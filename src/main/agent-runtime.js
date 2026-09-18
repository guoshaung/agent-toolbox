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

function resolveCommand(command) {
  const names = commandNames(command);
  const candidates = [
    ...names.map((name) => path.join(os.homedir(), 'AppData', 'Roaming', 'npm', name)),
    ...names.map((name) => path.join(os.homedir(), '.local', 'bin', name)),
    ...names.map((name) => path.join('/opt/homebrew/bin', name)),
    ...names.map((name) => path.join('/usr/local/bin', name)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2000 })
      .split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
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

module.exports = { AGENTS, installedAgents, resolveCommand, runAgent, validWorkingDirectory };
