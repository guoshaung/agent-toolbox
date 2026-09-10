'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, execFile, execFileSync } = require('node:child_process');

/**
 * SillyTavern（酒馆）内嵌服务。
 * 生命周期与 DSH 一致：自动安装 → 启动 → 健康探测 → 状态广播 → 退出时清理进程树。
 * 运行时安装在 userData/tavern-runtime，不混进项目仓库。
 */
const DEFAULT_PORT = 8000;
const RUNTIME_DIR = 'tavern-runtime';
const BOOT_TIMEOUT = 90000;

function tavernRoot(userDataPath) {
  if (!userDataPath) return os.homedir();
  return path.join(userDataPath, RUNTIME_DIR);
}

function resolveCommand(command, userDataPath = '') {
  const commandNames = process.platform === 'win32'
    ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
    : [command];
  const candidates = [
    ...commandNames,
    ...commandNames.map((name) => userDataPath && path.join(userDataPath, 'dsh-runtime', 'node_modules', '.bin', name)),
    ...commandNames.map((name) => path.join(os.homedir(), 'AppData', 'Roaming', 'npm', name)),
    ...commandNames.map((name) => path.join(process.env.ProgramFiles || '', 'nodejs', name)),
    path.join(os.homedir(), '.local', 'bin', command),
    path.join(os.homedir(), '.cargo', 'bin', command),
    path.join('/opt/homebrew/bin', command),
    path.join('/usr/local/bin', command),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!commandNames.includes(candidate) && fs.existsSync(candidate)) return candidate;
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch { return ''; }
}

function spawnOptions(options = {}) {
  return process.platform === 'win32' ? { ...options, shell: true } : options;
}

/** 探测端口上是不是酒馆：首页返回 200 且包含 SillyTavern 特征。 */
function probe(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 1500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.resume();
      response.on('end', () => resolve({
        running: response.statusCode >= 200 && response.statusCode < 500,
        isTavern: response.statusCode >= 200 && response.statusCode < 500 && /sillytavern/i.test(body),
      }));
    });
    request.on('error', () => resolve({ running: false, isTavern: false }));
    request.on('timeout', () => { request.destroy(); resolve({ running: false, isTavern: false }); });
  });
}

/** 找一个空闲的本地端口（8000 被其他程序占用时用）。 */
function findFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on('error', () => resolve(0));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * 杀掉 spawn 出来的进程树。Windows 上 spawn 带 shell:true 时 pid 是 cmd.exe 的，
 * 直接 kill 会留下它拉起的 node 子进程（重启后端口被占的根因），必须 taskkill /T。
 */
function killTree(child) {
  if (!child || !child.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGTERM'); } catch { /* 进程已经没了 */ } }
  return Promise.resolve();
}

class TavernService {
  constructor({ app, getWindow }) {
    this.app = app;
    this.getWindow = getWindow;
    this.child = null;
    this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
    this.state = { status: 'idle', url: this.url, managed: false, error: '', log: '' };
    this.listeners = new Set();
  }

  onStatus(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emit(next) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
    this.getWindow()?.webContents.send('tavern:status', this.state);
  }

  status() { return this.state; }

  /** 首次安装 / 补装依赖。运行时缺了就执行 npm install。 */
  async ensureInstalled() {
    const root = tavernRoot(this.app.getPath('userData'));
    if (!fs.existsSync(path.join(root, 'package.json'))) {
      throw new Error('酒馆运行时不存在，请重新安装（需要联网克隆 SillyTavern）。');
    }
    const hasDeps = fs.existsSync(path.join(root, 'node_modules', '.package-lock.json'))
      || fs.existsSync(path.join(root, 'node_modules'));
    if (hasDeps) return root;
    this.emit({ status: 'installing', error: '', log: '' });
    const npm = resolveCommand('npm', this.app.getPath('userData')) || 'npm';
    const result = await new Promise((resolve) => {
      const child = spawn(npm, ['install', '--no-fund', '--no-audit'], spawnOptions({ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }));
      let buf = '';
      child.stdout.on('data', (chunk) => { buf += chunk; });
      child.stderr.on('data', (chunk) => { buf += chunk; });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => resolve({ ok: code === 0, error: buf.trim().slice(-800) }));
    });
    if (!result.ok) throw new Error(result.error || '酒馆依赖安装失败。');
    return root;
  }

  async start() {
    const existing = await probe(DEFAULT_PORT);
    if (existing.running && existing.isTavern) {
      this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
      this.emit({ status: 'running', url: this.url, managed: false, error: '', log: '已检测到正在运行的酒馆实例，直接复用。' });
      return { ok: true, ...this.state };
    }
    if (this.child && !this.child.killed) return { ok: true, ...this.state };
    try {
      const root = await this.ensureInstalled();
      // 8000 被其他程序占了（非酒馆）就自动换空闲端口，不弹「端口被占用」。
      const port = existing.running ? (await findFreePort()) || DEFAULT_PORT : DEFAULT_PORT;
      this.url = `http://127.0.0.1:${port}`;
      this.emit({ status: 'starting', url: this.url, managed: true, error: '', log: '' });
      const node = resolveCommand('node', this.app.getPath('userData')) || process.execPath;
      let bootLog = '';
      // 注意：node.exe 是原生可执行文件，不能带 shell:true —— 那样 spawn 会把完整
      // 路径拼进 cmd 命令串，'C:\Program Files\...' 含空格会直接启动失败。
      this.child = spawn(node, ['server.js', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child.stdout.on('data', (chunk) => { bootLog += chunk; });
      this.child.stderr.on('data', (chunk) => { bootLog += chunk; });
      this.child.on('error', (error) => this.emit({ status: 'error', error: `酒馆启动失败：${error.message}`, log: bootLog.slice(-1200) }));
      this.child.on('close', (code) => {
        this.child = null;
        if (this.state.status !== 'stopping') {
          this.emit({ status: code === 0 ? 'idle' : 'error', error: code === 0 ? '' : `酒馆已退出（${code}）`, log: bootLog.slice(-1200) });
        }
      });
      const deadline = Date.now() + BOOT_TIMEOUT;
      while (Date.now() < deadline) {
        let health = { running: false, isTavern: false };
        try { health = await probe(port); } catch { /* 等待启动完成 */ }
        if (health.running && health.isTavern) {
          this.emit({ status: 'running', url: this.url, managed: true, error: '', log: bootLog.slice(-1200) });
          return { ok: true, ...this.state };
        }
        if (!this.child) break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const stillUp = this.child && !this.child.killed;
      if (stillUp) await killTree(this.child);
      this.child = null;
      this.emit({ status: 'error', error: this.state.error || (stillUp ? '酒馆启动超时。' : '酒馆进程已退出。'), log: bootLog.slice(-1200) });
      return { ok: false, ...this.state };
    } catch (error) {
      this.emit({ status: 'error', error: error.message, log: this.state.log });
      return { ok: false, ...this.state };
    }
  }

  async stop() {
    if (!this.child || this.child.killed) return { ok: true, ...this.state };
    this.emit({ status: 'stopping' });
    await killTree(this.child);
    this.child = null;
    this.emit({ status: 'idle', managed: false, error: '', log: '' });
    return { ok: true, ...this.state };
  }
}

module.exports = { DEFAULT_PORT, TavernService, findFreePort, probe, resolveCommand, tavernRoot };