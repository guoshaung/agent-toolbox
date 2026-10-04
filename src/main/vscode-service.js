'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, dialog } = require('electron');

/**
 * 内嵌 VS Code：跑一个本地 code-server（VS Code 的开源网页版，MIT），渲染层用 webview 装进去。
 *  - 只绑 127.0.0.1、免登录；用户数据和扩展都放在工具箱自己的 userData 下，和系统里的 VS Code 互不打扰
 *  - 默认打开「容器」目录当工作区；也能选别的文件夹（不用重启，改 URL 的 ?folder= 就行）
 *  - 没装的话给两条安装路（Homebrew / npm），装的过程把日志推回界面
 *  - 工具箱退出时把它一起带走
 */
const BASE_PORT = 13877;
let PORT = BASE_PORT;
const HOME = os.homedir();

/** 端口被别的东西占着（比如上次崩了没退干净的 helper）就往后找一个空的，别直接死在 EADDRINUSE 上 */
async function pickPort() {
  const net = require('net');
  for (let p = BASE_PORT; p < BASE_PORT + 20; p += 1) {
    const free = await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (free) return p;
  }
  return BASE_PORT;
}
const CANDIDATES = [
  '/opt/homebrew/bin/code-server', '/usr/local/bin/code-server', path.join(HOME, '.local/bin/code-server'),
  path.join(HOME, '.npm-global/bin/code-server'), path.join(HOME, '.nvm/versions/node'),
];

let userDataDir = '';
function findBinary() {
  // 先看工具箱自己装的独立包（userData/vscode/code-server-*/bin/code-server）
  if (userDataDir) {
    const base = path.join(userDataDir, 'vscode');
    try { for (const d of fs.readdirSync(base)) { if (!d.startsWith('code-server-')) continue; const b = path.join(base, d, 'bin', 'code-server'); if (fs.existsSync(b)) return b; } } catch { /* 还没装 */ }
  }
  for (const p of CANDIDATES) {
    if (p.endsWith('.nvm/versions/node')) {
      try { for (const v of fs.readdirSync(p)) { const b = path.join(p, v, 'bin', 'code-server'); if (fs.existsSync(b)) return b; } } catch { /* 没装 nvm */ }
      continue;
    }
    if (fs.existsSync(p)) return p;
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) { const b = path.join(dir, 'code-server'); if (dir && fs.existsSync(b)) return b; }
  return '';
}

class VscodeService {
  constructor({ getUserDataPath, defaultFolder, getMainWindow }) {
    this.getUserDataPath = getUserDataPath; this.defaultFolder = defaultFolder; this.getMainWindow = getMainWindow;
    userDataDir = getUserDataPath();
    this.child = null; this.installer = null; this.log = [];
    this.state = { status: 'idle', url: '', folder: '', bin: '', error: '', log: '' };
    app.on('will-quit', () => this.stop());
  }
  emit(patch) {
    this.state = { ...this.state, ...patch, log: this.log.slice(-40).join('\n') };
    try { const w = this.getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send('vscode:status', this.state); } catch { /* 窗口没了 */ }
  }
  pushLog(line) { for (const l of String(line).split(/\r?\n/)) if (l.trim()) this.log.push(l.trim().slice(0, 200)); if (this.log.length > 200) this.log.splice(0, this.log.length - 200); }
  status() { const bin = findBinary(); return { ...this.state, bin, installed: Boolean(bin), log: this.log.slice(-40).join('\n') }; }
  folder() { return this.state.folder || this.defaultFolder(); }
  urlFor(folder) { return `http://127.0.0.1:${PORT}/?folder=${encodeURIComponent(folder)}`; }

  async healthy() {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }

