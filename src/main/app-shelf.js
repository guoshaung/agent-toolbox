'use strict';
/**
 * 工具架：把本机上零散的小工具（Python 脚本、Node 服务、可执行文件）登记进来，
 * 一键启动 / 停止，输出留在这里看。
 *
 * 解决的是「装了个好用的工具，下次要用又忘了怎么启动」——
 * 每次都要翻目录、想起来该 activate 哪个虚拟环境、命令是什么。
 *
 * 边界：这里执行的是你自己写进去的命令，只在你点「启动」时才跑。
 * 不自动扫描、不自动运行、不联网取命令。
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');

const MAX_LOG_LINES = 400;
const running = new Map();   // id -> { child, log: string[], startedAt, command, cwd }

// 包名（可带版本约束）。AI 建议或用户输入最终都会拼进 uv 命令，
// 过不了这个白名单的直接拒绝，防止把任意命令塞进来。
const SAFE_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:(?:==|~=|!=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)?$/;

/** GUI 启动的 Electron 拿到的 PATH 往往缺用户级安装目录（uv 就在 ~/.local/bin），主动补上。 */
function toolEnv() {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const extra = [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm')]
    .filter(Boolean)
    .filter((dir) => !String(env.PATH || '').split(path.delimiter).includes(dir));
  if (extra.length) env.PATH = `${extra.reverse().join(path.delimiter)}${path.delimiter}${env.PATH || ''}`;
  return env;
}

function resolveToolCommand(command) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.cargo', 'bin')]) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* 下一个位置 */ }
    }
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch { return ''; }
}

