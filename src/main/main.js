'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  app, BrowserWindow, ipcMain, session, shell, dialog, clipboard, nativeTheme, safeStorage, screen,
  nativeImage,
} = require('electron');
const { Store } = require('./store');
const { buildQuickExplainMessages, parseQuickExplainResponse } = require('./quick-explain');
const { buildCompatibleEndpoints, validateCompatibleConfig, readStoredCompatibleConfig } = require('./ai-config');
const chatBridge = require('./chat-bridge');
const videoReport = require('./video-report');

const IS_DEV = process.argv.includes('--dev');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');

/** DeepSeek 会拒绝 Electron 默认 UA，统一伪装成同版本内核的 Chrome。 */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';

/** 每个内嵌站点用独立分区，登录态互不干扰、可单独清空。 */
const PARTITIONS = {
  deepseek: 'persist:deepseek',
  docs: 'persist:docs',
  research: 'persist:research',
};

let store;
let mainWindow;
let petWindow;
let petExpanded = false;

const PET_SIZE = { width: 124, height: 138 };
const PET_CARD_SIZE = { width: 390, height: 548 };
const PET_DEFAULTS = {
  enabled: false,
  skin: 'study-buddy',
  size: 1,
  opacity: 0.96,
  fontLevel: 'comfortable',
  snapToEdge: true,
  alwaysOnTop: true,
};

function petSettings() {
  return { ...PET_DEFAULTS, ...(store.get('pet') || {}) };
}

function petAvatarSize(scale = petSettings().size) {
  const value = Math.min(1.3, Math.max(0.75, Number(scale) || 1));
  return { width: Math.round(PET_SIZE.width * value), height: Math.round(PET_SIZE.height * value) };
}

function readApiKey() {
  const encrypted = store.get('ai.api.keyEncrypted', '');
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return ''; }
}

function saveApiKey(value) {
  const key = String(value || '').trim();
  if (!key) {
    store.set('ai.api.keyEncrypted', undefined);
    return { ok: true, hasKey: false };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: '系统安全存储当前不可用，未保存 API Key。' };
  }
  store.set('ai.api.keyEncrypted', safeStorage.encryptString(key).toString('base64'));
  return { ok: true, hasKey: true };
}

function migrateLegacyApiKey() {
  const legacy = store.get('ai.api.key', '');
  if (!legacy) return;
  const saved = saveApiKey(legacy);
  if (saved.ok) store.set('ai.api.key', undefined);
}

function safeConfig() {
  const data = structuredClone(store.all());
  if (data.ai?.api) {
    delete data.ai.api.key;
    delete data.ai.api.keyEncrypted;
    data.ai.api.hasKey = Boolean(readApiKey());
  }
  return data;
}

/**
 * 剥离 CSP 响应头。只作用于我们自己 App 内的这个分区，不影响系统浏览器。
 * 目的：让「自定义背景」的 CSS/图片注入不被站点 CSP 挡掉。
 */
function relaxPartition(partitionName) {
  const ses = session.fromPartition(partitionName);
  ses.setUserAgent(CHROME_UA);

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });

  // 站点可能按 UA 提示（Client Hints）判断浏览器，一并对齐，避免被判成非常规客户端。
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    headers['User-Agent'] = CHROME_UA;
    callback({ requestHeaders: headers });
  });

  return ses;
}

