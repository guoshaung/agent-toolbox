'use strict';

/**
 * 手势工作台的主进程部分：两个置顶小窗 + 应用列表 + 切换。
 *
 * - 手势窗：常驻右下角，摄像头 + 手部关键点在里面跑（src/gesture）。切到别的应用
 *   它还在，所以能一直比手势换页面。
 * - 切换栏：打响指唤出，铺在当前屏幕上，每个应用头上顶着 1–9 的编号（src/switcher）。
 *   ⌘Tab 那条越往后越分不清第几个，这里不复用它，自己画。
 *
 * 不依赖 Electron 的全局，全部注入，方便测试。
 */
const path = require('node:path');

const OWN_NAMES = new Set(['Electron', 'Agent 工具箱', 'agent-toolbox', 'Agent Toolbox']);

/** 解析 `lsappinfo list`：只要 type="Foreground" 的（有 Dock 图标、能切过去的那些） */
function parseLsappinfo(text) {
  const rows = [];
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const head = raw.match(/^\s*\d+\)\s+"(.+?)"\s+ASN:/);
    if (head) { current = { name: head[1], path: '', title: head[1], type: '' }; rows.push(current); continue; }
    if (!current) continue;
    const bundle = raw.match(/bundle path="([^"]*)"/);
    if (bundle) current.path = bundle[1];
    const type = raw.match(/\btype="([^"]*)"/);
    if (type) current.type = type[1];
  }
  return rows.filter((r) => r.type === 'Foreground');
}

class GestureDesk {
  constructor({ BrowserWindow, screen, app, execFile, platform = process.platform, preload, rootDir, onGestureClosed }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.app = app;
    this.execFile = execFile;            // promisified execFile(file, args, options) -> { stdout }
    this.platform = platform;
    this.preload = preload;
    this.rootDir = rootDir;              // src/ 目录
    this.onGestureClosed = onGestureClosed;
    this.gestureWindow = null;
    this.switcherWindow = null;
    this.apps = [];
    this.switcherOpen = false;
    this.pickTimer = null;
  }

  // ---------- 手势窗 ----------

