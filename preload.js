const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ウィンドウ操作
  dragStart:   () => ipcRenderer.send('drag-start'),
  dragMove:    () => ipcRenderer.send('drag-move'),
  dragEnd:     () => ipcRenderer.send('drag-end'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Phase5: メインプロセスからのキュー追加を受け取る
  onSpeakQueue: (callback) => ipcRenderer.on('speak-queue', (_, text) => callback(text)),
});
