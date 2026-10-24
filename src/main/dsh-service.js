'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile, execFileSync } = require('node:child_process');

// 2026-10-06 升到 0.1.7-rc.2：dsh-our-free-model 插件要求内核 0.1.5～0.1.7-rc.2；0.2.x 超出插件范围、且 dsh-web-all 0.4.x 才要 0.2
const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.7-rc.2';

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

/**
 * 光把进程 cwd 放进容器是不够的：DSH 不看 cwd，只认它自己存档里的「工作区」（$DSH_HOME/storages/workspace.json），
 * 默认那条指向 ~/Documents/dsh，于是它读写的文件根本不进「容器」那一栏。这里把容器的 dsh 目录登记成一条工作区
 * （不动用户已有的那条和它的会话），DSH 侧栏「工作区」里就能切过去。纯函数，好测；已有同路径就原样返回。
 */
function mergeContainerWorkspace(store, containerDir, { title = '工具箱容器', newId = () => require('crypto').randomUUID(), now = () => new Date().toISOString() } = {}) {
  const data = store && typeof store === 'object' ? store : {};
  const tables = data.tables && typeof data.tables === 'object' ? data.tables : {};
  const workspaces = tables.workspaces && typeof tables.workspaces === 'object' ? tables.workspaces : {};
  // DSH 的记录 schema（dsh-workspace/types/spec.js）：path 必须是 realpath 规范形，createdAt / updatedAt 必填的 ISO 串。
  // 少一个字段整个存档都过不了校验，工作区列表会一直"正在加载"，连原来那条也不见——这坑踩过。
  let target = path.resolve(containerDir);
  try { target = fs.realpathSync(target); } catch { /* 目录还没建就按 resolve 的用 */ }
  if (Object.values(workspaces).some((w) => w && path.resolve(String(w.path || '')) === target)) return { changed: false, store: data };
  const id = newId();
  const stamp = now();
  const global = data.global && typeof data.global === 'object' ? data.global : { initialized: true };
  return {
    changed: true,
    store: {
      ...data,
      unit: data.unit || { name: 'workspace', version: 2 },
      global: { ...global, workspaceIds: [...(Array.isArray(global.workspaceIds) ? global.workspaceIds : []), id] },
      tables: { ...tables, workspaces: { ...workspaces, [id]: { path: target, title, sessionIds: [], createdAt: stamp, updatedAt: stamp } } },
    },
  };
}

/** 启动 DSH 前把容器目录登记成工作区。文件不存在就不管（DSH 第一次跑会自己建），写失败也不拦启动。 */
function ensureContainerWorkspace(userDataPath, dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  try {
    const file = path.join(dshHome, 'storages', 'workspace.json');
    if (!fs.existsSync(file)) return { ok: false, reason: 'no-store' };
    const { changed, store } = mergeContainerWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')), dshWorkDir(userDataPath));
    if (!changed) return { ok: true, changed: false };
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, file);
    return { ok: true, changed: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
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
      const overlayLines = [
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
      ];
      // Blender MCP（mcp-for-blender，MIT 开源免费）：装了 uvx 就挂上。
      // failOnStartupError:false —— Blender 没开/没装也不拖垮 DSH 和上面的 toolbox MCP。
      // 真要用:装 Blender + `uvx mcp-for-blender install-addon` 启用插件，让 Blender 开着。
      const uvx = resolveCommand('uvx', userData);
      if (uvx) {
        overlayLines.push(
          '- id: mcp-blender',
          "  name: '@deepseek-ai/dsh-mcp-client'",
          '  config:',
          '    serverName: blender',
          '    transport: stdio',
          `    command: ${yamlPath(uvx)}`,
          "    args: ['mcp-for-blender']",
          '    toolCallTimeoutMs: 180000',
          '    failOnStartupError: false',
          '',
        );
      }
      fs.writeFileSync(overlay, overlayLines.join('\n'), 'utf8');
      this.emit({ status: 'starting', url: this.url, managed: true, error: '' });
      // 新版 DSH 的 URL 含一次性认证 token。若 3080 已被另一个实例占用，
      // 让 DSH 自选空闲端口，避免要求用户手动寻找并关闭旧进程。
      const port = existing.running ? 0 : DEFAULT_PORT;
      // 把容器目录登记成 DSH 工作区（只在我们自己拉起 DSH 时做；DSH 没跑的时候改它的存档才安全）
      ensureContainerWorkspace(this.app.getPath('userData'));
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

module.exports = { DSH_PACKAGE, DEFAULT_PORT, DshService, findWebUrl, probe, resolveCommand, dshWorkDir, mergeContainerWorkspace, ensureContainerWorkspace };
