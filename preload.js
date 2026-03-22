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
  onSpeakQueue:  (cb) => ipcRenderer.on('speak-queue',     (_, t)    => cb(t)),
  onSwitchGroup: (cb) => ipcRenderer.on('do-switch-group', (_, id)   => cb(id)),
  onSwitchModel: (cb) => ipcRenderer.on('do-switch-model', (_, data) => cb(data)),
  onSendText:    (cb) => ipcRenderer.on('do-send-text',    (_, t)    => cb(t)),
  onClearQueue:  (cb) => ipcRenderer.on('do-clear-queue',  ()        => cb()),

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

  // ── Phase 10: フォルダスキャン＆モーション再生 ────────────────
  scanVrmFiles:  (groupId)    => ipcRenderer.invoke('scan-vrm-files', groupId),
  scanVrmaFiles: ()           => ipcRenderer.invoke('scan-vrma-files'),
  playMotion:    (motionPath) => ipcRenderer.send('ctrl-play-motion', motionPath),
  onPlayMotion:  (cb)         => ipcRenderer.on('do-play-motion', (_, p) => cb(p)),

  // ── Phase 10-3: 登場演出A ────────────────────────────────────
  entranceA:    (modelPath) => ipcRenderer.send('ctrl-entrance-a', modelPath),
  onEntranceA:  (cb)        => ipcRenderer.on('do-entrance-a', (_, data) => cb(data)),

  // ── Phase 10-3: 登場演出B ────────────────────────────────────
  entranceB:    (modelPath) => ipcRenderer.send('ctrl-entrance-b', modelPath),
  onEntranceB:  (cb)        => ipcRenderer.on('do-entrance-b', (_, data) => cb(data)),

  // ── Phase 10-3: 登場演出C（ランダム抽選） ────────────────────
  entranceC:    (modelPath) => ipcRenderer.send('ctrl-entrance-c', modelPath),
  onEntranceC:  (cb)        => ipcRenderer.on('do-entrance-c', (_, data) => cb(data)),

  // ── Phase 11: カメラ操作 ─────────────────────────────────────
  toggleCamera:      () => ipcRenderer.invoke('ctrl-toggle-camera'),
  onCameraToggle:    (cb) => ipcRenderer.on('do-camera-toggle', (_, enabled) => cb(enabled)),

  // ── Phase 11-2: カメラプリセット ─────────────────────────────
  savePreset:        (index) => ipcRenderer.invoke('ctrl-save-preset', index),
  loadPreset:        (index) => ipcRenderer.send('ctrl-load-preset', index),
  resetCamera:       ()      => ipcRenderer.send('ctrl-reset-camera'),
  onSetCameraOrbit:  (cb)    => ipcRenderer.on('do-set-camera-orbit', (_, data) => cb(data)),

  // ── Phase 12-2: 表情切り替え ──────────────────────────────────
  onSetExpression:   (cb)    => ipcRenderer.on('do-set-expression', (_, name) => cb(name)),

  // ── Phase 13-5: ライティング調整 ─────────────────────────────
  getLighting: (modelPath) =>
    ipcRenderer.invoke('ctrl-get-lighting', modelPath),
  updateLighting: (modelPath, params) =>
    ipcRenderer.invoke('ctrl-update-lighting', modelPath, params),
  saveLighting: (modelPath, params) =>
    ipcRenderer.invoke('ctrl-save-lighting', modelPath, params),
  onSetLighting: (cb) =>
    ipcRenderer.on('do-set-lighting', (_, params) => cb(params)),

  // ── Phase 13-4: 口パク調整 ───────────────────────────────────
  updateLipsync: (modelPath, sensitivity, maxMouthOpen) =>
    ipcRenderer.invoke('ctrl-update-lipsync', modelPath, sensitivity, maxMouthOpen),
  saveLipsync: (modelPath, sensitivity, maxMouthOpen) =>
    ipcRenderer.invoke('ctrl-save-lipsync', modelPath, sensitivity, maxMouthOpen),
  onSetLipsync: (cb) =>
    ipcRenderer.on('do-set-lipsync', (_, data) => cb(data)),

  // ── Phase 13-2: soundDelayMs ─────────────────────────────────
  updateSoundDelay: (modelPath, pattern, value) =>
    ipcRenderer.invoke('ctrl-update-sound-delay', modelPath, pattern, value),
  saveSoundDelay: (modelPath, pattern, value) =>
    ipcRenderer.invoke('ctrl-save-sound-delay', modelPath, pattern, value),

  // ── 共通 ────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('get-config'),
});
