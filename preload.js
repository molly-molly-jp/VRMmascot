const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ウィンドウ操作
  dragStart:   () => ipcRenderer.send('drag-start'),
  dragMove:    () => ipcRenderer.send('drag-move'),
  dragEnd:     () => ipcRenderer.send('drag-end'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Phase 5: ショートカット読み上げ
  onSpeakQueue: (callback) => ipcRenderer.on('speak-queue', (_, text) => callback(text)),

  // Phase 6: config.json の設定値を取得
  getConfig: () => ipcRenderer.invoke('get-config'),
});
