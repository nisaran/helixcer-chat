const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
  Notification
} = require('electron');
const path = require('path');

const APP_URL = String(process.env.HELIXCER_APP_URL || 'https://chat.helixcer.com').replace(/\/$/, '');
const START_HASH = '#inbox';
const isWindows = process.platform === 'win32';

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
let hasShownTrayHint = false;

function iconPath(fileName) {
  return path.join(__dirname, 'assets', fileName);
}

function loadAppIcon() {
  const candidates = isWindows
    ? ['icon.ico', 'tray.png', 'icon.png']
    : ['tray.png', 'icon.png', 'icon.ico'];
  for (const name of candidates) {
    const image = nativeImage.createFromPath(iconPath(name));
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

function createTray() {
  if (tray) return tray;
  const image = loadAppIcon();
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Helixcer Chat');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Helixcer Chat',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  return tray;
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray({ announce = true } = {}) {
  if (!mainWindow) return;
  createTray();
  mainWindow.hide();
  if (announce && isWindows && Notification.isSupported() && !hasShownTrayHint) {
    hasShownTrayHint = true;
    new Notification({
      title: 'Helixcer Chat is still running',
      body: 'The app was hidden to the system tray. Click the tray icon to open it again, or choose Quit to exit.'
    }).show();
  }
}

function createMainWindow() {
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    createTray();
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hideToTray();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(APP_URL);
      if (target.origin !== allowed.origin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${APP_URL}/${START_HASH}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    createMainWindow();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    if (quitting) {
      if (tray) {
        tray.destroy();
        tray = null;
      }
      return;
    }
    // Keep the process alive while hidden in the tray.
  });

  app.on('activate', () => {
    showMainWindow();
  });
}
