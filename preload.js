const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── VRMウィンドウ用: ドラッグ移動 ──────────────────────────
  dragStart:   () => ipcRenderer.send('drag-start'),
  dragMove:    () => ipcRenderer.send('drag-move'),
  dragEnd:     () => ipcRenderer.send('drag-end'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // ── VRMウィンドウ用: 透過ヒットテスト ──────────────────────
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),

  // ── VRMウィンドウ用: コマンド受信 ──────────────────────────
  onSpeakQueue:  (cb) => ipcRenderer.on('speak-queue',     (_, t)  => cb(t)),
  onSwitchGroup: (cb) => ipcRenderer.on('do-switch-group', (_, id) => cb(id)),
  onSwitchModel: (cb) => ipcRenderer.on('do-switch-model', (_, p)  => cb(p)),
  onSendText:    (cb) => ipcRenderer.on('do-send-text',    (_, t)  => cb(t)),
  onClearQueue:  (cb) => ipcRenderer.on('do-clear-queue',  ()      => cb()),

  // ── VRMウィンドウ用: ステータスをコントロールへ通知 ────────
  sendStatus: (text) => ipcRenderer.send('vrm-status', text),

  // ── コントロールウィンドウ用: コマンド送信 ──────────────────
  switchGroup:   (groupId)   => ipcRenderer.send('ctrl-switch-group', groupId),
  switchModel:   (modelPath) => ipcRenderer.send('ctrl-switch-model', modelPath),
  sendTextToVRM: (text)      => ipcRenderer.send('ctrl-send-text', text),
  clearQueue:    ()          => ipcRenderer.send('ctrl-clear-queue'),

  // ── コントロールウィンドウ用: 自身の最前面トグル ────────────
  toggleAlwaysOnTop: () => ipcRenderer.invoke('ctrl-toggle-always-on-top'),

  // ── コントロールウィンドウ用: ステータス受信 ────────────────
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, text) => cb(text)),

  // ── Phase 8: DOM受信トグル ──────────────────────────────────
  toggleDomReceive:   () => ipcRenderer.invoke('ctrl-toggle-dom-receive'),
  getDomReceiveState: () => ipcRenderer.invoke('get-dom-receive-state'),

  // ── 共通 ────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('get-config'),
});
