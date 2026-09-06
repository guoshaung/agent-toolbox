'use strict';
/**
 * 自动更新。
 *
 * 走 GitHub Releases：CI 打完包传上去，客户端定期问一句「有没有新版」。
 *
 * 一个必须说清楚的平台限制：
 *   macOS 的更新是 Squirrel.Mac 在做，它会校验新版本的代码签名，
 *   **没有 Apple 开发者证书签过名的 app，下载完也装不上**。
 *   所以这里不假装能静默更新：装不上就退回「打开下载页，你自己拖一下」，
 *   而不是转个圈然后什么也没发生。
 *   Windows 的 NSIS 包没有这个限制，可以真正自动装。
 */
const { app, dialog, shell } = require('electron');

const RELEASES_PAGE = 'https://github.com/guoshaung/agent-toolbox/releases/latest';
const CHECK_DELAY_MS = 8000;          // 启动后先让界面跑起来，别抢资源
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 之后每 6 小时问一次

let autoUpdater = null;
let timer = null;
let checking = false;
let notifiedVersion = null;

function log(...args) { console.log('[updater]', ...args); }

function load() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('electron-updater 没装上：', err.message);
    return null;
  }
  autoUpdater.autoDownload = false;          // 先问用户，别默默占带宽
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  return autoUpdater;
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
  if (response === 1) { shell.openExternal(RELEASES_PAGE); return; }
  if (response !== 0) return;

  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log('下载失败', err.message);
    const { response: r2 } = await dialog.showMessageBox({
      type: 'warning',
      title: '自动下载没成功',
      message: '自动更新没能完成',
      detail: `${err.message}\n\nmacOS 上没有代码签名的应用装不了自动更新，这种情况去发布页手动下载一次即可。`,
      buttons: ['打开发布页', '算了'],
      defaultId: 0,
    });
    if (r2 === 0) shell.openExternal(RELEASES_PAGE);
  }
}

async function check({ silent = true } = {}) {
  const updater = load();
  if (!updater) {
    if (!silent) shell.openExternal(RELEASES_PAGE);
    return { ok: false, error: '更新组件不可用' };
  }
  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox({ type: 'info', title: '开发模式', message: '开发模式下不检查更新', detail: '打包后的版本才会走更新流程。' });
    }
    return { ok: false, error: '开发模式不检查更新' };
  }
  if (checking) return { ok: false, error: '正在检查中' };
  checking = true;
  try {
    const result = await updater.checkForUpdates();
    const version = result?.updateInfo?.version;
    const hasNew = version && version !== app.getVersion();
    if (hasNew && version !== notifiedVersion) {
      notifiedVersion = version;
      await promptDownload(result.updateInfo);
    } else if (!hasNew && !silent) {
      dialog.showMessageBox({ type: 'info', title: '已是最新', message: `已经是最新版本 ${app.getVersion()}` });
    }
    return { ok: true, version, hasNew: Boolean(hasNew) };
  } catch (err) {
    log('检查失败', err.message);
    if (!silent) {
      dialog.showMessageBox({ type: 'warning', title: '检查更新失败', message: '没能连上更新服务', detail: err.message });
    }
    return { ok: false, error: err.message };
  } finally {
    checking = false;
  }
}

function startAutoCheck() {
  const updater = load();
  if (!updater || !app.isPackaged) return;

  updater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: `${info.version} 已经下好了`,
      detail: '现在重启就能用上新版本；也可以下次退出时自动装。',
      buttons: ['现在重启', '下次再说'],
      defaultId: 0,
    });
    if (response === 0) updater.quitAndInstall();
  });
  updater.on('error', (err) => log('更新出错', err?.message || err));

  setTimeout(() => check({ silent: true }), CHECK_DELAY_MS);
  timer = setInterval(() => check({ silent: true }), CHECK_INTERVAL_MS);
}

function stopAutoCheck() {
  if (timer) clearInterval(timer);
  timer = null;
}

function registerUpdaterIpc(ipcMain) {
  ipcMain.handle('update:check', () => check({ silent: false }));
  ipcMain.handle('update:current', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('update:openReleases', () => { shell.openExternal(RELEASES_PAGE); return { ok: true }; });
}

module.exports = { registerUpdaterIpc, startAutoCheck, stopAutoCheck };
