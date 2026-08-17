import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';

// Kept separate from main.ts to avoid a circular import (main.ts -> ipc.ts -> main.ts).
// main.ts has top-level side effects (protocol.registerSchemesAsPrivileged) that must run
// before app is ready; if ipc.ts imports from main.ts, bundling can duplicate that top-level
// code into a lazily-loaded chunk, re-running it after the app is already ready and crashing.

let mainWindowRef: BrowserWindow | null = null;

export function setUpdaterMainWindow(win: BrowserWindow | null) {
  mainWindowRef = win;
}

export function setupAutoUpdater() {
  const isDev = process.env.VITE_DEV_SERVER_URL;

  // Don't check for updates in development mode
  if (isDev) {
    console.log('🔧 Development mode - auto-updater disabled');
    return;
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Don't download automatically - ask user first

  // Never swap the binary out from under a running bot.
  //
  // This is a private build for one machine and nothing is published to the
  // fork's releases, so an automatic install could only ever replace a working
  // app with something unexpected — while WhatsApp sessions are live. Updating
  // stays a deliberate act: rebuild and reinstall.
  autoUpdater.autoInstallOnAppQuit = false;

  // Log all auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for updates...');
    mainWindowRef?.webContents.send('updater:checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('✅ Update available:', info.version);
    mainWindowRef?.webContents.send('updater:update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('✅ App is up to date:', info.version);
    mainWindowRef?.webContents.send('updater:update-not-available');
  });

  autoUpdater.on('error', (err) => {
    console.error('❌ Error in auto-updater:', err);
    mainWindowRef?.webContents.send('updater:error', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const log = `Downloaded ${progressObj.percent.toFixed(2)}% (${progressObj.transferred}/${progressObj.total})`;
    console.log('⬇️', log);
    mainWindowRef?.webContents.send('updater:download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded:', info.version);
    mainWindowRef?.webContents.send('updater:update-downloaded', {
      version: info.version
    });
  });

  // No automatic check on launch.
  //
  // The configured feed is this fork's own repo, which deliberately has no
  // releases, so every launch used to 404 three seconds in and push an
  // 'updater:error' into the renderer — a failure notice for a feature that is
  // not in use. The manual checkForUpdates() below still works if a release is
  // ever published on purpose.
  console.log('🔒 Auto-update check on launch is disabled for this private build');
}

// Manually check for updates
export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}

// Download update
export function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

// Install update
export function quitAndInstall() {
  autoUpdater.quitAndInstall();
}
