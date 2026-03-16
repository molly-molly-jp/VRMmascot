const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 600,
    resizable: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.openDevTools({ mode: 'detach' });

  // ── ナビゲーション・リロードを完全ブロック ──────────────────
  // Enterキー等でページがリロードされるのをメインプロセスで防ぐ
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault();
    console.log('[main] will-navigate blocked');
  });
  win.webContents.on('will-redirect', (e) => {
    e.preventDefault();
  });

  // ── ドラッグ移動 ─────────────────────────────────────────────
  let dragStart = null;

  ipcMain.on('drag-start', () => {
    dragStart = {
      cursor: screen.getCursorScreenPoint(),
      win:    win.getPosition(),
    };
  });

  ipcMain.on('drag-move', () => {
    if (!dragStart) return;
    const cur = screen.getCursorScreenPoint();
    win.setPosition(
      dragStart.win[0] + (cur.x - dragStart.cursor.x),
      dragStart.win[1] + (cur.y - dragStart.cursor.y)
    );
  });

  ipcMain.on('drag-end',     () => { dragStart = null; });
  ipcMain.on('window-close', () => win.close());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