function restoreBounds() {
  const saved = store.get('window.bounds');
  const bounds = { width: 1280, height: 860, ...(saved || {}) };
  // 屏幕换了以后，旧坐标可能落在可视区外，越界就回落到居中。
  if (typeof bounds.x === 'number' && typeof bounds.y === 'number') {
    const { screen } = require('electron');
    const inside = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return bounds.x >= a.x - 50 && bounds.y >= a.y - 50 &&
        bounds.x < a.x + a.width && bounds.y < a.y + a.height;
    });
    if (!inside) { delete bounds.x; delete bounds.y; }
  }
  return bounds;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...restoreBounds(),
    minWidth: 900,
    minHeight: 620,
    title: 'Agent 工具箱',
    icon: ICON_PATH,          // macOS 上窗口图标无效，靠下面的 dock.setIcon
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12141a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true, // 四个工具全靠它内嵌 Chromium
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  let saveTimer;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
        store.set('window.bounds', mainWindow.getBounds());
      }
    }, 400);
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
    // 桌宠是主应用的一部分：Windows/Linux 仍保持原来“关主窗即退出”的体验；
    // macOS 则沿用关闭窗口但应用常驻的惯例，桌宠可继续使用。
    if (process.platform !== 'darwin') app.quit();
  });

  // 壳本身永远不该被导航走；工具里的链接一律交给内嵌 webview 或系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 强制所有 webview 的安全参数，不信任渲染进程写的属性。
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    const deepseekSession = session.fromPartition(PARTITIONS.deepseek);

    guest.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };

      // DeepSeek 的「用 Google / Apple 账号登录」是 window.open 弹窗。
      // 一律 deny 的话就是「登录弹窗已被浏览器拦截」，用户根本登不进去。
      // 所以给它一个真窗口，并显式指定同一个 partition —— 否则登录完 cookie
      // 落在别的会话里，主界面还是未登录。
      if (guest.session === deepseekSession) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 700,
            parent: mainWindow,
            autoHideMenuBar: true,
            title: '登录',
            backgroundColor: '#ffffff',
            webPreferences: {
              partition: PARTITIONS.deepseek,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }

      // 文档站里 target="_blank" 的链接：不弹窗，转给渲染进程开新标签
      mainWindow.webContents.send('webview:open-url', url);
      return { action: 'deny' };
    });
  });
}

function defaultPetPosition(width = PET_SIZE.width, height = PET_SIZE.height) {
  const work = screen.getPrimaryDisplay().workArea;
  return { x: work.x + work.width - width - 18, y: work.y + work.height - height - 18 };
}

function clampToWorkArea(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  return {
    x: Math.min(Math.max(bounds.x, work.x), work.x + work.width - bounds.width),
    y: Math.min(Math.max(bounds.y, work.y), work.y + work.height - bounds.height),
  };
}

function snapPetToEdge() {
  if (!petWindow || petWindow.isDestroyed() || !petSettings().snapToEdge) return;
  const bounds = petWindow.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const center = bounds.x + bounds.width / 2;
  const x = center < work.x + work.width / 2 ? work.x + 8 : work.x + work.width - bounds.width - 8;
  const pos = clampToWorkArea({ ...bounds, x });
  petWindow.setPosition(pos.x, pos.y, true);
  store.set('pet.position', pos);
}

function applyPetSettings() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const settings = petSettings();
  petWindow.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  petWindow.setOpacity(Math.min(1, Math.max(0.35, Number(settings.opacity) || PET_DEFAULTS.opacity)));
  if (!petExpanded) {
    const old = petWindow.getBounds();
    const size = petAvatarSize(settings.size);
    const work = screen.getDisplayMatching(old).workArea;
    const rightDocked = old.x + old.width / 2 >= work.x + work.width / 2;
    const pos = clampToWorkArea({
      ...size,
      x: rightDocked ? old.x + old.width - size.width : old.x,
      y: old.y + old.height - size.height,
    });
    petWindow.setBounds({ ...size, ...pos });
  }
  petWindow.webContents.send('pet:settings-changed', settings);
  if (settings.enabled) {
    petWindow.showInactive();
  } else {
    if (petExpanded) {
      petExpanded = false;
      const old = petWindow.getBounds();
      const size = petAvatarSize(settings.size);
      const pos = clampToWorkArea({ ...size, x: old.x + old.width - size.width, y: old.y + old.height - size.height });
      petWindow.setBounds({ ...size, ...pos });
    }
    petWindow.webContents.send('pet:collapse');
    petWindow.hide();
  }
}