  /** 同一时刻只允许一个 start 在跑：工具打开时会被叫两次（create 里 setNbMode + 外面的 activate），
   *  不去重就会起两个 code-server，第二个 EADDRINUSE 退出，还把第一个的「已就绪」盖成「出错」。 */
  start(opts = {}) {
    if (this.starting) return this.starting;
    this.starting = this._start(opts).finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start({ folder } = {}) {
    const target = folder || this.folder();
    try { fs.mkdirSync(target, { recursive: true }); } catch { /* 让 code-server 自己报 */ }
    if (this.state.status === 'running' && this.child && await this.healthy()) { this.emit({ folder: target, url: this.urlFor(target) }); return { ok: true, ...this.state }; }
    // 端口上已经有一个活的（上次没退干净）：直接复用
    if (await this.healthy()) { this.emit({ status: 'running', folder: target, url: this.urlFor(target), error: '' }); return { ok: true, ...this.state }; }
    const bin = findBinary();
    if (!bin) { this.emit({ status: 'missing', error: '没找到 code-server' }); return { ok: false, code: 'missing', error: '还没装 code-server' }; }
    PORT = await pickPort();
    const base = path.join(this.getUserDataPath(), 'vscode');
    // 会话 socket 放 /tmp：macOS 的 unix socket 路径上限 104 字节，userData 下面那条太长会直接起不来
    const sock = `/tmp/agent-toolbox-cs-${process.pid}.sock`;      // os.tmpdir() 在 mac 上是 /var/folders/... 也不短
    const args = ['--auth', 'none', '--bind-addr', `127.0.0.1:${PORT}`, '--disable-telemetry', '--disable-update-check', '--disable-workspace-trust',
      '--session-socket', sock, '--user-data-dir', path.join(base, 'user-data'), '--extensions-dir', path.join(base, 'extensions'), target];
    this.log = []; this.emit({ status: 'starting', bin, folder: target, error: '' });
    try {
      // 套一层 sh 看门狗：工具箱进程一没（哪怕是被 kill -9），它就把 code-server 干掉，端口不会被占着。
      // 同时 code-server 自己崩了，看门狗把它的退出码原样带出来。整组一起在独立进程组里，stop() 一次 kill 整组。
      const WATCHDOG = 'BIN="$1"; shift; "$BIN" "$@" & CS=$!; while kill -0 "$AT_PID" 2>/dev/null && kill -0 $CS 2>/dev/null; do sleep 1; done; if kill -0 $CS 2>/dev/null; then kill -TERM $CS 2>/dev/null; wait $CS; exit 0; fi; wait $CS; exit $?';
      this.child = spawn('/bin/sh', ['-c', WATCHDOG, 'sh', bin, ...args], { env: { ...process.env, HOME, AT_PID: String(process.pid) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) { this.emit({ status: 'error', error: err.message }); return { ok: false, error: err.message }; }
    const child = this.child;
    child.stdout.on('data', (d) => { this.pushLog(d); });
    child.stderr.on('data', (d) => { this.pushLog(d); });
    child.on('exit', (code) => {
      if (this.child !== child) return;          // 已经被 stop()/重启换掉的老进程，别动现在的状态
      this.child = null;
      if (this.state.status !== 'idle') this.emit({ status: code ? 'error' : 'idle', error: code ? `code-server 退出了（${code}）` : '' });
    });
    for (let i = 0; i < 60; i += 1) {         // 最多等 30 秒
      await new Promise((r) => setTimeout(r, 500));
      if (!this.child) break;
      if (await this.healthy()) { this.emit({ status: 'running', url: this.urlFor(target), error: '' }); return { ok: true, ...this.state }; }
    }
    const err = this.child ? 'code-server 起来了但一直没响应' : (this.state.error || 'code-server 没起来');
    this.emit({ status: 'error', error: err });
    return { ok: false, error: err, log: this.log.slice(-20).join('\n') };
  }

  stop() {
    if (this.child) { const pid = this.child.pid; this.child = null; try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已经没了 */ } } }
    this.emit({ status: 'idle', url: '' });
    return { ok: true };
  }

  async chooseFolder() {
    const r = await dialog.showOpenDialog(this.getMainWindow() || undefined, { title: '选一个文件夹当 VS Code 的工作区', defaultPath: this.folder(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const folder = r.filePaths[0];
    this.emit({ folder, url: this.state.status === 'running' ? this.urlFor(folder) : '' });
    return { ok: true, folder, url: this.state.url };
  }

  /**
   * 独立包安装（官方 install.sh 在 mac 上就是这么干的）：查最新 tag → 下 tar.gz → 解压到 userData/vscode/。
   * 不碰 Homebrew / npm，不进 PATH，卸载就是删那个文件夹。这台机器 brew 卡在 CLT 版本、npm 的 postinstall 会崩，
   * 所以把它放第一位。
   */
  async installStandalone() {
    if (this.installer) return { ok: false, error: '正在安装中' };
    this.installer = { standalone: true }; this.log = []; this.emit({ status: 'installing', error: '' });
    const base = path.join(this.getUserDataPath(), 'vscode'); const dl = path.join(base, 'dl');
    try {
      fs.mkdirSync(dl, { recursive: true });
      // GitHub 的 API 会限流（403），用 releases/latest 的 302 跳转拿 tag 最稳
      const r0 = await fetch('https://github.com/coder/code-server/releases/latest', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const tag = String(r0.headers.get('location') || '').split('/tag/')[1] || '';
      const ver = tag.replace(/^v/, '');
      if (!ver) throw new Error('查不到 code-server 最新版本（连不上 GitHub？）');
      const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
      const name = `code-server-${ver}-macos-${arch}.tar.gz`;
      const url = `https://github.com/coder/code-server/releases/download/${tag}/${name}`;
      this.pushLog(`版本 ${tag} · 下载 ${name}`); this.emit({});
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0); let got = 0; let lastPct = -1;
      const file = path.join(dl, name); const ws = fs.createWriteStream(file);
      for await (const chunk of res.body) {
        if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
        got += chunk.length; const pct = total ? Math.floor((got / total) * 100) : -1;
        if (pct !== lastPct && (pct % 5 === 0 || pct < 0)) { lastPct = pct; this.pushLog(`下载 ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(0)} MB (${pct}%)` : ''}`); this.emit({}); try { this.getMainWindow()?.setProgressBar(pct >= 0 ? pct / 100 : 2); } catch { /* ignore */ } }
      }
      await new Promise((resolve, reject) => { ws.on('error', reject); ws.end(resolve); });
      try { this.getMainWindow()?.setProgressBar(-1); } catch { /* ignore */ }
      if (got < 20 * 1048576) throw new Error('下载的文件太小，不像完整的包');
      this.pushLog('解压…'); this.emit({});
      await new Promise((resolve, reject) => { const t = spawn('/usr/bin/tar', ['-xzf', file, '-C', base]); t.on('error', reject); t.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`tar 退出码 ${c}`)))); });
      try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      const bin = findBinary();
      if (!bin) throw new Error('解压完没找到 bin/code-server');
      this.pushLog(`装好了：${bin}`); this.installer = null; this.emit({ status: 'idle', error: '' });
      this.start();
      return { ok: true, bin };
    } catch (err) {
      try { this.getMainWindow()?.setProgressBar(-1); } catch { /* ignore */ }
      this.installer = null; this.pushLog(`失败：${err.message}`); this.emit({ status: 'missing', error: err.message });
      return { ok: false, error: err.message };
    }
  }

  /** 安装：standalone（默认）/ brew / npm；日志推回界面，装完自动启动 */
  install(method = 'standalone') {
    if (method === 'standalone') return this.installStandalone();
    if (this.installer) return { ok: false, error: '正在安装中' };
    const plan = method === 'npm'
      ? { cmd: 'npm', args: ['install', '-g', 'code-server'], where: [path.join(HOME, '.nvm/versions/node'), '/opt/homebrew/bin', '/usr/local/bin'] }
      : { cmd: 'brew', args: ['install', 'code-server'], where: ['/opt/homebrew/bin', '/usr/local/bin'] };
    const dirs = [...plan.where.flatMap((d) => (d.endsWith('versions/node') ? (() => { try { return fs.readdirSync(d).map((v) => path.join(d, v, 'bin')); } catch { return []; } })() : [d])), ...String(process.env.PATH || '').split(path.delimiter)];
    const env = { ...process.env, HOME, PATH: dirs.filter(Boolean).join(path.delimiter), HOMEBREW_NO_AUTO_UPDATE: '1' };
    this.log = []; this.emit({ status: 'installing', error: '' });
    try { this.installer = spawn(plan.cmd, plan.args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) { this.installer = null; this.emit({ status: 'missing', error: `${plan.cmd} 起不来：${err.message}` }); return { ok: false, error: err.message }; }
    this.installer.stdout.on('data', (d) => { this.pushLog(d); this.emit({}); });
    this.installer.stderr.on('data', (d) => { this.pushLog(d); this.emit({}); });
    this.installer.on('error', (err) => { this.installer = null; this.emit({ status: 'missing', error: `没找到 ${plan.cmd}：${err.message}` }); });
    this.installer.on('exit', (code) => {
      this.installer = null;
      if (code === 0 && findBinary()) { this.emit({ status: 'idle', error: '' }); this.start(); }
      else this.emit({ status: 'missing', error: `安装没成功（${plan.cmd} 退出码 ${code}）。看下面日志；连不上源的话换另一种装法。` });
    });
    return { ok: true };
  }
}

function registerVscodeIpc(ipcMain, deps) {
  const svc = new VscodeService(deps);
  ipcMain.handle('vscode:status', () => svc.status());
  ipcMain.handle('vscode:start', (_e, opts) => svc.start(opts || {}));
  ipcMain.handle('vscode:stop', () => svc.stop());
  ipcMain.handle('vscode:chooseFolder', () => svc.chooseFolder());
  ipcMain.handle('vscode:install', (_e, method) => svc.install(method));
  return svc;
}

module.exports = { registerVscodeIpc, findBinary, PORT };