/** 跑一条不会常驻的命令（uv init / uv add），把输出原样收回来展示给用户。 */
function runCapture(command, args, cwd, timeout = 240000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已经没了 */ } }, timeout);
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, log: `${out}\n[启动失败] ${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, log: out }); });
  });
}

function tail(id) {
  const entry = running.get(id);
  return entry ? entry.log.join('\n') : '';
}

function pushLog(entry, chunk) {
  const text = String(chunk);
  const lines = text.split(/\r?\n/);
  // 以换行结尾的数据块，split 出来最后会多一个空串。
  // 不去掉的话每行输出后面都跟一个空行，日志白占一倍高度。
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) entry.log.push(line);
  if (entry.log.length > MAX_LOG_LINES) entry.log.splice(0, entry.log.length - MAX_LOG_LINES);
}

/**
 * 看一眼目录，猜出这是什么项目、该怎么启动。
 * 猜错没关系 —— 结果只是填进输入框的默认值，你可以改。
 */function probe(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: '目录不存在' };
  const has = (name) => fs.existsSync(path.join(dir, name));
  const out = { ok: true, dir, name: path.basename(dir), kind: '未知', command: '', notes: [] };

  // Python：优先用目录里已有的虚拟环境，其次 uv，最后系统 python3
  const venvPython = ['.venv/bin/python', 'venv/bin/python', '.venv/Scripts/python.exe']
    .map((rel) => path.join(dir, rel)).find((p) => fs.existsSync(p));
  const pyEntry = ['main.py', 'app.py', 'run.py', '__main__.py'].find(has);

  if (pyEntry) {
    out.kind = 'Python';
    if (venvPython) {
      out.command = `"${venvPython}" ${pyEntry}`;
      out.notes.push(`用目录里已有的虚拟环境：${path.relative(dir, venvPython)}`);
    } else if (has('pyproject.toml')) {
      out.command = `uv run ${pyEntry}`;
      out.notes.push('没找到 .venv，用 uv run 会自动建环境装依赖（需要本机装了 uv）');
    } else if (has('requirements.txt')) {
      out.command = `uv run --with-requirements requirements.txt ${pyEntry}`;
      out.notes.push('使用 requirements.txt 创建并复用 uv 运行环境（需要本机装了 uv）');
    } else {
      out.command = `${process.platform === 'win32' ? 'python' : 'python3'} ${pyEntry}`;
    }
    if (has('requirements.txt')) out.notes.push('有 requirements.txt，首次启动前可以点「装依赖」');
  } else if (has('package.json')) {
    out.kind = 'Node';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const script = pkg.scripts?.start ? 'start' : (pkg.scripts?.dev ? 'dev' : '');
      out.command = script ? `npm run ${script}` : `node ${pkg.main || 'index.js'}`;
      out.name = pkg.name || out.name;
    } catch {
      out.command = 'npm start';
    }
  } else {
    const sh = fs.readdirSync(dir).find((f) => /\.(sh|command)$/.test(f));
    if (sh) { out.kind = 'Shell'; out.command = `bash "${sh}"`; }
  }
  return out;
}

function normalizePackages(value) {
  const packages = String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (!packages.length) return { packages: [], error: '请输入至少一个包名，例如 requests 或 numpy。' };
  if (packages.length > 20) return { packages: [], error: '一次最多安装 20 个包。' };
  const invalid = packages.find((item) => !SAFE_PACKAGE.test(item));
  if (invalid) return { packages: [], error: `包名格式不安全：${invalid}` };
  return { packages };
}

/** 列出容器里某个工具目录已声明的依赖，给「装依赖」面板做展示。 */
function depsList(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: '目录不存在' };
  const deps = [];
  let kind = 'none';
  const pyproject = path.join(dir, 'pyproject.toml');
  const requirements = path.join(dir, 'requirements.txt');
  if (fs.existsSync(pyproject)) {
    kind = 'uv';
    try {
      // 只做展示用的宽松解析：抓 [project] dependencies 数组里的字符串项。
      const block = fs.readFileSync(pyproject, 'utf8').match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (block) for (const match of block[1].matchAll(/["']([^"']+)["']/g)) deps.push(match[1]);
    } catch { /* 读不出来就当空列表 */ }
  } else if (fs.existsSync(requirements)) {
    kind = 'requirements';
    try {
      for (const line of fs.readFileSync(requirements, 'utf8').split(/\r?\n/)) {
        const item = line.trim();
        if (item && !item.startsWith('#') && !item.startsWith('-')) deps.push(item);
      }
    } catch { /* 同上 */ }
  }
  return { ok: true, kind, deps };
}

/**
 * 给容器里的工具装依赖。有 pyproject.toml 就直接 uv add（以后 uv run 复用同一个环境）；
 * 纯脚本目录先 uv init --bare 建一个最小项目，再 add，让「放进来就能装库」对任何工具成立。
 */
async function installDeps({ cwd, packages }) {
  if (!cwd || !fs.existsSync(cwd)) return { ok: false, log: '目录不存在' };
  const normalized = normalizePackages(packages);
  if (normalized.error) return { ok: false, log: normalized.error };
  const uv = resolveToolCommand('uv');
  if (!uv) return { ok: false, log: '没有找到 uv。请先安装 uv（https://docs.astral.sh/uv/），装完重启工具箱。' };

  const log = [];
  if (!fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    const init = await runCapture(uv, ['init', '--bare', '--quiet'], cwd);
    log.push('$ uv init --bare', init.log.trim() || '(已创建 pyproject.toml)');
    if (!init.ok) return { ok: false, log: [...log, '初始化 uv 项目失败，请看上方输出。'].join('\n') };
  }
  log.push(`$ uv add ${normalized.packages.join(' ')}`);
  const install = await runCapture(uv, ['add', ...normalized.packages], cwd);
  log.push(install.log.trim() || '(无输出)');
  if (install.ok) log.push(`[完成] 已安装：${normalized.packages.join(', ')}`);
  else log.push('[失败] 依赖没有装上，请看上方输出。');
  return { ok: install.ok, log: log.join('\n') };
}

function start({ id, cwd, command }) {
  if (!id || !command) return { ok: false, error: '缺少启动命令' };
  const previous = running.get(id);
  if (previous?.child) return { ok: false, error: '这个工具已经在运行了' };
  if (previous) running.delete(id);
  if (cwd && !fs.existsSync(cwd)) return { ok: false, error: `工作目录不存在：${cwd}` };

  // 走登录 shell：这样 PATH 里才有 uv / pyenv / nvm 装的东西，
  // 不然从 GUI 启动的 Electron 拿到的是一个很干净的 PATH，常见的「命令找不到」都出在这。
  // Windows 没有 bash 登录 shell（-lc 会被 PowerShell 当成命令名报
  // CommandNotFoundException），改用 cmd.exe；PATH 和编码由 toolEnv() 补齐。
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd: cwd || os.homedir(),
      env: toolEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
    : spawn(process.env.SHELL || '/bin/bash', ['-lc', command], {
      cwd: cwd || process.env.HOME,
      env: toolEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

  const entry = { child, log: [], startedAt: Date.now(), command, cwd };
  running.set(id, entry);
  pushLog(entry, `$ ${command}`);

  child.stdout.on('data', (d) => pushLog(entry, d));
  child.stderr.on('data', (d) => pushLog(entry, d));
  child.on('error', (err) => pushLog(entry, `[启动失败] ${err.message}`));
  child.on('exit', (code, signal) => {
    pushLog(entry, `[已退出] code=${code} ${signal ? 'signal=' + signal : ''}`);
    entry.exited = { code, signal, at: Date.now() };
    entry.child = null;
  });

  return { ok: true, pid: child.pid };
}

function stop(id) {
  const entry = running.get(id);
  if (!entry) return { ok: false, error: '没在运行' };
  if (entry.child) {
    // Windows 上是 cmd.exe 包了一层，直接 kill 只杀 shell，会留下它拉起的子进程；
    // 用 taskkill /T 把整棵进程树收掉，避免工具停在后台占着端口。
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(entry.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* 进程可能已经没了 */ }
    } else {
      try { entry.child.kill('SIGTERM'); } catch { /* 已经没了 */ }
      // 给 2 秒体面退出，不行再来硬的
      const child = entry.child;
      setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* 忽略 */ } }, 2000);
    }
  }
  return { ok: true };
}

function forget(id) {
  stop(id);
  running.delete(id);
  return { ok: true };
}

function status() {
  const out = {};
  for (const [id, entry] of running) {
    out[id] = {
      running: Boolean(entry.child),
      pid: entry.child ? entry.child.pid : null,
      startedAt: entry.startedAt,
      exited: entry.exited || null,
      lines: entry.log.length,
    };
  }
  return out;
}

function registerShelfIpc(ipcMain, { dialog, getWindow }) {
  ipcMain.handle('shelf:pickFolder', async () => {
    const result = await dialog.showOpenDialog(getWindow?.(), {
      title: '选择工具所在的文件夹', properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return probe(result.filePaths[0]);
  });
  ipcMain.handle('shelf:probe', (_e, dir) => probe(dir));
  // 容器列目录时一次性问一批：哪些子文件夹是「能跑的项目」。
  // 每个只做几次 existsSync，比一个个来回 IPC 便宜得多。
  ipcMain.handle('shelf:probeMany', (_e, dirs) => {
    const out = {};
    for (const dir of dirs || []) {
      const info = probe(dir);
      if (info.ok && info.command) out[dir] = { kind: info.kind, command: info.command, notes: info.notes };
    }
    return out;
  });
  ipcMain.handle('shelf:start', (_e, payload) => start(payload || {}));
  ipcMain.handle('shelf:stop', (_e, id) => stop(id));
  ipcMain.handle('shelf:forget', (_e, id) => forget(id));
  ipcMain.handle('shelf:status', () => status());
  ipcMain.handle('shelf:log', (_e, id) => tail(id));
  ipcMain.handle('shelf:depsList', (_e, dir) => depsList(dir));
  ipcMain.handle('shelf:depsInstall', (_e, payload) => installDeps(payload || {}));
}

/** 应用退出时把还开着的子进程收掉，别留孤儿。 */
function stopAllShelfApps() {
  for (const id of [...running.keys()]) stop(id);
}

module.exports = { registerShelfIpc, stopAllShelfApps, probe, depsList, installDeps, normalizePackages, start, stop, status, tail, resolveToolCommand };
