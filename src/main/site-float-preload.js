'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('siteFloat', {
  onInit: (callback) => ipcRenderer.on('site-float:init', (_event, state) => callback(state)),
  onState: (callback) => ipcRenderer.on('site-float:state', (_event, state) => callback(state)),
  expand: (id) => ipcRenderer.send('site-float:expand', id),
  move: (id, deltaX, deltaY) => ipcRenderer.send('site-float:move', id, deltaX, deltaY),
  collapse: (id) => ipcRenderer.send('site-float:collapse', id),
  setMode: (id, mode) => ipcRenderer.send('site-float:set-mode', id, mode),
  close: (id) => ipcRenderer.send('site-float:close', id),
  openExternal: (url) => ipcRenderer.send('site-float:open-external', url),
});
