'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile, execFileSync } = require('node:child_process');

// 2026-10-06 升到 0.1.7-rc.2：内置种子里的 dsh-our-free-model 插件要求内核 0.1.5～0.1.7-rc.2；0.2.x 超出插件范围、且 dsh-web-all 0.4.x 才要 0.2
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

/* ---------- 内置 DSH 插件种子：新机器开箱即用 ---------- */

// DSH 的 $DSH_HOME（profile / 插件都在这下面）。和 DSH 自己的约定一致：没设环境变量就是 ~/.dsh
function dshHomeDir() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

// 判定 web profile「配齐了」的标志插件。只认换机器难重装的：免费模型不在 npm 上、逆向整合包（88 个 SKILL.md）
// 只能从 GitHub 装且要兼容性豁免——都在就说明这份 profile 是我们种过（或用户自己配齐）的，不再动它。
// ds-bot 刻意不列为标志：它是可开可关的助手（见 setBot / 切换按钮），用户关掉后绝不能被「种子还原」又装回来。
const SEED_PLUGINS = ['dsh-our-free-model', '@dhicoc/dsh-reverse-skill'];
// 可开关的助手 bundle：切换按钮就是往 profile 的 bundles 里增删这一项。
const BOT_BUNDLE = 'ds-bot';

// 种子包在 app 里的位置：打包后在 resources/dsh-seed，开发时在仓库根目录（同 container-seed 的约定）
function seedTgzPath(app) {
  const root = app?.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
  return path.join(root, 'dsh-seed', 'dsh-web-profile.tgz');
}

/** 纯判断：$DSH_HOME/profiles/web 缺不缺内置插件。没 profile、解析不了、少任一标志插件都算缺。 */
function webProfileNeedsSeed(dshHome) {
  const file = path.join(dshHome, 'profiles', 'web', 'package.json');
  if (!fs.existsSync(file)) return { needed: true, reason: 'no-profile' };
  let bundles;
  try { bundles = JSON.parse(fs.readFileSync(file, 'utf8'))?.dsh?.profile?.bundles; } catch { return { needed: true, reason: 'bad-profile' }; }
  if (!Array.isArray(bundles)) return { needed: true, reason: 'bad-profile' };
  const missing = SEED_PLUGINS.filter((name) => !bundles.includes(name));
  return missing.length ? { needed: true, reason: `missing:${missing.join(',')}` } : { needed: false, reason: 'complete' };
}

/**
 * 把 app 自带的 web profile 种子解包到 $DSH_HOME。只在缺插件时做；已有的 profile 先整个备份成 web.bak-<时间>。
 * 种子是从一台配好的机器整体导出的：node_modules 自洽，且整棵树没有任何软链（Windows 上 tar 解出的软链一 stat 就
 * EPERM，CI 栽过）——不在 npm 上的免费模型插件在 node_modules 里是真目录，plugins/ 下另留一份给 package.json 里
 * 相对路径的 link: 依赖用；.bin 全是软链所以不带。不含 .plugin-manager 登录态和任何密钥（模型配置只写 apiKeyEnv 变量名）。
 * 除 profiles/web 和 plugins/ 外还带 skills/（Superpowers、taste、mattpocock、Anatomy 等摊平成 <名字>/SKILL.md，
 * 这是 dsh-skill-filesystem 的用户级根 $DSH_HOME/skills）。
 * tgz 内路径带 `.dsh/` 前缀，--strip-components=1 剥掉它，这样 DSH_HOME 叫什么都能落对位置。
 * 任何一步失败都只返回 ok:false，不抛——调用方不该因它拦住 DSH 启动。
 */
