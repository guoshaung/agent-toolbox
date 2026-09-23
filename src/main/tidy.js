'use strict';

/**
 * 收纳：给「新建文件夹随便放」的人用的。
 *
 *  - scan()：把主目录、桌面、下载三处顶层散落的东西列出来，认出它是什么
 *    （代码项目 / 图片堆 / 文档 / 安装包 / 压缩包 / 数字命名的垃圾夹 …）
 *  - suggest()：先按规则给每一项一个「该去哪」；认不出来的再问一次模型
 *  - apply()：真的搬，同名不覆盖，每次搬完写一份撤销记录
 *  - recent()：「我刚建的那个文件夹放哪了」—— 最近几天在主目录下新建的东西
 *  - overview()：项目速览，给一个目录，认出技术栈 / 怎么跑 / 从哪读起
 *
 * 只动这三处的顶层，从不碰系统目录和隐藏文件。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
// 这些是系统 / 常见工具自己的目录，永远不当成「散落的东西」
const SKIP_NAMES = new Set([
  'Applications', 'Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public', 'Sites',
  'node_modules', 'go', 'miniconda3', 'anaconda3', 'miniforge3', 'opt', 'bin', 'snap', 'Projects', 'Code', '代码',
  '收纳', 'Agent工具箱', 'Parallels', 'VirtualBox VMs', 'OneDrive', 'Dropbox', 'Google Drive', 'iCloud Drive (Archive)',
]);
const SKIP_PREFIX = ['actions-runner', '.'];

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|avif)$/i;
const VIDEO = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;
const AUDIO = /\.(mp3|m4a|wav|flac|aac|ogg)$/i;
const DOC = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|rtf|pages|numbers|key|epub)$/i;
const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
const INSTALLER = /\.(dmg|pkg|apk|exe|msi|deb|rpm|appimage|ipa)$/i;
const CODE = /\.(js|ts|jsx|tsx|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|zsh|sql|ipynb|vue|svelte|lua|dart|scala|m|mm)$/i;
const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'CMakeLists.txt', 'Makefile', '.git', 'Gemfile', 'composer.json', 'setup.py', 'Package.swift', 'pubspec.yaml', 'environment.yml', 'main.tex'];

function statSafe(p) { try { return fs.statSync(p); } catch { return null; } }
function listSafe(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }

/** 一个文件夹是什么：看一层 + 少量二层，别递归太深 */
function classifyDir(full) {
  const entries = listSafe(full).filter((e) => !e.name.startsWith('.') || e.name === '.git');
  const names = entries.map((e) => e.name);
  const markers = PROJECT_MARKERS.filter((m) => names.includes(m));
  if (markers.length) return { kind: 'project', markers, count: entries.length };
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  // 里面装着好几个代码仓库的文件夹（比如 ~/Downloads/maybe 里放着正在开发的项目）：
  // 它本身就是一个「项目集」，搬走会把里面正在用的路径全弄断，建议原地不动
  const repos = dirs.filter((d) => listSafe(path.join(full, d)).some((e) => PROJECT_MARKERS.includes(e.name))).length;
  if (repos >= 1 && repos >= dirs.length * 0.5) return { kind: 'workspace', count: entries.length, repos };
  const tally = (re) => files.filter((f) => re.test(f)).length;
  const img = tally(IMAGE); const doc = tally(DOC); const code = tally(CODE); const vid = tally(VIDEO);
  if (!files.length && !dirs.length) return { kind: 'empty', count: 0 };
  if (code >= 2 && code >= files.length * 0.5) return { kind: 'project', markers: ['散装代码'], count: entries.length };
  if (img && img >= files.length * 0.6) return { kind: 'images', count: files.length };
  if (vid && vid >= files.length * 0.5) return { kind: 'videos', count: files.length };
  if (doc && doc >= files.length * 0.6) return { kind: 'docs', count: files.length };
  return { kind: 'mixed', count: entries.length, sample: [...dirs.slice(0, 3), ...files.slice(0, 4)] };
}

