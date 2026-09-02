'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('termPopup', {
  onState: (callback) => ipcRenderer.on('term:popup-state', (_event, state) => callback(state)),
  close: () => ipcRenderer.send('term:popup-close'),
  openTool: () => ipcRenderer.send('term:popup-open-tool'),
  copy: (text) => ipcRenderer.send('term:popup-copy', text),
  search: (query) => ipcRenderer.send('term:popup-search', query),
});
