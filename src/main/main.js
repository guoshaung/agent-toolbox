'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  app, BrowserWindow, ipcMain, session, shell, dialog, clipboard, nativeTheme, safeStorage, screen,
  nativeImage, globalShortcut,
} = require('electron');
const { Store } = require('./store');
const { buildQuickExplainMessages, parseQuickExplainResponse } = require('./quick-explain');
const { buildCompatibleEndpoints, validateCompatibleConfig, readStoredCompatibleConfig } = require('./ai-config');
const chatBridge = require('./chat-bridge');
const videoReport = require('./video-report');
const pdfTitle = require('./pdf-title');
const { installCoachExtension } = require('./coach-install');
const litFetch = require('./lit-fetch');
const { registerNotebookIpc } = require('./notebook');
const { registerBiblioIpc } = require('./biblio');
const { registerCertTrust } = require('./certtrust');
const translator = require('./translate');
const ocr = require('./ocr');
const newsFeed = require('./news-feed');
const { WindowDock } = require('./window-dock');
const skillFactory = require('./skill-factory');
const mcpFactory = require('./mcp-factory');
const practiceRunner = require('./practice-runner');
const edgeCookies = require('./edge-cookies');
const { RemoteControl } = require('./remote-control');

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
  feishu: 'persist:feishu',
  literature: 'persist:literature-download',
  focus: 'persist:focus',
  bilibili: 'persist:bilibili-study',
};

let store;
let mainWindow;
let petWindow;
let petExpanded = false;
let termPopupWindow;
let pendingTermRequest;
let literatureBrowserWindow;
let feishuWindow;
let literatureDownloadHooked = false;
let researchDownloadHooked = false;
let literatureDownloadWaiter;
let windowDock;
let quittingForDock = false;
let remoteControl;
const siteFloatWindows = new Map();
const pendingRemoteCommands = new Map();
const watchAvatarCache = new Map();

const execFileAsync = promisify(execFile);
const TERM_SHORTCUT = 'CommandOrControl+Shift+E';
const TERM_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌘⇧E' : 'Ctrl+Shift+E';
const MOBILE_SITE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SITE_FLOAT_SIZE = { width: 82, height: 82 };
const SITE_MOBILE_SIZE = { width: 430, height: 760 };
const SITE_PC_SIZE = { width: 1220, height: 820 };

function literatureDirectory() {
  const dir = path.join(app.getPath('userData'), 'literature');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configureBilibiliPartition() {
  const bilibiliSession = session.fromPartition(PARTITIONS.bilibili);
  bilibiliSession.webRequest.onBeforeRequest({
    urls: [
      '*://api.bilibili.com/x/v2/reply*',
      '*://api.bilibili.com/x/v2/reply/*',
      '*://comment.bilibili.com/*',
    ],
  }, (_details, callback) => callback({ cancel: true }));
}

function requestRemoteRenderer(type, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error('工具箱主窗口没有打开。'));
  const requestId = `remote-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRemoteCommands.delete(requestId);
      reject(new Error('电脑端处理超时。'));
    }, type === 'ai.ask' ? 120000 : 10000);
    pendingRemoteCommands.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send('remote:command', { requestId, type, payload });
  });
}

/** 把内置 B 站 webview 的登录态临时导出给 yt-dlp，使用完立即删除。 */
async function exportBilibiliCookies() {
  try {
    const cookies = await session.fromPartition(PARTITIONS.bilibili).cookies.get({});
    const allowed = cookies.filter((cookie) => /(?:^|\.)bilibili\.com$|(?:^|\.)hdslb\.com$|(?:^|\.)b23\.tv$/i.test(cookie.domain || ''));
    if (!allowed.length) return null;
    const lines = [
      '# Netscape HTTP Cookie File',
      ...allowed.map((cookie) => [
        cookie.domain,
        cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        Math.floor(Number(cookie.expirationDate) || 0),
        String(cookie.name || '').replace(/[\t\r\n]/g, ''),
        String(cookie.value || '').replace(/[\t\r\n]/g, ''),
      ].join('\t')),
      '',
    ];
    const file = path.join(os.tmpdir(), `agent-toolbox-bilibili-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizedSite(site) {
  const url = validHttpUrl(site?.url);
  if (!url) return null;
  return {
    name: String(site?.name || new URL(url).hostname).slice(0, 80),
    url,
    desc: String(site?.desc || '').slice(0, 160),
    emoji: String(site?.emoji || 'globe').slice(0, 12),
  };
}

function siteFloatPosition(size = SITE_FLOAT_SIZE) {
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  return {
    x: Math.min(Math.max(area.x + 8, point.x - Math.round(size.width / 2)), area.x + area.width - size.width - 8),
    y: Math.min(Math.max(area.y + 8, point.y - Math.round(size.height / 2)), area.y + area.height - size.height - 8),
  };
}

function siteFloatState(id) {
  return siteFloatWindows.get(id)?.state || null;
}

function sendSiteFloatState(id) {
  const entry = siteFloatWindows.get(id);
  if (!entry || entry.window.isDestroyed()) return;
  entry.window.webContents.send('site-float:state', { id, ...entry.state });
}

function resizeSiteFloat(entry, mode, expanded) {
  const size = expanded ? (mode === 'pc' ? SITE_PC_SIZE : SITE_MOBILE_SIZE) : SITE_FLOAT_SIZE;
  const old = entry.window.getBounds();
  const pos = expanded
    ? clampToWorkArea({ x: old.x, y: old.y, ...size })
    : clampToWorkArea({ x: old.x, y: old.y, ...size });
  entry.window.setBounds({ ...pos, ...size }, true);
}

function configureSiteFloatWindow(entry) {
  const owner = entry.window;
  owner.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = path.join(__dirname, 'site-bypass-preload.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.plugins = true;
  });
  owner.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setUserAgent(entry.state.mode === 'pc' ? CHROME_UA : MOBILE_SITE_UA);
    entry.guest = guest;
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) guest.loadURL(url);
      return { action: 'deny' };
    });
  });
}

