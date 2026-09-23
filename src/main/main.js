'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const QRCode = require('qrcode');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, ipcMain, session, shell, dialog, clipboard, nativeTheme, safeStorage, screen,
  nativeImage, globalShortcut,
  systemPreferences,
  Notification, Tray, Menu,
} = require('electron');
const { Store } = require('./store');
const { buildQuickExplainMessages, parseQuickExplainResponse } = require('./quick-explain');
const { buildCompatibleEndpoints, validateCompatibleConfig, readStoredCompatibleConfig } = require('./ai-config');
const chatBridge = require('./chat-bridge');
const agentRuntime = require('./agent-runtime');
const videoReport = require('./video-report');
const pdfTitle = require('./pdf-title');
const { installCoachExtension } = require('./coach-install');
const litFetch = require('./lit-fetch');
const { registerNotebookIpc } = require('./notebook');
const { registerBiblioIpc } = require('./biblio');
const { registerDocSearchIpc } = require('./doc-search');
const { registerShelfIpc, stopAllShelfApps, start: startShelfTool, stop: stopShelfTool, status: shelfStatus, tail: shelfTail, resolveToolCommand } = require('./app-shelf');
const { registerUpdaterIpc, startAutoCheck, stopAutoCheck } = require('./updater');
const { createAvatarWindowController } = require('../avatar/window');
const { GestureDesk } = require('./gesture-desk');
const deckPptx = require('./deck-pptx');
const httpClient = require('./http-client');
const { GitDesk } = require('./git-desk');
const { NetCapture } = require('./net-capture');
const { Monologue } = require('./monologue');
const { PhoneAgent, PhoneOutbox } = require('./phone-agent');
const tidy = require('./tidy');
const chatRead = require('./chat-read');
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
const { registerContainerIpc, seedContainer, syncContainerLiterature, containerRoot } = require('./container-storage');
const { registerAvatarRigIpc } = require('./avatar-rig-service');
const { DshService } = require('./dsh-service');
const { TavernService } = require('./tavern-service');
const { AppControls } = require('./app-controls');
const { computeBounds, canApplyGesture } = require('./window-gesture');
const { VoiceboxService } = require('./voicebox-service');
const { OpenAIImageClient } = require('./openai-image');
const { generateTeachingSlides } = require('./teaching-slides');
const { exportPptx } = require('./pptx-export');
const { VoiceBoxService } = require('./voicebox-service');
const voiceboxApi = require('./voicebox-api');
const { sameLibrarySite } = require('./literature-site');

async function remoteStatusWithQr(state) {
  const current = state || remoteControl.status();
  const apkUrl = current.apkUrls?.[0] || '';
  const pairUrl = current.urls?.[0] || '';
  // 直接编码 HTTPS/HTTP 配对地址：系统相机可打开网页，新版 App 内扫码也可识别。
  const pairDeepLink = pairUrl;
  return {
    ...current,
    apkQr: apkUrl ? await QRCode.toDataURL(apkUrl, { width: 320, margin: 2 }) : '',
    pairDeepLink,
    pairQr: pairDeepLink ? await QRCode.toDataURL(pairDeepLink, { width: 320, margin: 2 }) : '',
  };
}
const { ArgosService } = require('./argos-service');

const IS_DEV = process.argv.includes('--dev');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const APP_USER_MODEL_ID = 'Guoshaung.AgentToolbox';
let runtimeAppIcon = null;

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
let petMode = false; // false | 'card' | 'memory'
let termPopupWindow;
let pendingTermRequest;
let literatureBrowserWindow;
let feishuWindow;
let literatureDownloadHooked = false;
let researchDownloadHooked = false;
let literatureDownloadWaiter;
let literatureActiveDownload = null;
let literatureBatchControl = null;
let windowDock;
let quittingForDock = false;
let remoteControl;
let gestureDesk = null;
let gitDesk = null;
let netCapture = null;
let monologue = null;
let monologueWindow = null;
let overlayWindow = null;
let phoneAgent = null;
let phoneOutbox = null;

/** 手机精灵在干嘛 → 桌面精灵跟着变、通知一声 */
function relayPhoneState(payload) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:phone', payload);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone:event', { type: 'state', ...payload, at: Date.now() });
  if (payload.state === 'gave' && payload.path) {
    try {
      const n = new Notification({ title: '手机精灵递来一个文件', body: payload.text });
      n.on('click', () => shell.showItemInFolder(payload.path));
      n.show();
    } catch { /* 系统不让发通知就算了 */ }
  }
}
const MONOLOGUE_SHORTCUT = 'CommandOrControl+Shift+M';
// 叫回主窗口。关掉窗口后应用还在后台（桌宠、手机服务都靠它），但没有一个显眼的入口能把窗口叫回来，
// 于是「叉掉就找不到了」。菜单栏图标 + 这个快捷键 + 点 Dock 图标，三条路都能回来。
const WAKE_SHORTCUT = 'CommandOrControl+Shift+A';
// 在任何应用里选中一段代码 / 一句话 → 桌宠弹出四行解释。学代码最常用的一下。
const EXPLAIN_SHORTCUT = 'CommandOrControl+Shift+L';

async function explainSelectionWithPet() {
  const text = await captureSelectedText().catch(() => '');
  if (!store.get('pet.enabled', true)) { store.set('pet.enabled', true); applyPetSettings(); }
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  const deliver = () => petWindow.webContents.send('pet:quick', { text });
  if (petWindow.webContents.isLoading()) petWindow.webContents.once('did-finish-load', deliver); else deliver();
  petWindow.showInactive();
}
let tray = null;

function createTray() {
  if (tray) return tray;
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    if (!icon.isEmpty()) icon = icon.resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    tray.setToolTip('Agent 工具箱 —— 点一下叫回窗口');
    const menu = Menu.buildFromTemplate([
      { label: '显示工具箱', accelerator: WAKE_SHORTCUT, click: () => ensureMainWindow({ show: true }) },
      { type: 'separator' },
      { label: '退出工具箱', click: () => quitToolbox() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => ensureMainWindow({ show: true }));
  } catch (error) { console.warn('[tray] 建不出菜单栏图标：', error.message); }
  return tray;
}
let dshService;
let tavernService;
let argosService;
let appControls;
let voiceBoxService;
let voiceboxService;
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
    }, type === 'ai.ask' || type === 'eat.recommend' ? 120000 : 10000);   // 这两个要跑 AI，实测 10 秒不够
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

function isFeishuHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'feishu.cn' || host.endsWith('.feishu.cn');
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
    // macOS 上部分国内站点的 Electron 兼容层会在 guest sandbox 下直接
    // 返回 ERR_FAILED；主窗口仍保持 sandbox，第三方 guest 走兼容模式。
    webPreferences.sandbox = process.platform !== 'darwin';
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
        sandbox: process.platform !== 'darwin',
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
    case 'remote.inbox.add':
      return { accepted: true };
    case 'app.show':
      ensureMainWindow({ show: true });
      return { shown: true };
    // 手机上看电脑画面：抓主窗口一帧，缩到 900 宽的 JPEG。点一下 / 滑一下也原样送回窗口。
    case 'screen.tap': {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('工具箱主窗口没有打开。');
      const [w, h] = mainWindow.getContentSize();
      const x = Math.round(Math.min(1, Math.max(0, Number(payload.x) || 0)) * w);
      const y = Math.round(Math.min(1, Math.max(0, Number(payload.y) || 0)) * h);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      return { ok: true, x, y };
    }
    case 'screen.scroll': {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('工具箱主窗口没有打开。');
      const [w, h] = mainWindow.getContentSize();
      const x = Math.round(Math.min(1, Math.max(0, Number(payload.x) || 0.5)) * w);
      const y = Math.round(Math.min(1, Math.max(0, Number(payload.y) || 0.5)) * h);
      const deltaY = Math.max(-1200, Math.min(1200, Math.round(Number(payload.dy) || 0)));
      mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -deltaY, canScroll: true });
      return { ok: true };
    }
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
    // 今天吃什么：推荐要跑 AI、读的是渲染层里的记录，所以整个交给渲染层
    case 'eat.recommend':
      return requestRemoteRenderer(type, { mood: String(payload.mood || '').slice(0, 20) });
    case 'eat.record':
      return requestRemoteRenderer(type, { dish: String(payload.dish || '').slice(0, 80), shop: String(payload.shop || '').slice(0, 80) });
    case 'agent.office':
      return { agents: chatBridge.listLatestSessions() };
    case 'agent.session': {
      const source = String(payload.source || '');
      const id = String(payload.id || '');
      if (!/^[a-z0-9-]+$/.test(source) || !id || id.length > 300) throw new Error('会话标识无效。');
      const sessionData = chatBridge.loadSession(source, id, { previewOnly: true, tail: true });
      if (!sessionData) throw new Error('会话已被清理或暂时无法读取。');
      return { session: sessionData };
    }
    case 'agent.run': {
      const source = String(payload.source || '');
      const prompt = String(payload.prompt || '').trim().slice(0, 20000);
      const runtime = agentRuntime.AGENTS[source];
      if (!runtime || !prompt) throw new Error('Agent 或命令内容无效。');
      // 不再让电脑端弹框确认 —— 人在手机上就是因为不在电脑前，每次都要回来点一下等于没这功能。
      // 手机已经用一次性令牌配过对，就当是本人；CLI 那条路仍然是只读 / 计划模式。
      // 走哪条路在主进程里定，跟办公室页用同一份设置（store 里的 focus.channel.*）——
      // 之前靠渲染层的处理器，专注页没打开时它根本不存在，等 10 秒超时后竟然去跑了 CLI。
      const desktopApps = await listDesktopApps();
      const saved = String(store.get(`focus.channel.${source}`, '') || '');
      const channel = ['window', 'web', 'cli'].includes(saved) ? saved : desktopApps[source] ? 'window' : 'cli';
      if (channel === 'window') {
        // 桌面客户端：粘贴 + 回车。应用没开的话 activate 会把它拉起来。
        const target = String(store.get(`focus.handoffTarget.${source}`, '') || desktopApps[source] || '');
        if (!target) throw new Error(`${runtime.label} 还没选要送进哪个应用，去电脑上「专注 → 派发台」点它的屏幕选一个。`);
        const handed = await handoffToApp(target, prompt);
        if (!handed.ok) throw new Error(handed.error || '投送失败');
        return { text: `已送进电脑上的 ${target}，回答在那边看。`, source, channel: 'window', target };
      }
      if (channel === 'web') {
        ensureMainWindow({ show: true });
        const viaOffice = await requestRemoteRenderer('office.send', { id: source, prompt }).catch(() => null);
        if (!viaOffice?.handled) throw new Error(`${runtime.label} 走的是网页版，要先在电脑上打开「专注」页。`);
        if (!viaOffice.ok) throw new Error(viaOffice.error || '投送失败');
        return { text: viaOffice.text, source, channel: 'web' };
      }
      ensureMainWindow({ show: true });
      const latest = chatBridge.listSessions(source)[0];
      return agentRuntime.runAgent(source, prompt, { cwd: latest?.cwd || os.homedir() });
    }
    default:
      throw new Error(`不支持的远程动作：${type || '空动作'}`);
  }
}
const DOCK_SHORTCUT = process.platform === 'darwin' ? 'Alt+Shift+D' : 'CommandOrControl+Alt+Shift+D';
const DOCK_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌥⇧D' : 'Ctrl+Alt+Shift+D';

