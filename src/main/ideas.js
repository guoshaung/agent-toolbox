'use strict';

/**
 * 想法 / 提问的落地能力：
 *  - 想法本身存在 config（渲染层管），这里只负责「提问」那一步：
 *    把问题 + 相关想法写成一个 .md 文件（放进你选的 Obsidian 仓库），
 *    然后能用 Obsidian 打开，或在终端里开一个编码 agent 的对话（codex / claude / …）围绕这个文件问。
 *
 * 只往你选定的仓库目录里写，slug 化文件名，路径不出目录。终端走 macOS 的 Terminal.app / 别的平台各自的终端。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SUBDIR = '工具箱提问';
const CLIS = ['codex', 'claude', 'opencode', 'kimi', 'gemini'];

function resolveCli(name) {
  if (!CLIS.includes(name)) return '';
  const dirs = [
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.23.1', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin',
    path.join(os.homedir(), '.bun', 'bin'),
  ];
  for (const d of dirs) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  // nvm 目录里版本号可能变，扫一遍
  try {
    const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(root)) { const p = path.join(root, v, 'bin', name); if (fs.existsSync(p)) return p; }
  } catch { /* 没装 nvm */ }
  return '';
}

function availableClis() { return CLIS.filter((c) => resolveCli(c)); }

function slugify(text) {
  const s = String(text || '').trim().replace(/[\uFF1F\uFF1A\uFF0F\uFF3C\uFF0A\uFF1C\uFF1E\uFF5C]/g, '').replace(/\s+/g, '-').replace(/[\\/:*?"<>|#^[\]]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (s || '问题').slice(0, 48);
}

/** AppleScript 双引号字符串里的转义 */
function asStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
/** POSIX 单引号里的转义 */
function shSingle(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

class IdeasService {
  constructor({ store, shell, dialog, getWindow, execFileAsync }) {
    Object.assign(this, { store, shell, dialog, getWindow, execFileAsync });
  }

  vault() { return this.store.get('ideas.vault', '') || ''; }

  status() {
    const v = this.vault();
    return { vault: v, vaultExists: Boolean(v && fs.existsSync(v)), clis: availableClis(), defaultCli: this.store.get('ideas.cli', '') || availableClis()[0] || '' };
  }

  async pickVault() {
    const win = this.getWindow?.();
    const r = await this.dialog.showOpenDialog(win || undefined, { title: '选一个文件夹放提问的 Markdown（选你的 Obsidian 仓库）', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths?.[0]) return { ok: false, canceled: true };
    this.store.set('ideas.vault', r.filePaths[0]);
    return { ok: true, ...this.status() };
  }

  /** 写一个提问 md，返回绝对路径 */
  writeQuestion({ title, question, context = '', tags = [] }) {
    let vault = this.vault();
    if (!vault || !fs.existsSync(vault)) { vault = path.join(os.homedir(), SUBDIR); this.store.set('ideas.vault', vault); }
    const dir = path.join(vault, SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date();
    const iso = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
    const base = `${iso.slice(0, 10)}-${slugify(title || question)}`;
    let file = path.join(dir, `${base}.md`); let n = 1;
    while (fs.existsSync(file)) file = path.join(dir, `${base}-${n++}.md`);
    // 目录内校验
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) return { ok: false, error: '路径越界' };
    const tagLine = (tags || []).filter(Boolean).map((t) => String(t).replace(/[\s,]/g, '')).join(', ');
    const md = [
      '---', `created: ${iso}`, `tags: [提问${tagLine ? `, ${tagLine}` : ''}]`, '---', '',
      `# ${String(title || question || '问题').trim().slice(0, 80)}`, '',
      '## 问题', '', String(question || '').trim() || '（在这里写下你的问题）', '',
      context.trim() ? `## 相关想法 / 上下文\n\n${context.trim()}\n` : '',
      '## 回答', '', '> 终端里问的 agent 会把回答写在这下面；你自己也能补充。', '', '',
    ].join('\n');
    fs.writeFileSync(file, md, 'utf8');
    return { ok: true, path: file, rel: path.relative(vault, file), vault };
  }

  openPath(p) {
    const target = String(p || '');
    if (!target || !fs.existsSync(target)) return { ok: false, error: '文件不在了' };
    this.shell.openPath(target);
    return { ok: true };
  }

  /** 用 Obsidian 打开这个文件（obsidian:// 需要仓库已在 Obsidian 里注册；失败就默认程序打开） */
  openInObsidian(p) {
    const target = String(p || '');
    if (!target || !fs.existsSync(target)) return { ok: false, error: '文件不在了' };
    const vault = this.vault();
    try {
      if (vault && target.startsWith(vault)) {
        const fileParam = encodeURIComponent(path.relative(vault, target).split(path.sep).join('/'));
        const vaultName = path.basename(vault);
        this.shell.openExternal(`obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${fileParam}`);
        return { ok: true, via: 'uri' };
      }
    } catch { /* 退回默认程序 */ }
    this.shell.openPath(target);
    return { ok: true, via: 'open' };
  }

  /** 在系统终端里开一个编码 agent 的对话，围绕这个 md 文件 */
  async openTerminalChat({ file, cli }) {
    const target = String(file || '');
    if (!target || !fs.existsSync(target)) return { ok: false, error: '文件不在了' };
    const name = cli && CLIS.includes(cli) ? cli : (this.store.get('ideas.cli', '') || availableClis()[0]);
    const bin = resolveCli(name);
    if (!bin) return { ok: false, error: `没找到 ${name || '编码 agent'}，装了 codex / claude / opencode 之一再试` };
    this.store.set('ideas.cli', name);
    const dir = path.dirname(target);
    const base = path.basename(target);
    const seed = `请读一下当前目录里的 ${base}，回答里面「## 问题」的内容，把回答写进这个文件「## 回答」的下面，然后我们继续聊。`;
    const shellCmd = `cd ${shSingle(dir)} && ${shSingle(bin)} ${shSingle(seed)}`;
    try {
      if (process.platform === 'darwin') {
        await this.execFileAsync('/usr/bin/osascript', [
          '-e', `tell application "Terminal" to do script "${asStr(shellCmd)}"`,
          '-e', 'tell application "Terminal" to activate',
        ], { timeout: 8000 });
      } else if (process.platform === 'win32') {
        await this.execFileAsync('cmd.exe', ['/c', 'start', 'cmd', '/k', `cd /d "${dir}" && "${bin}" "${seed}"`], { timeout: 8000 });
      } else {
        // Linux：尽量用常见终端
        const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].map((t) => resolveCliRaw(t)).find(Boolean);
        if (!term) return { ok: false, error: '没找到可用的终端程序' };
        await this.execFileAsync(term, ['-e', `bash -lc ${shSingle(shellCmd)}`], { timeout: 8000 });
      }
      return { ok: true, cli: name };
    } catch (err) { return { ok: false, error: `开终端失败：${err.message}` }; }
  }
}

function resolveCliRaw(name) {
  for (const d of ['/usr/bin', '/bin', '/usr/local/bin']) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  return '';
}

module.exports = { IdeasService, slugify, availableClis, resolveCli };
