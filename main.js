const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

let win;

// config.json からショートカットキーを読み込む
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.warn('[main] config.json読み込み失敗、デフォルト使用:', e.message);
    return { shortcutKey: 'Ctrl+Shift+R' };
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
  // win.webContents.openDevTools({ mode: 'detach' });

  // ナビゲーションブロック
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect',  (e) => e.preventDefault());

  // ── ドラッグ移動 ─────────────────────────────────────────────
  let dragStart = null;
  ipcMain.on('drag-start', () => {
    dragStart = { cursor: screen.getCursorScreenPoint(), win: win.getPosition() };
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

  // ── Phase5: グローバルショートカット登録 ──────────────────────
  const config = loadConfig();
  const shortcutKey = config.shortcutKey || 'Ctrl+Shift+R';

  const registered = globalShortcut.register(shortcutKey, () => {
    const text = clipboard.readText().trim();
    if (!text) {
      console.log('[main] クリップボードが空のためスキップ');
      return;
    }
    console.log('[main] ショートカット発火、テキスト送信:', text.slice(0, 50) + '...');
    // レンダラーのキューにテキストを追加
    if (win && !win.isDestroyed()) {
      win.webContents.send('speak-queue', text);
    }
  });

  if (registered) {
    console.log(`[main] グローバルショートカット登録: ${shortcutKey}`);
  } else {
    console.error(`[main] ショートカット登録失敗: ${shortcutKey}（他のアプリが使用中の可能性）`);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll(); // アプリ終了時にショートカット解除
  if (process.platform !== 'darwin') app.quit();
});
