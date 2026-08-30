'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, session, shell, dialog, clipboard, nativeTheme } = require('electron');
const { Store } = require('./store');

const IS_DEV = process.argv.includes('--dev');

/** DeepSeek 会拒绝 Electron 默认 UA，统一伪装成同版本内核的 Chrome。 */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';

/** 每个内嵌站点用独立分区，登录态互不干扰、可单独清空。 */
const PARTITIONS = {
  deepseek: 'persist:deepseek',
  docs: 'persist:docs',
};

let store;
let mainWindow;

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
  mainWindow.on('closed', () => { mainWindow = null; });

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

  // 内嵌页面里 target="_blank" 的链接不弹独立窗口，转给渲染进程去开新标签。
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) mainWindow.webContents.send('webview:open-url', url);
      return { action: 'deny' };
    });
  });
}

function registerIpc() {
  ipcMain.handle('config:all', () => store.all());
  ipcMain.handle('config:get', (_e, key, fallback) => store.get(key, fallback));
  ipcMain.handle('config:set', (_e, key, value) => store.set(key, value));

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
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  nativeTheme.themeSource = 'dark';

  for (const partition of Object.values(PARTITIONS)) relaxPartition(partition);

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
