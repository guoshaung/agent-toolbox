'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const MAX_CODE = 80 * 1024;
const MAX_OUTPUT = 24 * 1024;
const DEFAULT_TIMEOUT = 12000;

const DANGEROUS_SHELL = [
  /(^|[;&|])\s*(sudo|rm\s+-rf|mkfs|shutdown|reboot|halt)\b/i,
  /:\(\)\s*\{/,
  /(^|\s)(curl|wget)\b[^\n]*(https?:\/\/[^\n]+\|\s*(sh|bash|zsh))/i,
  />\s*\/dev\/(disk|rdisk|mem)/i,
];

const TRACKS = {
  python: { label: 'Python', engine: 'python3', extension: '.py' },
  linux: { label: 'Linux 命令', engine: 'bash', extension: '.sh' },
  sql: { label: 'MySQL / SQL', engine: 'sqlite3', extension: '.sql' },
  requests: { label: 'Requests 爬虫', engine: 'python3', extension: '.py' },
  matlab: { label: 'MATLAB / Octave', engine: 'matlab', extension: '.m' },
};

function commandExists(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function environment() {
  return {
    python: commandExists('python3'),
    bash: commandExists('bash'),
    sqlite3: commandExists('sqlite3'),
    mysql: commandExists('mysql'),
    octave: commandExists('octave-cli') || commandExists('octave'),
    matlab: commandExists('matlab'),
  };
}

function trimOutput(value) {
  const text = String(value || '');
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n…输出超过 ${MAX_OUTPUT} 字节，已截断`;
}

function validateCode(trackId, code) {
  const track = TRACKS[trackId];
  if (!track) return '未知实践领域。';
  if (!String(code || '').trim()) return '请先写一点代码。';
  if (String(code).length > MAX_CODE) return `代码超过 ${MAX_CODE} 字节。`;
  if (trackId === 'linux' && DANGEROUS_SHELL.some((pattern) => pattern.test(code))) {
    return '这条命令包含工具箱拦截的高风险操作，请改成无破坏性的练习命令。';
  }
  return '';
}

function unavailable(trackId, env) {
  if (trackId === 'matlab' && !env.matlab && !env.octave) return '当前设备没有安装 MATLAB 或 GNU Octave。安装任意一个后再运行此轨道。';
  if (trackId === 'sql' && !env.sqlite3) return '当前设备没有安装 sqlite3，无法运行 SQL 练习。';
  if (trackId === 'linux' && !env.bash) return '当前设备没有找到 bash。';
  if ((trackId === 'python' || trackId === 'requests') && !env.python) return '当前设备没有找到 python3。';
  return '';
}

function runProcess(command, args, input, cwd, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const collect = (target) => (chunk) => {
      const next = target === 'stdout' ? stdout + chunk : stderr + chunk;
      if (target === 'stdout') stdout = next.slice(-MAX_OUTPUT * 2);
      else stderr = next.slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') child.kill();
        else process.kill(-child.pid, 'SIGKILL');
      } catch { child.kill(); }
    }, Math.min(Math.max(Number(timeout) || DEFAULT_TIMEOUT, 500), 30000));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, signal: null, timedOut, stdout: trimOutput(stdout), stderr: error.message, duration: Date.now() - started });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        signal,
        timedOut,
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        duration: Date.now() - started,
      });
    });
    child.stdin.end(input);
  });
}

async function run(trackId, code, options = {}) {
  const track = TRACKS[trackId];
  const validation = validateCode(trackId, code);
  if (validation) return { ok: false, error: validation };
  const env = environment();
  const missing = unavailable(trackId, env);
  if (missing) return { ok: false, error: missing, environment: env };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-practice-'));
  try {
    if (trackId === 'python' || trackId === 'requests') {
      return { ...(await runProcess('python3', ['-u', '-'], code, cwd, options.timeout)), engine: 'python3' };
    }
    if (trackId === 'linux') {
      return { ...(await runProcess('bash', ['-lc', 'set -o pipefail\nsource /dev/stdin'], code, cwd, options.timeout)), engine: 'bash' };
    }
    if (trackId === 'sql') {
      const database = path.join(cwd, 'practice.sqlite');
      return { ...(await runProcess('sqlite3', ['-header', '-column', database], code, cwd, options.timeout)), engine: 'sqlite3', dialect: 'MySQL-compatible SQL sandbox' };
    }
    const script = path.join(cwd, `main${track.extension}`);
    fs.writeFileSync(script, code, 'utf8');
    if (env.matlab) return { ...(await runProcess('matlab', ['-batch', `run(${JSON.stringify(script)})`], '', cwd, options.timeout)), engine: 'matlab' };
    return { ...(await runProcess(commandExists('octave-cli') ? 'octave-cli' : 'octave', ['--quiet', script], '', cwd, options.timeout)), engine: 'octave' };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

module.exports = { TRACKS, environment, run, validateCode };
