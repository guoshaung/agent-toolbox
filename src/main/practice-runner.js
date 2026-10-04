'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const MAX_CODE = 80 * 1024;
const MAX_OUTPUT = 24 * 1024;
const DEFAULT_TIMEOUT = 12000;
const ENV_ROOT = path.join(os.homedir(), '.agent-toolbox', 'practice-envs');
const SHARED_ENV_ID = 'learning';

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
  langchain: { label: 'LangChain', engine: 'python3', extension: '.py', packages: ['langchain'] },
  pytorch: { label: 'PyTorch', engine: 'python3', extension: '.py', packages: ['torch'] },
  transformers: { label: 'Transformers', engine: 'python3', extension: '.py', packages: ['transformers'] },
  fastapi: { label: 'FastAPI', engine: 'python3', extension: '.py', packages: ['fastapi'] },
  matplotlib: { label: 'Matplotlib', engine: 'python3', extension: '.py', packages: ['matplotlib'] },
  pandas: { label: 'Pandas', engine: 'python3', extension: '.py', packages: ['pandas'] },
  // 下面这批是后加的实践轨道。新增轨道必须同时在这里登记，
  // 否则渲染层能选到、点运行却报「未知实践领域」。
  regex: { label: '正则表达式', engine: 'python3', extension: '.py' },
  numpy: { label: 'NumPy', engine: 'python3', extension: '.py', packages: ['numpy'] },
  asyncio: { label: 'asyncio 异步', engine: 'python3', extension: '.py' },
  datafile: { label: '文件与 JSON/CSV', engine: 'python3', extension: '.py' },
  pytest: { label: 'pytest 测试', engine: 'python3', extension: '.py', packages: ['pytest'] },
  git: { label: 'Git 常用命令', engine: 'bash', extension: '.sh' },
  textproc: { label: 'Shell 文本处理', engine: 'bash', extension: '.sh' },
};

const PYTHON_TRACKS = new Set(['python', 'requests', 'langchain', 'pytorch', 'transformers', 'fastapi', 'matplotlib', 'pandas',
  'regex', 'numpy', 'asyncio', 'datafile', 'pytest']);
const SHELL_TRACKS = new Set(['linux', 'uv', 'git', 'textproc']);

function commandExists(command) {
  return Boolean(resolveCommand(command));
}