  openGesture() {
    if (this.gestureWindow && !this.gestureWindow.isDestroyed()) { this.gestureWindow.show(); return this.gestureWindow; }
    const size = { width: 300, height: 268 };
    const work = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
    const win = new this.BrowserWindow({
      ...size,
      x: work.x + work.width - size.width - 16,
      y: work.y + work.height - size.height - 16,
      frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, focusable: true, show: false,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(this.rootDir, 'gesture', 'index.html'));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.gestureWindow = null; this.hideSwitcher(); this.onGestureClosed?.(); });
    this.gestureWindow = win;
    return win;
  }

  closeGesture() {
    const win = this.gestureWindow;
    this.gestureWindow = null;
    if (win && !win.isDestroyed()) win.close();
    this.hideSwitcher();
  }

  gestureOpen() { return Boolean(this.gestureWindow && !this.gestureWindow.isDestroyed()); }

  _pushState() {
    if (!this.gestureOpen()) return;
    this.gestureWindow.webContents.send('gesture:state', { switcherOpen: this.switcherOpen, count: this.apps.length });
  }

  // ---------- 应用列表 ----------

  /** 本机开着的、有界面的应用：[{ name, path, title, icon }]，最多 9 个，不含工具箱自己 */
  async listApps() {
    let rows = [];
    try {
      if (this.platform === 'darwin') {
        // lsappinfo 十几毫秒出结果；System Events 逐个进程问路径要好几秒，从 Node 里跑经常超时
        const { stdout } = await this.execFile('/usr/bin/lsappinfo', ['list'], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
        rows = parseLsappinfo(stdout);
      } else if (this.platform === 'win32') {
        const ps = 'Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName)`t$($_.Path)`t$($_.MainWindowTitle)" }';
        const { stdout } = await this.execFile('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 8000 });
        rows = stdout.split(/\r?\n/).map((line) => line.split('\t')).filter((r) => r[0]).map(([name, file, title]) => ({ name: name.trim(), path: (file || '').trim(), title: (title || name).trim() }));
      }
    } catch (error) { console.warn('[gesture] 列应用失败:', error.message); rows = []; }
    const seen = new Set();
    const apps = [];
    for (const row of rows) {
      if (OWN_NAMES.has(row.name) || seen.has(row.name)) continue;
      seen.add(row.name);
      apps.push(row);
      if (apps.length >= 9) break;
    }
    await Promise.all(apps.map(async (item) => { item.icon = await this.iconFor(item.path); }));
    this.apps = apps;
    return apps;
  }

  /**
   * 应用图标。macOS 上 app.getFileIcon 对 .app 只给一个通用图标（9 个应用一模一样），
   * 得自己从包里的 .icns 转：Info.plist → CFBundleIconFile → sips 转 64px PNG。按路径缓存。
   * （另：getFileIcon 传 size:'large' 会让主进程 NOTREACHED 直接崩，别用。）
   */
  async iconFor(appPath) {
    if (!appPath) return '';
    this.iconCache = this.iconCache || new Map();
    if (this.iconCache.has(appPath)) return this.iconCache.get(appPath);
    let icon = '';
    try {
      if (this.platform === 'darwin' && appPath.endsWith('.app')) {
        const fs = require('node:fs');
        const os = require('node:os');
        const plist = path.join(appPath, 'Contents', 'Info.plist');
        const { stdout } = await this.execFile('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], { timeout: 3000 });
        let name = stdout.trim();
        if (name && !name.endsWith('.icns')) name += '.icns';
        const icns = path.join(appPath, 'Contents', 'Resources', name);
        if (name && fs.existsSync(icns)) {
          const out = path.join(os.tmpdir(), `agent-toolbox-icon-${Buffer.from(appPath).toString('base64url').slice(0, 40)}.png`);
          await this.execFile('/usr/bin/sips', ['-z', '64', '64', '-s', 'format', 'png', icns, '--out', out], { timeout: 6000 });
          icon = `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
        }
      }
      if (!icon && this.app?.getFileIcon) {
        const img = await this.app.getFileIcon(appPath);
        icon = img && !img.isEmpty() ? img.toDataURL() : '';
      }
    } catch { icon = ''; }
    this.iconCache.set(appPath, icon);
    return icon;
  }

  async activate(item) {
    if (!item) return { ok: false, error: '没有这个应用' };
    try {
      if (this.platform === 'darwin') {
        // lsappinfo 给的是本地化名（「飞书」「访达」），tell application 不一定认；按包路径 open 最稳
        if (item.path) await this.execFile('/usr/bin/open', ['-a', item.path], { timeout: 5000 });
        else await this.execFile('/usr/bin/osascript', ['-e', `tell application "${item.name.replace(/"/g, '\\"')}" to activate`], { timeout: 5000 });
      } else if (this.platform === 'win32') {
        const title = (item.title || item.name).replace(/'/g, "''");
        await this.execFile('powershell.exe', ['-NoProfile', '-Command', `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate('${title}')) { exit 2 }`], { timeout: 5000 });
      } else return { ok: false, error: '这个系统还不支持切换应用' };
      return { ok: true, name: item.name };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  // ---------- 切换栏 ----------

  _ensureSwitcher() {
    if (this.switcherWindow && !this.switcherWindow.isDestroyed()) return this.switcherWindow;
    const win = new this.BrowserWindow({
      width: 800, height: 400, frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, hasShadow: false, alwaysOnTop: true, focusable: true, show: false,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');      // 压在全屏应用上面也能看见
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(this.rootDir, 'switcher', 'index.html'));
    win.webContents.on('did-finish-load', () => win.webContents.send('switcher:apps', this.apps));
    win.on('closed', () => { this.switcherWindow = null; this.switcherOpen = false; });
    this.switcherWindow = win;
    return win;
  }

  async showSwitcher() {
    const apps = await this.listApps();
    const win = this._ensureSwitcher();
    const area = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
    win.setBounds(area);
    win.webContents.send('switcher:apps', apps);
    win.show();
    this.switcherOpen = true;
    this._pushState();
    return apps;
  }

  hideSwitcher() {
    clearTimeout(this.pickTimer);
    if (this.switcherWindow && !this.switcherWindow.isDestroyed()) this.switcherWindow.hide();
    this.switcherOpen = false;
    this._pushState();
  }

  async toggleSwitcher() { return this.switcherOpen ? this.hideSwitcher() : this.showSwitcher(); }

  highlight(n) {
    if (this.switcherWindow && !this.switcherWindow.isDestroyed()) this.switcherWindow.webContents.send('switcher:highlight', n);
  }

  async pick(n) {
    const item = this.apps[Number(n) - 1];
    this.highlight(n);
    this.hideSwitcher();
    return this.activate(item);
  }

  /** 手势窗报上来的动作 */
  async handleEvent(event = {}) {
    switch (event.type) {
      case 'snap': return this.toggleSwitcher();
      case 'fist': return this.hideSwitcher();
      case 'number': {
        // 切换栏没开也切：银河页上就列着编号，比了就该过去，不用先打响指
        const n = Number(event.value);
        if (!this.switcherOpen && !this.apps.length) await this.listApps();
        if (!this.apps[n - 1]) return { ok: false, error: `没有第 ${n} 个应用` };
        if (!this.switcherOpen) return this.activate(this.apps[n - 1]);
        // 先亮一下再切，人眼能看到选中了哪个
        this.highlight(n);
        clearTimeout(this.pickTimer);
        await new Promise((resolve) => { this.pickTimer = setTimeout(resolve, 220); });
        return this.pick(n);
      }
      default: return { ok: false, ignored: true };
    }
  }
}

module.exports = { GestureDesk, OWN_NAMES, parseLsappinfo };