const PET_SIZE = { width: 124, height: 138 };
const PET_CARD_SIZE = { width: 390, height: 548 };
// 记忆栈要装整段对话，390 宽根本排不下，长文会挤成一条竖线。
const PET_MEMORY_SIZE = { width: 880, height: 620 };
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
  if (scope === 'image') return 'image.api.keyEncrypted';
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
  if (data.image?.api) {
    delete data.image.api.key;
    delete data.image.api.keyEncrypted;
    data.image.api.hasKey = Boolean(readApiKey('image'));
  }
  if (data.remote) delete data.remote.tokenEncrypted;
  return data;
}

const officePartitions = new Set();

/** Configure browser identity without weakening third-party response policies. */
function configurePartition(partitionName) {
  const ses = session.fromPartition(partitionName);
  ses.setUserAgent(CHROME_UA);

  // Client hints only need to be normalized for document requests. Response
  // headers, including third-party Content-Security-Policy, are preserved.
  const DOC_ONLY = { urls: ['<all_urls>'], types: ['mainFrame', 'subFrame'] };
  // 站点可能按 UA 提示（Client Hints）判断浏览器，一并对齐，避免被判成非常规客户端。
  ses.webRequest.onBeforeSendHeaders(DOC_ONLY, (details, callback) => {
    const headers = details.requestHeaders;
    // UA 已经由上面的 setUserAgent 全局设过了，这里保留是为了万无一失；
    // Client Hints 只有文档请求上的才会被站点用来判断浏览器。
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

function loadRuntimeAppIcon() {
  if (runtimeAppIcon && !runtimeAppIcon.isEmpty()) return runtimeAppIcon;
  const dataUrl = store?.get('ui.appIconDataUrl', '');
  if (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|svg\+xml);base64,/.test(dataUrl)) return null;
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (!image.isEmpty()) runtimeAppIcon = image;
  } catch { /* 回退到随包默认图标 */ }
  return runtimeAppIcon;
}

function createWindow(showOnReady = true) {
  loadRuntimeAppIcon();
  mainWindow = new BrowserWindow({
    ...restoreBounds(),
    minWidth: 900,
    minHeight: 620,
    title: 'Agent 工具箱',
    icon: runtimeAppIcon && !runtimeAppIcon.isEmpty() ? runtimeAppIcon : ICON_PATH,          // macOS 上窗口图标无效，靠下面的 dock.setIcon
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12141a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 四个工具全靠它内嵌 Chromium
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (runtimeAppIcon && !runtimeAppIcon.isEmpty()) mainWindow.setIcon(runtimeAppIcon);

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
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[renderer] did-fail-load', code, description, url);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer]', message, `${sourceId}:${line}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details.reason, details.exitCode);
  });
  mainWindow.webContents.on('unresponsive', () => console.error('[renderer] unresponsive'));
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  let rendererRecoveries = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] renderer process ended:', details?.reason || 'unknown', details?.exitCode ?? '');
    if (rendererRecoveries >= 1 || mainWindow.isDestroyed()) return;
    rendererRecoveries += 1;
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 500);
  });
  mainWindow.webContents.on('did-finish-load', () => { rendererRecoveries = 0; });

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
  // 焦点跑进 webview 时宿主页面的 document.hasFocus() 也是 false，渲染层区分不了
  // 「切到内嵌页面」和「整个应用失焦」。所以由主进程判断整窗失焦，再通知过去关面板。
  mainWindow.on('closed', () => {
    mainWindow = null;
    windowDock?.detach({ restoreMain: false, restoreTarget: true });
    // 桌宠是主应用的一部分：Windows/Linux 仍保持原来“关主窗即退出”的体验；
    // macOS 则沿用关闭窗口但应用常驻的惯例，桌宠可继续使用。
    // 桌宠、术语弹窗这些是 hide 不是 destroy，只要被创建过就一直算「还有窗口」，
    // window-all-closed 永远不触发，进程就留在后台了。quitToolbox 会显式销毁。
    if (process.platform !== 'darwin') quitToolbox();
  });

  // 壳本身永远不该被导航走；工具里的链接一律交给内嵌 webview 或系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 强制所有 webview 的安全参数，不信任渲染进程写的属性。
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    const source = String(params?.src || '');
    const isDsh = webPreferences.partition === 'persist:dsh' || /^https?:\/\/127\.0\.0\.1:3080(?:\/|$)/i.test(source);
    const isTavern = webPreferences.partition === 'persist:tavern';
    // 示意图编辑器不套站点清理脚本：它是本地单文件应用，不需要拆登录墙。
    const isDrafter = webPreferences.partition === 'persist:drafter' || /figure-drafter\.html$/i.test(source);
    // 办公室里各家 AI 的网页版：要像一个普通 Chrome 一样过登录和 Cloudflare，
    // 所以分区第一次出现时把 UA / Client Hints 配齐；也不套站点清理脚本。
    const isOffice = String(webPreferences.partition || '').startsWith('persist:office-');
    if (isOffice && !officePartitions.has(webPreferences.partition)) {
      officePartitions.add(webPreferences.partition);
      configurePartition(webPreferences.partition);
    }
    // DSH / 酒馆 / 示意图编辑器都是完整的本地 Web 应用，不要套用站点清理脚本。
    // 该脚本会主动改写 html/body 的滚动和 user-select，且监听整个 DOM，对这些
    // 模块化 SPA 可能造成启动阶段黑屏。保留空 preload 只为明确隔离边界。
    webPreferences.preload = path.join(__dirname,
      (isDsh || isDrafter || isTavern || isOffice) ? 'dsh-preload.js' : 'site-bypass-preload.js');
    console.log('[main] will-attach-webview preload:', webPreferences.preload, source);
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = process.platform !== 'darwin';
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
              sandbox: process.platform !== 'darwin',
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
                sandbox: process.platform !== 'darwin',
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
              sandbox: process.platform !== 'darwin',
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
      sandbox: true,
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

/**
 * 把一段文字投送到别的应用里，并替你按下回车。
 *
 * 为什么不是「起一个 CLI 进程」：那样起来的是一个全新的、没登录的会话。
 * 而你屏幕上那个 Claude/Codex 窗口本来就登录好、上下文也在，所以正确的做法是
 * 把字送进那个窗口，而不是另起炉灶。
 *
 * 为什么用剪贴板粘贴而不是逐字符敲：osascript 的 keystroke 对中文基本不可用
 * （会丢字或变成乱码），粘贴是唯一稳的路子。投完把剪贴板还原，不然会把你
 * 原来复制的东西冲掉。
 */
async function handoffToApp(appName, text) {
  const target = String(appName || '').trim();
  const body = String(text || '');
  if (!target) return { ok: false, error: '没有指定要投送到哪个应用。' };
  if (!body.trim()) return { ok: false, error: '内容是空的。' };

  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    // 先申请（带弹窗），让应用进到辅助功能列表；用户点了允许再来一次就通
    systemPreferences.isTrustedAccessibilityClient(true);
    return {
      ok: false, needsPermission: true,
      error: '需要先允许工具箱控制别的应用：刚弹出的系统提示点「打开系统设置」，在辅助功能里把「Agent 工具箱」打开；列表里没有的话点左下角「+」，选 /Applications/Agent 工具箱.app。',
    };
  }
  const previous = clipboard.readText();
  clipboard.writeText(body);
  // 应用还没开的话 activate 会顺手把它拉起来，得多等一会儿再粘贴，否则字丢在半路
  const wasRunning = (await listForegroundApps()).includes(target);
  const settle = wasRunning ? 0.35 : 2.2;
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('/usr/bin/osascript', [
        '-e', `tell application "${target.replace(/"/g, '\\"')}" to activate`,
        '-e', `delay ${settle}`,
        '-e', 'tell application "System Events" to keystroke "v" using command down',
        '-e', 'delay 0.15',
        '-e', 'tell application "System Events" to key code 36',
      ], { timeout: 8000 });
    } else if (process.platform === 'win32') {
      // AppActivate 认窗口标题的前缀，SendKeys 里 ^v 是 Ctrl+V
      const ps = `$w = New-Object -ComObject WScript.Shell; `
        + `if (-not $w.AppActivate('${target.replace(/'/g, "''")}')) { exit 2 }; `
        + `Start-Sleep -Milliseconds ${Math.round(settle * 1000)}; $w.SendKeys('^v'); Start-Sleep -Milliseconds 150; $w.SendKeys('{ENTER}')`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 8000 });
    } else {
      await execFileAsync('/bin/sh', ['-lc',
        `command -v xdotool >/dev/null && xdotool search --name ${JSON.stringify(target)} windowactivate --sync key --clearmodifiers ctrl+v Return`],
      { timeout: 8000 });
    }
    return { ok: true };
  } catch (error) {
    // macOS 的 1002 就是「没给辅助功能权限」，单独认出来，好让界面给一个直达按钮
    const needsPermission = process.platform === 'darwin' && /1002|not allowed to send keystrokes|不允许发送按键/i.test(error.message);
    const hint = needsPermission
      ? '需要先允许它控制别的应用：系统设置 → 隐私与安全性 → 辅助功能。'
      : process.platform === 'darwin' ? '' : '确认那个窗口开着、标题对得上。';
    const detail = String(error.message).split('\n').map((l) => l.trim()).filter(Boolean).pop() || '投送失败';
    return { ok: false, needsPermission, error: [detail, hint].filter(Boolean).join(' ') };
  } finally {
    // 稍等一下再还原，太快的话粘贴还没读到剪贴板
    setTimeout(() => { try { clipboard.writeText(previous); } catch { /* 还原失败不致命 */ } }, 1200);
  }
}

/**
 * 各家 AI 的桌面客户端叫什么。派活默认送进这些应用，而不是浏览器 ——
 * 你平时聊天的上下文、登录态都在这些 app 里。
 */
const DESKTOP_APPS = {
  codex: ['ChatGPT'],
  claude: ['Claude'],
  dsh: ['DeepSeek'],
  kimi: ['Kimi'],
  grok: ['Grok'],
  glm: ['智谱清言', 'ChatGLM'],
  gemini: ['Gemini'],
};

/** 本机装了哪些 AI 桌面客户端：{ codex: 'ChatGPT', claude: 'Claude', ... }，没装的不出现。 */
async function listDesktopApps() {
  const found = {};
  const running = new Set(await listForegroundApps());
  for (const [id, names] of Object.entries(DESKTOP_APPS)) {
    for (const name of names) {
      let installed = running.has(name);
      if (!installed && process.platform === 'darwin') {
        installed = ['/Applications', path.join(os.homedir(), 'Applications')].some((dir) => fs.existsSync(path.join(dir, `${name}.app`)));
      } else if (!installed && process.platform === 'win32') {
        const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
        installed = roots.some((dir) => fs.existsSync(path.join(dir, name)));
      }
      if (installed) { found[id] = name; break; }
    }
  }
  return found;
}

