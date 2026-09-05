'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const MAX_CODE = 80 * 1024;
const MAX_OUTPUT = 24 * 1024;
const DEFAULT_TIMEOUT = 12000;
const ENV_ROOT = path.join(os.homedir(), '.agent-toolbox', 'practice-envs');

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
  uv: { label: 'uv 环境管理', engine: 'uv', extension: '.sh', packages: [] },
  langchain: { label: 'LangChain', engine: 'python3', extension: '.py', packages: ['langchain-core'] },
  pytorch: { label: 'PyTorch', engine: 'python3', extension: '.py', packages: ['torch'] },
  transformers: { label: 'Transformers', engine: 'python3', extension: '.py', packages: ['transformers'] },
  fastapi: { label: 'FastAPI', engine: 'python3', extension: '.py', packages: ['fastapi'] },
  matplotlib: { label: 'Matplotlib', engine: 'python3', extension: '.py', packages: ['matplotlib'] },
  pandas: { label: 'Pandas', engine: 'python3', extension: '.py', packages: ['pandas'] },
};

const PYTHON_TRACKS = new Set(['python', 'requests', 'langchain', 'pytorch', 'transformers', 'fastapi', 'matplotlib', 'pandas']);
const SHELL_TRACKS = new Set(['linux', 'uv']);

function commandExists(command) {
  return Boolean(resolveCommand(command));
}

function resolveCommand(command) {
  if (command.includes(path.sep)) return fs.existsSync(command) ? command : '';
  const candidates = [
    command,
    path.join(os.homedir(), '.local', 'bin', command),
    path.join(os.homedir(), '.cargo', 'bin', command),
    path.join('/opt/homebrew/bin', command),
    path.join('/usr/local/bin', command),
  ];
  for (const candidate of candidates.slice(1)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* try the next known install location */ }
  }
  try {
    return execFileSync('which', [command], { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return '';
  }
}

function venvPython(trackId) {
  const binary = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  return path.join(ENV_ROOT, trackId, '.venv', binary);
}

function pythonInterpreter(trackId) {
  const isolated = venvPython(trackId);
  if (fs.existsSync(isolated)) return isolated;
  return resolveCommand('python3') || null;
}

function pythonPackageExists(modules, interpreter = 'python3') {
  if (!interpreter || !commandExists(interpreter)) return false;
  const names = Array.isArray(modules) ? modules : [modules];
  try {
    execFileSync(interpreter, ['-c', `import importlib.util; raise SystemExit(0 if any(importlib.util.find_spec(${JSON.stringify(name)}) for name in ${JSON.stringify(names)}) else 1)`], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function environment() {
  return {
    python: Boolean(pythonInterpreter('python') || commandExists('python3')),
    bash: commandExists('bash'),
    sqlite3: commandExists('sqlite3'),
    mysql: commandExists('mysql'),
    octave: commandExists('octave-cli') || commandExists('octave'),
    matlab: commandExists('matlab'),
    uv: commandExists('uv'),
    langchain: pythonPackageExists(['langchain', 'langchain_core'], pythonInterpreter('langchain')),
    torch: pythonPackageExists('torch', pythonInterpreter('pytorch')),
    transformers: pythonPackageExists('transformers', pythonInterpreter('transformers')),
    fastapi: pythonPackageExists('fastapi', pythonInterpreter('fastapi')),
    matplotlib: pythonPackageExists('matplotlib', pythonInterpreter('matplotlib')),
    pandas: pythonPackageExists('pandas', pythonInterpreter('pandas')),
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
  if (SHELL_TRACKS.has(trackId) && DANGEROUS_SHELL.some((pattern) => pattern.test(code))) {
    return '这条命令包含工具箱拦截的高风险操作，请改成无破坏性的练习命令。';
  }
  return '';
}

function unavailable(trackId, env) {
  if (trackId === 'matlab' && !env.matlab && !env.octave) return '当前设备没有安装 MATLAB 或 GNU Octave。安装任意一个后再运行此轨道。';
  if (trackId === 'sql' && !env.sqlite3) return '当前设备没有安装 sqlite3，无法运行 SQL 练习。';
  if (trackId === 'linux' && !env.bash) return '当前设备没有找到 bash。';
  if (trackId === 'uv' && !env.uv) return '当前设备没有找到 uv。请先在终端执行 uv 的官方安装命令，再重启工具。';
  if (PYTHON_TRACKS.has(trackId) && !pythonInterpreter(trackId)) return '当前设备没有找到 python3，也没有可用的 uv 虚拟环境。';
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
    }, Math.min(Math.max(Number(timeout) || DEFAULT_TIMEOUT, 500), 300000));
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
    if (PYTHON_TRACKS.has(trackId)) {
      const interpreter = pythonInterpreter(trackId);
      return { ...(await runProcess(interpreter, ['-u', '-'], code, cwd, options.timeout)), engine: trackId === 'python' ? 'python3' : interpreter === 'python3' ? 'python3' : `${track.label} · uv .venv` };
    }
    if (SHELL_TRACKS.has(trackId)) {
      const shell = resolveCommand('bash');
      const uvPath = trackId === 'uv' ? resolveCommand('uv') : '';
      const pathPrefix = uvPath ? `export PATH=${JSON.stringify(path.dirname(uvPath))}:$PATH\n` : '';
      return { ...(await runProcess(shell, ['-lc', `set -o pipefail\n${pathPrefix}source /dev/stdin`], code, cwd, options.timeout)), engine: trackId === 'uv' ? 'uv' : 'bash' };
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

async function setup(trackId) {
  const track = TRACKS[trackId];
  if (!track) return { ok: false, error: '未知实践领域。' };
  if (!PYTHON_TRACKS.has(trackId)) return { ok: false, error: '这个领域使用临时沙箱，不需要安装 Python 依赖。' };
  const uv = resolveCommand('uv');
  if (!uv) return { ok: false, error: '没有找到 uv。请先在终端执行：curl -LsSf https://astral.sh/uv/install.sh | sh，然后重启工具。' };

  const envDir = path.join(ENV_ROOT, trackId);
  const envPath = path.join(envDir, '.venv');
  fs.mkdirSync(envDir, { recursive: true });
  const setupTimeout = 240000;
  if (!fs.existsSync(venvPython(trackId))) {
    const created = await runProcess(uv, ['venv', envPath, '--python', '3.12'], '', envDir, setupTimeout);
    if (!created.ok) return { ok: false, error: created.stderr || created.stdout || 'uv 创建虚拟环境失败。' };
  }
  if (track.packages?.length) {
    const installed = await runProcess(uv, ['pip', 'install', '--python', venvPython(trackId), ...track.packages], '', envDir, setupTimeout);
    if (!installed.ok) return { ok: false, error: installed.stderr || installed.stdout || `${track.label} 依赖安装失败。` };
  }
  return { ok: true, message: `${track.label} 的 uv 虚拟环境已准备好`, environment: environment() };
}

module.exports = { TRACKS, environment, run, setup, validateCode };