function classifyFile(name) {
  if (IMAGE.test(name)) return 'image';
  if (VIDEO.test(name)) return 'video';
  if (AUDIO.test(name)) return 'audio';
  if (DOC.test(name)) return 'doc';
  if (ARCHIVE.test(name)) return 'archive';
  if (INSTALLER.test(name)) return 'installer';
  if (CODE.test(name)) return 'code';
  return 'other';
}

/** 数字串 / 日期串 / 「未命名文件夹」这类，一看就是随手建的 */
function looksCareless(name) {
  return /^\d{4,}$/.test(name) || /^(未命名|新建|untitled|new folder|新しい)/i.test(name) || /^(临时|temp|tmp|test|测试|aaa+|asd|qwe|123|111|xxx)\d*$/i.test(name);
}

function describeItem(dirPath, entry, now) {
  const full = path.join(dirPath, entry.name);
  const st = statSafe(full);
  if (!st) return null;
  const base = { name: entry.name, path: full, where: path.basename(dirPath) || '~', mtime: st.mtimeMs, birth: st.birthtimeMs || st.ctimeMs, ageDays: Math.max(0, (now - (st.birthtimeMs || st.mtimeMs)) / 86400000), careless: looksCareless(entry.name) };
  if (entry.isDirectory()) return { ...base, isDir: true, ...classifyDir(full) };
  return { ...base, isDir: false, kind: classifyFile(entry.name), size: st.size };
}

/** 三处顶层散落的东西 */
function scan() {
  const now = Date.now();
  const roots = [HOME, path.join(HOME, 'Desktop'), path.join(HOME, 'Downloads')];
  const items = [];
  for (const root of roots) {
    for (const entry of listSafe(root)) {
      if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name) || SKIP_PREFIX.some((p) => entry.name.startsWith(p))) continue;
      if (entry.isSymbolicLink()) continue;
      if (root === HOME && !entry.isDirectory()) { /* 主目录顶层的散文件也算 */ }
      const item = describeItem(root, entry, now);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, items, roots: roots.map((r) => r.replace(HOME, '~')) };
}

/** 目的地：都放在 ~/收纳 下面，一眼能找到；代码单独一个目录 */
function destinations(settings = {}) {
  const codeDir = settings.codeDir || path.join(HOME, 'Projects');
  const base = path.join(HOME, '收纳');
  return {
    project: codeDir,
    images: path.join(base, '图片'), image: path.join(base, '图片'),
    videos: path.join(base, '视频'), video: path.join(base, '视频'), audio: path.join(base, '音频'),
    docs: path.join(base, '文档'), doc: path.join(base, '文档'),
    archive: path.join(base, '压缩包'), installer: path.join(base, '安装包'),
    code: path.join(base, '零散代码'), mixed: path.join(base, '杂项'), other: path.join(base, '杂项'), empty: null,
  };
}

/** 规则给每一项一个去处；给不了的标 unsure，让模型补 */
function suggest(items, settings = {}) {
  const dest = destinations(settings);
  return items.map((it) => {
    const kind = it.kind;
    if (kind === 'empty') return { ...it, action: 'delete', to: null, reason: '空文件夹' };
    if (kind === 'project') return { ...it, action: 'move', to: dest.project, reason: `代码项目（${(it.markers || []).slice(0, 2).join('、')}）` };
    if (kind === 'workspace') return { ...it, action: 'keep', to: null, reason: `里面有 ${it.repos} 个代码仓库，别动` };
    if (dest[kind] && kind !== 'mixed' && kind !== 'other') return { ...it, action: 'move', to: dest[kind], reason: labelOf(kind) };
    return { ...it, action: 'unsure', to: dest.mixed, reason: it.isDir ? '内容杂，看不出来' : '认不出这是什么' };
  });
}

function labelOf(kind) {
  return { workspace: '项目集', images: '图片', image: '图片', videos: '视频', video: '视频', audio: '音频', docs: '文档', doc: '文档', archive: '压缩包', installer: '安装包', code: '零散代码', mixed: '杂项', other: '杂项', project: '代码项目', empty: '空' }[kind] || kind;
}

