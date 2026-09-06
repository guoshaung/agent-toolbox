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
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const MAX_LOG_LINES = 400;
const running = new Map();   // id -> { child, log: string[], startedAt, command, cwd }

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
 */
function probe(dir) {
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
    } else if (has('pyproject.toml') || has('requirements.txt')) {
      out.command = `uv run ${pyEntry}`;
      out.notes.push('没找到 .venv，用 uv run 会自动建环境装依赖（需要本机装了 uv）');
    } else {
      out.command = `python3 ${pyEntry}`;
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

function start({ id, cwd, command }) {
  if (!id || !command) return { ok: false, error: '缺少启动命令' };
  if (running.has(id)) return { ok: false, error: '这个工具已经在运行了' };
  if (cwd && !fs.existsSync(cwd)) return { ok: false, error: `工作目录不存在：${cwd}` };

  // 走登录 shell：这样 PATH 里才有 uv / pyenv / nvm 装的东西，
  // 不然从 GUI 启动的 Electron 拿到的是一个很干净的 PATH，常见的「命令找不到」都出在这。
  const child = spawn(process.env.SHELL || '/bin/bash', ['-lc', command], {
    cwd: cwd || process.env.HOME,
    env: { ...process.env },
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
    try { entry.child.kill('SIGTERM'); } catch { /* 已经没了 */ }
    // 给 2 秒体面退出，不行再来硬的
    const child = entry.child;
    setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* 忽略 */ } }, 2000);
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
}

/** 应用退出时把还开着的子进程收掉，别留孤儿。 */
function stopAllShelfApps() {
  for (const id of [...running.keys()]) stop(id);
}

module.exports = { registerShelfIpc, stopAllShelfApps, probe };
