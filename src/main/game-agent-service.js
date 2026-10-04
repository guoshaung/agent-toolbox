/*
 * game-agent-service.js —— 主进程侧的「游戏控制」子进程管理。
 *
 * 职责只有三件事：
 *   1. 找到 python 和 game-agent 目录，把子进程拉起来
 *   2. 把子进程的结构化输出（@@FRAME@@ JSON）和普通日志转发给渲染层
 *   3. 停止时先温和后强硬，尽量让 Python 走完自己的「释放所有按键」收尾
 *
 * 安全边界：
 *   - 这里不做任何键鼠模拟，只负责把用户配置原样传给 Python 端。
 *   - 不读游戏进程内存、不注入、不写注册表 —— 这不是反作弊对抗工具。
 */

'use strict';

let electron;
try { electron = require('electron'); } catch (_) { electron = null; }
const app = electron && typeof electron === 'object' ? electron.app : null;
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EVENT_CHANNEL = 'game-agent:event';
const FRAME_MARK = '@@FRAME@@';
const STOP_GRACE_MS = 4000;

/** 渲染层允许覆盖的配置字段。白名单在这里，多一个字段都不透传。 */
const ALLOWED_KEYS = [
  'source', 'threshold', 'fps', 'preset', 'mode', 'template', 'backend',
  'windowTitle', 'focusTitle', 'focusMode', 'pulseMode', 'minPulseMs', 'maxPulseMs',
  'gain', 'settleMs', 'invertAxis', 'noWindow', 'maxSeconds', 'maxFrames', 'dumpDir',
  // 性能开关：--fast 会打开「跟踪 + 检测降采样 960 + 截图 ROI + jpg 落盘」，
  // 实测 2560x1440 上整帧 49ms → 11.4ms。不放进来的话，界面上的一键启动
  // 就只能跑默认档，等于白白丢掉了最大的一笔性能收益。
  'fast',
];

function resolveGameAgentDir() {
  // 打包后 electron-builder 会把它作为 extraResources 拷到 resources/game-agent；
  // 开发时就在仓库里。写成可降级的形式，让这个模块在纯 Node 单测里也能 require。
  const packaged = path.join(process.resourcesPath || '', 'game-agent');
  if (app && app.isPackaged && fs.existsSync(packaged)) return packaged;
  const base = app && typeof app.getAppPath === 'function' ? app.getAppPath() : path.resolve(__dirname, '..', '..');
  return path.join(base, 'game-agent');
}

function resolvePython(dir) {
  const candidates = [
    path.join(dir, '.venv', 'Scripts', 'python.exe'),
    path.join(dir, '.venv', 'bin', 'python'),
  ];
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) { /* 忽略 */ }
  }
  return 'python'; // 交给 PATH
}

function buildArgs(config) {
  const args = ['main.py', '--events', 'json', '--log-format', 'line'];
  const source = config.source === 'sim' ? 'sim' : 'screen';
  args.push('--source', source);
  if (source === 'sim') args.push('--no-window');

  if (Number.isFinite(config.threshold)) args.push('--threshold', String(Math.round(config.threshold)));
  if (Number.isFinite(config.fps)) args.push('--fps', String(config.fps));
  if (config.preset) args.push('--preset', String(config.preset));
  if (config.mode) args.push('--mode', String(config.mode));
  if (['template', 'feature'].includes(config.mode) && config.template) args.push('--template', String(config.template));
  const testedWindow = config.windowTitle === 'AgentToolboxTestTarget' && config.focusTitle === config.windowTitle && config.focusMode === 'block';
  args.push('--backend', source === 'screen' && !testedWindow ? 'null' : String(config.backend || 'null'));
  if (config.windowTitle) args.push('--window-title', String(config.windowTitle));
  if (config.focusTitle) args.push('--focus-title', String(config.focusTitle));
  if (config.focusMode) args.push('--focus-mode', String(config.focusMode));
  if (config.pulseMode) args.push('--pulse-mode', String(config.pulseMode));
  if (Number.isFinite(config.minPulseMs)) args.push('--min-pulse-ms', String(config.minPulseMs));
  if (Number.isFinite(config.maxPulseMs)) args.push('--max-pulse-ms', String(config.maxPulseMs));
  if (Number.isFinite(config.gain)) args.push('--gain', String(config.gain));
  if (Number.isFinite(config.settleMs)) args.push('--settle-ms', String(config.settleMs));
  if (config.invertAxis) args.push('--invert-axis');
  if (config.fast) args.push('--fast');
  if (config.noWindow) args.push('--no-window');
  if (Number.isFinite(config.maxSeconds) && config.maxSeconds > 0) args.push('--max-seconds', String(config.maxSeconds));
  if (Number.isFinite(config.maxFrames) && config.maxFrames > 0) args.push('--max-frames', String(config.maxFrames));
  if (config.dumpDir) args.push('--dump-dir', String(config.dumpDir));
  return args;
}