/** 让模型给 unsure 的那几项起个像样的归属：只发名字和几个文件名，不发内容 */
async function refine(items, ask, settings = {}) {
  const unsure = items.filter((it) => it.action === 'unsure');
  if (!unsure.length || typeof ask !== 'function') return items;
  const dest = destinations(settings);
  const lines = unsure.map((it, i) => `${i + 1}. ${it.isDir ? '文件夹' : '文件'}「${it.name}」${it.sample ? `，里面有：${it.sample.join(', ')}` : ''}`).join('\n');
  const prompt = `下面是用户电脑上散落的东西。给每一项挑一个去处，只能从这些里选：project(代码项目) images docs archive installer videos audio mixed(杂项) delete(明显是垃圾/临时)。
再给一个不超过 10 个字的理由。只输出 JSON 数组：[{"i":1,"to":"docs","reason":"..."}]\n\n${lines}`;
  try {
    const r = await ask([{ role: 'system', content: '你只输出 JSON。' }, { role: 'user', content: prompt }]);
    const text = String(r?.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    for (const a of arr) {
      const it = unsure[Number(a.i) - 1];
      if (!it) continue;
      if (a.to === 'delete') { it.action = 'delete'; it.to = null; }
      else if (dest[a.to]) { it.action = 'move'; it.to = dest[a.to]; }
      it.reason = `AI：${String(a.reason || '').slice(0, 20)}`;
    }
  } catch { /* 模型没答好就保持 unsure，用户自己决定 */ }
  return items;
}

function uniqueTarget(dir, name) {
  const ext = path.extname(name); const stem = name.slice(0, name.length - ext.length);
  let target = path.join(dir, name);
  for (let k = 2; fs.existsSync(target); k += 1) target = path.join(dir, `${stem} (${k})${ext}`);
  return target;
}

function undoFile(userData) { return path.join(userData, 'tidy-undo.json'); }

/** 真的搬。moves: [{path, to, action}] */
async function apply(userData, moves, { trash } = {}) {
  const done = []; const errors = [];
  for (const m of Array.isArray(moves) ? moves : []) {
    const src = path.resolve(String(m.path || ''));
    // 只允许搬三处顶层的东西，别被喂个 /System 进来
    const parent = path.dirname(src);
    if (![HOME, path.join(HOME, 'Desktop'), path.join(HOME, 'Downloads')].includes(parent)) { errors.push(`${src}：不在允许范围`); continue; }
    if (!fs.existsSync(src)) { errors.push(`${src}：已经不在了`); continue; }
    try {
      if (m.action === 'delete') {
        if (trash) await trash(src); else fs.rmSync(src, { recursive: true, force: true });
        done.push({ from: src, to: null, action: 'delete' });
        continue;
      }
      const dir = path.resolve(String(m.to || ''));
      if (!dir.startsWith(HOME)) { errors.push(`${src}：目的地不在主目录里`); continue; }
      fs.mkdirSync(dir, { recursive: true });
      const target = uniqueTarget(dir, path.basename(src));
      fs.renameSync(src, target);
      done.push({ from: src, to: target, action: 'move' });
    } catch (error) { errors.push(`${path.basename(src)}：${error.message}`); }
  }
  if (done.length) {
    const log = { at: Date.now(), moves: done.filter((d) => d.action === 'move') };
    try { fs.writeFileSync(undoFile(userData), JSON.stringify(log)); } catch { /* 写不了撤销记录不算失败 */ }
  }
  return { ok: errors.length === 0, done, errors };
}

/** 把上一次搬的东西搬回去 */
function undo(userData) {
  let log;
  try { log = JSON.parse(fs.readFileSync(undoFile(userData), 'utf8')); } catch { return { ok: false, error: '没有可以撤销的记录。' }; }
  const restored = []; const errors = [];
  for (const m of log.moves || []) {
    try {
      if (!fs.existsSync(m.to)) { errors.push(`${path.basename(m.to)}：已经不在原处`); continue; }
      fs.mkdirSync(path.dirname(m.from), { recursive: true });
      fs.renameSync(m.to, uniqueTarget(path.dirname(m.from), path.basename(m.from)));
      restored.push(m.from);
    } catch (error) { errors.push(`${path.basename(m.to)}：${error.message}`); }
  }
  try { fs.unlinkSync(undoFile(userData)); } catch { /* ok */ }
  return { ok: errors.length === 0, restored, errors, at: log.at };
}

function lastUndo(userData) {
  try { const log = JSON.parse(fs.readFileSync(undoFile(userData), 'utf8')); return { at: log.at, count: (log.moves || []).length }; } catch { return null; }
}

/** 最近 days 天在主目录下新建的文件夹 / 文件（深度有限，跳过大目录） */
function recent({ days = 3, maxDepth = 4, limit = 60 } = {}) {
  const since = Date.now() - days * 86400000;
  const out = [];
  const skip = new Set(['Library', 'node_modules', '.git', '.Trash', 'Applications', '.cache', '.npm', '.nvm', 'Movies', 'Music', '.vscode', '.cursor', 'dist', 'build', '.gradle', '.android', 'venv', '.venv', '__pycache__', 'Pictures', 'Photos Library.photoslibrary']);
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= limit * 3) return;
    for (const e of listSafe(dir)) {
      if (e.name.startsWith('.') || skip.has(e.name) || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const st = statSafe(full);
      if (!st) continue;
      const born = st.birthtimeMs || st.ctimeMs;
      if (born >= since) out.push({ name: e.name, path: full, isDir: e.isDirectory(), born, where: path.dirname(full).replace(HOME, '~') });
      // 代码仓库里每天都在生文件，不往里钻 —— 要找的是「随手建的」，不是提交记录
      if (e.isDirectory() && !fs.existsSync(path.join(full, '.git'))) walk(full, depth + 1);
    }
  };
  walk(HOME, 0);
  out.sort((a, b) => b.born - a.born);
  // 同一棵新建的树只报最上面那层
  const kept = [];
  for (const it of out) { if (!kept.some((k) => k.isDir && it.path.startsWith(k.path + path.sep))) kept.push(it); if (kept.length >= limit) break; }
  return { ok: true, items: kept, days };
}