/** 列出当前开着的、能投送的应用（只要有界面的那些）。 */
async function listForegroundApps() {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e', 'tell application "System Events" to get name of every process whose background only is false',
      ], { timeout: 5000 });
      return stdout.split(',').map((s) => s.trim()).filter(Boolean).sort();
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
        "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }"], { timeout: 5000 });
      return [...new Set(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].sort();
    }
    return [];
  } catch {
    return [];
  }
}

async function captureSelectedText() {
  const previous = clipboard.readText();
  const marker = `__agent_toolbox_term_${Date.now()}__`;
  clipboard.writeText(marker);
  try {
    await pressCopyShortcut();
    // 别的应用把选中内容写进剪贴板要一会儿（TextEdit 实测 160ms 不够），轮询到变了为止，最多 ~800ms
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const selected = clipboard.readText().trim();
      if (selected && selected !== marker) return selected.slice(0, 1200);
    }
    return '';
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

function hasPdfSignature(filePath) {
  let handle = null;
  try {
    handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(5);
    fs.readSync(handle, header, 0, 5, 0);
    return header.equals(Buffer.from('%PDF-'));
  } catch {
    return false;
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch { /* 已关闭 */ }
    }
  }
}

function hookLiteratureDownloads() {
  if (literatureDownloadHooked) return;
  literatureDownloadHooked = true;
  const ses = session.fromPartition(PARTITIONS.literature);
  ses.on('will-download', (_event, item) => {
    literatureActiveDownload = item;
    const target = uniqueLiteraturePath(item.getFilename());
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      if (literatureActiveDownload === item) literatureActiveDownload = null;
      const completed = state === 'completed';
      const format = path.extname(target).slice(1).toLowerCase();
      const valid = completed && (format !== 'pdf' || hasPdfSignature(target));
      const error = !completed
        ? `下载状态：${state}`
        : valid ? '' : '下载内容不是有效 PDF，可能是登录页或验证码页面。';
      literatureDownloadWaiter?.({
        ok: valid,
        state: valid ? state : 'invalid-file',
        file: path.basename(target),
        error,
      });
      literatureDownloadWaiter = null;
      if (!valid) {
        try { fs.rmSync(target, { force: true }); } catch { /* 清理失败不影响错误提示 */ }
        return;
      }
      mainWindow?.webContents.send('lit:downloaded', {
        file: path.basename(target),
        size: fs.existsSync(target) ? fs.statSync(target).size : 0,
        format,
      });
    });
  });
}

/**
 * 让某个分区的下载落进容器的子目录，而不是系统下载文件夹。
 * 画图工具导出的 SVG / PNG、DSH 里下载的东西都走这条 ——
 * 东西留在「容器」那一栏里看得见、能整理，也不会散到 home 下面。
 */
const containerDownloadHooked = new Set();
function hookContainerDownloads(partitionName, subFolder) {
  if (containerDownloadHooked.has(partitionName)) return;
  containerDownloadHooked.add(partitionName);
  const ses = session.fromPartition(partitionName);
  ses.on('will-download', (_event, item) => {
    let dir;
    try {
      dir = path.join(containerRoot(() => app.getPath('userData')), subFolder);
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return;                       // 建不出目录就让它走系统默认，别把下载弄丢
    }
    const ext = path.extname(item.getFilename());
    const stem = path.basename(item.getFilename(), ext) || 'download';
    let target = path.join(dir, `${stem}${ext}`);
    let index = 1;
    while (fs.existsSync(target)) target = path.join(dir, `${stem}-${index++}${ext}`);
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state !== 'completed') return;
      mainWindow?.webContents.send('container:downloaded', {
        file: path.basename(target), folder: subFolder,
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
      const format = path.extname(target).slice(1).toLowerCase();
      if (state !== 'completed' || (format === 'pdf' && !hasPdfSignature(target))) {
        try { fs.rmSync(target, { force: true }); } catch { /* 清理失败不影响下载流程 */ }
        return;
      }
      mainWindow?.webContents.send('lit:downloaded', {
        file: path.basename(target),
        size: fs.existsSync(target) ? fs.statSync(target).size : 0,
        format,
        source: '学校访问',
      });
    });
  });
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

