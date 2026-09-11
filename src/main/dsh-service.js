'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile, execFileSync } = require('node:child_process');

const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.1-rc.2';

/**
 * DSH 的工作目录。
 * 默认放在工具箱的容器里，而不是用户家目录 —— 它读写的文件就落在
 * 「容器」那一栏里看得见、能整理，也不会散到 home 下面找不着。
 */
function dshWorkDir(userDataPath) {
  if (!userDataPath) return os.homedir();
  const dir = path.join(userDataPath, 'container', 'dsh');
  try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch { return os.homedir(); }
}
const DEFAULT_PORT = 3080;

function resolveCommand(command, userDataPath = '') {
  const commandNames = process.platform === 'win32'
    ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
    : [command];
  const candidates = [
    ...commandNames,
    ...commandNames.map((name) => userDataPath && path.join(userDataPath, 'dsh-runtime', 'node_modules', '.bin', name)),
    ...commandNames.map((name) => path.join(os.homedir(), 'AppData', 'Roaming', 'npm', name)),
    ...commandNames.map((name) => path.join(process.env.ProgramFiles || '', 'nodejs', name)),
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.23.1', 'bin', command),
    path.join(os.homedir(), '.local', 'bin', command),
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

function probe(port = DEFAULT_PORT, requestPath = '/') {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: requestPath, timeout: 1200 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.resume();
      response.on('end', () => resolve({
        running: response.statusCode >= 200 && response.statusCode < 500,
        authenticated: response.statusCode !== 401,
        isDsh: response.statusCode !== 401 || body.includes('dsh web authentication required'),
      }));
    });
    request.on('error', () => resolve({ running: false, authenticated: false, isDsh: false }));
    request.on('timeout', () => { request.destroy(); resolve({ running: false, authenticated: false, isDsh: false }); });
  });
}

function findWebUrl(text) {
  return String(text || '').match(/https?:\/\/[^\s"'<>]+/)?.[0] || '';
}

/**
 * 杀掉 spawn 出来的进程树。
 * Windows 上 spawn 带 shell:true 时 child.pid 是 cmd.exe 的 pid，
 * child.kill() 只会杀 cmd，它拉起的 node 子进程会变成残留 DSH —— 端口就这样被占掉的。
 * 所以 Windows 必须用 taskkill /T 连子树一起杀。
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
      const child = spawn(npm, ['install', '--prefix', prefix, '--no-fund', '--no-audit', DSH_PACKAGE], spawnOptions({ cwd: prefix, stdio: ['ignore', 'pipe', 'pipe'] }));
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
    const existing = await probe(DEFAULT_PORT);
    if (existing.running && existing.authenticated) {
      this.emit({ status: 'running', url: this.url, managed: false, error: '' });
      return { ok: true, ...this.state };
    }
    if (this.child && !this.child.killed) return { ok: true, ...this.state };
    try {
      const dsh = await this.ensureInstalled();
      const userData = this.app.getPath('userData');
      const mcpServer = path.join(__dirname, 'toolbox-mcp-server.js');
      const overlay = path.join(userData, 'dsh-toolbox.patch.yml');
      const yamlPath = (value) => JSON.stringify(String(value).replace(/\\/g, '/'));
      fs.writeFileSync(overlay, [
        '- id: mcp-agent-toolbox',
        "  name: '@deepseek-ai/dsh-mcp-client'",
        '  config:',
        '    serverName: agent_toolbox',
        '    transport: stdio',
        `    command: ${yamlPath(process.execPath)}`,
        `    args: [${yamlPath(mcpServer)}]`,
        `    cwd: ${yamlPath(path.dirname(mcpServer))}`,
        '    env:',
        `      AGENT_TOOLBOX_USER_DATA: ${yamlPath(userData)}`,
        '      ELECTRON_RUN_AS_NODE: "1"',
        '    toolCallTimeoutMs: 180000',
        '    failOnStartupError: true',
        '',
      ].join('\n'), 'utf8');
      this.emit({ status: 'starting', url: this.url, managed: true, error: '' });
      // 新版 DSH 的 URL 含一次性认证 token。若 3080 已被另一个实例占用，
      // 让 DSH 自选空闲端口，避免要求用户手动寻找并关闭旧进程。
      const port = existing.running ? 0 : DEFAULT_PORT;
      this.child = spawn(dsh, ['--profile', 'web', '--patch', overlay, '--no-open', '--port', String(port)], spawnOptions({ cwd: dshWorkDir(this.app.getPath('userData')), stdio: ['ignore', 'pipe', 'pipe'] }));
      const captureUrl = (chunk) => {
        const url = findWebUrl(chunk);
        if (url) this.url = url;
      };
      this.child.stdout.on('data', captureUrl);
      this.child.stderr.on('data', captureUrl);
      this.child.on('error', (error) => this.emit({ status: 'error', error: `DSH 启动失败：${error.message}` }));
      this.child.on('close', (code) => {
        this.child = null;
        if (this.state.status !== 'stopping') this.emit({ status: code === 0 ? 'idle' : 'error', error: code === 0 ? '' : `DSH 已退出（${code}）` });
      });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        let health = { running: false, isDsh: false };
        try {
          const parsed = new URL(this.url);
          // 启动 URL 中的 token 是一次性凭证。健康检查只能探测裸地址；
          // 若在这里请求 ?token=...，webview 随后打开时会因 token 已消费而 401。
          health = await probe(Number(parsed.port), '/');
        } catch { /* 等待 DSH 输出 URL */ }
        if (health.running && health.isDsh && this.url.includes('token=')) {
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
    await killTree(this.child);
    this.child = null;
    this.emit({ status: 'idle', managed: false });
    return { ok: true, ...this.state };
  }
}

module.exports = { DSH_PACKAGE, DEFAULT_PORT, DshService, findWebUrl, probe, resolveCommand };
