'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程唯一的 Node 能力入口。这里是白名单：没列出来的能力，
 * 页面里拿不到。工具代码统一通过 window.toolbox 访问。
 */
contextBridge.exposeInMainWorld('toolbox', {
  platform: process.platform,

  config: {
    all: () => ipcRenderer.invoke('config:all'),
    get: (key, fallback) => ipcRenderer.invoke('config:get', key, fallback),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },

  files: {
    /** 打开选图对话框，返回 { path, name, mime, base64 } 或 null（用户取消） */
    pickImage: () => ipcRenderer.invoke('files:pickImage'),
  },

  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  /** 内嵌页面请求打开新窗口时，主进程把 URL 转到这里 */
  onOpenUrl: (callback) => {
    ipcRenderer.on('webview:open-url', (_event, url) => callback(url));
  },

  app: {
    version: () => ipcRenderer.invoke('app:version'),
    reload: () => ipcRenderer.invoke('app:reload'),
    openDevTools: () => ipcRenderer.invoke('app:openDevTools'),
  },
});
