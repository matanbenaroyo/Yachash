import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, Menu, protocol } from 'electron';
import { initDatabase, closeDatabase } from './database/index';
import { setupIPCHandlers, campaignScheduler, warmUpService } from './ipc';
import { logger } from './logger';
import { setupAutoUpdater, setUpdaterMainWindow } from './updater';

// Development uses an ISOLATED userData directory.
//
// Everything stateful hangs off app.getPath('userData'): leadsender.db, the
// WhatsApp LocalAuth sessions/ folder, media/, chat-photos/ and .license. Without
// this override a `npm run electron:dev` session shares all of it with the
// INSTALLED LeadSender, so any dev experiment mutates real production data — and
// because campaigns with status='running' auto-resume on startup, it could send
// real messages to real contacts.
//
// Must run before app is ready and before anything reads userData (initDatabase
// and the LicenseManager constructor both do). Production is unaffected.
if (process.env.VITE_DEV_SERVER_URL) {
  const devUserData = path.join(app.getPath('appData'), 'leadsender-dev');
  fs.mkdirSync(devUserData, { recursive: true });
  app.setPath('userData', devUserData);
  console.log('🧪 Dev mode - isolated userData:', devUserData);
}

// Only one copy of the app may run at a time.
//
// Two instances share one SQLite file and one WhatsApp session folder. Both keep
// a long-lived connection with the WAL memory-mapped, and the second one racing
// the first over those sidecars is what surfaces as "database disk image is
// malformed" on a file that is actually intact. Focus the existing window
// instead of opening a second copy.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.log('⚠️ LeadSender is already running - focusing the existing window');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// Register custom protocol for serving local files (e.g. chat photos)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);

// Initialize logger immediately to capture all logs
console.log('🚀 LeadSender starting...');

// Safety net: whatsapp-web.js internally fires some page.evaluate() calls
// (e.g. requestPairingCode) outside of the promise chain we await, so a
// rejection there (e.g. page/context closed mid-evaluation) can surface as an
// unhandled rejection here rather than at our call site. Without this handler
// Node prints a raw, unformatted warning; catching it lets us log it through
// our logger without crashing the app.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled promise rejection (caught, app continues running):', reason);
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // In production, __dirname points to dist-electron
  // In dev, we need to use process.cwd()
  const isDev = process.env.VITE_DEV_SERVER_URL;
  
  const preloadPath = isDev 
    ? path.join(process.cwd(), 'dist-electron', 'preload.js')
    : path.join(__dirname, 'preload.js');
    
  // Production icon previously pointed at
  //   process.resourcesPath/app.asar.unpacked/dist/assets/lead-icon-<hash>.png
  // which never exists: asarUnpack only unpacks better-sqlite3 and whatsapp-web.js,
  // so dist/assets is never written outside the asar. It also hardcoded a Vite
  // content hash that changes whenever the image does. Resolve inside the asar
  // (fs works on asar paths) and match the hash by pattern instead.
  const iconPath = isDev
    ? path.join(process.cwd(), 'src', 'images', 'lead-icon.png')
    : (() => {
        const assetsDir = path.join(__dirname, '..', 'dist', 'assets');
        try {
          const match = fs.readdirSync(assetsDir).find(n => /^lead-icon-.*\.png$/.test(n));
          if (match) return path.join(assetsDir, match);
        } catch {
          // fall through to Electron's default icon
        }
        return undefined;
      })();
  
  console.log('Is Dev:', isDev);
  console.log('__dirname:', __dirname);
  console.log('process.cwd():', process.cwd());
  console.log('Preload path:', preloadPath);
  console.log('Preload exists:', require('fs').existsSync(preloadPath));
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    autoHideMenuBar: true, // Hide menu bar
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev ? true : false // Enable DevTools only in development
    },
  });

  // Remove menu completely
  mainWindow.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    // Development mode - load from dev server
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Open DevTools in dev mode for debugging
    mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    // DO NOT open DevTools in production
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    setUpdaterMainWindow(null);
  });

  setUpdaterMainWindow(mainWindow);

  // DevTools control in production
  if (!isDev) {
    // Block default DevTools shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Block F12
      if (input.key === 'F12') {
        event.preventDefault();
      }
      // Block Ctrl+Shift+I (Windows/Linux)
      if (input.control && input.shift && input.key === 'I') {
        event.preventDefault();
      }
      // Block Cmd+Option+I (Mac)
      if (input.meta && input.alt && input.key === 'I') {
        event.preventDefault();
      }
      
      // Allow Ctrl+Shift+D as secret DevTools toggle
      if (input.control && input.shift && input.key === 'D') {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
    });
  }

  // Enable right-click context menu for input fields
  // This is essential for copy/paste in Electron apps
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { editFlags, selectionText, isEditable } = params;
    
    // Show context menu for editable fields (input, textarea, contenteditable)
    if (isEditable || params.inputFieldType === 'plainText') {
      const hasText = selectionText && selectionText.length > 0;
      
      const menu = Menu.buildFromTemplate([
        {
          label: 'Cut',
          role: 'cut',
          accelerator: 'CmdOrCtrl+X',
          enabled: editFlags.canCut && hasText,
          visible: hasText
        },
        {
          label: 'Copy',
          role: 'copy',
          accelerator: 'CmdOrCtrl+C',
          enabled: editFlags.canCopy && hasText,
          visible: hasText
        },
        {
          label: 'Paste',
          role: 'paste',
          accelerator: 'CmdOrCtrl+V',
          enabled: editFlags.canPaste
        },
        {
          label: 'Delete',
          role: 'delete',
          enabled: editFlags.canDelete && hasText,
          visible: hasText
        },
        { 
          type: 'separator',
          visible: hasText
        },
        {
          label: 'Select All',
          role: 'selectAll',
          accelerator: 'CmdOrCtrl+A',
          enabled: editFlags.canSelectAll
        }
      ]);
      
      menu.popup();
    }
  });
}

app.whenReady().then(async () => {
  // app.quit() above is asynchronous, so 'ready' can still fire in the losing
  // instance. Nothing below may touch the database or the session folder.
  if (!hasSingleInstanceLock) return;

  // Register protocol handler for local files (chat photos, etc.)
  protocol.handle('local-file', (request) => {
    // URL comes as local-file:///C:/Users/... — strip scheme and leading slash before drive letter
    let filePath = decodeURIComponent(request.url.slice('local-file:///'.length));
    filePath = filePath.replace(/\//g, '\\');
    console.log('📸 local-file protocol - raw URL:', request.url);
    console.log('📸 local-file protocol - resolved path:', filePath);
    console.log('📸 local-file protocol - file exists:', fs.existsSync(filePath));
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      };
      return new Response(data, {
        headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // Initialize database
  await initDatabase();

  // Setup IPC handlers
  setupIPCHandlers();

  createWindow();
  
  // Setup auto-updater (after window is created)
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Save state before quitting (campaigns and warmup will auto-resume on next start)
app.on('before-quit', () => {
  console.log('💾 App closing - state will be preserved in database for auto-resume');
  
  // Note: We don't need to do anything here!
  // The campaigns and warm-up sessions have status = 'running' in DB
  // They will auto-resume when the app starts again
  
  // Optional: You could pause everything here if you want manual resume instead:
  // campaignScheduler.pauseAll();
  // warmUpService.stopAll();

  // Fold the WAL back into the database file and close cleanly, so the next
  // launch opens a single consistent file instead of replaying a large WAL.
  if (hasSingleInstanceLock) closeDatabase();
});

export { mainWindow };