// ---------- 项目速览 ----------

function readHead(file, n = 60) {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(0, n).join('\n'); } catch { return ''; }
}

function tree(dir, depth = 2, prefix = '', out = [], budget = { n: 0 }) {
  if (depth < 0 || budget.n > 120) return out;
  const entries = listSafe(dir).filter((e) => !e.name.startsWith('.') && !['node_modules', 'dist', 'build', '__pycache__', 'venv', '.venv', 'target', 'out'].includes(e.name));
  for (const e of entries.slice(0, 40)) {
    budget.n += 1;
    out.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
    if (e.isDirectory()) tree(path.join(dir, e.name), depth - 1, prefix + '  ', out, budget);
  }
  return out;
}

/** 收集一个项目的「事实」：技术栈线索、脚本、README 开头、目录树。给模型讲解用 */
function projectFacts(root) {
  const abs = path.resolve(String(root || ''));
  if (!statSafe(abs)?.isDirectory()) return { ok: false, error: '这不是一个文件夹。' };
  const names = listSafe(abs).map((e) => e.name);
  const facts = { root: abs, name: path.basename(abs), markers: PROJECT_MARKERS.filter((m) => names.includes(m)), tree: tree(abs, 2).join('\n'), readme: '', manifest: '' };
  const readme = names.find((n) => /^readme(\.md|\.txt|\.rst)?$/i.test(n));
  if (readme) facts.readme = readHead(path.join(abs, readme), 80);
  for (const m of ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'pubspec.yaml', 'environment.yml']) {
    if (names.includes(m)) { facts.manifest += `--- ${m} ---\n${readHead(path.join(abs, m), 60)}\n`; }
  }
  // 入口文件候选
  facts.entries = names.filter((n) => /^(main|index|app|server|cli|run|manage|__main__|setup)\.(js|ts|py|go|rs|java|kt|swift|sh)$/i.test(n) || n === 'src' || n === 'app' || n === 'cmd');
  return { ok: true, ...facts };
}