function seedWebProfile(seedTgz, dshHome = dshHomeDir()) {
  try {
    if (!fs.existsSync(seedTgz)) return { ok: false, seeded: false, reason: 'no-seed' };
    const check = webProfileNeedsSeed(dshHome);
    if (!check.needed) return { ok: true, seeded: false, reason: check.reason };
    const web = path.join(dshHome, 'profiles', 'web');
    let backup = '';
    if (fs.existsSync(web)) {
      backup = `${web}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.renameSync(web, backup);
    }
    fs.mkdirSync(dshHome, { recursive: true });
    // 选项全部放在 -f 之前，bsdtar（macOS / Win10+ 自带）和 GNU tar 都认
    // Windows 上指定系统自带的 bsdtar：PATH 里排前面的常是 Git 带的 GNU tar，它会把 D:\\… 当成「主机:路径」
    // 去连远程（GitHub windows 镜像 20261015 起就这样，种子全挂）。没有 System32\\tar.exe 再退回 PATH 里的 tar。
    const sysTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '';
    const tarBin = sysTar && fs.existsSync(sysTar) ? sysTar : 'tar';
    execFileSync(tarBin, ['-x', '-z', '--strip-components=1', '-f', seedTgz, '-C', dshHome], { stdio: 'ignore', timeout: 120000 });
    if (!fs.existsSync(path.join(web, 'package.json'))) throw new Error('解包后没有 profiles/web/package.json');
    return { ok: true, seeded: true, reason: check.reason, backup };
  } catch (error) {
    return { ok: false, seeded: false, reason: error.message };
  }
}

/* ---------- ds-bot 开关：在 profile 的 bundles 里增删这个 bundle，可逆、不删文件 ---------- */

// 读 profile 的 bundles 数组（读不到/格式坏都返回空数组，不抛）
function readProfileBundles(dshHome = dshHomeDir()) {
  try {
    const file = path.join(dshHome, 'profiles', 'web', 'package.json');
    const bundles = JSON.parse(fs.readFileSync(file, 'utf8'))?.dsh?.profile?.bundles;
    return Array.isArray(bundles) ? bundles : [];
  } catch { return []; }
}

// ds-bot 当前是否开着 = 它在不在 bundles 里
function botEnabled(dshHome = dshHomeDir()) {
  return readProfileBundles(dshHome).includes(BOT_BUNDLE);
}

// 纯函数：返回增删某 bundle 后的新 bundles（幂等；开→去重后追加到末尾，关→过滤掉；其余顺序不变）
function toggleBundle(bundles, name, enabled) {
  const list = (Array.isArray(bundles) ? bundles : []).filter((b) => b !== name);
  return enabled ? [...list, name] : list;
}

// 把开关写回 profile 的 package.json（原子写，整份 JSON round-trip 保留其余字段）。返回写完后该 bundle 是否在。
function setBundleEnabled(name, enabled, dshHome = dshHomeDir()) {
  const file = path.join(dshHome, 'profiles', 'web', 'package.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.dsh = data.dsh || {};
  data.dsh.profile = data.dsh.profile || {};
  data.dsh.profile.bundles = toggleBundle(data.dsh.profile.bundles, name, enabled);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return data.dsh.profile.bundles.includes(name);
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

/**
 * 把 node 所在目录放到子进程 PATH 最前面。
 * 工具箱是 GUI 进程，macOS 上 launchd 给它的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin ——
 * node 只装在 nvm / homebrew 里的机器上，`dsh` 脚本的 `#!/usr/bin/env node` 一个都找不到，
 * 子进程当场退出、我们这边只看到「启动超时」。这坑栽过：profile 明明能起，换成从 Finder 双击就起不来。
 * 纯函数，好测。
 */
function withNodeOnPath(env, nodeBin) {
  if (!nodeBin) return { ...env };
  const dir = path.dirname(nodeBin);
  const parts = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  return { ...env, PATH: [dir, ...parts.filter((p) => p !== dir)].join(path.delimiter) };
}

/** `dsh` 在 mac/linux 上是个 `env node` 脚本：显式用解析到的 node 去跑它，不赌 PATH。Windows 的 .cmd 走 shell 原样执行。 */
function dshSpawnSpec(dshBin, nodeBin, args) {
  if (nodeBin && !/\.(cmd|exe|bat)$/i.test(dshBin)) return { command: nodeBin, args: [dshBin, ...args] };
  return { command: dshBin, args };
}

/* ---------- REA（morluto/rea，MIT）：逆向 MCP ---------- */

// 固定版本，和它官方文档推荐的 `npx -y rea-agents@<ver> mcp` 一致；升级时改这里并重测 `rea mcp doctor`
const REA_PACKAGE = 'rea-agents@6.5.0';

/** dsh-runtime 里本地装好的 REA 入口（装过就有）。 */
function reaLocalScript(userData) {
  return userData ? path.join(userData, 'dsh-runtime', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs') : '';
}

/**
 * REA 逆向 MCP 的 overlay 条目（纯函数，好测）。
 * 优先级：本地已装 → `node rea.mjs mcp`；否则按官方形状走 npx——但 npx 自己也是 `env node` 脚本（nvm/官方包里是指向
 * npm/bin/npx-cli.js 的软链），GUI 下同样找不到 node，所以这里把软链解到 npx-cli.js、显式用 node 跑它；
 * Windows 按 REA 文档包一层 `cmd.exe /d /c npx …`（Windows 安装器会把 node 写进系统 PATH）。
 * failOnStartupError:false —— 首次要下载 ~100MB，慢或失败都只是没有 REA 工具，不拖垮 DSH。
 */
function reaMcpLines({ nodeBin, userData, platform = process.platform, exists = fs.existsSync, realpath = fs.realpathSync }) {
  const local = reaLocalScript(userData);
  let command; let args;
  if (local && exists(local) && nodeBin) { command = nodeBin; args = [local, 'mcp']; }
  else if (platform === 'win32') { command = 'cmd.exe'; args = ['/d', '/c', 'npx', '-y', REA_PACKAGE, 'mcp']; }
  else {
    let npxCli = '';
    if (nodeBin) { try { npxCli = realpath(path.join(path.dirname(nodeBin), 'npx')); } catch { /* 没有 npx 就退回 PATH 里的 */ } }
    if (npxCli && nodeBin) { command = nodeBin; args = [npxCli, '-y', REA_PACKAGE, 'mcp']; }
    else { command = 'npx'; args = ['-y', REA_PACKAGE, 'mcp']; }
  }
  return [
    '- id: mcp-rea',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: rea',
    '    transport: stdio',
    `    command: ${yamlPath(command)}`,
    `    args: [${args.map(yamlPath).join(', ')}]`,
    '    toolCallTimeoutMs: 600000',
    '    failOnStartupError: false',
    '',
  ];
}

let reaInstallStarted = false;
/** 把 REA 装进 dsh-runtime（和 DSH 内核同一个 prefix）：只在缺的时候、后台静默装一次，供下次启动走本地包。失败只打日志。 */
function ensureReaInstalled(userData, nodeBin) {
  try {
    if (reaInstallStarted || !userData || fs.existsSync(reaLocalScript(userData))) return false;
    const npm = resolveCommand('npm', userData);
    if (!npm) return false;
    reaInstallStarted = true;
    const prefix = path.join(userData, 'dsh-runtime');
    fs.mkdirSync(prefix, { recursive: true });
    const child = spawn(npm, ['install', '--prefix', prefix, '--no-fund', '--no-audit', REA_PACKAGE], spawnOptions({ cwd: prefix, stdio: 'ignore', env: withNodeOnPath(process.env, nodeBin) }));
    child.on('error', (error) => console.warn(`[dsh] REA 后台安装失败：${error.message}`));
    child.on('close', (code) => console.log(`[dsh] REA 后台安装${code === 0 ? '完成，下次启动 DSH 走本地包' : `退出（${code}）`}`));
    return true;
  } catch (error) {
    console.warn(`[dsh] REA 后台安装未开始：${error.message}`);
    return false;
  }
}

/* ---------- DSH overlay（--patch）：把 MCP server 挂进 profile ---------- */

const yamlPath = (value) => JSON.stringify(String(value).replace(/\\/g, '/'));

/**
 * 把「条目列表」包成一个 `- insert:` 操作。
 * DSH 的 patch 列表里，裸写 `- id: xxx` 的语义是「修改已有条目」——id 在树里不存在就只在 stderr 打一句
 * `patch: entry "xxx" not found` 然后跳过，整个 overlay 等于没写。新增条目必须走 `- insert:`。
 * 工具箱的 MCP overlay 之前就是裸写的，agent_toolbox / Blender 两条其实从来没加载过——这坑是用 --dump-config
 * 加一条故意写坏的 mcp-client 做判别实验才抓到的（坏条目既不报错也不影响激活计数 ⇒ overlay 根本没进树）。
 */
function asInsertPatch(entryLines) {
  return ['- insert:', ...entryLines.map((line) => (line ? `    ${line}` : ''))];
}

/**
 * 工具箱自己的 MCP（toolbox-mcp-server.js，用 Electron 以 node 模式跑）。failOnStartupError:true——它挂了说明工具箱自身有问题，要暴露出来。
 * cwd 必须是真目录：打包后 mcpServer 在 app.asar 里，那个"目录"只在 Electron 进程里看着像目录，
 * 对 OS 来说不是——子进程一设 cwd 就 `spawn ENOTDIR`，DSH 只报"initial connection failed"。开发态是真目录所以看不出来。
 * 脚本本身从 asar 里 require 没问题（ELECTRON_RUN_AS_NODE 下 asar 支持仍开着），只是 cwd 不能指进去。
 */
function toolboxMcpLines({ userData, mcpServer, execPath }) {
  return [
    '- id: mcp-agent-toolbox',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: agent_toolbox',
    '    transport: stdio',
    `    command: ${yamlPath(execPath)}`,
    `    args: [${yamlPath(mcpServer)}]`,
    `    cwd: ${yamlPath(userData)}`,
    '    env:',
    `      AGENT_TOOLBOX_USER_DATA: ${yamlPath(userData)}`,
    '      ELECTRON_RUN_AS_NODE: "1"',
    '    toolCallTimeoutMs: 180000',
    '    failOnStartupError: true',
    '',
  ];
}

/** Blender MCP（mcp-for-blender，MIT 开源免费）：装了 uvx 才挂；Blender 没开/没装也不拖垮 DSH。真要用：装 Blender + `uvx mcp-for-blender install-addon`，让 Blender 开着。 */
function blenderMcpLines(uvx) {
  if (!uvx) return [];
  return [
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
  ];
}

/** 整份 overlay 文本（纯函数，好测）：toolbox MCP + Blender（可选）+ REA，全部包在一个 insert 里。 */
function buildOverlay({ userData, mcpServer, execPath, uvx, nodeBin }) {
  const entries = [
    ...toolboxMcpLines({ userData, mcpServer, execPath }),
    ...blenderMcpLines(uvx),
    ...reaMcpLines({ nodeBin, userData }),
  ];
  return `${asInsertPatch(entries).join('\n')}\n`;
}

// DSH 只把这些事写在 stderr：overlay 没生效（patch: entry not found）、条目没激活（did not activate）、MCP 连不上。
// 以前整条 stderr 只用来找 URL、其余全扔，MCP 没挂上也没人知道。
const DSH_WARNING = /^dsh: (warning|\[.*\] patch:)|did not activate|mcp-client\(|skipping profile bundle/;

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
    this.state = { status: 'idle', url: this.url, managed: false, error: '', warnings: [] };
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
      const env = withNodeOnPath(process.env, resolveCommand('node', userData));
      const child = spawn(npm, ['install', '--prefix', prefix, '--no-fund', '--no-audit', DSH_PACKAGE], spawnOptions({ cwd: prefix, stdio: ['ignore', 'pipe', 'pipe'], env }));
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
      // 新机器开箱即用：web profile 缺内置插件（免费模型 / ds-bot…）就从 app 自带的种子解包一份到 $DSH_HOME。
      // 已配齐的不碰；失败也不拦启动，最多退回 DSH 自己的默认 profile。
      const seeded = seedWebProfile(seedTgzPath(this.app));
      if (seeded.seeded) console.log(`[dsh] 已从内置种子初始化 web profile（${seeded.reason}）`);
      else if (!seeded.ok && seeded.reason !== 'no-seed') console.warn(`[dsh] 内置插件种子未生效：${seeded.reason}`);
      const userData = this.app.getPath('userData');
      const nodeBin = resolveCommand('node', userData);
      const mcpServer = path.join(__dirname, 'toolbox-mcp-server.js');
      const overlay = path.join(userData, 'dsh-toolbox.patch.yml');
      // toolbox MCP + Blender（可选）+ REA 逆向 MCP，见 buildOverlay / 各 *McpLines 的说明
      fs.writeFileSync(overlay, buildOverlay({ userData, mcpServer, execPath: process.execPath, uvx: resolveCommand('uvx', userData), nodeBin }), 'utf8');
      ensureReaInstalled(userData, nodeBin);
      this.emit({ status: 'starting', url: this.url, managed: true, error: '', warnings: [] });
      // 新版 DSH 的 URL 含一次性认证 token。若 3080 已被另一个实例占用，
      // 让 DSH 自选空闲端口，避免要求用户手动寻找并关闭旧进程。
      const port = existing.running ? 0 : DEFAULT_PORT;
      const spec = dshSpawnSpec(dsh, nodeBin, ['--profile', 'web', '--patch', overlay, '--no-open', '--port', String(port)]);
      this.child = spawn(spec.command, spec.args, spawnOptions({ cwd: dshWorkDir(userData), stdio: ['ignore', 'pipe', 'pipe'], env: withNodeOnPath(process.env, nodeBin) }));
      const captureUrl = (chunk) => {
        const url = findWebUrl(chunk);
        if (url) this.url = url;
      };
      const captureWarnings = (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (!DSH_WARNING.test(line)) continue;
          console.warn('[dsh]', line);
          this.emit({ warnings: [...(this.state.warnings || []), line].slice(-20) });
        }
      };
      this.child.stdout.on('data', captureUrl);
      this.child.stderr.on('data', (chunk) => { captureUrl(chunk); captureWarnings(chunk); });
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

  // 当前 ds-bot 开没开（读 profile，不碰运行态）
  botEnabled() { return botEnabled(); }

  // 切换 ds-bot：改 profile 的 bundles，然后重启 DSH 让新 profile 生效。可逆。
  async setBot(enabled) {
    try {
      const now = setBundleEnabled(BOT_BUNDLE, !!enabled);
      await this.stop();
      await new Promise((r) => setTimeout(r, 800));   // 等 3080 和子进程树彻底释放，别让 start() 误判端口还占着去 adopt 旧进程
      const state = await this.start();
      return { ...state, botEnabled: now };
    } catch (error) {
      this.emit({ status: 'error', error: `切换 DS Bot 失败：${error.message}` });
      return { ok: false, ...this.state, botEnabled: botEnabled() };
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

module.exports = { DSH_PACKAGE, DEFAULT_PORT, DshService, findWebUrl, probe, resolveCommand, dshHomeDir, SEED_PLUGINS, BOT_BUNDLE, seedTgzPath, webProfileNeedsSeed, seedWebProfile, withNodeOnPath, dshSpawnSpec, REA_PACKAGE, reaLocalScript, reaMcpLines, ensureReaInstalled, asInsertPatch, buildOverlay, DSH_WARNING, readProfileBundles, botEnabled, toggleBundle, setBundleEnabled };
