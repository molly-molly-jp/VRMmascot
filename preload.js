const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  dragStart:   () => ipcRenderer.send('drag-start'),
  dragMove:    () => ipcRenderer.send('drag-move'),
  dragEnd:     () => ipcRenderer.send('drag-end'),
  closeWindow: () => ipcRenderer.send('window-close'),
});