function createPetWindow() {
  const avatarSize = petAvatarSize();
  const saved = store.get('pet.position');
  const initial = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { ...saved, ...avatarSize }
    : { ...defaultPetPosition(avatarSize.width, avatarSize.height), ...avatarSize };
  const position = clampToWorkArea(initial);

  petWindow = new BrowserWindow({
    ...avatarSize,
    ...position,
    minWidth: Math.round(PET_SIZE.width * 0.75),
    minHeight: Math.round(PET_SIZE.height * 0.75),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    alwaysOnTop: Boolean(petSettings().alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.loadFile(path.join(__dirname, '..', 'pet', 'index.html'));
  petWindow.on('closed', () => { petWindow = null; });
  petWindow.webContents.once('did-finish-load', applyPetSettings);
}

async function performCompatibleRequest({ endpoint, apiKey, model, messages, temperature = 0.2, timeout = 90000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Number(timeout) || 90000, 300000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, stream: false }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const safeText = text.split(apiKey).join('[已隐藏]');
      return { ok: false, code: 'http', error: `${response.status} ${response.statusText}：${safeText.slice(0, 300)}` };
    }
    let payload;
    try { payload = JSON.parse(text); } catch {
      return { ok: false, code: 'http', error: `返回的不是 JSON：${text.split(apiKey).join('[已隐藏]').slice(0, 200)}` };
    }
    return { ok: true, text: payload?.choices?.[0]?.message?.content ?? '' };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return { ok: false, code: aborted ? 'timeout' : 'http', error: aborted ? '请求超时。' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function callCompatibleApi({ baseUrl, model, messages, temperature = 0.2, timeout = 90000 }) {
  const apiKey = readApiKey();
  const config = validateCompatibleConfig({ baseUrl, model, hasKey: Boolean(apiKey) });
  if (!config.ok) return config;
  return performCompatibleRequest({
    endpoint: config.endpoints.chat, apiKey, model: config.model, messages, temperature, timeout,
  });
}

async function callStoredCompatibleApi({ messages, temperature = 0.2, timeout = 90000 }) {
  const apiKey = readApiKey();
  const config = readStoredCompatibleConfig(store, Boolean(apiKey));
  if (!config.ok) return config;
  return performCompatibleRequest({
    endpoint: config.endpoints.chat, apiKey, model: config.model, messages, temperature, timeout,
  });
}

function registerIpc() {
  ipcMain.handle('config:all', () => safeConfig());
  ipcMain.handle('config:get', (_e, key, fallback) => {
    if (key === 'ai.api.key' || key === 'ai.api.keyEncrypted') return fallback;
    return store.get(key, fallback);
  });
  ipcMain.handle('config:set', (_e, key, value) => {
    if (key === 'ai.api.key' || key === 'ai.api.keyEncrypted') throw new Error('API Key 必须通过安全凭据接口保存。');
    const result = store.set(key, value);
    if (key.startsWith('pet.')) applyPetSettings();
    return result;
  });

  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) return false; // 只放行 http(s)，挡掉 file:// 之类
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:reload', () => { if (mainWindow) mainWindow.reload(); });
  ipcMain.handle('app:openDevTools', () => {
    if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  /**
   * 自定义 AI API 的请求。放在主进程有两个原因：
   * 渲染进程有 CSP（connect-src 'self'）发不出去；API Key 也不该在页面上下文里流转。
   */
  ipcMain.handle('ai:chat', (_e, payload) => callCompatibleApi(payload));
  ipcMain.handle('ai:credentialStatus', () => ({ hasKey: Boolean(readApiKey()), secure: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('ai:saveCredential', (_e, key) => saveApiKey(key));
  ipcMain.handle('ai:clearCredential', () => saveApiKey(''));
  ipcMain.handle('ai:listModels', async (_e, { baseUrl }) => {
    const endpoints = buildCompatibleEndpoints(baseUrl);
    if (!endpoints) return { ok: false, error: '请先填写以 http:// 或 https:// 开头的有效 Base URL。' };
    const apiKey = readApiKey();
    if (!apiKey) return { ok: false, error: '请先安全保存 API Key。' };
    try {
      const response = await fetch(endpoints.models, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return { ok: false, error: `模型列表请求失败（${response.status}）。可继续手工填写模型名。` };
      const payload = await response.json();
      const models = (Array.isArray(payload?.data) ? payload.data : [])
        .map((item) => String(item?.id || '')).filter(Boolean).sort();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: `模型列表请求失败：${err.message}。可继续手工填写模型名。` };
    }
  });

  ipcMain.handle('pet:getState', () => ({ settings: petSettings(), clipboard: clipboard.readText() }));
  ipcMain.handle('pet:setEnabled', (_e, enabled) => {
    store.set('pet.enabled', Boolean(enabled));
    applyPetSettings();
    return true;
  });
  ipcMain.handle('pet:resize', (_e, expanded) => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    const old = petWindow.getBounds();
    petExpanded = Boolean(expanded);
    const size = expanded ? PET_CARD_SIZE : petAvatarSize();
    const display = screen.getDisplayMatching(old);
    const work = display.workArea;
    const rightDocked = old.x + old.width / 2 >= work.x + work.width / 2;
    const proposed = {
      x: rightDocked ? old.x + old.width - size.width : old.x,
      y: old.y + old.height - size.height,
      ...size,
    };
    const pos = clampToWorkArea(proposed);
    petWindow.setBounds({ ...size, ...pos }, true);
    return true;
  });
  ipcMain.handle('pet:move', (_e, { x, y }) => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    const bounds = petWindow.getBounds();
    const pos = clampToWorkArea({ ...bounds, x: Math.round(x), y: Math.round(y) });
    petWindow.setPosition(pos.x, pos.y);
    return true;
  });
  ipcMain.handle('pet:endDrag', () => { snapPetToEdge(); return true; });
  ipcMain.handle('pet:explain', async (_e, input) => {
    const messages = buildQuickExplainMessages(input || {});
    const result = await callStoredCompatibleApi({ messages, temperature: 0.15, timeout: 90000 });
    if (!result.ok) return result;
    const parsed = parseQuickExplainResponse(result.text);
    return { ok: true, text: parsed.quick, supplement: parsed.supplement };
  });
  ipcMain.handle('pet:openAiSettings', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    const navigate = () => mainWindow?.webContents.send('app:navigate-tool', { id: 'settings', section: 'ai' });
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', navigate);
    else navigate();
    return true;
  });

  ipcMain.handle('files:pickImage', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    const MAX = 40 * 1024 * 1024;
    if (stat.size > MAX) {
      return { error: `图片太大（${(stat.size / 1024 / 1024).toFixed(1)}MB），请选 40MB 以内的。` };
    }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return {
      path: filePath,
      name: path.basename(filePath),
      mime,
      base64: fs.readFileSync(filePath).toString('base64'),
    };
  });

  ipcMain.handle('files:pickPetSkin', async () => {
    const result = await dialog.showOpenDialog(mainWindow || petWindow, {
      title: '导入有权使用的桌宠图片',
      properties: ['openFile'],
      filters: [{ name: '透明背景图片', extensions: ['png', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > 8 * 1024 * 1024) return { error: '图片超过 8MB，请压缩后再导入。' };
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : `image/${ext}`;
    const dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    store.set('pet.customSkin', { name: path.basename(filePath), dataUrl });
    store.set('pet.skin', 'custom');
    applyPetSettings();
    return { name: path.basename(filePath) };
  });

  // ---- 聊天记录迁移：读 Codex / Claude 的本地会话，导出或打包 ----

  ipcMain.handle('chat:sources', () => chatBridge.SOURCES);

  ipcMain.handle('chat:list', (_e, source) => chatBridge.listSessions(source));
  ipcMain.handle('chat:load', (_e, { source, id, full }) => chatBridge.loadSession(source, id, { previewOnly: !full }));

  ipcMain.handle('chat:export', async (_e, { source, id, format }) => {
    const session = chatBridge.loadSession(source, id, { previewOnly: false });
    if (!session) return { ok: false, error: '没找到这个会话，可能被清理了。' };
    const exporter = chatBridge.EXPORTERS[format] || chatBridge.EXPORTERS.md;
    const safeTitle = (session.title || session.id).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出会话',
      defaultPath: `${source}_${safeTitle}_${session.id.slice(0, 8)}.${exporter.ext}`,
      filters: [{ name: exporter.label, extensions: [exporter.ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, exporter.build(session), 'utf8');
    return { ok: true, path: result.filePath, count: session.messages.length };
  });

  ipcMain.handle('chat:transfer', async (_e, { source, ids, note }) => {
    const sessions = chatBridge.loadFullSessions(source, ids);
    if (!sessions.length) return { ok: false, error: '这些会话都读不到，可能被清理了。' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '生成迁移包',
      defaultPath: `${source}_transfer_${Date.now()}.json`,
      filters: [{ name: '迁移包 JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, chatBridge.buildTransferPackage(sessions, note || ''), 'utf8');
    const count = sessions.reduce((n, s) => n + s.messages.length, 0);
    return { ok: true, path: result.filePath, sessions: sessions.length, count };
  });

  ipcMain.handle('chat:pickTransfer', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择迁移包',
      properties: ['openFile'],
      filters: [{ name: '迁移包 JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 80 * 1024 * 1024) return { error: '迁移包超过 80MB，太大了。' };
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(data.sessions)) return { error: '这不是迁移包格式（缺少 sessions）。' };
      return {
        path: filePath,
        note: data.note || '',
        createdAt: data.created_at || '',
        sessions: data.sessions.map((s) => ({
          id: s.session_id,
          source: s.source,
          title: s.title,
          count: Array.isArray(s.messages) ? s.messages.length : 0,
        })),
      };
    } catch (err) {
      return { error: `迁移包读不出来：${err.message}` };
    }
  });

  ipcMain.handle('chat:showInFinder', (_e, targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.startsWith(os.homedir())) return false;
    shell.showItemInFolder(targetPath);
    return true;
  });

  // ---- 视频报告：B 站链接 → 本地 Markdown → 可选发飞书 ----

  ipcMain.handle('video:fetchInfo', (_e, url) => videoReport.fetchBilibiliInfo(url));

  ipcMain.handle('video:saveReport', (_e, payload) =>
    videoReport.saveReport(app.getPath('userData'), payload));

  ipcMain.handle('video:listReports', () => videoReport.listReports(app.getPath('userData')));

  ipcMain.handle('video:readReport', (_e, fileName) =>
    videoReport.readReport(app.getPath('userData'), fileName));

  // ---- 科研门户：站点 favicon 抓取（渲染进程 CSP 只放行 self/data，图片要主进程代取） ----
  ipcMain.handle('site:favicon', async (_e, url) => {
    let origin;
    try {
      origin = new URL(String(url)).origin;
    } catch {
      return null;
    }
    const tryImage = async (imageUrl) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(imageUrl, {
          headers: { 'User-Agent': CHROME_UA },
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        const mime = (res.headers.get('content-type') || '').split(';')[0];
        if (!/^image\//.test(mime)) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 256 * 1024) return null; // 图标不该超过 256KB
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch {
        return null;
      }
    };

    // 1. 直接要 /favicon.ico，大多数站点吃这套
    const direct = await tryImage(`${origin}/favicon.ico`);
    if (direct) return direct;

    // 2. SPA 站点的图标常在首页 HTML 的 <link rel="icon"> 里，可能在 CDN 上
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(origin, {
        headers: { 'User-Agent': CHROME_UA },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const htmlText = await res.text();
      const tag = htmlText.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i)
        || htmlText.match(/<link[^>]+href=[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i);
      const hrefMatch = tag && tag[0].match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const iconUrl = new URL(hrefMatch[1], origin).href;
        const fromLink = await tryImage(iconUrl);
        if (fromLink) return fromLink;
      }
    } catch { /* 放弃，界面用 emoji 兜底 */ }
    return null;
  });

  // ---- 文献管理器：文件统一收进 userData/literature/，元信息在渲染进程存 config ----

  const LIT_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'epub', 'caj', 'djvu', 'ppt', 'pptx', 'xls', 'xlsx', 'rtf'];

  const litDir = () => {
    const dir = path.join(app.getPath('userData'), 'literature');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  ipcMain.handle('lit:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入文献',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文献', extensions: LIT_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const dir = litDir();
    const imported = [];
    for (const src of result.filePaths) {
      const base = path.basename(src);
      const ext = path.extname(base);
      const stem = path.basename(base, ext);
      let dest = path.join(dir, base);
      let n = 1;
      while (fs.existsSync(dest)) dest = path.join(dir, `${stem}-${n++}${ext}`);
      try {
        fs.copyFileSync(src, dest);
        const stat = fs.statSync(dest);
        imported.push({ file: path.basename(dest), size: stat.size, format: ext.slice(1).toLowerCase() });
      } catch { /* 单个失败不拖垮整批 */ }
    }
    return imported;
  });

  ipcMain.handle('lit:list', () => {
    try {
      return fs.readdirSync(litDir())
        .filter((f) => !f.startsWith('.'))
        .map((f) => {
          const stat = fs.statSync(path.join(litDir(), f));
          return { file: f, size: stat.size, mtime: stat.mtime.toISOString(), format: path.extname(f).slice(1).toLowerCase() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
    } catch {
      return [];
    }
  });

  ipcMain.handle('lit:open', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    if (!fs.existsSync(full)) return { ok: false, error: '文件不存在了' };
    return shell.openPath(full).then((err) => (err ? { ok: false, error: err } : { ok: true }));
  });

  ipcMain.handle('lit:reveal', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    if (!fs.existsSync(full)) return false;
    shell.showItemInFolder(full);
    return true;
  });

  ipcMain.handle('lit:remove', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    try {
      fs.rmSync(full);
      return true;
    } catch {
      return false;
    }
  });
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  migrateLegacyApiKey();
  nativeTheme.themeSource = 'dark';

  // 不打包直接 npm start 时，dock 里是 Electron 的默认图标，换成我们自己的
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  for (const partition of Object.values(PARTITIONS)) relaxPartition(partition);

  registerIpc();
  createWindow();
  createPetWindow();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