class GameAgentService {
  constructor() {
    this.child = null;
    this.status = 'idle'; // idle | starting | running | stopping
    this.lastError = '';
    this.startedAt = 0;
    this.frameCount = 0;
    this.listeners = new Set();
    this.installChild = null;
    this.testWindowChild = null;
  }

  onEvent(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(payload) {
    for (const listener of this.listeners) {
      try { listener(payload); } catch (_) { /* 单个订阅者出错不影响别人 */ }
    }
  }

  send(channel, payload) {
    this.emit({ channel, ...payload });
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  start(rawConfig = {}) {
    if (this.isRunning()) {
      return { ok: false, error: '已经在运行了，先停止再启动。' };
    }
    if (this.installChild) {
      return { ok: false, error: '正在安装依赖，装完再启动。' };
    }

    const config = {};
    for (const key of ALLOWED_KEYS) {
      if (rawConfig[key] !== undefined && rawConfig[key] !== null && rawConfig[key] !== '') {
        config[key] = rawConfig[key];
      }
    }

    const dir = resolveGameAgentDir();
    const mainPy = path.join(dir, 'main.py');
    if (!fs.existsSync(mainPy)) {
      return { ok: false, error: `找不到 ${mainPy}` };
    }
    const python = resolvePython(dir);

    const args = buildArgs(config);
    let child;
    try {
      child = spawn(python, args, {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      return { ok: false, error: `启动失败：${error.message}` };
    }

    this.child = child;
    this.status = 'running';
    this.startedAt = Date.now();
    this.frameCount = 0;
    this.lastError = '';

    const pushLog = (level, message) => {
      this.send('log', { level, message, at: Date.now() });
    };

    pushLog('info', `$ ${path.basename(python)} ${args.join(' ')}`);

    let stdoutBuffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let index;
      while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, index).replace(/\r$/, '');
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        if (!line) continue;
        if (line.startsWith(FRAME_MARK)) {
          try {
            const payload = JSON.parse(line.slice(FRAME_MARK.length));
            if (payload.type === 'frame') this.frameCount += 1;
            this.send('frame', payload);
          } catch (_) { /* 半行 JSON 就丢掉，别让界面卡住 */ }
        } else {
          pushLog('info', line);
        }
      }
    });

    let stderrBuffer = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      let index;
      while ((index = stderrBuffer.indexOf('\n')) >= 0) {
        const line = stderrBuffer.slice(0, index).replace(/\r$/, '');
        stderrBuffer = stderrBuffer.slice(index + 1);
        if (line) pushLog('warn', line);
      }
    });

    child.on('error', (error) => {
      this.lastError = error.message;
      pushLog('error', `子进程错误：${error.message}`);
      this.status = 'idle';
      this.child = null;
      this.send('status', { status: 'idle', error: this.lastError });
    });

    child.on('exit', (code, signal) => {
      const graceful = code === 0 || code === null;
      pushLog(graceful ? 'info' : 'error',
        `子进程退出 code=${code}${signal ? ` signal=${signal}` : ''}`);
      this.status = 'idle';
      this.child = null;
      this.send('status', { status: 'idle', exitCode: code, signal });
    });

    this.send('status', { status: 'running', pid: child.pid, python, args });
    return { ok: true, pid: child.pid, python, args };
  }

  /** 先写 stop 到 stdin 让 Python 自己收尾（松键），超时才强杀。 */
  stop() {
    if (!this.isRunning()) {
      this.status = 'idle';
      return { ok: true, stopped: false };
    }
    const child = this.child;
    this.status = 'stopping';
    this.send('status', { status: 'stopping' });

    let forced = false;
    try {
      if (child.stdin && child.stdin.writable) {
        child.stdin.write('stop\n');
      }
    } catch (_) { /* stdin 可能已经关了 */ }

    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        forced = true;
        try { child.kill(); } catch (_) { /* 已经退了 */ }
      }
    }, STOP_GRACE_MS);

    child.once('exit', () => clearTimeout(timer));
    return { ok: true, forced };
  }

  /** 应用退出时调用。绝不能把一个还在敲键的子进程留在后台。 */
  shutdown() {
    try {
      if (this.installChild && this.installChild.exitCode === null) {
        try { this.installChild.kill(); } catch (_) { /* 已经退了 */ }
        this.installChild = null;
      }
    } catch (_) { /* 尽力而为 */ }
    try { this.closeTestWindow(); } catch (_) { /* 尽力而为 */ }
    try { this.stop(); } catch (_) { /* 尽力而为 */ }
  }

  status_snapshot() {
    return {
      status: this.status,
      running: this.isRunning(),
      frameCount: this.frameCount,
      startedAt: this.startedAt,
      lastError: this.lastError,
      dir: resolveGameAgentDir(),
    };
  }

  /** 给界面用的环境自检：python 在不在、依赖装没装。 */
  async doctor() {
    const dir = resolveGameAgentDir();
    const python = resolvePython(dir);
    const hasVenv = fs.existsSync(path.join(dir, '.venv'));
    const { execFile } = require('child_process');

    const probe = () => new Promise((resolve) => {
      execFile(python, ['-c', 'import mss, cv2, numpy; print("ok")'],
        { cwd: dir, timeout: 20000, windowsHide: true }, (error, stdout) => {
          if (error) resolve({ ok: false, error: error.message });
          else resolve({ ok: String(stdout || '').includes('ok'), output: String(stdout || '').trim() });
        });
    });

    const result = await probe();
    return {
      dir, python, hasVenv,
      depsReady: result.ok,
      detail: result.ok ? '依赖齐全' : `缺依赖：${result.error || result.output || '未知原因'}`,
      hint: result.ok ? '' : `在 ${dir} 下执行：uv sync  （或 pip install -r requirements.txt）`,
    };
  }

  /**
   * 列出当前可见窗口，供界面上的「选择游戏窗口」下拉用。
   * 走的是 Python 端的 --list-windows：只读窗口标题/矩形/进程名，读完就退出。
   */
  listWindows() {
    const dir = resolveGameAgentDir();
    const python = resolvePython(dir);
    const { execFile } = require('child_process');

    return new Promise((resolve) => {
      execFile(python, ['main.py', '--list-windows'], {
        cwd: dir, timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, windows: [], error: (stderr && String(stderr).trim()) || error.message });
          return;
        }
        try {
          const text = String(stdout || '').trim();
          const lastLine = text.slice(text.lastIndexOf('\n') + 1);
          const parsed = JSON.parse(lastLine);
          resolve({ ok: true, windows: Array.isArray(parsed.windows) ? parsed.windows : [] });
        } catch (parseError) {
          resolve({ ok: false, windows: [], error: `看不懂 Python 的输出：${parseError.message}` });
        }
      });
    });
  }

  /**
   * 一键装依赖。优先 uv（和本仓库 container-seed 的约定一致），没有 uv 就退回 pip。
   * 安装过程的每一行都会以 log 事件推给界面，不会静默卡住。
   */
  async installDeps() {
    if (this.installChild) return { ok: false, error: '依赖安装已经在进行中，稍等一下。' };

    const dir = resolveGameAgentDir();
    const uvAvailable = await new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('uv', ['--version'], { timeout: 8000, windowsHide: true }, (error) => resolve(!error));
    });

    const command = uvAvailable ? 'uv' : resolvePython(dir);
    const args = uvAvailable
      ? ['sync', '--no-progress']
      : ['-m', 'pip', 'install', '-r', 'requirements.txt'];

    this.send('log', {
      level: 'info',
      message: uvAvailable ? '检测到 uv，用 uv sync 安装依赖' : '没找到 uv，退回 pip 安装',
      at: Date.now(),
    });

    const child = spawn(command, args, {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    this.installChild = child;
    this.send('install', { state: 'running', via: uvAvailable ? 'uv' : 'pip' });

    const pump = (stream, level) => {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '').trim();
          buffer = buffer.slice(index + 1);
          if (line) this.send('log', { level, message: line, at: Date.now() });
        }
      });
    };
    pump(child.stdout, 'info');
    pump(child.stderr, 'warn');

    child.on('error', (error) => {
      this.installChild = null;
      this.send('log', { level: 'error', message: `安装失败：${error.message}`, at: Date.now() });
      this.send('install', { state: 'failed', error: error.message });
    });

    child.on('exit', (code) => {
      this.installChild = null;
      this.send('log', {
        level: code === 0 ? 'good' : 'error',
        message: code === 0 ? '依赖安装完成' : `依赖安装结束，退出码 ${code}`,
        at: Date.now(),
      });
      this.send('install', { state: code === 0 ? 'done' : 'failed', code });
    });

    return { ok: true, via: uvAvailable ? 'uv' : 'pip' };
  }

  openTestWindow() {
    const dir = resolveGameAgentDir();
    const python = resolvePython(dir);
    const child = spawn(python, ['-u', 'test_target_window.py'], {
      cwd: dir, stdio: 'ignore', windowsHide: false, detached: false,
    });
    child.on('error', (error) => {
      this.send('log', { level: 'error', message: `测试窗口启动失败：${error.message}` });
    });
    this.testWindowChild = child;
    return { ok: true, pid: child.pid };
  }

  closeTestWindow() {
    if (this.testWindowChild && this.testWindowChild.exitCode === null) {
      try { this.testWindowChild.kill(); } catch (_) { /* 忽略 */ }
    }
    this.testWindowChild = null;
    return { ok: true };
  }
}

function registerGameAgentIpc(ipcMain, getSender) {
  const service = new GameAgentService();

  service.onEvent((payload) => {
    try {
      const win = typeof getSender === 'function' ? getSender() : null;
      if (win && !win.isDestroyed()) win.webContents.send('game-agent:event', payload);
    } catch (_) { /* 窗口可能正关着 */ }
  });

  ipcMain.handle('game-agent:status', () => service.status_snapshot());
  ipcMain.handle('game-agent:doctor', () => service.doctor());
  ipcMain.handle('game-agent:list-windows', () => service.listWindows());
  ipcMain.handle('game-agent:install-deps', () => service.installDeps());
  ipcMain.handle('game-agent:start', (_e, config) => service.start(config || {}));
  ipcMain.handle('game-agent:stop', () => service.stop());
  ipcMain.handle('game-agent:open-test-window', () => service.openTestWindow());
  ipcMain.handle('game-agent:close-test-window', () => service.closeTestWindow());

  return service;
}

module.exports = { registerGameAgentIpc, resolveGameAgentDir, EVENT_CHANNEL, GameAgentService, buildArgs };
