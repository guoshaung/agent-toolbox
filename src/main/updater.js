'use strict';
// Follow electron-updater's GitHub/NSIS flow. The library owns version
// comparison, download verification and installation; this module owns consent.
const { app, dialog, shell } = require('electron');

const RELEASES_PAGE = 'https://github.com/guoshaung/agent-toolbox/releases/latest';
const CHECK_DELAY_MS = 8000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let timer = null;
let startupTimer = null;
let checking = false;
let notifiedVersion = null;
let lastResult = { at: 0, ok: null, error: null, version: null };

function log(...args) { console.log('[updater]', ...args); }

function load() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('Cannot load electron-updater:', err.message);
    return null;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.on('error', (err) => log('Update failed:', err?.message || err));
  autoUpdater.on('update-downloaded', (info) => {
    promptInstall(info).catch((err) => log('Cannot prompt for installation:', err.message));
  });
  return autoUpdater;
}

async function promptInstall(info) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '更新已下载',
    message: `${info.version} 已经下好了`,
    detail: '现在重启就能用上新版本；也可以下次退出时自动装。',
    buttons: ['现在重启', '下次再说'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

async function promptDownload(info) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '有新版本',
    message: `Agent 工具箱 ${info.version} 可以更新了`,
    detail: `你现在用的是 ${app.getVersion()}。\n\n下载完成后会在下次退出时自动装上。`,
    buttons: ['下载', '打开发布页自己下', '这次不用'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 1) { await shell.openExternal(RELEASES_PAGE); return; }
  if (response === 0) await autoUpdater.downloadUpdate();
}

async function check({ silent = true } = {}) {
  if (!app.isPackaged) {
    if (!silent) {
      await dialog.showMessageBox({ type: 'info', title: '开发模式', message: '开发模式下不检查更新', detail: '打包后的版本才会走更新流程。' });
    }
    return { ok: false, error: '开发模式不检查更新' };
  }
  const updater = load();
  if (!updater) return { ok: false, error: '更新组件不可用' };
  if (checking) return { ok: false, error: '正在检查中' };
  checking = true;
  try {
    const result = await updater.checkForUpdates();
    const version = result?.updateInfo?.version;
    const hasNew = result?.isUpdateAvailable === true;
    if (hasNew && (!silent || version !== notifiedVersion)) {
      notifiedVersion = version;
      await promptDownload(result.updateInfo);
    } else if (!hasNew && !silent) {
      await dialog.showMessageBox({ type: 'info', title: '已是最新', message: `已经是最新版本 ${app.getVersion()}` });
    }
    lastResult = { at: Date.now(), ok: true, error: null, version };
    return { ok: true, version, hasNew };
  } catch (err) {
    notifiedVersion = null;
    log('Update check or download failed:', err.message);
    lastResult = { at: Date.now(), ok: false, error: err.message, version: null };
    return { ok: false, error: err.message };
  } finally {
    checking = false;
  }
}

function startAutoCheck() {
  if (!app.isPackaged || timer) return;
  if (!load()) return;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    check({ silent: true });
  }, CHECK_DELAY_MS);
  timer = setInterval(() => check({ silent: true }), CHECK_INTERVAL_MS);
}

function stopAutoCheck() {
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
}

function registerUpdaterIpc(ipcMain) {
  ipcMain.handle('update:check', () => check({ silent: false }));
  ipcMain.handle('update:current', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    // 后台那次静默检查的结果，让设置页能说清「查过了，失败在哪」
    last: lastResult,
  }));
  ipcMain.handle('update:openReleases', () => {
    shell.openExternal(RELEASES_PAGE).catch((err) => log('Cannot open releases:', err.message));
    return { ok: true };
  });
}

module.exports = { registerUpdaterIpc, startAutoCheck, stopAutoCheck };