async function overview(root, ask) {
  const f = projectFacts(root);
  if (!f.ok) return f;
  if (typeof ask !== 'function') return { ok: false, error: '没有配好模型。' };
  const prompt = `帮一个懒得自己翻代码的人快速看懂这个项目。只根据下面的事实，不要编。用 Markdown，五节，每节两到五句话：
## 这是什么
## 怎么跑起来（给具体命令）
## 从哪个文件开始读（按顺序列 3-5 个文件，每个一句话说为什么）
## 核心模块和它们怎么配合
## 建议的学习顺序（今天先看什么、明天看什么）

项目名：${f.name}
根目录：${f.root}
识别到的标记：${f.markers.join(', ') || '无'}
可能的入口：${(f.entries || []).join(', ') || '无'}

目录树（两层）：
${f.tree}

${f.manifest ? `清单文件：\n${f.manifest}` : ''}
${f.readme ? `README 开头：\n${f.readme}` : ''}`;
  const r = await ask([{ role: 'system', content: '你是个耐心的师兄，讲人话，不说废话。' }, { role: 'user', content: prompt }]);
  if (!r?.ok) return { ok: false, error: r?.error || '模型没返回。' };
  return { ok: true, markdown: String(r.text || ''), facts: { name: f.name, root: f.root, markers: f.markers, entries: f.entries } };
}

/**
 * 把讲解里「学习顺序」那一节变成任务清单：每个列表项一条。
 * 找不到那一节就退而求其次，拿「从哪个文件开始读」的列表。纯函数，方便测。
 */