function cancelLiteratureBatch() {
  if (!literatureBatchControl) return { ok: false, error: '当前没有运行中的批量下载。' };
  literatureBatchControl.cancelled = true;
  try { literatureActiveDownload?.cancel(); } catch { /* 下载已经结束 */ }
  literatureDownloadWaiter?.({ ok: false, state: 'cancelled', error: '已暂停，未完成项目保留在列表中。' });
  return { ok: true };
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
      const links = [...document.querySelectorAll('a[href], [data-href], [data-url], [data-download-url]')];
      for (const anchor of links) {
        if (!visible(anchor)) continue;
        const rawHref = anchor.getAttribute('data-download-url')
          || anchor.getAttribute('data-href')
          || anchor.getAttribute('data-url')
          || anchor.getAttribute('href')
          || '';
        let href = '';
        try { href = rawHref ? new URL(rawHref, location.href).href : anchor.href || ''; } catch { href = ''; }
        const direct = /\\.pdf(?:$|[?#])|(?:^|[\\/])download(?:[\\/?#]|$)|[?&](?:download|attachment|format)=pdf(?:&|$)/i.test(href);
        const linkedText = titleFrom(anchor);
        let text = linkedText;
        if ((!text || text.length < 4) && direct) {
          try {
            const leaf = decodeURIComponent(new URL(href).pathname.split('/').pop() || '').replace(/\\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
            text = leaf && !/^(download|file|attachment|pdf)$/i.test(leaf) ? leaf : '未命名 PDF';
          } catch { text = '未命名 PDF'; }
        }
        if (!/^https?:\\/\\//i.test(href) || !text || text.length > 240) continue;
        if ((blocked.test(text) && !direct) || /^(javascript:|#)/i.test(rawHref)) continue;
        if (!direct && text.length < 4) continue;
        if (!direct && /下载|download|cite|引用|分享|收藏/i.test(text) && text.length < 20) continue;
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
  if (literatureBatchControl) return { ok: false, error: '已有一个批量下载任务在运行，请先等待或暂停它。' };
  const list = Array.isArray(items) ? items.slice(0, 30) : [];
  if (!list.length) return { ok: false, error: '请先扫描并勾选论文。' };
  const control = { cancelled: false };
  literatureBatchControl = control;
  const originUrl = literatureBrowserWindow.webContents.getURL();
  const results = [];
  try {
    for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    if (control.cancelled) break;
    if (!sameLibrarySite(originUrl, item.url)) {
      results.push({ ok: false, title: item.title || '未命名论文', error: '论文地址不属于当前登录站点，已跳过。' });
      continue;
    }
    mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title || item.url, state: 'opening' });
    try {
      await literatureBrowserWindow.loadURL(item.url);
      if (control.cancelled) break;
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (control.cancelled) break;
      // 下载事件可能在 click() 返回前同步触发，必须先布置等待器，不能点击后再等。
      const downloadPromise = waitForLiteratureDownload();
      const clicked = await clickPaperDownload();
      if (control.cancelled) {
        literatureDownloadWaiter?.({ ok: false, state: 'cancelled', error: '已暂停，未完成项目保留在列表中。' });
        break;
      }
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
      if (control.cancelled || download.state === 'cancelled') {
        mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title, state: 'paused', error: download.error || '已暂停' });
        break;
      }
      if (!download.ok) continue;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch (err) {
      if (control.cancelled) break;
      const error = `打开或下载失败：${err.message}`;
      results.push({ ok: false, title: item.title, error });
      mainWindow?.webContents.send('lit:batch-progress', { index, total: list.length, title: item.title, state: 'paused', error });
      break;
    }
  }
    return {
      ok: !control.cancelled && results.length === list.length && results.every((item) => item.ok),
      paused: control.cancelled,
      completed: results.filter((item) => item.ok).length,
      total: list.length,
      remaining: Math.max(0, list.length - results.length),
      results,
    };
  } finally {
    if (literatureBatchControl === control) literatureBatchControl = null;
  }
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
        sandbox: process.platform !== 'darwin',
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
  // 记忆栈展开时不动窗口透明度，否则正在读的长文会跟着变淡
  if (petMode !== 'memory') {
    petWindow.setOpacity(Math.min(1, Math.max(0.35, Number(settings.opacity) || PET_DEFAULTS.opacity)));
  }
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
    shrinkPetToAvatar(settings.size);
    petWindow.webContents.send('pet:collapse');
    petWindow.hide();
  }
}

/** 把桌宠窗口收回头像大小。禁用时和点到别处失焦时都走这里。 */
function shrinkPetToAvatar(sizeSetting) {
  if (!petWindow || petWindow.isDestroyed() || !petExpanded) return;
  petExpanded = false;
  petMode = false;
  const old = petWindow.getBounds();
  const size = petAvatarSize(sizeSetting);
  petWindow.setResizable(false);
  petWindow.setOpacity(Math.min(1, Math.max(0.35, Number(petSettings().opacity) || PET_DEFAULTS.opacity)));
  const pos = clampToWorkArea({ ...size, x: old.x + old.width - size.width, y: old.y + old.height - size.height });
  petWindow.setBounds({ ...size, ...pos });
}

/** 内心独白浮窗：默认贴在屏幕底部中间，置顶、不抢焦点 */
function createMonologueWindow() {
  if (monologueWindow && !monologueWindow.isDestroyed()) return monologueWindow;
  const size = { width: 420, height: 340 };
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const saved = store.get('monologue.position');
  const position = clampToWorkArea({
    x: Number.isFinite(saved?.x) ? saved.x : Math.round(work.x + (work.width - size.width) / 2),
    y: Number.isFinite(saved?.y) ? saved.y : work.y + work.height - size.height - 24,
    ...size,
  });
  monologueWindow = new BrowserWindow({
    ...size, ...position,
    frame: false, transparent: true, resizable: true, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false,
    minWidth: 320, minHeight: 200,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  monologueWindow.setAlwaysOnTop(true, 'floating');
  monologueWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  monologueWindow.loadFile(path.join(__dirname, '..', 'monologue', 'index.html'));
  monologueWindow.on('moved', () => {
    const b = monologueWindow.getBounds();
    store.set('monologue.position', { x: b.x, y: b.y });
  });
  monologueWindow.on('closed', () => { monologueWindow = null; });
  return monologueWindow;
}

/**
 * 覆盖层：一个完全透明、鼠标穿透的窗口，贴着微信窗口浮在上面。
 * 做不到真的嵌进微信（那得往它进程里注入代码），但视觉上是一回事 ——
 * Discord / Steam 的游戏内浮层、翻译软件的悬浮译文都是这么做的。
 */
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  overlayWindow = new BrowserWindow({
    width: 800, height: 600, x: 0, y: 0,
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, show: false,
    alwaysOnTop: true, acceptFirstMouse: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // 整层点击穿透：点在卡片上也会落到底下的微信
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

/** 跟着微信窗口走；微信不在前台就藏起来，免得浮在别的应用上面 */
function placeOverlay(bounds) {
  const win = overlayWindow;
  if (!win || win.isDestroyed()) return;
  if (!bounds) { if (win.isVisible()) win.hide(); return; }
  win.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.w), height: Math.round(bounds.h) });
  if (bounds.front) { if (!win.isVisible()) win.showInactive(); }
  else if (win.isVisible()) win.hide();
}

function pushMonologue(payload) {
  if (monologueWindow && !monologueWindow.isDestroyed()) monologueWindow.webContents.send('monologue:update', payload);
}

/** 选中的文字 → 解读 → 浮窗。快捷键和「分析剪贴板」都走这里。 */
async function runMonologue(text) {
  const win = createMonologueWindow();
  if (!win.isVisible()) win.showInactive();      // 不抢焦点，微信那边不会失焦
  const clean = String(text || '').trim();
  if (!clean) { pushMonologue({ type: 'error', error: '没选中任何文字。先在微信里选中对方那句话，再按快捷键。' }); return; }
  pushMonologue({ type: 'thinking', text: clean });
  const result = await monologue.analyze(clean);
  pushMonologue(result.ok ? { type: 'result', ...result } : { type: 'error', error: result.error });
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
      sandbox: true,
    },
  });
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.loadFile(path.join(__dirname, '..', 'pet', 'index.html'));
  petWindow.on('closed', () => { petWindow = null; });
  // 展开之后点到别的地方，桌宠自己缩回去 —— 否则那块大面板会一直挡着屏幕，
  // 每次都得回去点一下「×」。拖动窗口时不算失焦，所以不会误触发。
  petWindow.on('blur', () => {
    if (!petExpanded) return;
    shrinkPetToAvatar();
    petWindow.webContents.send('pet:collapse');
  });
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

const API_KEY_PATHS = new Set(['ai.api.key', 'ai.api.keyEncrypted', 'study.quiz.keyEncrypted', 'research.translation.keyEncrypted', 'image.api.key', 'image.api.keyEncrypted']);

function registerIpc() {
  // 证书例外：按域名放行，不做全局关闭
  registerCertTrust(app, ipcMain, { getStore: () => store, getWindow: () => mainWindow });

  // 文献库：书目元数据补全 + 引用导出
  registerBiblioIpc(ipcMain, { dialog, getWindow: () => mainWindow, clipboard });
  registerDocSearchIpc(ipcMain);
  registerShelfIpc(ipcMain, { dialog, getWindow: () => mainWindow });
  registerUpdaterIpc(ipcMain);
  // 渲染层启动时把真实工具表推过来，手机端按这个生成按钮
  ipcMain.handle('remote:setTools', (_e, list) => { remoteControl?.setTools(list); return { ok: true }; });

  // 代码记事本：读取 Understand-Anything 的知识图谱 + 按行号回读源码
  registerNotebookIpc(ipcMain, { dialog, getWindow: () => mainWindow, getUserDataPath: () => app.getPath('userData') });
  registerContainerIpc(ipcMain, { shell, getUserDataPath: () => app.getPath('userData') });
  // 学习记录：解释过什么、看懂过哪个项目、读过哪个文件、考了几分 —— 首页给一点进度感
  const journalAdd = (entry) => {
    try {
      const list = store.get('learn.journal', []) || [];
      store.set('learn.journal', [{ at: Date.now(), ...entry }, ...list].slice(0, 500));
    } catch { /* 记不上不算事 */ }
  };
  ipcMain.handle('learn:journal', (_e, { limit = 50 } = {}) => {
    const list = store.get('learn.journal', []) || [];
    const weekAgo = Date.now() - 7 * 86400000;
    const week = list.filter((x) => x.at >= weekAgo);
    const byKind = week.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {});
    const quizzes = week.filter((x) => x.kind === 'quiz' && Number.isFinite(x.score));
    return { items: list.slice(0, limit), week: { total: week.length, byKind, quizAvg: quizzes.length ? Math.round(quizzes.reduce((s, x) => s + x.score / x.total, 0) / quizzes.length * 100) : null } };
  });
  ipcMain.handle('learn:note', (_e, entry) => { journalAdd({ kind: String(entry?.kind || 'note').slice(0, 20), title: String(entry?.title || '').slice(0, 200), meta: entry?.meta ?? null, score: entry?.score, total: entry?.total }); return { ok: true }; });

  // 收纳：主目录 / 桌面 / 下载 三处顶层散落的东西
  const tidyAsk = (messages) => callStoredCompatibleApi({ messages, temperature: 0.2, timeout: 90000 });
  const tidySettings = () => ({ codeDir: store.get('tidy.codeDir', '') || undefined });
  // 首页每次打开都要扫一遍三处目录、跑几十个 git log，几秒的 IO。短期缓存，搬过东西就作废
  const tidyCache = new Map();
  const cached = async (key, ttlMs, compute) => {
    const hit = tidyCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await compute();
    tidyCache.set(key, { at: Date.now(), value });
    return value;
  };
  const tidyInvalidate = () => tidyCache.clear();
  ipcMain.handle('tidy:scan', async (_e, { ai = false, fresh = false } = {}) => {
    if (ai || fresh) tidyInvalidate();
    return cached(ai ? 'scan:ai' : 'scan', 60 * 1000, async () => {
      const scanned = tidy.scan();
      let items = tidy.suggest(scanned.items, tidySettings());
      if (ai) items = await tidy.refine(items, tidyAsk, tidySettings());
      return { ...scanned, items, destinations: tidy.destinations(tidySettings()), undo: tidy.lastUndo(app.getPath('userData')) };
    });
  });
  ipcMain.handle('tidy:apply', async (_e, moves) => { const r = await tidy.apply(app.getPath('userData'), moves, { trash: (p) => shell.trashItem(p) }); tidyInvalidate(); return r; });
  ipcMain.handle('tidy:undo', () => { const r = tidy.undo(app.getPath('userData')); tidyInvalidate(); return r; });
  ipcMain.handle('tidy:recent', (_e, opts) => cached(`recent:${JSON.stringify(opts || {})}`, 30 * 1000, () => tidy.recent(opts || {})));
  ipcMain.handle('tidy:activity', (_e, opts) => cached(`activity:${JSON.stringify(opts || {})}`, 5 * 60 * 1000, () => tidy.activity(opts || {})));
  ipcMain.handle('tidy:nudge', (_e, on) => { if (typeof on === 'boolean') store.set('tidy.nudge', on); return { on: store.get('tidy.nudge', true) !== false }; });
  // 每天最多提醒一次：散落的东西超过 30 项就发一条系统通知，点了直接去收纳
  const tidyNudge = () => {
    try {
      if (store.get('tidy.nudge', true) === false) return;
      const today = new Date().toISOString().slice(0, 10);
      if (store.get('tidy.nudgedOn') === today) return;
      const stray = tidy.suggest(tidy.scan().items, tidySettings()).filter((x) => x.action !== 'keep');
      if (stray.length < 30) return;
      store.set('tidy.nudgedOn', today);
      const n = new Notification({ title: `桌面 / 下载 / 主目录散落了 ${stray.length} 项`, body: '点一下去收纳，勾选后一键归位（可撤销）。不想被提醒可以在收纳里关。' });
      n.on('click', () => ensureMainWindow({ show: true }).webContents.send('app:navigate-tool', { id: 'tidy' }));
      n.show();
    } catch { /* 提醒失败不算事 */ }
  };
  setTimeout(tidyNudge, 90 * 1000);
  setInterval(tidyNudge, 6 * 3600 * 1000);
  // 讲解按目录缓存：同一个项目再打开秒出，想重来点「重新讲」
  ipcMain.handle('tidy:overview', async (_e, root, { fresh = false } = {}) => {
    const cache = store.get('tidy.overviews', {}) || {};
    const key = String(root || '');
    if (!fresh && cache[key]?.markdown) return { ok: true, cached: true, at: cache[key].at, ...cache[key] };
    const r = await tidy.overview(root, tidyAsk);
    if (r.ok) {
      journalAdd({ kind: 'overview', title: r.facts?.name || key, meta: key });
      const next = { ...cache, [key]: { markdown: r.markdown, facts: r.facts, at: Date.now() } };
      const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at).slice(0, 30);   // 最多留 30 个
      store.set('tidy.overviews', Object.fromEntries(keys.map((k) => [k, next[k]])));
    }
    return r;
  });
  ipcMain.handle('tidy:ask', (_e, { root, question, prior }) => tidy.askProject(root, question, prior, tidyAsk));
  ipcMain.handle('tidy:readingList', (_e, { root, markdown }) => tidy.readingList(markdown, root));
  ipcMain.handle('tidy:draftReadme', (_e, root) => tidy.draftReadme(root, tidyAsk));
  ipcMain.handle('tidy:quiz', (_e, { root, prior }) => tidy.quizFor(root, prior, tidyAsk));
  ipcMain.handle('tidy:saveReadme', (_e, { root, target, markdown }) => tidy.saveReadme(root, target, markdown));
  // 单个文件的讲解也缓存（键：根目录 + 相对路径）
  ipcMain.handle('tidy:explainFile', async (_e, { root, rel, prior, fresh = false }) => {
    const cache = store.get('tidy.fileExplains', {}) || {};
    const key = `${root}::${rel}`;
    if (!fresh && cache[key]?.markdown) return { ok: true, cached: true, rel, ...cache[key] };
    const r = await tidy.explainFile(root, rel, tidyAsk, { priorMarkdown: prior });
    if (r.ok) {
      journalAdd({ kind: 'file', title: `${String(root).split('/').pop()} / ${rel}`, meta: root });
      const next = { ...cache, [key]: { markdown: r.markdown, at: Date.now() } };
      const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at).slice(0, 120);
      store.set('tidy.fileExplains', Object.fromEntries(keys.map((k) => [k, next[k]])));
    }
    return r;
  });
  // 讲解里的「学习顺序」→ 任务清单（和「任务」工具存同一个键，首页也会显示）
  ipcMain.handle('tidy:planToTasks', (_e, { markdown, name }) => {
    const titles = tidy.studyPlanToTasks(markdown);
    if (!titles.length) return { ok: false, error: '这份讲解里没有找到「学习顺序」列表。' };
    const existing = store.get('tasks.items', []) || [];
    const makeId = () => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const fresh = titles.filter((t) => !existing.some((x) => x.title === `${name ? `[${name}] ` : ''}${t}`))
      .map((t) => ({ id: makeId(), title: `${name ? `[${name}] ` : ''}${t}`, done: false, priority: 'normal', due: '', createdAt: Date.now(), completedAt: null }));
    store.set('tasks.items', [...fresh, ...existing]);
    return { ok: true, added: fresh.length, skipped: titles.length - fresh.length };
  });
  ipcMain.handle('tidy:overviewList', () => {
    const cache = store.get('tidy.overviews', {}) || {};
    return Object.entries(cache).map(([root, v]) => ({ root, name: v.facts?.name || root.split('/').pop(), at: v.at })).sort((a, b) => b.at - a.at);
  });
  ipcMain.handle('tidy:facts', (_e, root) => tidy.projectFacts(root));
  ipcMain.handle('tidy:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: '选一个项目文件夹', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.handle('tidy:setCodeDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: '代码项目统一放在哪', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    store.set('tidy.codeDir', r.filePaths[0]);
    return { ok: true, codeDir: r.filePaths[0] };
  });
  ipcMain.handle('tidy:reveal', (_e, p) => { shell.showItemInFolder(String(p)); return { ok: true }; });
  ipcMain.handle('tidy:open', (_e, p) => shell.openPath(String(p)));
  registerAvatarRigIpc(ipcMain, { app, shell, getUserDataPath: () => app.getPath('userData'),
    getSeedPath: () => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..'), 'container-seed', 'avatar-rig-studio') });
  // 画图工具导出的图、DSH 里下载的文件，都落进容器
  hookContainerDownloads('persist:drafter', '图表');
  // 页面里 <a download> 存的文件走这条（webview 里 blob 下载会被丢弃，见 drafter-preload）
  ipcMain.handle('container:saveBinary', (_e, { folder = '', name = 'file', data = [] } = {}) => {
    try {
      const safeName = path.basename(String(name)).replace(/[/\\:*?"<>|]/g, '_') || 'file';
      const dir = path.join(containerRoot(() => app.getPath('userData')), path.basename(String(folder || '')));
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(safeName);
      const stem = path.basename(safeName, ext);
      let target = path.join(dir, safeName);
      let index = 1;
      while (fs.existsSync(target)) target = path.join(dir, `${stem}-${index++}${ext}`);
      fs.writeFileSync(target, Buffer.from(data));
      return { ok: true, relPath: path.relative(containerRoot(() => app.getPath('userData')), target) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  hookContainerDownloads('persist:dsh', 'dsh');
  hookContainerDownloads('persist:tavern', '酒馆');
  // 把随包附带的工具铺进容器（只补缺，不覆盖）。
  // 打包后种子在 resources/container-seed，开发时在仓库根目录。
  const seedDir = app.isPackaged
    ? path.join(process.resourcesPath, 'container-seed')
    : path.join(__dirname, '..', '..', 'container-seed');
  const seeded = seedContainer(() => app.getPath('userData'), seedDir);
  if (seeded.copied.length) console.log('[container] 已放入随包工具:', seeded.copied.join(', '));

  ipcMain.handle('voicebox:status', async () => {
    const legacy = voiceBoxService?.status?.() || {};
    const managed = voiceboxService?.refreshStatus ? await voiceboxService.refreshStatus() : {};
    return { ...managed, ...legacy, status: managed.status || legacy.status, installed: Boolean(legacy.installed || managed.exists), appPath: legacy.appPath || '' };
  });
  ipcMain.handle('voicebox:start', async () => {
    const legacy = voiceBoxService ? await voiceBoxService.start() : { ok: false };
    if (legacy.ok) {
      const managed = voiceboxService?.refreshStatus ? await voiceboxService.refreshStatus() : {};
      return { ...managed, ...legacy, status: managed.status || legacy.state?.status || 'installed', installed: true, appPath: legacy.state?.appPath || '' };
    }
    return voiceboxService?.start ? voiceboxService.start() : legacy;
  });
  ipcMain.handle('voicebox:openProject', () => voiceBoxService.openProject());
  ipcMain.handle('voicebox:openDownload', () => voiceBoxService.openDownload());
  ipcMain.handle('voicebox:openDocs', () => voiceBoxService.openDocs());
  ipcMain.handle('voicebox:apiHealth', async () => {
    try { return { ok: true, data: await voiceboxApi.health() }; }
    catch (error) { return { ok: false, error: error.message, code: error.code }; }
  });
  ipcMain.handle('voicebox:apiProfiles', async () => {
    try { return { ok: true, profiles: await voiceboxApi.profiles() }; }
    catch (error) { return { ok: false, error: error.message, code: error.code, profiles: [] }; }
  });
  ipcMain.handle('voicebox:apiActiveTasks', async () => {
    try { return { ok: true, data: await voiceboxApi.activeTasks() }; }
    catch (error) { return { ok: false, error: error.message, code: error.code }; }
  });
  ipcMain.handle('voicebox:apiCancelDownload', async (_e, modelName) => {
    const allowed = ['turbo', 'base', 'small', 'medium', 'large'].includes(String(modelName || '').replace(/^whisper-/, ''));
    if (!allowed) return { ok: false, error: '不支持取消这个模型下载。' };
    try {
      return { ok: true, data: await voiceboxApi.cancelDownload(`whisper-${String(modelName).replace(/^whisper-/, '')}`) };
    } catch (error) { return { ok: false, error: error.message, code: error.code }; }
  });
  ipcMain.handle('voicebox:apiGenerateAudio', async (_e, payload) => {
    try { return await voiceboxApi.generateAudio(payload || {}); }
    catch (error) { return { ok: false, error: error.message, code: error.code }; }
  });
  ipcMain.handle('voicebox:stop', () => voiceboxService?.stop?.() || { ok: true });
  ipcMain.handle('voicebox:mcpInfo', () => voiceboxService?.mcpInfo?.() || {});
  ipcMain.handle('voicebox:tts', (_e, text) => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'text 不能为空' };
    return voiceboxService.tts(text);
  });
  ipcMain.handle('voicebox:installGpu', () => voiceboxService?.installGpuAcceleration?.() || { ok: false, error: 'Voicebox 服务不可用。' });

  ipcMain.handle('dsh:status', () => dshService.status());
  ipcMain.handle('dsh:start', () => dshService.start());
  ipcMain.handle('dsh:stop', () => dshService.stop());
  ipcMain.handle('tavern:status', () => tavernService.status());
  ipcMain.handle('tavern:start', () => tavernService.start());
  ipcMain.handle('tavern:stop', () => tavernService.stop());
  ipcMain.handle('appControls:status', () => appControls.status());
  ipcMain.handle('appControls:setEnabled', (_e, enabled) => {
    appControls.setEnabled(Boolean(enabled));
    return appControls.register(globalShortcut);
  });
  ipcMain.handle('appControls:closeForeground', () => appControls.closeForeground());
  ipcMain.handle('appControls:cycleWindows', () => appControls.cycleWindows());

  // 教学幻灯片：5 页 storyboard + 5 张 GPT Image（Key 来自环境变量，绝不硬编码）
  ipcMain.handle('slides:generateTeaching', async (_e, topic) => {
    const outputDir = path.join(app.getPath('userData'), 'teaching-slides');
    const apiKey = process.env.OPENAI_API_KEY || readApiKey('image');
    if (!apiKey) return { ok: false, error: '缺少图片 API Key：请在「语音」栏目保存，或设置 OPENAI_API_KEY。' };
    const configuredBase = process.env.OPENAI_BASE_URL || store.get('image.api.baseUrl', 'https://api.openai.com/v1');
    const baseUrl = /^https?:\/\/[^\s]+$/i.test(String(configuredBase)) ? String(configuredBase) : 'https://api.openai.com/v1';
    const imageClient = new OpenAIImageClient({ apiKey, baseUrl });
    const result = await generateTeachingSlides(String(topic || ''), { outputDir, imageClient, concurrency: 2 });
    return result.ok ? result : { ok: false, error: result.error || '教学幻灯片生成失败', ...result };
  });

  // 手势识别 → 窗口动作：作用于当前前台窗口（全屏 / 左半 / 右半）
  // 手势工作台：右下角常驻的手势窗 + 带编号的应用切换栏
  // ---------- 接口台 / 抓包台 / Git 组合拳 ----------
  ipcMain.handle('http:send', (_e, request) => httpClient.send(request || {}));
  ipcMain.handle('http:toCurl', (_e, request, vars) => httpClient.toCurl(request || {}, vars || {}));
  ipcMain.handle('http:fromCurl', (_e, text) => {
    try { return { ok: true, request: httpClient.fromCurl(text) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('net:start', () => netCapture?.start() || { ok: false });
  ipcMain.handle('net:stop', () => netCapture?.stop() || { ok: false });
  ipcMain.handle('net:clear', () => netCapture?.clear() || { ok: false });
  ipcMain.handle('net:list', (_e, options) => netCapture?.list(options || {}) || []);
  ipcMain.handle('net:detail', (_e, id) => netCapture?.detail(String(id || '')) || null);
  ipcMain.handle('net:status', () => netCapture?.status() || { capturing: false });
  ipcMain.handle('net:proxyStart', (_e, port) => netCapture?.startProxy(Number(port) || 8899) || { ok: false });
  ipcMain.handle('net:proxyStop', () => netCapture?.stopProxy() || { ok: false });
  ipcMain.handle('net:exportHar', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 HAR（可拖进 Chrome DevTools 看）',
      defaultPath: `agent-toolbox-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.har`,
      filters: [{ name: 'HAR', extensions: ['har'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(netCapture.toHar(), null, 2), 'utf8');
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle('git:combos', () => gitDesk?.combos() || []);
  ipcMain.handle('git:recents', () => gitDesk?.recents() || []);
  ipcMain.handle('git:forget', (_e, repo) => gitDesk?.forget(String(repo || '')) || []);
  ipcMain.handle('git:pick', () => gitDesk?.pickRepo() || null);
  ipcMain.handle('git:use', async (_e, repo) => {
    const dir = String(repo || '');
    const check = await gitDesk.run(dir, ['rev-parse', '--show-toplevel']);
    if (!check.ok) return { ok: false, error: check.error };
    const top = check.stdout.trim() || dir;
    gitDesk.remember(top);
    return { ok: true, repo: top };
  });
  ipcMain.handle('git:status', (_e, repo) => gitDesk?.status(String(repo || '')) || { ok: false });
  ipcMain.handle('git:run', (_e, repo, args) => gitDesk?.run(String(repo || ''), args) || { ok: false });
  ipcMain.handle('git:runCombo', (_e, repo, id, params) => gitDesk?.runCombo(String(repo || ''), String(id || ''), params || {}) || { ok: false });
  ipcMain.handle('git:reveal', (_e, repo) => { if (repo) shell.openPath(String(repo)); return { ok: true }; });

  // ---------- 内心独白 ----------
  ipcMain.handle('monologue:templates', () => monologue?.templates() || []);
  ipcMain.handle('monologue:status', () => monologue?.status() || {});
  ipcMain.handle('monologue:setTemplate', (_e, id) => { store.set('monologue.template', String(id || 'chat')); return { ok: true }; });
  ipcMain.handle('monologue:set', (_e, patch) => {
    for (const [key, value] of Object.entries(patch || {})) {
      if (['app', 'chatLeft', 'chatRight', 'interval', 'template', 'who'].includes(key)) store.set(`monologue.${key}`, value);
    }
    return monologue?.status() || {};
  });
  ipcMain.handle('monologue:show', () => { const w = createMonologueWindow(); w.showInactive(); return { ok: true }; });
  ipcMain.handle('monologue:hide', () => { monologue?.stop(); monologueWindow?.hide(); return { ok: true }; });
  ipcMain.handle('monologue:analyze', (_e, text) => runMonologue(text));
  ipcMain.handle('monologue:analyzeSelection', async () => runMonologue(await captureSelectedText()));
  ipcMain.handle('monologue:startWatch', () => { createMonologueWindow().showInactive(); return monologue?.start() || { ok: false }; });
  // 手机精灵：把文件放进出件箱（拖到桌面精灵身上 / 面板里选）
  ipcMain.handle('phone:sendFiles', (_e, paths) => {
    const results = (Array.isArray(paths) ? paths : [paths]).map((p) => phoneOutbox.add(p));
    const sent = results.filter((r) => r.ok).map((r) => r.item);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone:event', { type: 'outbox', items: phoneOutbox.list(), at: Date.now() });
    return { ok: sent.length > 0, sent, errors: results.filter((r) => !r.ok).map((r) => r.error), connected: Boolean(remoteControl?.server) };
  });
  ipcMain.handle('phone:pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    const results = filePaths.map((p) => phoneOutbox.add(p));
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone:event', { type: 'outbox', items: phoneOutbox.list(), at: Date.now() });
    return { ok: true, sent: results.filter((r) => r.ok).map((r) => r.item), errors: results.filter((r) => !r.ok).map((r) => r.error) };
  });
  ipcMain.handle('phone:outbox', () => ({ items: phoneOutbox.list(), inboxDir: phoneOutbox.inboxDir, log: phoneAgent.log }));
  ipcMain.handle('phone:outboxRemove', (_e, id) => ({ removed: phoneOutbox.remove(String(id)) }));
  ipcMain.handle('phone:openInboxDir', () => { fs.mkdirSync(phoneOutbox.inboxDir, { recursive: true }); return shell.openPath(phoneOutbox.inboxDir); });
  ipcMain.handle('monologue:startOverlay', () => {
    createOverlayWindow();
    return monologue?.startOverlay({
      onNotice: ({ code, error }) => {
        try { const n = new Notification({ title: '内心独白读不到微信窗口', body: error }); n.show(); } catch { /* 不让发通知就算了 */ }
        if (code === 'no-permission' && process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      },
      onBounds: (bounds) => placeOverlay(bounds),
      onCards: (cards) => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('overlay:cards', cards); },
    }) || { ok: false };
  });
  ipcMain.handle('monologue:stopOverlay', () => {
    const result = monologue?.stopOverlay() || { ok: false };
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    return result;
  });
  ipcMain.handle('monologue:stopWatch', () => monologue?.stop() || { ok: false });
  ipcMain.handle('monologue:openScreenPerm', () => {
    if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return { ok: true };
  });
  ipcMain.handle('monologue:peek', async () => {
    const { app: appName, chatLeft, chatRight } = monologue.status();
    const read = await chatRead.readWindow(app.getPath('userData'), appName);
    if (!read.ok) return read;
    return { ok: true, app: read.app, messages: chatRead.toMessages(read.lines, { chatLeft, chatRight }).slice(-12) };
  });

  ipcMain.handle('gesture:openWindow', async () => {
    // macOS 上要先向系统正式要摄像头权限（TCC）。不要的话 Chromium 也说 granted，
    // 但轨道一直是 live + muted，一帧画面都不来 —— 之前手势识别「不好用」根子就在这。
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('camera');
      if (status !== 'granted') {
        const ok = await systemPreferences.askForMediaAccess('camera');
        if (!ok) {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
          return { ok: false, error: '没拿到摄像头权限：系统设置 → 隐私与安全性 → 摄像头，把「Agent 工具箱」打开。' };
        }
      }
    }
    gestureDesk?.openGesture();
    return { ok: Boolean(gestureDesk) };
  });
  ipcMain.handle('gesture:closeWindow', () => { gestureDesk?.closeGesture(); return { ok: true }; });
  // 小窗报错时把系统层面的摄像头状态一起显示出来，好判断是系统没给还是我们自己拦了
  // wasm 和模型打包后在 app.asar 里，页面 fetch 不到（Failed to fetch）；它们被 asarUnpack 出来了，
  // 这里给页面真正的磁盘路径
  ipcMain.handle('gesture:paths', () => {
    const unpacked = (p) => p.replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
    const root = path.join(__dirname, '..', '..');
    return {
      wasm: pathToFileURL(unpacked(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'))).href,
      model: pathToFileURL(unpacked(path.join(root, 'assets', 'models', 'hand_landmarker.task'))).href,
    };
  });
  ipcMain.handle('gesture:cameraStatus', () => ({
    system: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('camera') : 'n/a',
    platform: process.platform,
    version: app.getVersion(),
  }));
  ipcMain.handle('gesture:openCameraSettings', () => {
    if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
    else if (process.platform === 'win32') shell.openExternal('ms-settings:privacy-webcam');
    return { ok: true };
  });
  // 小窗被摄像头权限卡住时，把工具箱主窗口叫回来，别让人以为工具箱没了
  ipcMain.handle('gesture:showMain', () => { ensureMainWindow({ show: true }); return { ok: true }; });
  ipcMain.handle('gesture:isOpen', () => Boolean(gestureDesk?.gestureOpen()));
  ipcMain.handle('gestureWin:event', (_e, event) => gestureDesk?.handleEvent(event || {}));
  ipcMain.handle('switcher:pick', (_e, n) => gestureDesk?.pick(n));
  ipcMain.handle('switcher:hide', () => { gestureDesk?.hideSwitcher(); return { ok: true }; });
  ipcMain.handle('switcher:show', () => gestureDesk?.showSwitcher());
  ipcMain.handle('gesture:listApps', () => gestureDesk?.listApps() || []);
  ipcMain.handle('gesture:control', async (_e, action, side) => {
    const gesture = action === 'fullscreen' ? 'fullscreen' : action === 'snap' ? (side === 'right' ? 'snap-right' : 'snap-left') : null;
    if (!gesture || !windowDock) return { ok: false, error: '不支持的窗口动作' };
    const front = await windowDock.run(['frontmost']);
    if (!front.ok) return { ok: false, error: front.error || '无法获取前台窗口' };
    if (!canApplyGesture(front, { currentPid: process.pid })) return { ok: false, error: '当前前台窗口受保护，已跳过。' };
    const point = front.bounds
      ? { x: front.bounds.x + front.bounds.width / 2, y: front.bounds.y + front.bounds.height / 2 }
      : screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const bounds = computeBounds(gesture, display);
    if (!bounds) return { ok: false, error: '无法计算目标区域' };
    const moved = await windowDock.run([
      'set', front.handle || '', front.title || '', bounds.x, bounds.y, bounds.width, bounds.height,
    ]);
    if (!moved.ok) return { ok: false, error: moved.error || '窗口移动失败' };
    return { ok: true, ...bounds };
  });
  ipcMain.handle('music:play', (_e, url) => {
    if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/i.test(url)) return { ok: false, error: '音乐网址无效' };
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('config:all', () => safeConfig());
  ipcMain.handle('config:get', (_e, key, fallback) => {
    if (API_KEY_PATHS.has(key)) return fallback;
    return store.get(key, fallback);
  });
  ipcMain.handle('config:set', (_e, key, value) => {
    if (API_KEY_PATHS.has(key)) {
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

  ipcMain.handle('remote:status', async () => ({ ...(await remoteStatusWithQr()), autoStart: store.get('remote.autoStart', false), persistent: Boolean(readRemoteToken()) }));
  ipcMain.handle('remote:start', async () => {
    const result = await remoteControl.start({ token: readRemoteToken() });
    saveRemoteToken(result.token);
    return { ...(await remoteStatusWithQr(result)), persistent: Boolean(readRemoteToken()) };
  });
  ipcMain.handle('remote:stop', () => remoteControl.stop());
  ipcMain.handle('remote:rotate', async () => {
    await remoteControl.stop();
    const result = await remoteControl.start();
    saveRemoteToken(result.token);
    return { ...(await remoteStatusWithQr(result)), persistent: Boolean(readRemoteToken()) };
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
  ipcMain.handle('app:quit', () => { setImmediate(() => quitToolbox()); return { ok: true }; });
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
    return { ok: true };
  });
  ipcMain.handle('app:reload', () => { if (mainWindow) mainWindow.reload(); });
  ipcMain.handle('app:openDevTools', () => {
    if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
  ipcMain.handle('app:setAppIcon', (_e, dataUrl) => {
    if (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|svg\+xml);base64,/.test(dataUrl)) return { ok: false, error: '图标格式无效' };
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) return { ok: false, error: '图标解析失败' };
      runtimeAppIcon = image;
      store?.set('ui.appIconDataUrl', dataUrl);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(image);
      if (process.platform === 'darwin' && app.dock) app.dock.setIcon(image);
      // Windows 下显式提示：setIcon 只更新运行中的窗口图标；
      // 若用户把应用“固定”到了任务栏，固定项图标来自 .lnk 缓存，需要取消固定再固定才刷新。
      return { ok: true, pinnedHint: process.platform === 'win32' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
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
  // 同一条路也给面板 / 命令面板用：读当前前台应用里选中的文字，交给桌宠解释
  ipcMain.handle('pet:quickSelection', () => explainSelectionWithPet().then(() => ({ ok: true })));
  ipcMain.handle('pet:setEnabled', (_e, enabled) => {
    store.set('pet.enabled', Boolean(enabled));
    applyPetSettings();
    return true;
  });
  // mode: false = 收起头像，'card' / true = 四行解释卡，'memory' = 记忆栈大窗
  ipcMain.handle('pet:resize', (_e, mode) => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    const old = petWindow.getBounds();
    petExpanded = Boolean(mode);
    petMode = mode === 'memory' ? 'memory' : (mode ? 'card' : false);
    // 记忆栈是要长时间读的，允许拖边框改大小；头像和小卡片保持固定。
    petWindow.setResizable(mode === 'memory');
    const size = mode === 'memory' ? PET_MEMORY_SIZE : (mode ? PET_CARD_SIZE : petAvatarSize());
    // 记忆栈里全是要读的长文字。窗口级 setOpacity 会把文字一起变淡，
    // 那正是「看不清」的来源，所以这里强制不透明，半透明交给 CSS 只作用在底板上。
    petWindow.setOpacity(mode === 'memory' ? 1 : Math.min(1, Math.max(0.35,
      Number(petSettings().opacity) || PET_DEFAULTS.opacity)));
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
    journalAdd({ kind: 'explain', title: String(input?.code || '').replace(/\s+/g, ' ').trim().slice(0, 80) });
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

  ipcMain.handle('files:pickText', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: payload.title || '打开学习文件',
      properties: ['openFile'],
      filters: [{ name: '学习文件', extensions: ['ipynb', 'json', 'txt', 'md', 'py'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > 30 * 1024 * 1024) return { ok: false, error: '文件超过 30MB，无法导入。' };
    return { ok: true, path: filePath, name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8') };
  });

  ipcMain.handle('files:saveImage', async (_event, payload = {}) => {
    const match = String(payload.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { ok: false, error: '图片数据无效，只支持 PNG / JPEG / WebP。' };
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 40 * 1024 * 1024) return { ok: false, error: '图片为空或超过 40MB。' };
    const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    const defaultName = path.basename(String(payload.defaultName || `科研图板.${extension}`));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出科研图片',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, path: result.filePath, size: buffer.length };
  });

  ipcMain.handle('files:saveText', async (_event, payload = {}) => {
    const content = String(payload.content || '');
    if (!content || content.length > 30 * 1024 * 1024) return { ok: false, error: '文本为空或超过 30MB。' };
    const extension = String(payload.extension || 'txt').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt';
    const defaultName = path.basename(String(payload.defaultName || `科研图板.${extension}`));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出科研文件',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath, size: Buffer.byteLength(content) };
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

  // 动效 PPT：deck 模型 → 带 p:timing 动画的 .pptx
  ipcMain.handle('deck:exportPptx', async (_event, deck = {}, filePath = '') => {
    // 给了路径就直接写（自动化 / 批量用），没给才弹保存框
    let target = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : '';
    if (!target) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出动效 PPTX',
        defaultPath: `${String(deck.title || '演示文稿').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.pptx`,
        filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      target = result.filePath;
    }
    try {
      return await deckPptx.exportDeck(target, deck);
    } catch (error) {
      return { ok: false, error: `动效 PPTX 导出失败：${error.message}` };
    }
  });

  ipcMain.handle('presentation:exportPptx', async (_event, deck = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出科研 PPTX',
      defaultPath: `${String(deck.title || '科研演示').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.pptx`,
      filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      return await exportPptx(result.filePath, deck);
    } catch (error) {
      return { ok: false, error: `PPTX 导出失败：${error.message}` };
    }
  });

  // ---- 聊天记录迁移：读 Codex / Claude 的本地会话，导出或打包 ----

  // ---- AI 派发台：在专注页里直接把任务交给本机的 AI ----
  //
  // 手机那条路（handleRemoteCommand 的 agent.run）必须弹确认框，因为请求来自
  // 另一台设备。这里不弹：任务就是坐在电脑前的人自己敲进去的，再弹一次
  // 「你确定要执行你刚刚亲手输入的东西吗」纯属噪音。
  ipcMain.handle('agent:list', () => agentRuntime.installedAgents());
  ipcMain.handle('agent:apps', () => listForegroundApps());
  ipcMain.handle('agent:desktopApps', () => listDesktopApps());
  ipcMain.handle('agent:openAccessibility', () => {
    if (process.platform !== 'darwin') return { ok: false };
    // 正式向系统申请一次：会弹「想要控制这台电脑」的框，应用也会因此出现在辅助功能列表里。
    // 之前只是让 osascript 去试、失败了，工具箱自己没申请过，所以列表里根本找不到它。
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return { ok: true, trusted };
  });
  ipcMain.handle('agent:handoff', (_e, payload = {}) => handoffToApp(payload.app, payload.text));
  ipcMain.handle('agent:run', async (_e, payload = {}) => {
    const id = String(payload.id || '');
    const prompt = String(payload.prompt || '');
    try {
      const latest = chatBridge.listSessions(id)[0];
      const result = await agentRuntime.runAgent(id, prompt, { cwd: latest?.cwd || os.homedir() });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('chat:sources', () => chatBridge.SOURCES);
  ipcMain.handle('chat:latest', () => chatBridge.listLatestSessions());

  ipcMain.handle('chat:list', (_e, source) => chatBridge.listSessions(source));
  ipcMain.handle('chat:load', (_e, { source, id, full, tail }) => chatBridge.loadSession(source, id, { previewOnly: !full, tail: Boolean(tail) }));

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

  ipcMain.handle('video:fetchSubs', async (event, payload) => {
    const cookieFile = await exportBilibiliCookies();
    try {
      const requestedModel = String(payload?.voiceboxModel || 'turbo');
      const voiceboxModel = ['turbo', 'base', 'small', 'medium', 'large'].includes(requestedModel) ? requestedModel : 'turbo';
      return await videoReport.fetchSubtitles(payload?.url, payload?.scope, {
        cookieFile,
        voiceboxModel,
        transcriptDir: path.join(app.getPath('userData'), 'video-transcripts'),
        onProgress: (state) => {
          if (!event.sender.isDestroyed()) event.sender.send('video:subProgress', state);
        },
      });
    } finally {
      if (cookieFile) {
        try { fs.rmSync(cookieFile, { force: true }); } catch { /* 临时 cookie 文件清理失败不影响结果 */ }
      }
    }
  });

  ipcMain.handle('video:prepareLocal', (event, payload) => {
    const paths = Array.isArray(payload) ? payload : payload?.paths;
    const requestedModel = String(payload?.options?.voiceboxModel || 'turbo');
    const voiceboxModel = ['turbo', 'base', 'small', 'medium', 'large'].includes(requestedModel) ? requestedModel : 'turbo';
    return videoReport.prepareLocalVideos(Array.isArray(paths) ? paths : [], {
      voiceboxModel,
      transcriptDir: path.join(app.getPath('userData'), 'video-transcripts'),
      onProgress: (state) => {
        if (!event.sender.isDestroyed()) event.sender.send('video:prepareProgress', state);
      },
    });
  });

  ipcMain.handle('video:saveReport', (_e, payload) =>
    videoReport.saveReport(app.getPath('userData'), payload));

  ipcMain.handle('video:publishReport', (_e, fileName, force) =>
    videoReport.publishReport(app.getPath('userData'), fileName, Boolean(force)));

  ipcMain.handle('video:openFeishuWindow', async (_e, url) => {
    let target;
    try { target = new URL(String(url || '')); } catch { return { ok: false, error: '飞书文档地址无效。' }; }
    if (target.protocol !== 'https:' || !isFeishuHost(target.hostname)) {
      return { ok: false, error: '只允许打开飞书文档地址。' };
    }
    await edgeCookies.syncCookies(PARTITIONS.feishu, 'feishu.cn').catch(() => {});
    if (!feishuWindow || feishuWindow.isDestroyed()) {
      feishuWindow = new BrowserWindow({
        width: 1180, height: 820, minWidth: 820, minHeight: 620,
        title: '飞书报告', backgroundColor: '#ffffff', parent: mainWindow || undefined,
        webPreferences: { partition: PARTITIONS.feishu, contextIsolation: true, nodeIntegration: false, sandbox: process.platform !== 'darwin' },
      });
      feishuWindow.webContents.setWindowOpenHandler(({ url: next }) => {
        try { return isFeishuHost(new URL(next).hostname) ? { action: 'allow' } : { action: 'deny' }; } catch { return { action: 'deny' }; }
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

  ipcMain.handle('lit:saveAnalysisReport', (_e, payload) =>
    videoReport.saveMarkdownReport(app.getPath('userData'), {
      ...(payload || {}),
      folder: 'research-reports',
    }));

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
  syncContainerLiterature(() => app.getPath('userData'), litDir())
    .then((result) => { if (result.count) console.log('[container] 自动转入科研文献:', result.count); })
    .catch((error) => console.warn('[container] 文献自动入库失败:', error.message));

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

  function collectLiteratureSources(sources) {
    const result = [];
    const seen = new Set();
    const visit = (source) => {
      if (result.length >= 300 || typeof source !== 'string') return;
      let stat;
      try {
        const link = fs.lstatSync(source);
        if (link.isSymbolicLink()) return;
        stat = link;
      } catch { return; }
      if (stat.isDirectory()) {
        let entries;
        try { entries = fs.readdirSync(source, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          visit(path.join(source, entry.name));
          if (result.length >= 300) return;
        }
        return;
      }
      const ext = path.extname(source).slice(1).toLowerCase();
      if (!LIT_EXTENSIONS.includes(ext) || seen.has(source)) return;
      if (ext === 'pdf' && !hasPdfSignature(source)) return;
      seen.add(source);
      result.push(source);
    };
    for (const source of Array.isArray(sources) ? sources : []) visit(source);
    return result;
  }

  async function importLiteratureSources(sources) {
    const dir = litDir();
    const imported = [];
    for (const src of collectLiteratureSources(sources)) {
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
        if (extName === 'pdf') {
          const renamedPdf = await maybeRenamePdf(dir, finalName);
          finalName = renamedPdf.file;
          renamed = renamedPdf.renamed;
        }
        imported.push({ file: finalName, size: stat.size, format: extName, renamed });
      } catch { /* 单个失败不拖垮整批 */ }
    }
    return imported;
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
    return importLiteratureSources(result.filePaths);
  });

  ipcMain.handle('lit:importFiles', (_e, sources) => importLiteratureSources(sources));
  ipcMain.handle('container:toLiterature', async (_e, relPaths) => {
    const root = path.join(app.getPath('userData'), 'container');
    const sources = [];
    for (const rel of Array.isArray(relPaths) ? relPaths : []) {
      const target = path.resolve(root, String(rel || ''));
      if (target === root || target.startsWith(root + path.sep)) sources.push(target);
    }
    const imported = await importLiteratureSources(sources);
    return { ok: true, imported, count: imported.length };
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
  ipcMain.handle('lit:references', (_e, query) => litFetch.discoverReferences(query));
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
  ipcMain.handle('lit:cancelBatch', () => cancelLiteratureBatch());

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

  ipcMain.handle('translation:argos', (_event, payload) => argosService.translate(payload));
  // Kept for preload compatibility. Research reading does not use this remote provider by default.
  ipcMain.handle('lit:translate', (_event, text, options) => translator.translate(text, options));
  ipcMain.handle('translation:argos-status', () => argosService.status());
  ipcMain.handle('translation:argos-install', () => argosService.installModels());

  /** 圈选截图（dataURL PNG）→ 本地 OCR，只识别不翻译，返回 { ok, text | error }。
   *  普通翻译由渲染层的 local-first TranslationManager 处理。 */
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
  ipcMain.handle('practice:run', (_e, payload = {}) => practiceRunner.run(payload.track, payload.code, { timeout: payload.timeout, prelude: payload.prelude }));
  ipcMain.handle('practice:setup', (_e, payload = {}) => practiceRunner.setup(payload.track));
  ipcMain.handle('practice:install', (_e, payload = {}) => practiceRunner.install(payload.track, payload.packages));
  ipcMain.handle('practice:terminal', (_e, payload = {}) => practiceRunner.terminal(payload.command));

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

/**
 * Ctrl+Tab 模块切换器要在「任何地方」都能唤出来。
 *
 * 难点：焦点在 <webview> 里的时候，键盘事件全被那个 guest 页面吃掉了，
 * 根本不会冒泡到宿主页面 —— 所以在渲染层挂 window keydown 是够不着的
 * （在文档页里按没反应就是这个原因）。
 * 解法是在主进程给每个 webContents 挂 before-input-event，截下来转发给主窗口。
 */
let switcherHolding = false;   // 面板是不是正被「按住 Ctrl」这个状态撑着

function forwardSwitcherKeys(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const ctrl = input.control || input.modifiers?.includes('control');

    // ⌘K / Ctrl+K：焦点在 webview 里时宿主页面收不到，主进程截下来转发
    if (input.type === 'keyDown' && (input.meta || input.control) && !input.shift && !input.alt && String(input.key).toLowerCase() === 'k') {
      event.preventDefault();
      mainWindow.webContents.send('palette:open');
      return;
    }
    if (input.type === 'keyDown' && ctrl && input.key === 'Tab') {
      event.preventDefault();
      switcherHolding = true;
      mainWindow.webContents.send('switcher:step', { back: Boolean(input.shift) });
      return;
    }
    if (!switcherHolding) return;
    // 收尾两条路径都要留：
    //   1) Control 的 keyUp —— **不看 input.control**。这一下上报的修饰键状态
    //      可能还带着 control，只用 !ctrl 判会把「手松开」这条主路径判没了。
    //   2) 任何显示 Ctrl 已松的输入 —— 兜住焦点在 webview 之间跳、keyUp 整个丢掉。
    if ((input.type === 'keyUp' && input.key === 'Control') || !ctrl) {
      switcherHolding = false;
      mainWindow.webContents.send('switcher:commit');
    }
  });
}

app.on('web-contents-created', (_e, contents) => forwardSwitcherKeys(contents));

/**
 * 主进程的全局兜底。没有这两个，任何一个漏掉 catch 的 Promise 都会弹出 Electron 那个
 * 「A JavaScript error occurred in the main process」对话框（退出时那次就是这么来的）。
 * 这里记到 userData/logs/main-errors.log，界面上不打扰。
 */
function logMainError(kind, error) {
  const line = `[${new Date().toISOString()}] ${kind}: ${error?.stack || error?.message || String(error)}\n`;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'main-errors.log'), line);
  } catch { /* 连日志都写不了就只能 console 了 */ }
  console.error(line.trim());
}
process.on('unhandledRejection', (reason) => logMainError('unhandledRejection', reason));
// 渲染层（主窗口 / 桌宠 / 浮窗）的未捕获错误也送到同一份日志，排查时不用开 DevTools
ipcMain.on('log:renderer', (event, payload = {}) => {
  const where = (() => { try { return new URL(event.sender.getURL()).pathname.split('/').slice(-2).join('/'); } catch { return '?'; } })();
  logMainError(`renderer(${where}) ${String(payload.kind || 'error')}`, `${String(payload.message || '').slice(0, 500)}\n${String(payload.stack || '').slice(0, 1500)}`);
});
process.on('uncaughtException', (error) => logMainError('uncaughtException', error));

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  store = new Store(app.getPath('userData'));
  migrateLegacyApiKey();
  nativeTheme.themeSource = 'dark';

  // 不打包直接 npm start 时，dock 里是 Electron 的默认图标，换成我们自己的
  if (process.platform === 'darwin' && app.dock) {
    loadRuntimeAppIcon();
    const icon = runtimeAppIcon && !runtimeAppIcon.isEmpty() ? runtimeAppIcon : nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  for (const partition of Object.values(PARTITIONS)) configurePartition(partition);
  configureBilibiliPartition();

  // 手势识别需要主窗口渲染进程调用摄像头：只放行主窗口自身的 media 请求
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isMainWindow = mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents;
    const isGestureWindow = gestureDesk?.gestureOpen() && webContents === gestureDesk.gestureWindow.webContents;
    // 手势小窗也是我们自己的本地页面；认身份认不出来时按「是不是工具箱自己的 file:// 页」兜底
    const isOwnPage = /^file:\/\//.test(webContents.getURL() || '') && webContents.getURL().includes('/gesture/');
    if (permission === 'media' && (isMainWindow || isGestureWindow || isOwnPage)) return callback(true);
    if (permission === 'media') console.warn('[media] 拒绝了摄像头请求:', webContents.getURL());
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const isMainWindow = mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents;
    const isGestureWindow = gestureDesk?.gestureOpen() && webContents === gestureDesk.gestureWindow.webContents;
    const isOwnPage = /^file:\/\//.test(webContents?.getURL?.() || '') && webContents.getURL().includes('/gesture/');
    return permission === 'media' && (isMainWindow || isGestureWindow || isOwnPage);
  });

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

  gitDesk = new GitDesk({ execFile: execFileAsync, store, dialog, getWindow: () => mainWindow });
  monologue = new Monologue({
    ask: (messages) => callStoredCompatibleApi({ messages, temperature: 0.2, timeout: 60000 }),
    readChat: (dir, app) => chatRead.readWindow(dir, app),
    getUserDataPath: () => app.getPath('userData'),
    store,
    onUpdate: (payload) => pushMonologue(payload),
  });
  netCapture = new NetCapture({
    session,
    partitions: [...Object.values(PARTITIONS), 'persist:eat-meituan', 'persist:eat-eleme', 'persist:eat-jd'],
    onChange: () => { /* 界面自己轮询，这里不主动推，省得一秒几百条 IPC */ },
  });

  gestureDesk = new GestureDesk({
    BrowserWindow, screen, app, execFile: execFileAsync,
    preload: path.join(__dirname, 'preload.js'),
    rootDir: path.join(__dirname, '..'),
    onGestureClosed: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('gesture:window-closed'); },
  });

  phoneOutbox = new PhoneOutbox();
  phoneAgent = new PhoneAgent({
    ask: (messages) => callStoredCompatibleApi({ messages, temperature: 0.1, timeout: 60000 }),
    onEvent: (item) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('phone:event', item); },
  });
  remoteControl = new RemoteControl({
    deviceName: 'Agent 工具箱',
    onCommand: handleRemoteCommand,
    onPhoneStep: (body) => phoneAgent.step(body),
    onPhoneState: relayPhoneState,
    outbox: phoneOutbox,
    apkPath: path.join(__dirname, '..', '..', 'assets', 'mobile', 'Agent-Toolbox-Remote-0.3.2-debug.apk'),
    assetsDir: path.join(__dirname, '..', '..', 'assets'),
    onScreen: async ({ width: wanted = 900 } = {}) => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const image = await mainWindow.webContents.capturePage();
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      const target = Math.max(400, Math.min(1600, Number(wanted) || 900));   // 全屏时手机要更清楚的一帧
      const scaled = width > target ? image.resize({ width: target }) : image;
      return scaled.toJPEG(target > 1000 ? 70 : 62);
    },
    apkName: 'Agent-Toolbox-Remote-0.3.2-debug.apk',
    inbox: store.get('remote.inbox', []),
    onInbox: (item) => {
      const inbox = [item, ...(store.get('remote.inbox', []) || [])].slice(0, 100);
      store.set('remote.inbox', inbox);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote:inbox', item);
    },
  });
  argosService = new ArgosService();

  dshService = new DshService({ app, getWindow: () => mainWindow });
  tavernService = new TavernService({ app, getWindow: () => mainWindow });
  voiceboxService = new VoiceboxService({ getUserDataPath: () => app.getPath('userData'), getWindow: () => mainWindow });
  appControls = new AppControls({
    store,
    // ⌘/Ctrl+Shift+Q 一键退出工具箱：走和点叉号同一条路（销毁全部窗口再退），
    // 这样 Windows 上不会留在后台。
    onQuitSelf: () => quitToolbox(),
    onResult: (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('appControls:result', result);
    },
  });
  voiceBoxService = new VoiceBoxService({
    app,
    shell,
    getWindow: () => mainWindow,
  });

  registerIpc();
  hookLiteratureDownloads();
  hookResearchDownloads();
  createWindow();
  createAvatarWindowController({ getMainWindow: () => mainWindow });
  startAutoCheck();
  // Voicebox 不自动安装/启动：避免开机即下载几百 MB；页面内手动启动，已有实例时自动复用 17493。
  dshService.start().catch((error) => console.warn('[dsh] background start failed:', error.message));
  createPetWindow();
  if (store.get('remote.autoStart', false)) {
    remoteControl.start({ token: readRemoteToken() })
      .then((result) => saveRemoteToken(result.token))
      .catch((error) => console.warn('[remote] 自动启动失败:', error.message));
  }
  createTray();
  try {
    if (!globalShortcut.register(WAKE_SHORTCUT, () => ensureMainWindow({ show: true }))) console.warn('[wake] 快捷键被占用：', WAKE_SHORTCUT);
    if (!globalShortcut.register(EXPLAIN_SHORTCUT, () => explainSelectionWithPet().catch((e) => console.warn('[explain]', e.message)))) console.warn('[explain] 快捷键被占用：', EXPLAIN_SHORTCUT);
  } catch (error) { console.warn('[wake] 快捷键注册失败：', error.message); }
  // 选中文字 → ⌘⇧M → 浮窗给解读
  try {
    globalShortcut.register(MONOLOGUE_SHORTCUT, () => {
      captureSelectedText().then((text) => runMonologue(text)).catch(() => runMonologue(''));
    });
  } catch (error) { console.warn('[monologue] 快捷键注册失败：', error.message); }

  const termShortcut = registerTermShortcut();
  if (!termShortcut.ok) console.warn('[terms]', termShortcut.error);
  const dockShortcut = registerDockShortcut();
  if (!dockShortcut.ok) console.warn('[dock]', dockShortcut.error);
  const controlsShortcut = appControls.register(globalShortcut);
  if (controlsShortcut.enabled && !controlsShortcut.registered) {
    console.warn('[appControls]', controlsShortcut.closeRegistered || controlsShortcut.cycleRegistered
      ? '快捷键有冲突，部分未注册。'
      : '快捷键被其他应用占用了。');
  }

  // 点 Dock 图标：窗口被关了就重建，只是藏着就拉出来
  app.on('activate', () => ensureMainWindow({ show: true }));
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

/**
 * 退出兜底。
 *
 * 点了叉号之后进程留在后台，是因为有东西还吊着 Node 的事件循环：
 * 没关干净的 socket、没杀掉的子进程、悬着的定时器。
 * 逐个去堵永远堵不完（每加一个外部服务就多一个可能），
 * 所以这里加一道硬底线：退出流程走完还没真的退，就强制结束。
 * Windows 上尤其需要 —— 那边没有 macOS「关窗不退应用」的惯例，
 * 用户点叉号就是要它消失。
 */
/** 关窗、快捷键、菜单退出都走这里，保证行为一致。 */
function quitToolbox() {
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* 已经没了 */ }
  }
  app.quit();
}

const FORCE_EXIT_AFTER_MS = 3000;
let forceExitTimer = null;
function armForceExit() {
  if (forceExitTimer) return;
  forceExitTimer = setTimeout(() => {
    console.warn('[quit] 退出流程超时，强制结束进程');
    app.exit(0);
  }, FORCE_EXIT_AFTER_MS);
  forceExitTimer.unref?.();     // 它自己不该成为「阻止退出」的那个句柄
}

/**
 * 退出时逐个收尾。
 *
 * 每一步都单独兜住：之前 `voiceBoxService?.stop()` 抛了 TypeError（那个类根本没有
 * stop），整个 will-quit 就断在那儿 —— 表现是退出时弹一个 JavaScript error，
 * 而且排在它后面的 `voiceboxService.stop()`（真正负责杀掉 voicebox-server 子进程的
 * 那一步）从来没执行过，语音服务每次都是被强退硬掐掉的。
 * 一个收尾动作失败不该连累其余的。
 */
app.on('will-quit', () => {
  armForceExit();
  const steps = [
    ['工具架子进程', () => stopAllShelfApps()],
    ['更新检查', () => stopAutoCheck()],
    ['全局快捷键', () => globalShortcut.unregisterAll()],
    ['手机控制', () => remoteControl?.stop?.()],
    ['Argos', () => argosService?.destroy?.()],
    ['未完成的手机请求', () => {
      for (const pending of pendingRemoteCommands.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('工具箱正在退出。'));
      }
      pendingRemoteCommands.clear();
    }],
    ['DSH', () => dshService?.stop?.()],
    ['酒馆', () => tavernService?.stop?.()],
    ['Voicebox 外部应用', () => voiceBoxService?.stop?.()],
    ['Voicebox 服务', () => voiceboxService?.stop?.()],
    ['内心独白', () => monologue?.stop?.()],
  ];
  for (const [name, run] of steps) {
    try { run(); } catch (error) { console.warn(`[quit] ${name} 收尾失败：`, error?.message || error); }
  }
});