function resolveCommand(command) {
  if (command.includes(path.sep)) return fs.existsSync(command) ? command : '';
  // Windows 上命令几乎都带扩展名（uv.exe / npm.cmd），~/.local/bin 这类
  // 用户级目录也不会进 GUI 进程的 PATH，先把这两层补齐再交给 where.exe。
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const knownDirs = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.cargo', 'bin'),
    path.join('/opt/homebrew/bin'),
    path.join('/usr/local/bin'),
  ];
  for (const dir of knownDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* try the next known install location */ }
    }
  }
  // System32 里的 bash.exe 是 WSL 的，行为和 Git Bash 完全不同，宁缺毋滥。
  if (process.platform === 'win32' && command === 'bash') {
    for (const candidate of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return '';
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

function venvPython(trackId) {
  const binary = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  return path.join(ENV_ROOT, SHARED_ENV_ID, '.venv', binary);
}

function legacyVenvPython(trackId) {
  const binary = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  return path.join(ENV_ROOT, trackId, '.venv', binary);
}

function pythonInterpreter(trackId) {
  const isolated = venvPython(trackId);
  if (fs.existsSync(isolated)) return isolated;
  const legacy = legacyVenvPython(trackId);
  if (fs.existsSync(legacy)) return legacy;
  // Windows 只有 python.exe（python3 常常是商店占位 stub），反过来 mac/linux 只有 python3。
  return resolveCommand(process.platform === 'win32' ? 'python' : 'python3') || null;
}

function pythonPackageExists(modules, interpreter = 'python3') {
  if (!interpreter || !commandExists(interpreter)) return false;
  const names = Array.isArray(modules) ? modules : [modules];
  try {
    const script = `import importlib.util; names = ${JSON.stringify(names)}; raise SystemExit(0 if any(importlib.util.find_spec(name) for name in names) else 1)`;
    execFileSync(interpreter, ['-c', script], { stdio: 'ignore', timeout: 3000 });
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
    learningEnv: fs.existsSync(venvPython('learning')),
    langchain: pythonPackageExists(['langchain', 'langchain_core'], pythonInterpreter('langchain')),
    torch: pythonPackageExists('torch', pythonInterpreter('pytorch')),
    transformers: pythonPackageExists('transformers', pythonInterpreter('transformers')),
    fastapi: pythonPackageExists('fastapi', pythonInterpreter('fastapi')),
    matplotlib: pythonPackageExists('matplotlib', pythonInterpreter('matplotlib')),
    pandas: pythonPackageExists('pandas', pythonInterpreter('pandas')),
    numpy: pythonPackageExists('numpy', pythonInterpreter('numpy')),
    pytest: pythonPackageExists('pytest', pythonInterpreter('pytest')),
    git: commandExists('git'),
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

function normalizePackages(value) {
  const packages = String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (!packages.length) return { packages: [], error: '请输入至少一个第三方包名，例如 numpy 或 pandas。' };
  if (packages.length > 20) return { packages: [], error: '一次最多安装 20 个第三方包。' };
  const packagePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:(?:==|~=|!=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)?$/;
  const invalid = packages.find((item) => !packagePattern.test(item));
  if (invalid) return { packages: [], error: `包名格式不安全：${invalid}` };
  return { packages };
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
  const prelude = String(options.prelude || '');
  if (prelude.length + String(code || '').length > MAX_CODE) return { ok: false, error: `当前单元格和前置单元格合计超过 ${MAX_CODE} 字节。` };
  const env = environment();
  const missing = unavailable(trackId, env);
  if (missing) return { ok: false, error: missing, environment: env };
  // 学 GitHub 仓库时在仓库目录里跑，import 才找得到包；只认家目录下真实存在的目录
  const repoCwd = String(options.cwd || '');
  const useRepo = repoCwd && repoCwd.startsWith(os.homedir()) && fs.existsSync(repoCwd) && fs.statSync(repoCwd).isDirectory();
  const cwd = useRepo ? repoCwd : fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-practice-'));
  try {
    if (PYTHON_TRACKS.has(trackId)) {
      const interpreter = pythonInterpreter(trackId);
      const source = pythonHarness(prelude, String(code || ''));
      const ran = await runProcess(interpreter, ['-u', '-'], source, cwd, options.timeout);
      const { text, displays } = await collectDisplays(ran.stdout);
      return { ...ran, stdout: text, displays, engine: trackId === 'python' ? 'python3' : interpreter === 'python3' ? 'python3' : `${track.label} · uv .venv` };
    }
    if (SHELL_TRACKS.has(trackId)) {
      const shell = resolveCommand('bash');
      const uvPath = trackId === 'uv' ? resolveCommand('uv') : '';
      const pathPrefix = uvPath ? `export PATH=${JSON.stringify(path.dirname(uvPath))}:$PATH\n` : '';
      const source = prelude.trim() ? `${prelude}\n\n${code}` : code;
      // Git Bash on Windows does not expose /dev/stdin for source; -s reads the pipe directly.
      return { ...(await runProcess(shell, ['-l', '-s'], `set -o pipefail\n${pathPrefix}${source}`, cwd, options.timeout)), engine: trackId === 'uv' ? 'uv' : 'bash' };
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
    if (!useRepo) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * 像 Jupyter 一样：最后一行是个表达式就把它的值「显示」出来 ——
 * graphviz 的图、matplotlib 的图、带 _repr_svg_ / _repr_png_ 的对象都变成图片，其他打 repr。
 * 图片用标记行塞进 stdout，主进程再抠出来。文件名保持 <string>，报错行号的解析不用改。
 */
function pythonHarness(prelude, code) {
  return [
    'import ast, sys, base64, contextlib, io',
    '_g = globals()',
    `_prelude = ${JSON.stringify(prelude)}`,
    `_code = ${JSON.stringify(code)}`,
    'if _prelude.strip():',
    '    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):',
    '        exec(compile(_prelude, "<string>", "exec"), _g)',
    'def _toolbox_display(v):',
    '    if v is None: return',
    '    def emit(kind, data): print("\\n<<toolbox-display:%s:%s>>\\n" % (kind, base64.b64encode(data if isinstance(data, bytes) else str(data).encode("utf-8")).decode("ascii")))',
    '    src = getattr(v, "source", None)',
    '    if isinstance(src, str) and type(v).__name__ in ("Digraph", "Graph", "Source"): return emit("dot", src)',
    '    f = getattr(v, "_repr_svg_", None)',
    '    if callable(f):',
    '        try: return emit("svg", f())',
    '        except Exception: pass',
    '    f = getattr(v, "_repr_png_", None)',
    '    if callable(f):',
    '        try: return emit("png", f())',
    '        except Exception: pass',
    '    if hasattr(v, "savefig"):',
    '        buf = io.BytesIO(); v.savefig(buf, format="png", bbox_inches="tight"); return emit("png", buf.getvalue())',
    '    print(repr(v))',
    '_tree = ast.parse(_code)',
    'if _tree.body and isinstance(_tree.body[-1], ast.Expr):',
    '    exec(compile(ast.Module(body=_tree.body[:-1], type_ignores=[]), "<string>", "exec"), _g)',
    '    _toolbox_display(eval(compile(ast.Expression(body=_tree.body[-1].value), "<string>", "eval"), _g))',
    'else:',
    '    exec(compile(_tree, "<string>", "exec"), _g)',
    // matplotlib：没显式 show 也把当前的图交出来
    'try:',
    '    import matplotlib.pyplot as _plt',
    '    for _n in _plt.get_fignums(): _toolbox_display(_plt.figure(_n))',
    'except Exception: pass',
    '',
  ].join('\n');
}

let vizInstance = null;
async function renderDot(source) {
  if (!vizInstance) { const { instance } = require('@viz-js/viz'); vizInstance = await instance(); }
  return vizInstance.renderString(source, { format: 'svg' });
}

/** 把 stdout 里的显示标记抠出来：dot 在这里用 viz.js 画成 svg，不需要装 Graphviz 本体 */
async function collectDisplays(stdout) {
  const displays = [];
  const re = /\n?<<toolbox-display:(dot|svg|png):([A-Za-z0-9+/=]*)>>\n?/g;
  const parts = [];
  let last = 0; let m;
  const text = String(stdout || '');
  while ((m = re.exec(text))) {
    parts.push(text.slice(last, m.index)); last = m.index + m[0].length;
    const raw = Buffer.from(m[2], 'base64');
    try {
      if (m[1] === 'dot') displays.push({ kind: 'svg', data: await renderDot(raw.toString('utf8')) });
      else if (m[1] === 'svg') displays.push({ kind: 'svg', data: raw.toString('utf8') });
      else displays.push({ kind: 'png', data: raw.toString('base64') });
    } catch (err) { parts.push(`[图片没画出来：${err.message}]\n`); }
  }
  parts.push(text.slice(last));
  return { text: parts.join(''), displays };
}

/** 学 GitHub 仓库：克隆后扫一遍代码文件（浅层、小文件），README 一起带回 */
const REPO_CODE_EXT = /\.(py|sh|bash|sql|js|mjs|ts|go|rs|c|h|cpp|cc|java|rb|m|ipynb)$/i;
const REPO_SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.idea', '.vscode', 'target', 'assets', 'docs', 'data', 'images', 'img']);
function scanRepo(root) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 4 || files.length > 300) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || REPO_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (REPO_CODE_EXT.test(e.name)) {
        try { const st = fs.statSync(full); const limit = /\.ipynb$/i.test(e.name) ? 3 * 1024 * 1024 : 80 * 1024; if (st.size <= limit) files.push({ rel: path.relative(root, full).split(path.sep).join('/'), size: st.size }); } catch { /* 跳过 */ }
      }
    }
  };
  walk(root, 0);
  let readme = '';
  for (const name of ['README.md', 'readme.md', 'README.rst', 'README']) { const f = path.join(root, name); if (fs.existsSync(f)) { try { readme = fs.readFileSync(f, 'utf8').slice(0, 40000); } catch { /* 没 README */ } break; } }
  return { files, readme };
}

async function setup(trackId) {
  const track = TRACKS[trackId];
  if (!track) return { ok: false, error: '未知实践领域。' };
  if (!PYTHON_TRACKS.has(trackId)) return { ok: false, error: '这个领域使用临时沙箱，不需要安装 Python 依赖。' };
  const uv = resolveCommand('uv');
  if (!uv) return { ok: false, error: '没有找到 uv。请先在终端执行：curl -LsSf https://astral.sh/uv/install.sh | sh，然后重启工具。' };

  const envDir = path.join(ENV_ROOT, SHARED_ENV_ID);
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
  return { ok: true, message: `共享学习环境已准备好（${track.label} 依赖已就绪）`, environment: environment() };
}

async function install(trackId, packageInput) {
  const track = TRACKS[trackId];
  if (!track) return { ok: false, error: '未知实践领域。' };
  if (!PYTHON_TRACKS.has(trackId)) return { ok: false, error: '只有 Python 和框架轨道支持安装第三方 Python 包。' };
  const normalized = normalizePackages(packageInput);
  if (normalized.error) return { ok: false, error: normalized.error };
  const prepared = await setup(trackId);
  if (!prepared.ok) return prepared;
  const uv = resolveCommand('uv');
  const envDir = path.join(ENV_ROOT, SHARED_ENV_ID);
  const installed = await runProcess(uv, ['pip', 'install', '--python', venvPython(trackId), ...normalized.packages], '', envDir, 240000);
  if (!installed.ok) return { ok: false, error: installed.stderr || installed.stdout || '第三方包安装失败。' };
  return { ok: true, message: `已安装到共享学习环境：${normalized.packages.join(', ')}`, environment: environment() };
}

async function terminal(command) {
  const input = String(command || '').trim();
  if (!input) return { ok: false, error: '请输入一条终端命令。' };
  if (input.length > MAX_CODE) return { ok: false, error: `终端命令超过 ${MAX_CODE} 字节。` };
  if (DANGEROUS_SHELL.some((pattern) => pattern.test(input))) {
    return { ok: false, error: '这条命令包含工具箱拦截的高风险操作，请改成无破坏性的学习命令。' };
  }
  const shell = resolveCommand(process.platform === 'win32' ? 'cmd.exe' : 'bash');
  if (!shell) return { ok: false, error: '当前设备没有可用的终端解释器。' };
  const envDir = path.join(ENV_ROOT, SHARED_ENV_ID);
  fs.mkdirSync(envDir, { recursive: true });
  const uvPath = resolveCommand('uv');
  const envBin = path.dirname(venvPython('learning'));
  const pathPrefix = uvPath && process.platform !== 'win32'
    ? `export PATH=${JSON.stringify(envBin)}:${JSON.stringify(path.dirname(uvPath))}:$PATH\n`
    : '';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', input]
    : ['-lc', `set -o pipefail\n${pathPrefix}source /dev/stdin`];
  const result = await runProcess(shell, args, process.platform === 'win32' ? '' : input, envDir, 120000);
  return { ...result, engine: 'learning-terminal', cwd: envDir, environment: environment() };
}

module.exports = { TRACKS, environment, install, run, setup, terminal, validateCode, scanRepo };
