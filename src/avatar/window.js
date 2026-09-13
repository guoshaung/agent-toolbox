'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');

const PARTITION = 'persist:avatar-output';
const SETTINGS_FILE = 'avatar-output-settings.json';
const DEFAULT_SETTINGS = Object.freeze({
  cameraId: '', modelPath: '', backgroundMode: 'transparent', backgroundColor: '#18202b',
  alwaysOnTop: true, frameless: false,
});

function sanitizeSettings(value = {}) {
  return {
    cameraId: typeof value.cameraId === 'string' ? value.cameraId : '',
    modelPath: typeof value.modelPath === 'string' ? value.modelPath : '',
    backgroundMode: value.backgroundMode === 'solid' ? 'solid' : 'transparent',
    backgroundColor: /^#[0-9a-f]{6}$/i.test(value.backgroundColor) ? value.backgroundColor : DEFAULT_SETTINGS.backgroundColor,
    alwaysOnTop: value.alwaysOnTop === undefined ? DEFAULT_SETTINGS.alwaysOnTop : Boolean(value.alwaysOnTop),
    frameless: Boolean(value.frameless),
  };
}

/** Owns the dedicated, OBS-capturable avatar window and its narrow IPC surface. */
function createAvatarWindowController({ getMainWindow = () => null } = {}) {
  let avatarWindow = null;
  let bounds = null;
  let settings = loadSettings();

  const avatarSession = session.fromPartition(PARTITION);
  avatarSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isAvatar = avatarWindow && !avatarWindow.isDestroyed() && webContents === avatarWindow.webContents;
    const wantsVideo = !details?.mediaTypes || details.mediaTypes.includes('video');
    const wantsAudio = details?.mediaTypes?.includes('audio');
    callback(Boolean(isAvatar && permission === 'media' && wantsVideo && !wantsAudio));
  });
  avatarSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    const isAvatar = avatarWindow && !avatarWindow.isDestroyed() && webContents === avatarWindow.webContents;
    return Boolean(isAvatar && permission === 'media' && details?.mediaType !== 'audio');
  });

  function filePath() { return path.join(app.getPath('userData'), SETTINGS_FILE); }
  function loadSettings() {
    try { return sanitizeSettings(JSON.parse(fs.readFileSync(filePath(), 'utf8'))); }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings() {
    const target = filePath();
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
  function status() {
    return { open: Boolean(avatarWindow && !avatarWindow.isDestroyed()), settings: { ...settings } };
  }
  function rememberBounds() {
    if (avatarWindow && !avatarWindow.isDestroyed()) bounds = avatarWindow.getBounds();
  }
  function createWindow() {
    avatarWindow = new BrowserWindow({
      width: bounds?.width || 960, height: bounds?.height || 640,
      ...(Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y) ? { x: bounds.x, y: bounds.y } : {}),
      minWidth: 560, minHeight: 420, title: 'Avatar Output', frame: !settings.frameless,
      transparent: true, backgroundColor: '#00000000', resizable: true,
      alwaysOnTop: settings.alwaysOnTop, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), partition: PARTITION,
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    avatarWindow.setMenuBarVisibility(false);
    avatarWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    avatarWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    avatarWindow.webContents.on('will-navigate', (event, url) => {
      if (url !== avatarWindow.webContents.getURL()) event.preventDefault();
    });
    avatarWindow.once('ready-to-show', () => avatarWindow?.show());
    avatarWindow.on('closed', () => { avatarWindow = null; });
    avatarWindow.on('resize', rememberBounds);
    avatarWindow.on('move', rememberBounds);
    avatarWindow.loadFile(path.join(__dirname, 'settings-panel.html'));
  }
  async function open() {
    if (!avatarWindow || avatarWindow.isDestroyed()) createWindow();
    if (avatarWindow.isMinimized()) avatarWindow.restore();
    avatarWindow.show();
    avatarWindow.focus();
    return status();
  }
  function close() {
    avatarWindow?.close();
    return { ...status(), open: false };
  }
  function recreateWindow() {
    if (!avatarWindow || avatarWindow.isDestroyed()) return;
    rememberBounds();
    avatarWindow.destroy();
    createWindow();
  }
  function updateSettings(patch = {}) {
    const previousFrameless = settings.frameless;
    settings = sanitizeSettings({ ...settings, ...patch });
    saveSettings();
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      if (settings.frameless !== previousFrameless) setImmediate(recreateWindow);
      else {
        avatarWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
        avatarWindow.webContents.send('avatar:settings-changed', settings);
      }
    }
    return { ...settings };
  }
  function isAvatarSender(event) {
    return Boolean(avatarWindow && !avatarWindow.isDestroyed() && event.sender === avatarWindow.webContents);
  }

  ipcMain.handle('avatar:open', () => open());
  ipcMain.handle('avatar:close', () => close());
  ipcMain.handle('avatar:status', () => status());
  ipcMain.handle('avatar:settings:get', (event) => isAvatarSender(event) ? { ...settings } : null);
  ipcMain.handle('avatar:settings:update', (event, patch) => {
    if (!isAvatarSender(event)) throw new Error('Avatar settings are only available to the avatar window');
    return updateSettings(patch);
  });
  ipcMain.handle('avatar:model:pick', async (event) => {
    if (!isAvatarSender(event)) throw new Error('Avatar model selection is only available to the avatar window');
    const result = await dialog.showOpenDialog(avatarWindow, {
      title: '选择 VRM 模型', properties: ['openFile'], filters: [{ name: 'VRM model', extensions: ['vrm'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
  });

  function installEntryButton() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const script = `new Promise((resolve) => {
      let button = document.getElementById('avatar-output-entry');
      if (!button) {
        button = document.createElement('button');
        button.id = 'avatar-output-entry';
        button.className = 'rail__item rail__avatar';
        button.type = 'button';
        button.title = '打开虚拟形象输出窗口';
        button.setAttribute('aria-label', '打开虚拟形象输出窗口');
        button.innerHTML = '<span aria-hidden="true">&#9671;</span>';
        const rail = document.querySelector('.rail');
        const spacer = rail?.querySelector('.rail__spacer');
        if (rail) rail.insertBefore(button, spacer || null);
        else {
          button.textContent = '虚拟形象';
          document.body.appendChild(button);
        }
      }
      button.onclick = () => resolve(true);
    })`;
    mainWindow.webContents.executeJavaScript(script, true)
      .then(() => open()).then(() => installEntryButton()).catch(() => {});
  }
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.on('did-finish-load', installEntryButton);
    if (!mainWindow.webContents.isLoading()) installEntryButton();
  }

  return { open, close, isOpen: () => status().open, status };
}

module.exports = { createAvatarWindowController };
