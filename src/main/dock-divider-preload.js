'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dockDivider', {
  move: (screenX) => ipcRenderer.send('dock:divider-move', screenX),
  end: () => ipcRenderer.send('dock:divider-end'),
  detach: () => ipcRenderer.send('dock:divider-detach'),
});