function studyPlanToTasks(markdown) {
  const lines = String(markdown || '').split('\n');
  const pick = (titleRe) => {
    const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && titleRe.test(l));
    if (start < 0) return [];
    const out = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^#{1,4}\s/.test(lines[i])) break;
      const m = lines[i].match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
      if (m) out.push(m[1].replace(/\*\*/g, '').replace(/`/g, '').trim().slice(0, 120));
    }
    return out;
  };
  const items = pick(/学习顺序|学习计划|先看|顺序/) .length ? pick(/学习顺序|学习计划|先看|顺序/) : pick(/从哪|开始读|入口/);
  return items.filter(Boolean);
}

// ---------- 这周在写的项目 ----------

const { execFile } = require('node:child_process');
const gitLog = (dir, days) => new Promise((resolve) => {
  execFile('git', ['-C', dir, 'log', `--since=${days} days ago`, '--format=%ct%x09%s', '--no-merges'], { timeout: 4000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out)));
});

/** git log 输出 → { count, last: { at, message } }。纯函数，方便测 */
function parseGitLog(out) {
  const rows = String(out || '').split('\n').filter(Boolean).map((l) => { const [ts, ...rest] = l.split('\t'); return { at: Number(ts) * 1000, message: rest.join('\t').trim() }; }).filter((r) => r.message);
  if (!rows.length) return null;
  rows.sort((a, b) => b.at - a.at);
  return { count: rows.length, last: rows[0] };
}

/** 从散落项里把代码仓库都挑出来（项目本身 + 项目集里的每个仓库），最多 limit 个 */
function projectRoots(items, limit = 40) {
  const roots = [];
  for (const it of items) {
    if (it.kind === 'project') roots.push(it.path);
    else if (it.kind === 'workspace') for (const e of listSafe(it.path)) if (e.isDirectory() && listSafe(path.join(it.path, e.name)).some((x) => x.name === '.git')) roots.push(path.join(it.path, e.name));
    if (roots.length >= limit) break;
  }
  return roots.slice(0, limit);
}

/** 主目录 / 桌面 / 下载 下两层内所有 git 仓库（跳过系统目录和依赖目录） */
function findRepos({ maxDepth = 2, limit = 150 } = {}) {
  const out = [];
  const skip = new Set(['Library', 'node_modules', '.Trash', 'Applications', '.cache', '.npm', '.nvm', 'Movies', 'Music', 'Pictures', 'venv', '.venv', 'dist', 'build', 'target']);
  const walk = (dir, depth) => {
    if (out.length >= limit) return;
    for (const e of listSafe(dir)) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (fs.existsSync(path.join(full, '.git'))) { out.push(full); continue; }   // 仓库里不再往下找
      if (depth < maxDepth) walk(full, depth + 1);
    }
  };
  for (const root of [HOME, path.join(HOME, 'Desktop'), path.join(HOME, 'Downloads')]) walk(root, 0);
  return [...new Set(out)];
}

/** 这几天有提交的仓库，按最近一次提交排 */
async function activity({ days = 7, limit = 8 } = {}) {
  const roots = findRepos();
  const results = await Promise.all(roots.map(async (dir) => {
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    const parsed = parseGitLog(await gitLog(dir, days));
    return parsed ? { name: path.basename(dir), path: dir, ...parsed } : null;
  }));
  const active = results.filter(Boolean).sort((a, b) => b.last.at - a.last.at).slice(0, limit);
  return { ok: true, days, scanned: roots.length, items: active };
}

// ---------- 带我读：按讲解里的顺序一个文件一个文件讲 ----------

/** 从讲解的「从哪个文件开始读」一节里抠出文件路径（相对项目根），只留真实存在的。纯函数 + fs */
function readingList(markdown, root) {
  const lines = String(markdown || '').split('\n');
  const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && /(从哪|开始读|入口|先看)/.test(l));
  const scope = start < 0 ? lines : lines.slice(start + 1, lines.findIndex((l, i) => i > start && /^#{1,4}\s/.test(l)) > 0 ? lines.findIndex((l, i) => i > start && /^#{1,4}\s/.test(l)) : undefined);
  const out = [];
  for (const line of scope) {
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) continue;
    const tokens = line.match(/[`]?([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,6})[`]?/g) || [];
    for (const raw of tokens) {
      const rel = raw.replace(/`/g, '').replace(/^\.\//, '');
      if (!rel.includes('.') || /^\d+\.\d+$/.test(rel)) continue;
      const abs = path.join(root, rel);
      if (fs.existsSync(abs) && statSafe(abs)?.isFile() && !out.some((o) => o.rel === rel)) { out.push({ rel, abs, why: line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*/g, '').slice(0, 120) }); break; }
    }
  }
  return out.slice(0, 8);
}

/** 讲一个文件：在项目里干什么、关键函数、和谁相连、读的时候注意什么 */
async function explainFile(root, rel, ask, { priorMarkdown = '' } = {}) {
  const abs = path.resolve(String(root || ''), String(rel || ''));
  if (!abs.startsWith(path.resolve(root))) return { ok: false, error: '不在项目里。' };
  const st = statSafe(abs);
  if (!st?.isFile()) return { ok: false, error: '文件不存在。' };
  if (st.size > 400 * 1024) return { ok: false, error: '这个文件太大（>400KB），先挑别的读。' };
  const head = readHead(abs, 260);
  if (typeof ask !== 'function') return { ok: false, error: '没有配好模型。' };
  const prompt = `项目「${path.basename(root)}」。${priorMarkdown ? `之前对整个项目的讲解：\n${String(priorMarkdown).slice(0, 1500)}\n\n` : ''}现在带一个初学者读文件 ${rel}（下面是前 260 行）。用 Markdown，四节，每节两到四句：
## 这个文件在项目里干什么
## 从上往下怎么读（按顺序点出 3-5 个关键函数 / 段落，各一句话）
## 它和哪些文件相连（import 了谁、被谁用）
## 读的时候容易卡在哪

\`\`\`
${head}
\`\`\``;
  const r = await ask([{ role: 'system', content: '你是个耐心的师兄，讲人话，不说废话，不要复述代码。' }, { role: 'user', content: prompt }]);
  if (!r?.ok) return { ok: false, error: r?.error || '模型没返回。' };
  return { ok: true, rel, markdown: String(r.text || ''), lines: head.split('\n').length };
}

