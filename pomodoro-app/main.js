const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Create a simple tomato icon as a data URL (32x32 PNG-like via nativeImage)
function createTrayIcon() {
  // Create a simple 16x16 tomato-colored square icon using raw bitmap
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const r = Math.sqrt(cx * cx + cy * cy);
      if (r < size / 2 - 0.5) {
        // Tomato red body
        buf[idx] = 229;     // R
        buf[idx + 1] = 57;  // G
        buf[idx + 2] = 53;  // B
        buf[idx + 3] = 255; // A
      } else if (r < size / 2 + 0.5) {
        // Darker edge
        buf[idx] = 198;
        buf[idx + 1] = 40;
        buf[idx + 2] = 40;
        buf[idx + 3] = 255;
      } else {
        buf[idx + 3] = 0; // transparent
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 400,
    minHeight: 640,
    icon: createTrayIcon(),
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('番茄钟 - 准备开始');

  const updateTrayMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// IPC Handlers
ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, icon: createTrayIcon() });
    notification.show();
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    return true;
  }
  return false;
});

ipcMain.handle('set-always-on-top', (event, flag) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(flag);
    return true;
  }
  return false;
});

ipcMain.handle('set-tray-tooltip', (event, text) => {
  if (tray) {
    tray.setToolTip(text);
  }
});

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle('close-app', () => {
  isQuitting = true;
  app.quit();
});

// ---- Data Persistence (file-based, survives app restarts) ----
function getDataPath() {
  return path.join(app.getPath('userData'), 'pomodoro-data.json');
}

ipcMain.handle('load-data', () => {
  try {
    const p = getDataPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('load-data failed:', e);
  }
  return null;
});

ipcMain.handle('save-data', (event, data) => {
  try {
    const p = getDataPath();
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('save-data failed:', e);
    return false;
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});
