const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

let win;

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.warn('[main] config.json読み込み失敗:', e.message);
    return { shortcutKey: 'Ctrl+Shift+R', lipSyncDevice: 'VB-Audio Virtual Cable' };
  }
}

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
  win.webContents.openDevTools({ mode: 'detach' }); // デバッグON

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect',  (e) => e.preventDefault());

  const config = loadConfig();
  ipcMain.handle('get-config', () => config);

  // ドラッグ移動（スロットリングで高頻度IPC抑制）
  let dragStart = null;
  let lastMoveTime = 0;

  ipcMain.on('drag-start', () => {
    dragStart = { cursor: screen.getCursorScreenPoint(), win: win.getPosition() };
  });
  ipcMain.on('drag-move', () => {
    if (!dragStart) return;
    const now = Date.now();
    if (now - lastMoveTime < 16) return; // 約60fps に制限
    lastMoveTime = now;
    const cur = screen.getCursorScreenPoint();
    win.setPosition(
      dragStart.win[0] + (cur.x - dragStart.cursor.x),
      dragStart.win[1] + (cur.y - dragStart.cursor.y)
    );
  });
  ipcMain.on('drag-end',     () => { dragStart = null; });
  ipcMain.on('window-close', () => win.close());

  // Phase 5: グローバルショートカット
  const shortcutKey = config.shortcutKey || 'Ctrl+Shift+R';
  const registered = globalShortcut.register(shortcutKey, () => {
    const text = clipboard.readText().trim();
    if (!text) return;
    console.log('[main] ショートカット発火:', text.slice(0, 50));
    if (win && !win.isDestroyed()) win.webContents.send('speak-queue', text);
  });
  console.log(registered
    ? `[main] ショートカット登録: ${shortcutKey}`
    : `[main] ショートカット登録失敗: ${shortcutKey}`
  );
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
