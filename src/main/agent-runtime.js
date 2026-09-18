'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const activeRuns = new Set();

const AGENTS = {
  codex: { label: 'Codex', command: 'codex', args: (prompt, cwd) => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cwd, prompt] },
  claude: { label: 'Claude', command: 'claude', args: (prompt) => ['--print', '--permission-mode', 'plan', '--output-format', 'text', prompt] },
  opencode: { label: 'OpenCode', command: 'opencode', args: (prompt, cwd) => ['run', '--dir', cwd, prompt] },
  dsh: { label: 'DSH', command: 'dsh', args: (prompt) => ['--profile', 'headless', prompt] },
  gemini: { label: 'Gemini', command: 'gemini', args: (prompt) => ['--prompt', prompt, '--approval-mode', 'plan', '--output-format', 'text'] },
};

function commandNames(command) {
  // PowerShell -File and native executables preserve argv boundaries. Avoid cmd.exe
  // wrappers here because a remote prompt may contain cmd metacharacters.
  return process.platform === 'win32'
    ? [`${command}.ps1`, `${command}.exe`]
    : [command];
}

/**
 * 这个文件能不能直接 spawn 起来。
 *
 * existsSync 为真不代表能执行：装了又卸载干净的 npm 包常留下一个没有 shebang
 * 的文本桩（实测 /usr/local/bin/claude 就是这样一个，spawn 直接 ENOEXEC），
 * 看着在、点下去就崩。所以这里要么是二进制，要么得有 shebang。
 */
function isRunnable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    return false;
  }
  if (process.platform === 'win32') return true;
  // 认魔数：要么是 #! 脚本，要么是真的可执行文件。其余一律当坏桩。
  // 没有 shebang 的纯文本脚本，从 shell 里跑得起来（shell 会兜底用 sh），
  // 但 posix_spawn 起不来 —— 而我们走的正是 spawn。
  try {
    const head = Buffer.alloc(4);
    const fd = fs.openSync(file, 'r');
    const read = fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (read < 4) return false;
    if (head[0] === 0x23 && head[1] === 0x21) return true;                       // #!
    if (head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF') return true; // Linux
    if (head[0] === 0x4d && head[1] === 0x5a) return true;                       // MZ
    const magic = head.readUInt32BE(0);
    // Mach-O：32/64 位、大小端，以及 universal 的 0xcafebabe
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic);
  } catch {
    return false;
  }
}

function resolveCommand(command) {
  // 先问 PATH。写死的那几个目录是给「从访达启动、PATH 很秃」的情况兜底的，
  // 不该反过来盖住 PATH 里那个真正能用的 —— 实测本机 PATH 里的 claude 是好的，
  // 而写死目录里的 /usr/local/bin/claude 是个坏桩，先查写死目录就永远用坏的那个。
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const found = execFileSync(finder, [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const file of found) {
      if (isRunnable(file)) return file;
    }
  } catch { /* PATH 里没有，往下走兜底 */ }

  const names = commandNames(command);
  const candidates = [
    ...names.map((name) => path.join(os.homedir(), 'AppData', 'Roaming', 'npm', name)),
    ...names.map((name) => path.join(os.homedir(), '.local', 'bin', name)),
    ...names.map((name) => path.join('/opt/homebrew/bin', name)),
    ...names.map((name) => path.join('/usr/local/bin', name)),
  ];
  for (const candidate of candidates) {
    if (isRunnable(candidate)) return candidate;
  }
  return '';
}

function installedAgents() {
  return Object.entries(AGENTS).map(([id, agent]) => ({
    id,
    label: agent.label,
    installed: Boolean(resolveCommand(agent.command)),
  }));
}

function validWorkingDirectory(value, fallback = os.homedir()) {
  const requested = String(value || '').trim();
  try {
    if (requested && fs.statSync(requested).isDirectory()) return requested;
  } catch { /* use fallback */ }
  return fallback;
}

function runAgent(id, prompt, options = {}) {
  const agent = AGENTS[id];
  if (!agent) return Promise.reject(new Error('不支持这个 AI Agent。'));
  const text = String(prompt || '').trim().slice(0, 20000);
  if (!text) return Promise.reject(new Error('命令内容不能为空。'));
  const command = resolveCommand(agent.command);
  if (!command) return Promise.reject(new Error(`${agent.label} 尚未安装或不在 PATH 中。`));
  if (activeRuns.has(id)) return Promise.reject(new Error(`${agent.label} 已有任务正在执行，请完成后再发送。`));
  const cwd = validWorkingDirectory(options.cwd);
  const args = agent.args(text, cwd);
  activeRuns.add(id);
  return new Promise((resolve, reject) => {
    let executable = command;
    let commandArgs = args;
    if (process.platform === 'win32' && /\.ps1$/i.test(command)) {
      executable = 'powershell.exe';
      commandArgs = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args];
    }
    execFile(executable, commandArgs, {
      cwd,
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    }, (error, stdout, stderr) => {
      activeRuns.delete(id);
      const output = String(stdout || stderr || '').trim();
      if (error) {
        const detail = output.slice(-2000) || error.message;
        reject(new Error(`${agent.label} 执行失败：${detail}`));
        return;
      }
      resolve({ agent: id, label: agent.label, text: output.slice(-20000) || '任务已完成，但没有返回文字。' });
    });
  });
}

module.exports = { AGENTS, installedAgents, isRunnable, resolveCommand, runAgent, validWorkingDirectory };