/** 帮懒得写文档的人起一份 README 草稿：只根据事实，缺的地方留 TODO */
async function draftReadme(root, ask) {
  const f = projectFacts(root);
  if (!f.ok) return f;
  if (typeof ask !== 'function') return { ok: false, error: '没有配好模型。' };
  const prompt = `给项目「${f.name}」写一份 README.md 草稿（中文，Markdown）。只根据下面的事实，不知道的写「TODO：…」别编。结构：
# 项目名 —— 一句话
## 这是什么（2-4 句）
## 怎么跑起来（具体命令；没有清单文件就写 TODO）
## 目录结构（挑重要的 5-10 项，每项一句话）
## 常见问题（2-3 条，没有就 TODO）

识别到的标记：${f.markers.join(', ') || '无'}
可能的入口：${(f.entries || []).join(', ') || '无'}
目录树：
${f.tree}
${f.manifest ? `清单文件：\n${f.manifest}` : ''}
${f.readme ? `已有 README 开头（保留其中有用的信息）：\n${f.readme}` : ''}`;
  const r = await ask([{ role: 'system', content: '你写技术文档，短句，不吹。' }, { role: 'user', content: prompt }]);
  if (!r?.ok) return { ok: false, error: r?.error || '模型没返回。' };
  const markdown = String(r.text || '').replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
  const target = fs.existsSync(path.join(f.root, 'README.md')) ? path.join(f.root, 'README.draft.md') : path.join(f.root, 'README.md');
  return { ok: true, markdown, target, existed: target.endsWith('README.draft.md') };
}

/** 把草稿写进项目（只写 README.md / README.draft.md，别的名字不写） */
function saveReadme(root, target, markdown) {
  const abs = path.resolve(String(target || ''));
  const base = path.basename(abs);
  if (!abs.startsWith(path.resolve(root)) || !['README.md', 'README.draft.md'].includes(base)) return { ok: false, error: '只允许写 README.md 或 README.draft.md。' };
  if (base === 'README.md' && fs.existsSync(abs)) return { ok: false, error: 'README.md 已经存在，不覆盖。' };
  fs.writeFileSync(abs, String(markdown || ''));
  return { ok: true, path: abs };
}

/** 接着问这个项目：把项目事实和上次的讲解一起带上，模型只根据这些回答 */
async function askProject(root, question, priorMarkdown, ask) {
  const f = projectFacts(root);
  if (!f.ok) return f;
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: '问题是空的。' };
  if (typeof ask !== 'function') return { ok: false, error: '没有配好模型。' };
  const prompt = `这是项目「${f.name}」（${f.root}）。

目录树：
${f.tree}
${f.manifest ? `\n清单文件：\n${f.manifest}` : ''}${f.readme ? `\nREADME 开头：\n${f.readme}` : ''}
${priorMarkdown ? `\n之前给用户的讲解：\n${String(priorMarkdown).slice(0, 3000)}` : ''}

用户现在问：${q}

只根据上面的事实回答，不知道就说「得打开某某文件看」并指出是哪个文件。用 Markdown，简短。`;
  const r = await ask([{ role: 'system', content: '你是个耐心的师兄，讲人话，不说废话。' }, { role: 'user', content: prompt }]);
  if (!r?.ok) return { ok: false, error: r?.error || '模型没返回。' };
  return { ok: true, markdown: String(r.text || '') };
}

module.exports = { scan, suggest, refine, apply, undo, lastUndo, recent, projectFacts, overview, askProject, studyPlanToTasks, activity, parseGitLog, projectRoots, findRepos, readingList, explainFile, draftReadme, saveReadme, destinations, classifyDir, classifyFile, looksCareless, labelOf, HOME };
