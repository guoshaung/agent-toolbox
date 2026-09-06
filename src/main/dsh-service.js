'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.1-rc.2';
const DEFAULT_PORT = 3080;

function resolveCommand(command, userDataPath = '') {
  const candidates = [
    command,
    userDataPath && path.join(userDataPath, 'dsh-runtime', 'node_modules', '.bin', command),
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.23.1', 'bin', command),
    path.join(os.homedir(), '.local', 'bin', command),
    path.join('/opt/homebrew/bin', command),
    path.join('/usr/local/bin', command),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== command && fs.existsSync(candidate)) return candidate;
  }
  try { return execFileSync('which', [command], { encoding: 'utf8', timeout: 2000 }).trim() || ''; } catch { return ''; }
}

function probe(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 1200 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

class DshService {
  constructor({ app, getWindow }) {
    this.app = app;
    this.getWindow = getWindow;
    this.child = null;
    this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
    this.state = { status: 'idle', url: this.url, managed: false, error: '' };
    this.listeners = new Set();
  }

  onStatus(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emit(next) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
    this.getWindow()?.webContents.send('dsh:status', this.state);
  }

  status() { return this.state; }

  async ensureInstalled() {
    const userData = this.app.getPath('userData');
    const existing = resolveCommand('dsh', userData);
    if (existing) return existing;
    const npm = resolveCommand('npm', userData);
    if (!npm) throw new Error('没有找到 Node.js/npm，无法自动下载 DSH。请先安装 Node.js 后重启工具。');
    const prefix = path.join(userData, 'dsh-runtime');
    fs.mkdirSync(prefix, { recursive: true });
    this.emit({ status: 'installing', error: '' });
    const result = await new Promise((resolve) => {
      const child = spawn(npm, ['install', '--prefix', prefix, '--no-fund', '--no-audit', DSH_PACKAGE], { cwd: prefix, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => resolve({ ok: code === 0, error: stderr.trim() }));
    });
    if (!result.ok) throw new Error(result.error || 'DSH 下载失败。');
    const installed = resolveCommand('dsh', userData);
    if (!installed) throw new Error('DSH 下载完成，但没有找到启动命令。');
    return installed;
  }

  async start() {
    if (await probe(DEFAULT_PORT)) {
      this.emit({ status: 'running', url: this.url, managed: false, error: '' });
      return { ok: true, ...this.state };
    }
    if (this.child && !this.child.killed) return { ok: true, ...this.state };
    try {
      const dsh = await this.ensureInstalled();
      this.emit({ status: 'starting', url: this.url, managed: true, error: '' });
      this.child = spawn(dsh, ['web', '--no-open', '--port', String(DEFAULT_PORT)], { cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'] });
      this.child.stdout.resume();
      this.child.stderr.resume();
      this.child.on('error', (error) => this.emit({ status: 'error', error: `DSH 启动失败：${error.message}` }));
      this.child.on('close', (code) => {
        this.child = null;
        if (this.state.status !== 'stopping') this.emit({ status: code === 0 ? 'idle' : 'error', error: code === 0 ? '' : `DSH 已退出（${code}）` });
      });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (await probe(DEFAULT_PORT)) {
          this.emit({ status: 'running', url: this.url, managed: true, error: '' });
          return { ok: true, ...this.state };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('DSH 启动超时，请检查 DSH 配置或端口 3080。');
    } catch (error) {
      this.emit({ status: 'error', error: error.message });
      return { ok: false, ...this.state };
    }
  }

  async stop() {
    if (!this.child || this.child.killed) return { ok: true, ...this.state };
    this.emit({ status: 'stopping' });
    this.child.kill('SIGTERM');
    this.child = null;
    this.emit({ status: 'idle', managed: false });
    return { ok: true, ...this.state };
  }
}

module.exports = { DSH_PACKAGE, DEFAULT_PORT, DshService, probe, resolveCommand };
