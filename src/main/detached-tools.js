'use strict';

// 工具撕成独立窗口：复用同一个 index.html，带 ?detach=<toolId> 只渲染那一个工具。
// 关闭即收回；拖近主窗口(重叠超过阈值)松手自动吸附收回。

const { BrowserWindow } = require('electron');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const windows = new Map(); // toolId -> BrowserWindow
let deps = null;           // { getMainWindow, preload, getIcon }

function mainWin() {
  const mw = deps?.getMainWindow?.();
  return mw && !mw.isDestroyed() ? mw : null;
}

function notifyMain() {
  const mw = mainWin();
  if (mw) mw.webContents.send('detach:changed', [...windows.keys()]);
}

// 独立窗口和主窗口重叠超过自身面积的 ~35% 就算"靠近，可吸附"
function nearMain(win) {
  const mw = mainWin();
  if (!mw || win.isDestroyed()) return false;
  const a = win.getBounds();
  const b = mw.getBounds();
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ix * iy > 0.35 * a.width * a.height;
}

function openDetached(toolId, bounds) {
  const existing = windows.get(toolId);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { ok: true, focused: true }; }
  if (existing) windows.delete(toolId);

  const mw = mainWin();
  const base = mw ? mw.getBounds() : { x: 120, y: 120, width: 1000, height: 720 };
  const width = Math.max(480, Math.round(bounds?.width || Math.min(960, base.width * 0.72)));
  const height = Math.max(360, Math.round(bounds?.height || Math.min(720, base.height * 0.84)));
  const x = Math.round(bounds?.x ?? base.x + 56);
  const y = Math.round(bounds?.y ?? base.y + 56);

  const win = new BrowserWindow({
    x, y, width, height, minWidth: 420, minHeight: 320,
    title: 'Agent 工具箱', backgroundColor: '#12141a',
    titleBarStyle: 'hiddenInset', show: false,
    icon: deps?.getIcon?.() || undefined,
    webPreferences: {
      preload: deps.preload, contextIsolation: true, nodeIntegration: false,
      sandbox: true, webviewTag: true, spellcheck: false, backgroundThrottling: false,
    },
  });
  windows.set(toolId, win);
  win.loadFile(INDEX, { query: { detach: toolId } });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.on('closed', () => { if (windows.get(toolId) === win) windows.delete(toolId); notifyMain(); });

  let hinted = false;
  win.on('move', () => {
    if (win.isDestroyed()) return;
    const near = nearMain(win);
    if (near !== hinted) { hinted = near; win.webContents.send('detach:snapHint', near); }
  });
  win.on('moved', () => { if (nearMain(win)) dockDetached(toolId); });

  notifyMain();
  return { ok: true };
}

function dockDetached(toolId) {
  const win = windows.get(toolId);
  const mw = mainWin();
  if (mw) { mw.webContents.send('detach:dock', toolId); mw.show(); mw.focus(); }
  windows.delete(toolId);
  if (win && !win.isDestroyed()) win.close();
  notifyMain();
  return { ok: true };
}

function focusDetached(toolId) {
  const win = windows.get(toolId);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return { ok: true }; }
  return { ok: false };
}

function closeAll() {
  for (const w of windows.values()) { try { if (!w.isDestroyed()) w.close(); } catch (_) {} }
  windows.clear();
}

function registerDetachedIpc(ipcMain, d) {
  deps = d;
  ipcMain.handle('detach:open', (_e, toolId, bounds) => openDetached(String(toolId), bounds || null));
  ipcMain.handle('detach:dock', (_e, toolId) => dockDetached(String(toolId)));
  ipcMain.handle('detach:focus', (_e, toolId) => focusDetached(String(toolId)));
  ipcMain.handle('detach:list', () => [...windows.keys()]);
}

module.exports = { registerDetachedIpc, closeAll, openDetached, dockDetached };