function createSiteFloat(site) {
  const id = `site-float-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const position = siteFloatPosition();
  const entry = {
    state: { site, mode: 'mobile', expanded: false },
    window: new BrowserWindow({
      ...position,
      ...SITE_FLOAT_SIZE,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'site-float-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
      },
    }),
  };
  entry.window.setAlwaysOnTop(true, 'floating');
  entry.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  configureSiteFloatWindow(entry);
  entry.window.loadFile(path.join(__dirname, '..', 'renderer', 'site-float.html'));
  entry.window.once('ready-to-show', () => {
    entry.window.webContents.send('site-float:init', { id, ...entry.state });
    entry.window.showInactive();
  });
  entry.window.on('closed', () => siteFloatWindows.delete(id));
  siteFloatWindows.set(id, entry);
  return { ok: true, id };
}

function setSiteFloatExpanded(id, expanded, mode) {
  const entry = siteFloatWindows.get(id);
  if (!entry || entry.window.isDestroyed()) return { ok: false, error: '悬浮球已经关闭。' };
  entry.state.expanded = Boolean(expanded);
  if (mode === 'mobile' || mode === 'pc') entry.state.mode = mode;
  resizeSiteFloat(entry, entry.state.mode, entry.state.expanded);
  if (entry.guest && !entry.guest.isDestroyed()) {
    entry.guest.setUserAgent(entry.state.mode === 'pc' ? CHROME_UA : MOBILE_SITE_UA);
    if (entry.state.expanded) entry.guest.reload();
  }
  sendSiteFloatState(id);
  if (entry.state.expanded) entry.window.show();
  else entry.window.showInactive();
  return { ok: true, mode: entry.state.mode, expanded: entry.state.expanded };
}

async function handleRemoteCommand(type, payload = {}) {
  switch (type) {
    case 'remote.stop':
      setImmediate(() => remoteControl.stop());
      return { stopping: true };
    case 'app.show':
      ensureMainWindow({ show: true });
      return { shown: true };
    case 'clipboard.read':
      return { text: clipboard.readText() };
    case 'clipboard.write':
      clipboard.writeText(String(payload.text || ''));
      return { written: true };
    case 'url.open': {
      const url = validHttpUrl(payload.url);
      if (!url) throw new Error('只允许打开 http(s) 地址。');
      await shell.openExternal(url);
      return { opened: true };
    }
    case 'tool.open': {
      const id = String(payload.id || '');
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('工具名称无效。');
      ensureMainWindow({ show: true }).webContents.send('app:navigate-tool', { id });
      return { opened: id };
    }
    case 'ai.send': {
      const text = String(payload.text || '').trim();
      const url = validHttpUrl(payload.url);
      if (!text) throw new Error('没有要发送的文字。');
      if (!url) throw new Error('目标 AI 地址无效。');
      clipboard.writeText(text);
      await shell.openExternal(url);
      return { copied: true, opened: true };
    }
    case 'ai.ask':
      return requestRemoteRenderer(type, { prompt: String(payload.prompt || '').slice(0, 20000) });
    default:
      throw new Error(`不支持的远程动作：${type || '空动作'}`);
  }
}
const DOCK_SHORTCUT = process.platform === 'darwin' ? 'Alt+Shift+D' : 'CommandOrControl+Alt+Shift+D';
const DOCK_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌥⇧D' : 'Ctrl+Alt+Shift+D';

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

function credentialPath(scope = 'default') {
  if (scope === 'translation') return 'research.translation.keyEncrypted';
  if (scope === 'quiz') return 'study.quiz.keyEncrypted';
  return 'ai.api.keyEncrypted';
}

function readApiKey(scope = 'default') {
  const encrypted = store.get(credentialPath(scope), '');
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return ''; }
}

function readRemoteToken() {
  const encrypted = store.get('remote.tokenEncrypted', '');
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return ''; }
}

function saveRemoteToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    store.set('remote.tokenEncrypted', undefined);
    return { ok: true, persistent: false };
  }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, persistent: false, error: '系统安全存储不可用，无法持久保存手机配对。' };
  store.set('remote.tokenEncrypted', safeStorage.encryptString(value).toString('base64'));
  return { ok: true, persistent: true };
}

function saveApiKey(value, scope = 'default') {
  const key = String(value || '').trim();
  const configPath = credentialPath(scope);
  if (!key) {
    store.set(configPath, undefined);
    return { ok: true, hasKey: false };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: '系统安全存储当前不可用，未保存 API Key。' };
  }
  store.set(configPath, safeStorage.encryptString(key).toString('base64'));
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
  if (data.research?.translation) {
    delete data.research.translation.key;
    delete data.research.translation.keyEncrypted;
    data.research.translation.hasKey = Boolean(readApiKey('translation'));
  }
  if (data.study?.quiz) {
    delete data.study.quiz.key;
    delete data.study.quiz.keyEncrypted;
    data.study.quiz.hasKey = Boolean(readApiKey('quiz'));
  }
  if (data.remote) delete data.remote.tokenEncrypted;
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
    // 补齐 Chrome 130 的 Client Hints，防止站点从 Sec-CH-UA 里识别出 Electron
    headers['Sec-CH-UA'] = '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"macOS"';
    headers['Sec-CH-UA-Platform-Version'] = '"15.0.0"';
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

function createWindow(showOnReady = true) {
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

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback);
    if (showOnReady) mainWindow.show();
  });

  // 兜底：渲染进程如果加载失败，ready-to-show 永远不会触发，
  // 结果就是"进程活着、Dock 有图标、但永远没有窗口"，而且看不出哪里错了。
  // 宁可弹一个空窗口让人看见报错，也不要静默消失。
  const showFallback = setTimeout(() => {
    if (showOnReady && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.error('[window] ready-to-show 超时未触发，强制显示窗口（渲染进程可能加载失败）');
      mainWindow.show();
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }, 6000);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  let saveTimer;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
        if (!windowDock?.status().active) store.set('window.bounds', mainWindow.getBounds());
      }
    }, 400);
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
    windowDock?.detach({ restoreMain: false, restoreTarget: true });
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
    // 用主进程控制的 preload 做站点登录墙清理（只删遮挡层、恢复滚动/复制，不改登录态）
    webPreferences.preload = path.join(__dirname, 'site-bypass-preload.js');
    console.log('[main] will-attach-webview preload:', webPreferences.preload);
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    // 文献阅读器要用 Chromium 内置 PDF 查看器（自带缩放/翻页/搜索）
    webPreferences.plugins = true;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    const deepseekSession = session.fromPartition(PARTITIONS.deepseek);
    const bilibiliSession = session.fromPartition(PARTITIONS.bilibili);
    const feishuSession = session.fromPartition(PARTITIONS.feishu);
    const researchSession = session.fromPartition(PARTITIONS.research);

    // 拦截已知站点的强制登录重定向（先弹登录页再让内容页可访问）
    // 注意：did-attach-webview 的 guest 参数本身就是 WebContents
    const loginRedirectCounts = new Map();
    guest.on('will-redirect', (event, url) => {
      const lower = url.toLowerCase();
      if (/zhihu\.com\/signin/i.test(lower)) {
        event.preventDefault();
        const key = 'zhihu-signin';
        const count = (loginRedirectCounts.get(key) || 0) + 1;
        loginRedirectCounts.set(key, count);
        if (count <= 3) guest.loadURL('https://www.zhihu.com/hot');
        return;
      }
      if (/csdn\.net.*\/login/i.test(lower) || /passport\.csdn\.net/i.test(lower)) {
        event.preventDefault();
        return;
      }
    });

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

      if (guest.session === bilibiliSession) {
        if (/passport\.bilibili\.com|login\.bilibili\.com/i.test(url)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 520,
              height: 700,
              parent: mainWindow,
              autoHideMenuBar: true,
              title: '哔哩哔哩登录',
              backgroundColor: '#ffffff',
              webPreferences: {
                partition: PARTITIONS.bilibili,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
              },
            },
          };
        }
        guest.loadURL(url);
        return { action: 'deny' };
      }

      if (guest.session === feishuSession) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 700,
            parent: mainWindow,
            autoHideMenuBar: true,
            title: '飞书登录',
            backgroundColor: '#ffffff',
            webPreferences: {
              partition: PARTITIONS.feishu,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }

      // 门户 / 学术入口 / 学校访问：直接在同一个 webview 里导航。
      //
      // 图书馆的数据库入口（知网、Web of Science、SpringerLink…）几乎全是
      // target="_blank" 或 window.open。之前的做法是把 URL 转回渲染进程、再由
      // 当前可见的格子铺去导航 —— 环节太多，实测六种跳转方式里四种都断在半路，
      // 表现就是"点了没反应"。在主进程直接 loadURL 少了两个中间环节，
      // 而且天然在同一个 session 里，学校的 VPN / 登录态不会丢。
      if (guest.session === researchSession) {
        guest.loadURL(url);
        return { action: 'deny' };
      }

      // 文档站里 target="_blank" 的链接：转给渲染进程开新标签（那边有多标签）
      mainWindow.webContents.send('webview:open-url', url);
      return { action: 'deny' };
    });
  });
}

function ensureMainWindow({ show = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(show);
  if (show) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  return mainWindow;
}

function createTermPopup() {
  if (termPopupWindow && !termPopupWindow.isDestroyed()) return termPopupWindow;
  termPopupWindow = new BrowserWindow({
    width: 470,
    height: 560,
    minWidth: 390,
    minHeight: 300,
    maxWidth: 620,
    maxHeight: 760,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'term-popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  termPopupWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'normal');
  termPopupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  termPopupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'term-popup.html'));
  termPopupWindow.on('closed', () => { termPopupWindow = null; });
  return termPopupWindow;
}

function placeTermPopup() {
  const win = createTermPopup();
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const [width, height] = win.getSize();
  const offset = 16;
  const x = Math.min(Math.max(area.x, point.x + offset), area.x + area.width - width);
  const y = Math.min(Math.max(area.y, point.y + offset), area.y + area.height - height);
  win.setPosition(Math.round(x), Math.round(y), false);
}

function sendTermPopupState(state) {
  const win = createTermPopup();
  const send = () => win.webContents.send('term:popup-state', { shortcut: TERM_SHORTCUT_LABEL, ...state });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

async function pressCopyShortcut() {
  if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'], { timeout: 3000 });
    return;
  }
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'], { timeout: 3000 });
    return;
  }
  await execFileAsync('/bin/sh', ['-lc', 'command -v xdotool >/dev/null && xdotool key --clearmodifiers ctrl+c'], { timeout: 3000 });
}

async function captureSelectedText() {
  const previous = clipboard.readText();
  const marker = `__agent_toolbox_term_${Date.now()}__`;
  clipboard.writeText(marker);
  try {
    await pressCopyShortcut();
    await new Promise((resolve) => setTimeout(resolve, 160));
    const selected = clipboard.readText().trim();
    return selected && selected !== marker ? selected.slice(0, 1200) : '';
  } finally {
    clipboard.writeText(previous);
  }
}

async function requestExternalTermExplanation(text) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingTermRequest = { requestId, term: text };
  placeTermPopup();
  sendTermPopupState({ status: 'loading', term: text });
  const popup = createTermPopup();
  popup.showInactive();

  const win = ensureMainWindow({ show: false });
  const send = () => win.webContents.send('term:explain-request', { requestId, text });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

async function triggerTermOverlay() {
  try {
    const text = await captureSelectedText();
    if (!text) {
      placeTermPopup();
      sendTermPopupState({
        status: 'error',
        term: '没有读到选中文字',
        error: process.platform === 'darwin'
          ? '先选中一个术语再按快捷键。若已经选中，请到“系统设置 → 隐私与安全性 → 辅助功能”允许 Agent 工具箱控制键盘。'
          : '先选中一个术语再按快捷键。Linux 需要安装 xdotool。',
      });
      createTermPopup().showInactive();
      return;
    }
    await requestExternalTermExplanation(text);
  } catch (err) {
    placeTermPopup();
    sendTermPopupState({
      status: 'error',
      term: '无法读取选词',
      error: `系统没有允许工具箱读取当前选区。${err.message}`,
    });
    createTermPopup().showInactive();
  }
}

function registerTermShortcut() {
  globalShortcut.unregister(TERM_SHORTCUT);
  if (!store.get('terms.overlay.enabled', true)) return { ok: true, enabled: false, accelerator: TERM_SHORTCUT_LABEL };
  const ok = globalShortcut.register(TERM_SHORTCUT, triggerTermOverlay);
  return ok
    ? { ok: true, enabled: true, registered: true, accelerator: TERM_SHORTCUT_LABEL }
    : { ok: false, enabled: false, accelerator: TERM_SHORTCUT_LABEL, error: `快捷键 ${TERM_SHORTCUT_LABEL} 被其他应用占用了。` };
}

function uniqueLiteraturePath(fileName) {
  const clean = path.basename(String(fileName || 'paper.pdf')).replace(/[\\/:*?"<>|]/g, ' ').trim() || 'paper.pdf';
  const ext = path.extname(clean);
  const stem = path.basename(clean, ext).slice(0, 120) || 'paper';
  let candidate = path.join(literatureDirectory(), `${stem}${ext || '.pdf'}`);
  let index = 1;
  while (fs.existsSync(candidate)) candidate = path.join(literatureDirectory(), `${stem}-${index++}${ext || '.pdf'}`);
  return candidate;
}

function hookLiteratureDownloads() {
  if (literatureDownloadHooked) return;
  literatureDownloadHooked = true;
  const ses = session.fromPartition(PARTITIONS.literature);
  ses.on('will-download', (_event, item) => {
    const target = uniqueLiteraturePath(item.getFilename());
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      const completed = state === 'completed';
      literatureDownloadWaiter?.({
        ok: completed,
        state,
        file: path.basename(target),
        error: completed ? '' : `下载状态：${state}`,
      });
      literatureDownloadWaiter = null;
      if (!completed) return;
      mainWindow?.webContents.send('lit:downloaded', {
        file: path.basename(target),
        size: fs.existsSync(target) ? fs.statSync(target).size : 0,
        format: path.extname(target).slice(1).toLowerCase(),
      });
    });
  });
}

function hookResearchDownloads() {
  if (researchDownloadHooked) return;
  researchDownloadHooked = true;
  const ses = session.fromPartition(PARTITIONS.research);
  ses.on('will-download', (_event, item) => {
    const target = uniqueLiteraturePath(item.getFilename());
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      if (state !== 'completed') return;
      mainWindow?.webContents.send('lit:downloaded', {
        file: path.basename(target),
        size: fs.existsSync(target) ? fs.statSync(target).size : 0,
        format: path.extname(target).slice(1).toLowerCase(),
        source: '学校访问',
      });
    });
  });
}

function sameLibrarySite(left, right) {
  try {
    const a = new URL(String(left || ''));
    const b = new URL(String(right || ''));
    if (a.protocol !== 'https:' && a.protocol !== 'http:') return false;
    if (b.protocol !== 'https:' && b.protocol !== 'http:') return false;
    if (a.hostname === b.hostname) return true;
    return a.hostname.endsWith('.cnki.net') && b.hostname.endsWith('.cnki.net');
  } catch {
    return false;
  }
}

function waitForLiteratureDownload(timeout = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (literatureDownloadWaiter === finish) literatureDownloadWaiter = null;
      resolve({ ok: false, error: '等待下载超过 45 秒，可能需要人工验证或页面没有触发下载。' });
    }, timeout);
    function finish(result) {
      clearTimeout(timer);
      if (literatureDownloadWaiter === finish) literatureDownloadWaiter = null;
      resolve(result);
    }
    literatureDownloadWaiter = finish;
  });
}

async function scanLiteratureBrowserPage() {
  if (!literatureBrowserWindow || literatureBrowserWindow.isDestroyed()) {
    return { ok: false, error: '请先打开已登录的论文检索页面。' };
  }
  const url = literatureBrowserWindow.webContents.getURL();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '当前浏览器还没有打开论文网页。' };
  try {
    const candidates = await literatureBrowserWindow.webContents.executeJavaScript(`(() => {
      const blocked = /^(下载|download|引用|cite|分享|收藏|登录|注册|首页|更多|下一页|上一页)$/i;
      const candidates = [];
      const seen = new Set();
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      };
      const titleFrom = (anchor) => {
        const own = clean(anchor.textContent);
        const parent = anchor.closest('li, tr, article, .result, .doc-item, .essay, .paper, [class*="result"], [class*="item"]');
        const heading = parent?.querySelector('h1,h2,h3,h4,.title,[class*="title"]');
        return clean(heading?.textContent || own);
      };
      const links = [...document.querySelectorAll('a[href]')];
      for (const anchor of links) {
        if (!visible(anchor)) continue;
        const href = anchor.href;
        const text = titleFrom(anchor);
        if (!/^https?:\\/\\//i.test(href) || !text || text.length < 4 || text.length > 240) continue;
        if (blocked.test(text) || /^(javascript:|#)/i.test(anchor.getAttribute('href') || '')) continue;
        if (/下载|download|cite|引用|分享|收藏/i.test(text) && text.length < 20) continue;
        const key = href.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ title: text, url: key });
      }
      return candidates.slice(0, 80);
    })()`);
    const filtered = (Array.isArray(candidates) ? candidates : []).filter((item) => sameLibrarySite(url, item.url));
    return { ok: true, url, candidates: filtered };
  } catch (err) {
    return { ok: false, error: `扫描当前页面失败：${err.message}` };
  }
}

async function clickPaperDownload() {
  return literatureBrowserWindow.webContents.executeJavaScript(`(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const score = (node) => {
      const text = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
      const href = String(node.href || node.getAttribute('data-href') || '');
      if (!text && !href) return -1;
      if (/PDF/i.test(text)) return 10;
      if (/CAJ/i.test(text)) return 9;
      if (/下载全文|全文下载/i.test(text)) return 8;
      if (/下载|download/i.test(text) || /download|pdf|caj/i.test(href)) return 6;
      return -1;
    };
    const nodes = [...document.querySelectorAll('a,button,[role="button"],input[type="button"]')]
      .filter(visible).map((node) => ({ node, value: score(node) })).filter((item) => item.value >= 0)
      .sort((a, b) => b.value - a.value);
    if (!nodes.length) return { ok: false, error: '页面中没有找到下载按钮，可能需要先登录、购买或完成验证码。' };
    const target = nodes[0].node;
    const href = /^https?:\\/\\//i.test(String(target.href || '')) ? target.href : '';
    if (!href) target.click();
    return { ok: true, href, label: String(target.textContent || target.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80) };
  })()`);
}

async function downloadLiteratureBatch(items) {
  if (!literatureBrowserWindow || literatureBrowserWindow.isDestroyed()) return { ok: false, error: '登录下载浏览器没有打开。' };
  const list = Array.isArray(items) ? items.slice(0, 30) : [];
  if (!list.length) return { ok: false, error: '请先扫描并勾选论文。' };
  const originUrl = literatureBrowserWindow.webContents.getURL();
  const results = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    if (!sameLibrarySite(originUrl, item.url)) {
      results.push({ ok: false, title: item.title || '未命名论文', error: '论文地址不属于当前登录站点，已跳过。' });
      continue;
    }
    mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title || item.url, state: 'opening' });
    try {
      await literatureBrowserWindow.loadURL(item.url);
      await new Promise((resolve) => setTimeout(resolve, 900));
      // 下载事件可能在 click() 返回前同步触发，必须先布置等待器，不能点击后再等。
      const downloadPromise = waitForLiteratureDownload();
      const clicked = await clickPaperDownload();
      if (!clicked.ok) {
        literatureDownloadWaiter?.({ ok: false, error: clicked.error });
        results.push({ ok: false, title: item.title, error: clicked.error });
        mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title, state: 'paused', error: clicked.error });
        continue;
      }
      // 有直接下载地址时走 Chromium 的下载接口，保留当前登录 session，
      // 比依赖页面脚本的 programmatic click 稳定；没有地址时沿用页面点击。
      if (clicked.href) literatureBrowserWindow.webContents.downloadURL(clicked.href);
      const download = await downloadPromise;
      const result = { ...download, title: item.title };
      results.push(result);
      mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title, state: download.ok ? 'done' : 'failed', error: download.error || '' });
      if (!download.ok) continue;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch (err) {
      const error = `打开或下载失败：${err.message}`;
      results.push({ ok: false, title: item.title, error });
      mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title, state: 'paused', error });
      break;
    }
  }
  return { ok: results.every((item) => item.ok), completed: results.filter((item) => item.ok).length, total: list.length, results };
}

function openLiteratureBrowser(url) {
  let target;
  try { target = new URL(String(url || '')); } catch { return { ok: false, error: '论文页面地址无效。' }; }
  if (!['http:', 'https:'].includes(target.protocol)) return { ok: false, error: '只允许打开 http(s) 论文页面。' };
  hookLiteratureDownloads();
  if (!literatureBrowserWindow || literatureBrowserWindow.isDestroyed()) {
    literatureBrowserWindow = new BrowserWindow({
      width: 1120,
      height: 820,
      minWidth: 760,
      minHeight: 560,
      title: '论文登录下载',
      icon: ICON_PATH,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: PARTITIONS.literature,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true,
      },
    });
    literatureBrowserWindow.webContents.setWindowOpenHandler(({ url: next }) => {
      if (/^https?:\/\//i.test(next)) {
        literatureBrowserWindow.loadURL(next);
      }
      return { action: 'deny' };
    });
    literatureBrowserWindow.on('closed', () => { literatureBrowserWindow = null; });
  }
  literatureBrowserWindow.loadURL(target.toString());
  literatureBrowserWindow.show();
  literatureBrowserWindow.focus();
  return { ok: true };
}

function registerDockShortcut() {
  globalShortcut.unregister(DOCK_SHORTCUT);
  const ok = globalShortcut.register(DOCK_SHORTCUT, async () => {
    const result = await windowDock.captureFrontmost();
    if (!result.ok) {
      const win = ensureMainWindow({ show: true });
      win.webContents.send('dock:error', result.error || '窗口吸附失败');
    }
  });
  return ok
    ? { ok: true, registered: true, accelerator: DOCK_SHORTCUT_LABEL }
    : { ok: false, registered: false, accelerator: DOCK_SHORTCUT_LABEL, error: `快捷键 ${DOCK_SHORTCUT_LABEL} 被其他应用占用了。` };
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

async function callTranslationApi({ messages, temperature = 0.1, timeout = 120000 }) {
  const apiKey = readApiKey('translation');
  const baseUrl = store.get('research.translation.baseUrl', 'https://ark.cn-beijing.volces.com/api/v3');
  const model = store.get('research.translation.model', '');
  const config = validateCompatibleConfig({ baseUrl, model, hasKey: Boolean(apiKey) });
  if (!config.ok) {
    return {
      ...config,
      error: '豆包翻译尚未配置：请到「设置 → 豆包翻译」填写 API Key 和模型/接入点。',
    };
  }
  return performCompatibleRequest({
    endpoint: config.endpoints.chat, apiKey, model: config.model, messages, temperature, timeout,
  });
}

async function callQuizApi({ messages, temperature = 0.2, timeout = 120000 }) {
  const apiKey = readApiKey('quiz');
  const baseUrl = store.get('study.quiz.baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const model = store.get('study.quiz.model', 'qwen3.5-flash');
  const config = validateCompatibleConfig({ baseUrl, model, hasKey: Boolean(apiKey) });
  if (!config.ok) {
    return {
      ...config,
      error: 'Qwen 出题模型尚未配置：请到「设置 → 学习出题模型」填写 API Key。',
    };
  }
  return performCompatibleRequest({
    endpoint: config.endpoints.chat, apiKey, model: config.model, messages, temperature, timeout,
  });
}

function registerIpc() {
  // 证书例外：按域名放行，不做全局关闭
  registerCertTrust(app, ipcMain, { getStore: () => store, getWindow: () => mainWindow });

  // 文献库：书目元数据补全 + 引用导出
  registerBiblioIpc(ipcMain, { dialog, getWindow: () => mainWindow, clipboard });

  // 代码记事本：读取 Understand-Anything 的知识图谱 + 按行号回读源码
  registerNotebookIpc(ipcMain, { dialog, getWindow: () => mainWindow });

  ipcMain.handle('config:all', () => safeConfig());
  ipcMain.handle('config:get', (_e, key, fallback) => {
    if (key === 'ai.api.key' || key === 'ai.api.keyEncrypted' || key === 'study.quiz.keyEncrypted' || key === 'research.translation.keyEncrypted') return fallback;
    return store.get(key, fallback);
  });
  ipcMain.handle('config:set', (_e, key, value) => {
    if (key === 'ai.api.key' || key === 'ai.api.keyEncrypted' || key === 'study.quiz.keyEncrypted' || key === 'research.translation.keyEncrypted') {
      throw new Error('API Key 必须通过安全凭据接口保存。');
    }
    const result = store.set(key, value);
    if (key.startsWith('pet.')) applyPetSettings();
    return result;
  });

  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:readImage', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const png = image.toPNG();
    if (png.length > 12 * 1024 * 1024) return { ok: false, error: '剪贴板图片超过 12MB，请先缩小后再粘贴。' };
    return { ok: true, mime: 'image/png', base64: png.toString('base64') };
  });

  ipcMain.handle('remote:status', () => ({ ...remoteControl.status(), autoStart: store.get('remote.autoStart', false), persistent: Boolean(readRemoteToken()) }));
  ipcMain.handle('remote:start', async () => {
    const result = await remoteControl.start({ token: readRemoteToken() });
    saveRemoteToken(result.token);
    return { ...result, persistent: Boolean(readRemoteToken()) };
  });
  ipcMain.handle('remote:stop', () => remoteControl.stop());
  ipcMain.handle('remote:rotate', async () => {
    await remoteControl.stop();
    const result = await remoteControl.start();
    saveRemoteToken(result.token);
    return { ...result, persistent: Boolean(readRemoteToken()) };
  });
  ipcMain.handle('remote:setAutoStart', (_event, enabled) => {
    store.set('remote.autoStart', Boolean(enabled));
    return { ok: true, autoStart: Boolean(enabled) };
  });
  ipcMain.handle('remote:resolve', (_event, payload) => {
    const pending = pendingRemoteCommands.get(payload?.requestId);
    if (!pending) return false;
    pendingRemoteCommands.delete(payload.requestId);
    clearTimeout(pending.timer);
    if (payload.ok) pending.resolve(payload.result || {});
    else pending.reject(new Error(payload.error || '电脑端动作失败。'));
    return true;
  });

  ipcMain.handle('dock:status', () => ({
    ...windowDock.status(),
    registered: globalShortcut.isRegistered(DOCK_SHORTCUT),
  }));
  ipcMain.handle('dock:requestPermission', () => windowDock.requestPermission());
  ipcMain.handle('dock:togglePin', () => windowDock.togglePin());
  ipcMain.handle('dock:arm', () => windowDock.arm());
  ipcMain.handle('dock:cancelArm', () => windowDock.cancelArm());
  ipcMain.handle('dock:captureAfter', (_e, delay) => windowDock.captureAfter(delay));
  ipcMain.handle('dock:captureFrontmost', () => windowDock.captureFrontmost());
  ipcMain.handle('dock:setRatio', (_e, ratio) => windowDock.setRatio(ratio));
  ipcMain.handle('dock:setSide', (_e, side) => windowDock.setSide(side));
  ipcMain.handle('dock:detach', () => windowDock.detach());
  ipcMain.on('dock:divider-move', (_e, screenX) => { windowDock.setRatioFromScreenX(screenX); });
  ipcMain.on('dock:divider-end', () => windowDock.commitRatio());
  ipcMain.on('dock:divider-detach', () => { windowDock.detach(); });

  ipcMain.handle('term:status', () => ({
    ok: true,
    enabled: store.get('terms.overlay.enabled', true),
    accelerator: TERM_SHORTCUT_LABEL,
    registered: globalShortcut.isRegistered(TERM_SHORTCUT),
  }));
  ipcMain.handle('term:setOverlayEnabled', (_e, enabled) => {
    store.set('terms.overlay.enabled', Boolean(enabled));
    return registerTermShortcut();
  });
  ipcMain.handle('term:resolve', (_e, payload) => {
    if (!payload || payload.requestId !== pendingTermRequest?.requestId) return false;
    const term = pendingTermRequest.term;
    pendingTermRequest = null;
    if (payload.ok) sendTermPopupState({ status: 'done', term, result: payload.result });
    else sendTermPopupState({ status: 'error', term, error: payload.error || 'DeepSeek 没有返回解释。' });
    return true;
  });
  ipcMain.on('term:popup-close', () => termPopupWindow?.hide());
  ipcMain.on('term:popup-copy', (_e, text) => clipboard.writeText(String(text || '')));
  ipcMain.on('term:popup-search', (_e, query) => {
    const value = String(query || '').trim();
    if (value) shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(value)}`);
  });
  ipcMain.on('term:popup-open-tool', () => {
    const win = ensureMainWindow({ show: true });
    const navigate = () => win.webContents.send('app:navigate-tool', { id: 'terms' });
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', navigate);
    else navigate();
    termPopupWindow?.hide();
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) return false; // 只放行 http(s)，挡掉 file:// 之类
    shell.openExternal(url);
    return true;
  });
  ipcMain.handle('shell:openEasyConnect', async () => {
    const candidates = process.platform === 'darwin'
      ? ['/Applications/EasyConnect.app', '/Applications/Sangfor EasyConnect.app', path.join(os.homedir(), 'Applications', 'EasyConnect.app')]
      : process.platform === 'win32'
        ? ['C:\\Program Files\\Sangfor\\SSL\\EasyConnect\\EasyConnect.exe', 'C:\\Program Files (x86)\\Sangfor\\SSL\\EasyConnect\\EasyConnect.exe']
        : [];
    const appPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!appPath) return { ok: false, error: '未找到 EasyConnect，请先安装学校提供的官方客户端。' };
    const error = await shell.openPath(appPath);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('shell:openWeChat', async () => {
    try {
      await shell.openExternal('weixin://');
      return { ok: true };
    } catch {
      const candidates = [
        '/Applications/WeChat.app',
        '/Applications/微信.app',
        path.join(os.homedir(), 'Applications', 'WeChat.app'),
        path.join(os.homedir(), 'Applications', '微信.app'),
      ];
      const appPath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!appPath) return { ok: false, error: '没有找到微信，请先安装或手动打开微信。' };
      const error = await shell.openPath(appPath);
      return error ? { ok: false, error } : { ok: true };
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
    return { ok: true };
  });
  ipcMain.handle('app:reload', () => { if (mainWindow) mainWindow.reload(); });
  ipcMain.handle('app:openDevTools', () => {
    if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  /**
   * 自定义 AI API 的请求。放在主进程有两个原因：
   * 渲染进程有 CSP（connect-src 'self'）发不出去；API Key 也不该在页面上下文里流转。
   */
  ipcMain.handle('ai:chat', (_e, payload) => callCompatibleApi(payload));
  ipcMain.handle('ai:translate', (_e, payload) => callTranslationApi(payload));
  ipcMain.handle('ai:quiz', (_e, payload) => callQuizApi(payload));
  ipcMain.handle('ai:credentialStatus', (_e, scope = 'default') => ({ hasKey: Boolean(readApiKey(scope)), secure: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('ai:saveCredential', (_e, key, scope = 'default') => saveApiKey(key, scope));
  ipcMain.handle('ai:clearCredential', (_e, scope = 'default') => saveApiKey('', scope));
  ipcMain.handle('ai:listModels', async (_e, { baseUrl, scope = 'default' }) => {
    const endpoints = buildCompatibleEndpoints(baseUrl);
    if (!endpoints) return { ok: false, error: '请先填写以 http:// 或 https:// 开头的有效 Base URL。' };
    const apiKey = readApiKey(scope);
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

  ipcMain.handle('video:fetchSubs', async (_e, payload) => {
    const cookieFile = await exportBilibiliCookies();
    try {
      return await videoReport.fetchSubtitles(payload?.url, payload?.scope, { cookieFile });
    } finally {
      if (cookieFile) {
        try { fs.rmSync(cookieFile, { force: true }); } catch { /* 临时 cookie 文件清理失败不影响结果 */ }
      }
    }
  });

  ipcMain.handle('video:saveReport', (_e, payload) =>
    videoReport.saveReport(app.getPath('userData'), payload));

  ipcMain.handle('video:publishReport', (_e, fileName, force) =>
    videoReport.publishReport(app.getPath('userData'), fileName, Boolean(force)));

  ipcMain.handle('video:openFeishuWindow', async (_e, url) => {
    let target;
    try { target = new URL(String(url || '')); } catch { return { ok: false, error: '飞书文档地址无效。' }; }
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.feishu.cn')) {
      return { ok: false, error: '只允许打开飞书文档地址。' };
    }
    await edgeCookies.syncCookies(PARTITIONS.feishu, 'feishu.cn').catch(() => {});
    if (!feishuWindow || feishuWindow.isDestroyed()) {
      feishuWindow = new BrowserWindow({
        width: 1180, height: 820, minWidth: 820, minHeight: 620,
        title: '飞书报告', backgroundColor: '#ffffff', parent: mainWindow || undefined,
        webPreferences: { partition: PARTITIONS.feishu, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      feishuWindow.webContents.setWindowOpenHandler(({ url: next }) => {
        try { return new URL(next).hostname.endsWith('.feishu.cn') ? { action: 'allow' } : { action: 'deny' }; } catch { return { action: 'deny' }; }
      });
      feishuWindow.on('closed', () => { feishuWindow = null; });
    }
    await feishuWindow.loadURL(target.toString());
    feishuWindow.show();
    feishuWindow.focus();
    return { ok: true };
  });

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

  ipcMain.handle('watch:avatar', async (_e, handle) => {
    const value = String(handle || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{1,20}$/.test(value)) return null;
    const key = value.toLowerCase();
    if (watchAvatarCache.has(key)) return watchAvatarCache.get(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`https://unavatar.io/twitter/${encodeURIComponent(value)}?fallback=false`, {
        headers: { 'User-Agent': CHROME_UA, Accept: 'image/*' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const mime = (res.headers.get('content-type') || '').split(';')[0];
      if (!/^image\//.test(mime)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 2 * 1024 * 1024) return null;
      const image = nativeImage.createFromBuffer(buf);
      if (image.isEmpty()) return null;
      const dataUrl = `data:image/jpeg;base64,${image.resize({ width: 128 }).toJPEG(82).toString('base64')}`;
      watchAvatarCache.set(key, dataUrl);
      return dataUrl;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('site:float', (_e, site) => {
    const normalized = normalizedSite(site);
    if (!normalized) return { ok: false, error: '这个站点地址无效，无法创建悬浮球。' };
    return createSiteFloat(normalized);
  });

  ipcMain.on('site-float:expand', (_event, id) => setSiteFloatExpanded(String(id || ''), true, 'mobile'));
  ipcMain.on('site-float:move', (_event, id, deltaX, deltaY) => {
    const entry = siteFloatWindows.get(String(id || ''));
    if (!entry || entry.state.expanded || entry.window.isDestroyed()) return;
    const x = Number(deltaX);
    const y = Number(deltaY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const [left, top] = entry.window.getPosition();
    entry.window.setPosition(Math.round(left + x), Math.round(top + y), false);
  });
  ipcMain.on('site-float:collapse', (_event, id) => setSiteFloatExpanded(String(id || ''), false));
  ipcMain.on('site-float:set-mode', (_event, id, mode) => setSiteFloatExpanded(String(id || ''), true, mode));
  ipcMain.on('site-float:close', (_event, id) => {
    const entry = siteFloatWindows.get(String(id || ''));
    if (entry && !entry.window.isDestroyed()) entry.window.close();
  });
  ipcMain.on('site-float:open-external', (_event, url) => {
    const safeUrl = validHttpUrl(url);
    if (safeUrl) shell.openExternal(safeUrl);
  });

  // ---- 站点登录墙绕过脚本：主进程读文件，渲染进程通过 executeJavaScript 注入 webview ----
  let bypassScriptCache = null;
  ipcMain.handle('site:bypassScript', () => {
    if (bypassScriptCache) return bypassScriptCache;
    const filePath = path.join(__dirname, 'site-bypass-preload.js');
    try {
      bypassScriptCache = fs.readFileSync(filePath, 'utf8');
      return bypassScriptCache;
    } catch (err) {
      console.error('[main] read bypass script failed:', err.message);
      return '';
    }
  });

  // ---- Edge/Chrome Cookie 桥：把用户已在浏览器登录的站点 session 同步到 webview ----
  ipcMain.handle('edge:syncCookies', (_e, { partition, host }) => edgeCookies.syncCookies(partition, host));

  // ---- Skill 工厂：规范化生成和读取本机 SKILL.md ----

  ipcMain.handle('skill:targets', () => skillFactory.skillRoots({
    homeDir: app.getPath('home'),
    projectDir: process.cwd(),
  }));

  ipcMain.handle('skill:list', () => skillFactory.listSkills({
    homeDir: app.getPath('home'),
    projectDir: process.cwd(),
  }));

  ipcMain.handle('skill:read', (_e, filePath) => {
    try { return { ok: true, content: skillFactory.readSkill(filePath) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skill:write', (_e, payload) => {
    try { return skillFactory.writeSkill(payload || {}); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skill:reveal', (_e, filePath) => {
    if (typeof filePath !== 'string' || path.basename(filePath) !== skillFactory.SKILL_FILE) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  // ---- 自定义 MCP 服务：写入常见客户端配置，覆盖前保留 .bak ----
  const currentMcpTargets = () => mcpFactory.mcpTargets({ homeDir: app.getPath('home'), platform: process.platform });
  const findMcpTarget = (id) => currentMcpTargets().find((target) => target.id === id);
  ipcMain.handle('mcp:targets', () => currentMcpTargets());
  ipcMain.handle('mcp:list', (_e, targetId) => {
    const target = findMcpTarget(targetId);
    if (!target) return { ok: false, error: '找不到这个 MCP 配置目标。' };
    try { return { ok: true, target, servers: mcpFactory.listMcpServers(target) }; }
    catch (err) { return { ok: false, target, error: `读取 MCP 配置失败：${err.message}` }; }
  });
  ipcMain.handle('mcp:snippet', (_e, payload = {}) => {
    const target = findMcpTarget(payload.targetId);
    if (!target) return { ok: false, error: '找不到这个 MCP 配置目标。' };
    try { return { ok: true, target, content: mcpFactory.snippet(payload.definition || {}, target.format) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('mcp:write', (_e, payload = {}) => {
    const target = findMcpTarget(payload.targetId);
    if (!target) return { ok: false, error: '找不到这个 MCP 配置目标。' };
    try { return mcpFactory.writeMcpServer({ target, definition: payload.definition || {}, overwrite: payload.overwrite !== false }); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('mcp:remove', (_e, payload = {}) => {
    const target = findMcpTarget(payload.targetId);
    if (!target) return { ok: false, error: '找不到这个 MCP 配置目标。' };
    try { return mcpFactory.removeMcpServer({ target, name: payload.name }); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // ---- 文献管理器：文件统一收进 userData/literature/，元信息在渲染进程存 config ----

  const LIT_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'epub', 'caj', 'djvu', 'ppt', 'pptx', 'xls', 'xlsx', 'rtf'];

  const litDir = () => {
    const dir = path.join(app.getPath('userData'), 'literature');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  function decodeXmlText(value) {
    return String(value || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, num) => String.fromCodePoint(Number(num)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  async function fetchArxivTitle(id) {
    if (!id) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': CHROME_UA },
        signal: controller.signal,
      });
      if (!response.ok) return '';
      const xml = await response.text();
      const entry = xml.match(/<entry[\s\S]*?<\/entry>/i)?.[0] || '';
      return decodeXmlText(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  /** 编号命名的 PDF 尝试用 arXiv 元数据或正文标题重命名。 */
  async function maybeRenamePdf(dir, fileName) {
    if (!pdfTitle.looksLikeId(fileName)) return { file: fileName, renamed: false, reason: '不是编号命名' };
    const arxivId = pdfTitle.extractArxivId(fileName);
    const title = (arxivId && await fetchArxivTitle(arxivId)) || pdfTitle.extractPdfTitle(path.join(dir, fileName));
    if (!title) return { file: fileName, renamed: false, reason: '没有读出论文标题' };
    const stem = pdfTitle.sanitizeFileStem(title);
    if (!stem || stem.length < 6) return { file: fileName, renamed: false, reason: '论文标题不可用' };
    let target = `${stem}.pdf`;
    let n = 1;
    while (fs.existsSync(path.join(dir, target)) && target !== fileName) {
      target = `${stem}-${n++}.pdf`;
    }
    if (target === fileName) return { file: fileName, renamed: false, reason: '已经是标题名' };
    fs.renameSync(path.join(dir, fileName), path.join(dir, target));
    return { file: target, renamed: true, from: fileName, title };
  }

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
        const extName = ext.slice(1).toLowerCase();
        let finalName = path.basename(dest);
        let renamed = false;
        // arxiv 这类编号命名的 PDF：读正文标题重命名
        if (extName === 'pdf') {
          const r = await maybeRenamePdf(dir, finalName);
          finalName = r.file;
          renamed = r.renamed;
        }
        imported.push({ file: finalName, size: stat.size, format: extName, renamed });
      } catch { /* 单个失败不拖垮整批 */ }
    }
    return imported;
  });

  /** 整理库里已有的编号命名 PDF（不重新导入） */
  ipcMain.handle('lit:fixNames', async () => {
    const dir = litDir();
    const renames = [];
    const skipped = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.pdf') || !pdfTitle.looksLikeId(f)) continue;
      const r = await maybeRenamePdf(dir, f);
      if (r.renamed) renames.push({ from: r.from, to: r.file, title: r.title });
      else skipped.push({ file: f, reason: r.reason || '标题不可用' });
    }
    return { renames, skipped, checked: renames.length + skipped.length };
  });

  /** 按文献名自动下载免费 PDF 进库（arXiv 优先，Semantic Scholar 兜底） */
  ipcMain.handle('lit:fetch', (_e, query) => litFetch.fetchPaperByTitle(litDir(), query));
  /** 按研究方向发现候选论文（OpenAlex + Europe PMC） */
  ipcMain.handle('lit:discover', (_e, options) => litFetch.discoverPapers(options));
  /** 下载候选论文的合法开放全文 */
  ipcMain.handle('lit:downloadCandidate', (_e, paper) => litFetch.downloadPaperCandidate(litDir(), paper));
  ipcMain.handle('lit:downloadCandidates', (_e, papers) => litFetch.downloadPapersBatch(
    litDir(),
    papers,
    (state) => mainWindow?.webContents.send('lit:auto-progress', state),
  ));
  /** 打开带持久登录态的论文浏览器；用户正常登录后，下载文件自动进入文献库 */
  ipcMain.handle('lit:openAccessBrowser', (_e, url) => openLiteratureBrowser(url));
  /** 扫描已登录论文网页中的可疑似文献链接 */
  ipcMain.handle('lit:scanBrowserPage', () => scanLiteratureBrowserPage());
  /** 在当前登录站点逐篇点击下载，触发系统下载并自动入库 */
  ipcMain.handle('lit:downloadBatch', (_e, items) => downloadLiteratureBatch(items));

  /** 读 PDF 原始字节给渲染进程的 PDF.js 自渲染（Uint8Array） */
  ipcMain.handle('lit:readPdf', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    try {
      const stat = fs.statSync(full);
      if (stat.size > 60 * 1024 * 1024) return { ok: false, error: 'PDF 超过 60MB，太大了。' };
      return { ok: true, data: fs.readFileSync(full) };
    } catch {
      return { ok: false, error: '读不到这个 PDF。' };
    }
  });

  /** 免费翻译（有道），返回 { ok, translation | error } */
  ipcMain.handle('lit:translate', (_e, text, opts) => translator.translate(text, opts));

  /** 圈选截图（dataURL PNG）→ 本地 OCR，只识别不翻译，返回 { ok, text | error }。
   *  翻译由渲染层自己走 AI 接口（质量好、没有有道每分钟约 5 条新内容的配额）。 */
  ipcMain.handle('lit:snipOcr', (_e, dataUrl) => ocr.ocrImage(app.getPath('userData'), dataUrl));

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

  /** 内置阅读器要拿完整路径喂给 webview 的 file:// */
  ipcMain.handle('lit:path', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    return fs.existsSync(full) ? full : null;
  });

  /** TXT/MD 这类纯文本直接读进应用内阅读器 */
  ipcMain.handle('lit:readText', (_e, file) => {
    const full = path.join(litDir(), path.basename(String(file || '')));
    try {
      const stat = fs.statSync(full);
      if (stat.size > 3 * 1024 * 1024) return { ok: false, error: '文件超过 3MB，建议外部打开。' };
      return { ok: true, content: fs.readFileSync(full, 'utf8') };
    } catch {
      return { ok: false, error: '读不出来。' };
    }
  });

  // ---- 代码陪读：把插件装进本机 VSCode / Cursor 并写好默认配置 ----

  ipcMain.handle('coach:install', () => installCoachExtension());

  ipcMain.handle('practice:environment', () => practiceRunner.environment());
  ipcMain.handle('practice:run', (_e, payload = {}) => practiceRunner.run(payload.track, payload.code, { timeout: payload.timeout }));

  // ---- 专注 · AI 情报：RSS 快报由主进程代取（渲染进程 CSP 不放行跨域请求） ----
  ipcMain.handle('news:fetchFeed', (_e, url) => newsFeed.fetchFeed(url));

  // 快报配图代取成 data: URL，磁盘缓存放 userData/cache/news-img/。
  // 原图动辄几百 KB，用 nativeImage 缩到缩略图尺寸再转 JPEG，渲染层内存和缓存盘都省。
  ipcMain.handle('news:image', (_e, url) =>
    newsFeed.fetchImage(url, path.join(app.getPath('userData'), 'cache', 'news-img'), (buf) => {
      try {
        const img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) return null;
        const resized = img.resize({ width: 180 });
        return { mime: 'image/jpeg', b64: resized.toJPEG(72).toString('base64') };
      } catch {
        return null;
      }
    }));
}

// 单实例。再敲一次 npm start 不会开出第二个实例，而是把现有窗口叫回来 ——
// 窗口被关掉、或 Dock 图标因为某些窗口设置消失时，这是最顺手的找回方式。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (process.platform === 'darwin') app.dock?.show();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  migrateLegacyApiKey();
  nativeTheme.themeSource = 'dark';

  // 不打包直接 npm start 时，dock 里是 Electron 的默认图标，换成我们自己的
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  for (const partition of Object.values(PARTITIONS)) relaxPartition(partition);
  configureBilibiliPartition();

  // 启动时清空专注/情报分区的缓存和 cookie，避免站点记住上次的登录重定向状态
  try {
    const focusSes = session.fromPartition(PARTITIONS.focus);
    await focusSes.clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage', 'indexeddb', 'websql'] });
  } catch (err) {
    console.error('[main] clear focus partition failed:', err);
  }

  windowDock = new WindowDock({
    app,
    BrowserWindow,
    screen,
    store,
    getMainWindow: () => mainWindow,
  });

  remoteControl = new RemoteControl({
    deviceName: 'Agent 工具箱',
    onCommand: handleRemoteCommand,
  });

  registerIpc();
  hookLiteratureDownloads();
  hookResearchDownloads();
  createWindow();
  createPetWindow();
  if (store.get('remote.autoStart', false)) {
    remoteControl.start({ token: readRemoteToken() })
      .then((result) => saveRemoteToken(result.token))
      .catch((error) => console.warn('[remote] 自动启动失败:', error.message));
  }
  const termShortcut = registerTermShortcut();
  if (!termShortcut.ok) console.warn('[terms]', termShortcut.error);
  const dockShortcut = registerDockShortcut();
  if (!dockShortcut.ok) console.warn('[dock]', dockShortcut.error);

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quittingForDock || !windowDock?.status().active) return;
  event.preventDefault();
  quittingForDock = true;
  windowDock.dispose().finally(() => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  remoteControl?.stop();
  for (const pending of pendingRemoteCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('工具箱正在退出。'));
  }
  pendingRemoteCommands.clear();
});
