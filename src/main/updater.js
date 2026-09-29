'use strict';
// Follow electron-updater's GitHub/NSIS flow. The library owns version
// comparison, download verification and installation; this module owns consent.
const { app, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const macUpdate = require('./mac-self-update');

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

let getMainWindow = () => null;

/**
 * mac：electron-updater 装不了没签名的包，自己下 zip 换 .app。
 * 进度打在 Dock 图标上；下好了问一句就重启。
 */
async function macSelfUpdate(version) {
  const win = getMainWindow();
  const dir = path.join(app.getPath('temp'), `agent-toolbox-update-${version}`);
  const url = macUpdate.assetUrl(version);
  log('mac self-update from', url);
  try {
    const newApp = await macUpdate.downloadAndExtract({
      url, dir, execFile: promisify(execFile),
      onProgress: (frac) => { try { win?.setProgressBar(frac >= 0 ? frac : 2); } catch { /* 窗口没了 */ } },
    });
    try { win?.setProgressBar(-1); } catch { /* ignore */ }
    const { response } = await dialog.showMessageBox({
      type: 'info', title: '更新已下载', message: `${version} 下好了`,
      detail: '点「现在重启」会退出、换上新版本、再自动打开。', buttons: ['现在重启', '下次再说'], defaultId: 0, cancelId: 1,
    });
    if (response !== 0) return;
    const target = macUpdate.bundlePathFromExe(app.getPath('exe'));
    macUpdate.launchSwap({ pid: process.pid, target, newApp, dir, spawn });
    setTimeout(() => app.quit(), 200);
  } catch (err) {
    try { win?.setProgressBar(-1); } catch { /* ignore */ }
    log('mac self-update failed:', err.message);
    const { response } = await dialog.showMessageBox({
      type: 'warning', title: '自动更新没成功', message: err.message,
      detail: '连不上 GitHub 的话，去发布页手动下载 dmg 装一次也行。', buttons: ['打开发布页', '算了'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) await shell.openExternal(RELEASES_PAGE);
  }
}

async function promptDownload(info) {
  const mac = process.platform === 'darwin';
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '有新版本',
    message: `Agent 工具箱 ${info.version} 可以更新了`,
    detail: `你现在用的是 ${app.getVersion()}。\n\n${mac ? '会直接下载并替换应用，进度显示在 Dock 图标上；下好后重启一下就是新版。' : '下载完成后会在下次退出时自动装上。'}`,
    buttons: [mac ? '下载并重启' : '下载', '打开发布页自己下', '这次不用'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 1) { await shell.openExternal(RELEASES_PAGE); return; }
  if (response !== 0) return;
  if (mac) await macSelfUpdate(info.version);
  else await autoUpdater.downloadUpdate();
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

function registerUpdaterIpc(ipcMain, { getWindow } = {}) {
  if (typeof getWindow === 'function') getMainWindow = getWindow;
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
