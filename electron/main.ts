import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, Menu, Tray, nativeImage, powerSaveBlocker, protocol } from 'electron';
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
  // Double-clicking the desktop icon while the app is already running (possibly
  // hidden in the tray) should bring the window back, not start a second copy.
  app.on('second-instance', () => showMainWindow());
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
let tray: Tray | null = null;

/**
 * True only once the user has genuinely asked to exit (tray menu, or the OS
 * shutting down). Closing the window sets nothing — it hides instead.
 */
let isQuitting = false;

/** The "still running in the background" balloon is shown once per session. */
let hasShownTrayHint = false;

/**
 * The app icon, or undefined to fall back to Electron's default.
 *
 * In production the icon lives inside the asar; asarUnpack only extracts
 * better-sqlite3 and whatsapp-web.js, so dist/assets is never written to disk.
 * fs works on asar paths, and the Vite content hash changes whenever the image
 * does, so match by pattern rather than hardcoding a filename.
 */
function resolveIconPath(): string | undefined {
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(process.cwd(), 'src', 'images', 'lead-icon.png');
  }
  const assetsDir = path.join(__dirname, '..', 'dist', 'assets');
  try {
    const match = fs.readdirSync(assetsDir).find(n => /^lead-icon-.*\.png$/.test(n));
    if (match) return path.join(assetsDir, match);
  } catch {
    // fall through to Electron's default icon
  }
  return undefined;
}

/** Brings the window back, recreating it if it was destroyed. */
function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Tray icon, so closing the window leaves the bot running.
 *
 * Everything that answers WhatsApp — WhatsAppManager, the chatbot and the FYI
 * digest scheduler — lives in the main process. Without this, clicking X quit
 * the app and silently stopped answering messages, which is the opposite of
 * what an always-on bot needs.
 */
function createTray() {
  if (tray) return;

  const iconPath = resolveIconPath();
  try {
    tray = iconPath ? new Tray(iconPath) : new Tray(nativeImage.createEmpty());
  } catch (error) {
    console.warn('⚠️ Could not create tray icon:', error);
    return;
  }

  tray.setToolTip('LeadSender — הבוט פעיל');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתיחת LeadSender', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'יציאה (הבוט יפסיק לענות)',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', () => showMainWindow());
  console.log('🔔 Tray icon ready - closing the window keeps the bot running');
}

function createWindow() {
  // In production, __dirname points to dist-electron
  // In dev, we need to use process.cwd()
  const isDev = process.env.VITE_DEV_SERVER_URL;
  
  const preloadPath = isDev 
    ? path.join(process.cwd(), 'dist-electron', 'preload.js')
    : path.join(__dirname, 'preload.js');
    
  const iconPath = resolveIconPath();

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

  // Closing the window hides it; the bot keeps answering in the background and
  // the tray icon is how you get back. Only the tray's Quit (or the OS shutting
  // us down) actually exits.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    if (!hasShownTrayHint) {
      hasShownTrayHint = true;
      tray?.displayBalloon?.({
        title: 'LeadSender ממשיך לרוץ',
        content: 'הבוט ממשיך לענות להודעות ברקע. לפתיחה — לחיצה כפולה על הסמל בשורת המשימות.',
      });
    }
  });

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

  // Persist logs to disk now that userData is settled. Everything above this
  // point is still captured — the buffered backlog is written with the rest.
  logger.setLogDirectory(path.join(app.getPath('userData'), 'logs'));

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

  // Drop Electron's stock application menu in production.
  //
  // autoHideMenuBar only hides it until Alt is pressed, and the default menu
  // carries a Quit item — which now genuinely stops the bot, since closing the
  // window merely hides it. Removing the menu closes that accidental exit, and
  // takes the (already inert) Toggle Developer Tools entry with it. The
  // right-click context menu is built separately and is unaffected.
  if (!process.env.VITE_DEV_SERVER_URL) {
    Menu.setApplicationMenu(null);
  }

  createWindow();
  createTray();

  // Keep answering WhatsApp when the machine would otherwise idle down. The
  // current power plan happens to have sleep disabled, but that is a setting
  // anyone can change — the bot should not depend on it silently.
  try {
    powerSaveBlocker.start('prevent-app-suspension');
  } catch (error) {
    console.warn('⚠️ Could not block app suspension:', error);
  }

  // Setup auto-updater (after window is created)
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Deliberately does NOT quit. The window is hidden rather than destroyed, so
// reaching here means it was genuinely torn down — and the bot should still be
// answering WhatsApp. The tray's Quit is the only way out.
app.on('window-all-closed', () => {
  console.log('🪟 Window closed - LeadSender keeps running in the tray');
});

// Save state before quitting (campaigns and warmup will auto-resume on next start)
app.on('before-quit', () => {
  isQuitting = true;
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
  logger.flushSync();
});

export { mainWindow };
