const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

let vrmWin;
let ctrlWin;

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('[main] config読み込み成功 groups:', config.groups?.length);
    return config;
  } catch (e) {
    console.error('[main] config.json読み込み失敗:', e.message);
    return { shortcutKey: 'Ctrl+Shift+R', groups: [] };
  }
}

function createVRMWindow() {
  vrmWin = new BrowserWindow({
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
  vrmWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  vrmWin.webContents.on('will-navigate', (e) => e.preventDefault());
  vrmWin.webContents.on('will-redirect',  (e) => e.preventDefault());

  let dragStart    = null;
  let lastMoveTime = 0;
  ipcMain.on('drag-start', () => {
    dragStart = { cursor: screen.getCursorScreenPoint(), win: vrmWin.getPosition() };
  });
  ipcMain.on('drag-move', () => {
    if (!dragStart) return;
    const now = Date.now();
    if (now - lastMoveTime < 16) return;
    lastMoveTime = now;
    const cur = screen.getCursorScreenPoint();
    vrmWin.setPosition(
      dragStart.win[0] + (cur.x - dragStart.cursor.x),
      dragStart.win[1] + (cur.y - dragStart.cursor.y)
    );
  });
  ipcMain.on('drag-end',     () => { dragStart = null; });
  ipcMain.on('window-close', () => vrmWin.close());

  ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
    if (!vrmWin || vrmWin.isDestroyed()) return;
    vrmWin.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('vrm-status', (_, text) => {
    if (ctrlWin && !ctrlWin.isDestroyed())
      ctrlWin.webContents.send('status-update', text);
  });
}

function createControlWindow() {
  const displays = screen.getAllDisplays();
  const target   = displays.length > 1 ? displays[1] : displays[0];

  ctrlWin = new BrowserWindow({
    width:  360,
    height: 400,
    x: target.bounds.x + 20,
    y: target.bounds.y + 20,
    resizable: true,
    alwaysOnTop: false,
    title: 'VRM Mascot — コントロール',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  ctrlWin.loadFile(path.join(__dirname, 'renderer', 'control.html'));
  ctrlWin.on('close', (e) => { e.preventDefault(); ctrlWin.hide(); });
}

function setupIPC(config) {
  // ── get-config は既に登録済みの場合は登録しない ──────────────
  // ウィンドウreload時に二重登録されるのを防ぐ
  if (!ipcMain.listenerCount('get-config-handled')) {
    ipcMain.handle('get-config', () => {
      console.log('[main] get-config 呼ばれた groups:', config.groups?.length);
      return config;
    });
  }

  ipcMain.on('ctrl-switch-group', (_, id) => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-switch-group', id);
  });
  ipcMain.on('ctrl-switch-model', (_, p) => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-switch-model', p);
  });
  ipcMain.on('ctrl-send-text', (_, t) => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-send-text', t);
  });
  ipcMain.on('ctrl-clear-queue', () => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-clear-queue');
  });

  ipcMain.handle('ctrl-toggle-always-on-top', () => {
    if (!ctrlWin || ctrlWin.isDestroyed()) return false;
    const next = !ctrlWin.isAlwaysOnTop();
    ctrlWin.setAlwaysOnTop(next);
    return next;
  });
}

function setupShortcut(config) {
  const key = config.shortcutKey || 'Ctrl+Shift+R';
  const ok  = globalShortcut.register(key, () => {
    const text = clipboard.readText().trim();
    if (!text) return;
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('speak-queue', text);
  });
  console.log(ok ? `[main] ショートカット登録: ${key}` : `[main] ショートカット登録失敗: ${key}`);
}

app.whenReady().then(() => {
  const config = loadConfig();

  // ── IPCハンドラを先に登録してからウィンドウを開く ──────────
  // ウィンドウのJSが invoke('get-config') を呼ぶ前に
  // ハンドラが存在している必要がある
  setupIPC(config);
  setupShortcut(config);

  createVRMWindow();
  createControlWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createVRMWindow();
      createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
