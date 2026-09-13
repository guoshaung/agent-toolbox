'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avatar', {
  open: () => ipcRenderer.invoke('avatar:open'),
  close: () => ipcRenderer.invoke('avatar:close'),
  status: () => ipcRenderer.invoke('avatar:status'),
  getSettings: () => ipcRenderer.invoke('avatar:settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('avatar:settings:update', patch),
  pickModel: () => ipcRenderer.invoke('avatar:model:pick'),
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('avatar:settings-changed', listener);
    return () => ipcRenderer.removeListener('avatar:settings-changed', listener);
  },
});
