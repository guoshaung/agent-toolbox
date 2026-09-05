'use strict';
/**
 * 代码记事本的主进程侧：读取 Understand-Anything 生成的知识图谱，
 * 并按图谱里的 filePath + lineRange 回读真实源码。
 *
 * 图谱格式来自 Understand-Anything 插件（.ua/knowledge-graph.json）：
 *   nodes: { id, type, name, filePath, lineRange, summary, tags, complexity }
 *   edges: { source, target, type, direction, weight }   type 里的 calls 就是调用关系
 *
 * 安全边界：readSource 只允许读图谱所属项目根目录以内的文件，
 * 且做了 realpath 校验，防止 ../ 或软链跳出去。
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const GRAPH_DIRS = ['.ua', '.understand-anything'];
const GRAPH_FILE = 'knowledge-graph.json';
const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', 'Applications', '.Trash',
  'venv', '.venv', 'dist', 'build', '__pycache__', '.next', 'target']);
const MAX_GRAPH_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

function graphPathIn(projectRoot) {
  for (const dir of GRAPH_DIRS) {
    const candidate = path.join(projectRoot, dir, GRAPH_FILE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 从几个常见根目录做有界广度搜索，找已经跑过 /understand 的项目 */
async function findGraphs({ maxDepth = 4, limit = 40 } = {}) {
  const home = os.homedir();
  const roots = [home, path.join(home, 'Downloads'), path.join(home, 'Documents'),
    path.join(home, 'Desktop'), path.join(home, 'Projects'), path.join(home, 'code')]
    .filter((dir, index, arr) => arr.indexOf(dir) === index && fs.existsSync(dir));

  const found = [];
  const seen = new Set();
  let queue = roots.map((dir) => ({ dir, depth: 0 }));

  while (queue.length && found.length < limit) {
    const next = [];
    for (const { dir, depth } of queue) {
      if (found.length >= limit) break;
      const real = path.resolve(dir);
      if (seen.has(real)) continue;
      seen.add(real);

      const graph = graphPathIn(real);
      if (graph) {
        found.push(real);
        continue;   // 找到项目就不再往下钻了
      }
      if (depth >= maxDepth) continue;

      let entries;
      try {
        entries = await fsp.readdir(real, { withFileTypes: true });
      } catch { continue; }        // 没权限的目录直接跳过，不是错误
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && !GRAPH_DIRS.includes(entry.name)) continue;
        next.push({ dir: path.join(real, entry.name), depth: depth + 1 });
      }
    }
    queue = next;
  }

  return found.map((root) => describeGraph(root)).filter(Boolean);
}

function describeGraph(projectRoot) {
  const graphPath = graphPathIn(projectRoot);
  if (!graphPath) return null;
  try {
    const stat = fs.statSync(graphPath);
    return {
      root: projectRoot,
      name: path.basename(projectRoot),
      graphPath,
      size: stat.size,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

/** 只留下记事本用得上的字段，整份图谱几百 KB，没必要全塞进渲染进程 */
function slimGraph(raw, projectRoot) {
  const nodes = (raw.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    name: n.name,
    filePath: n.filePath || '',
    lineRange: Array.isArray(n.lineRange) ? n.lineRange : null,
    summary: n.summary || '',
    tags: Array.isArray(n.tags) ? n.tags : [],
    complexity: n.complexity || '',
  }));
  const edges = (raw.edges || []).map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
    description: e.description || '',
    weight: typeof e.weight === 'number' ? e.weight : 0,
  }));
  return {
    root: projectRoot,
    project: raw.project || path.basename(projectRoot),
    version: raw.version || '',
    nodes,
    edges,
    layers: raw.layers || [],
  };
}

async function loadGraph(projectRoot) {
  const graphPath = graphPathIn(projectRoot);
  if (!graphPath) {
    return { ok: false, error: `${projectRoot} 下没有找到 .ua/knowledge-graph.json —— 先在那个项目里跑一次 /understand。` };
  }
  try {
    const stat = await fsp.stat(graphPath);
    if (stat.size > MAX_GRAPH_BYTES) {
      return { ok: false, error: `图谱文件太大（${(stat.size / 1024 / 1024).toFixed(1)}MB）。` };
    }
    const raw = JSON.parse(await fsp.readFile(graphPath, 'utf8'));
    return { ok: true, graph: slimGraph(raw, projectRoot) };
  } catch (err) {
    return { ok: false, error: `读取图谱失败：${err.message}` };
  }
}

/**
 * 按 filePath + lineRange 回读源码。
 * 这是「从粘贴的片段跳到真实调用处」那一步的底层能力。
 */
async function readSource({ root, filePath, lineRange, context = 3 }) {
  if (!root || !filePath) return { ok: false, error: '缺少项目根目录或文件路径。' };

  // 路径必须落在项目根目录以内，realpath 之后再比一次，防软链绕过
  const target = path.resolve(root, filePath);
  let realRoot;
  let realTarget;
  try {
    realRoot = await fsp.realpath(root);
    realTarget = await fsp.realpath(target);
  } catch {
    return { ok: false, error: `文件不存在：${filePath}（图谱可能过期了，重新跑一次 /understand）` };
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    return { ok: false, error: '拒绝读取项目目录以外的文件。' };
  }

  try {
    const stat = await fsp.stat(realTarget);
    if (stat.size > MAX_SOURCE_BYTES) return { ok: false, error: '文件太大，不读了。' };

    const text = await fsp.readFile(realTarget, 'utf8');
    const lines = text.split('\n');
    const [rawStart, rawEnd] = Array.isArray(lineRange) && lineRange.length === 2
      ? lineRange
      : [1, Math.min(lines.length, 200)];

    const start = Math.max(1, Number(rawStart) - context);
    const end = Math.min(lines.length, Number(rawEnd) + context);
    return {
      ok: true,
      filePath,
      startLine: start,
      endLine: end,
      focusRange: [Number(rawStart), Number(rawEnd)],
      totalLines: lines.length,
      code: lines.slice(start - 1, end).join('\n'),
    };
  } catch (err) {
    return { ok: false, error: `读取失败：${err.message}` };
  }
}

/**
 * 轻量打开项目：只列**一层**目录，展开哪层才读哪层；文件内容点开才读。
 * 不做全量索引、不建缓存、不监听文件变化 —— 打开一个几万文件的仓库也只是
 * 读了根目录那几十个 entry。
 */
const TREE_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
  '.venv', 'venv', 'target', '.next', '.nuxt', '.cache', '.idea', '.DS_Store',
  '.pytest_cache', '.mypy_cache', 'coverage', '.gradle']);
const MAX_ENTRIES = 600;
const TEXT_MAX = 2 * 1024 * 1024;
const SEARCH_EXT = new Set(['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'sql', 'vue', 'svelte', 'json', 'yaml', 'yml', 'toml', 'md', 'html', 'css', 'scss']);
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_RESULTS = 300;
const LOCAL_NOTEBOOK_MAX = 30 * 1024 * 1024;
const IMPORT_FILE_MAX = 4 * 1024 * 1024;

/** 把路径限制在项目根以内，realpath 之后再比一次，防 ../ 和软链跳出去 */
async function safeResolve(root, relPath) {
  const target = path.resolve(root, relPath || '.');
  const realRoot = await fsp.realpath(root);
  const realTarget = await fsp.realpath(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error('拒绝访问项目目录以外的路径。');
  }
  return realTarget;
}

async function listDir({ root, relPath = '' }) {
  if (!root) return { ok: false, error: '没有打开任何项目。' };
  let dir;
  try {
    dir = await safeResolve(root, relPath);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return { ok: false, error: `读不了这个目录：${err.message}` };
  }

  const items = [];
  for (const entry of entries) {
    if (TREE_SKIP.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.ua') continue;
    const isDir = entry.isDirectory();
    let size = 0;
    if (!isDir) {
      try { size = (await fsp.stat(path.join(dir, entry.name))).size; } catch { /* 读不到就算 0 */ }
    }
    items.push({
      name: entry.name,
      isDir,
      size,
      ext: isDir ? '' : path.extname(entry.name).slice(1).toLowerCase(),
      relPath: path.posix.join(relPath || '', entry.name),
    });
    if (items.length >= MAX_ENTRIES) break;
  }

  // 目录在前，各自按名字排
  items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return { ok: true, relPath, items, truncated: entries.length > MAX_ENTRIES };
}

async function readFile({ root, relPath }) {
  let target;
  try {
    target = await safeResolve(root, relPath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.size > TEXT_MAX) {
      return { ok: false, error: `这个文件 ${(stat.size / 1024 / 1024).toFixed(1)}MB，太大了，不往记事本里塞。` };
    }
    const buffer = await fsp.readFile(target);
    // 前 8KB 里有 NUL 基本就是二进制，别当文本渲染
    if (buffer.subarray(0, 8192).includes(0)) {
      return { ok: false, error: '这是个二进制文件，不是代码。' };
    }
    const code = buffer.toString('utf8');
    return {
      ok: true,
      relPath,
      code,
      lines: code.split('\n').length,
      ext: path.extname(target).slice(1).toLowerCase(),
    };
  } catch (err) {
    return { ok: false, error: `读取失败：${err.message}` };
  }
}

function validateWritePath(root, relPath) {
  if (!root || typeof relPath !== 'string' || !relPath.trim()) throw new Error('缺少项目根目录或文件路径。');
  const normalized = relPath.replace(/\\/g, '/').trim();
  if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..' || part === '.')) throw new Error('文件路径必须位于项目目录以内。');
  const target = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !path.basename(target)) throw new Error('文件路径必须位于项目目录以内。');
  return { normalized, target };
}

async function writeFile({ root, relPath, content = '', create = false }) {
  let targetInfo;
  try { targetInfo = validateWritePath(root, relPath); } catch (err) { return { ok: false, error: err.message }; }
  try {
    const realRoot = await fsp.realpath(root);
    await fsp.mkdir(path.dirname(targetInfo.target), { recursive: true });
    const realParent = await fsp.realpath(path.dirname(targetInfo.target));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) return { ok: false, error: '拒绝写入项目目录以外的路径。' };
    if (create && fs.existsSync(targetInfo.target)) return { ok: false, error: `文件已经存在：${targetInfo.normalized}` };
    if (fs.existsSync(targetInfo.target)) {
      const realTarget = await fsp.realpath(targetInfo.target);
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return { ok: false, error: '拒绝写入项目目录以外的文件。' };
    }
    const text = String(content ?? '');
    if (Buffer.byteLength(text, 'utf8') > TEXT_MAX) return { ok: false, error: '文件内容超过 2MB，暂不写入。' };
    await fsp.writeFile(targetInfo.target, text, 'utf8');
    return { ok: true, relPath: targetInfo.normalized, name: path.basename(targetInfo.target), code: text, lines: text.split('\n').length, ext: path.extname(targetInfo.target).slice(1).toLowerCase() };
  } catch (err) {
    return { ok: false, error: `写入失败：${err.message}` };
  }
}

async function searchProject({ root, query, caseSensitive = false } = {}) {
  if (!root || !String(query || '').trim()) return { ok: false, error: '缺少项目目录或搜索内容。' };
  const needle = String(query).trim();
  let realRoot;
  try { realRoot = await fsp.realpath(root); } catch { return { ok: false, error: '项目目录不存在。' }; }
  const results = [];
  const queue = [''];
  let scannedFiles = 0;
  while (queue.length && scannedFiles < MAX_SEARCH_FILES && results.length < MAX_SEARCH_RESULTS) {
    const relDir = queue.shift();
    let entries;
    try { entries = await fsp.readdir(path.join(realRoot, relDir), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS || scannedFiles >= MAX_SEARCH_FILES) break;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const relPath = path.join(relDir, entry.name);
      if (entry.isDirectory()) { queue.push(relPath); continue; }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!SEARCH_EXT.has(ext)) continue;
      scannedFiles += 1;
      let buffer;
      try {
        const stat = await fsp.stat(path.join(realRoot, relPath));
        if (stat.size > TEXT_MAX || stat.size === 0) continue;
        buffer = await fsp.readFile(path.join(realRoot, relPath));
      } catch { continue; }
      if (buffer.subarray(0, 8192).includes(0)) continue;
      const text = buffer.toString('utf8');
      const source = caseSensitive ? text : text.toLowerCase();
      const target = caseSensitive ? needle : needle.toLowerCase();
      let offset = 0;
      while (offset <= source.length && results.length < MAX_SEARCH_RESULTS) {
        const hit = source.indexOf(target, offset);
        if (hit < 0) break;
        const line = source.slice(0, hit).split('\n').length;
        const lineStart = source.lastIndexOf('\n', hit - 1) + 1;
        const lineEnd = source.indexOf('\n', hit);
        results.push({ relPath: relPath.split(path.sep).join('/'), line, text: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trimEnd(), column: hit - lineStart + 1 });
        offset = hit + Math.max(1, target.length);
      }
    }
  }
  return { ok: true, results, scannedFiles, truncated: scannedFiles >= MAX_SEARCH_FILES || results.length >= MAX_SEARCH_RESULTS };
}

function localNotebookDirectory(getUserDataPath) {
  return path.join(getUserDataPath(), 'notebooks');
}

async function saveLocalNotebook(getUserDataPath, { snippets = [], currentId = null } = {}) {
  const directory = localNotebookDirectory(getUserDataPath);
  const payload = JSON.stringify({ version: 1, currentId, snippets }, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > LOCAL_NOTEBOOK_MAX) return { ok: false, error: '本地记事本内容超过 30MB，暂时没有保存。' };
  try {
    await fsp.mkdir(directory, { recursive: true });
    const target = path.join(directory, 'notebook.json');
    const temporary = `${target}.tmp-${process.pid}`;
    await fsp.writeFile(temporary, payload, 'utf8');
    await fsp.rename(temporary, target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: `本地记事本保存失败：${err.message}` };
  }
}

async function loadLocalNotebook(getUserDataPath) {
  const target = path.join(localNotebookDirectory(getUserDataPath), 'notebook.json');
  try {
    const stat = await fsp.stat(target);
    if (stat.size > LOCAL_NOTEBOOK_MAX) return { ok: false, error: '本地记事本文件超过 30MB。' };
    const data = JSON.parse(await fsp.readFile(target, 'utf8'));
    return { ok: true, path: target, currentId: data.currentId || null, snippets: Array.isArray(data.snippets) ? data.snippets : [] };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, path: target, currentId: null, snippets: [] };
    return { ok: false, error: `本地记事本读取失败：${err.message}` };
  }
}

async function importLocalFiles(getUserDataPath, input) {
  const paths = Array.isArray(input) ? input : input?.paths;
  if (!Array.isArray(paths) || !paths.length) return { ok: false, error: '没有拿到要导入的文件。' };
  const allowed = new Set(['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'sql', 'vue', 'svelte', 'json', 'yaml', 'yml', 'toml', 'md', 'txt', 'ipynb']);
  const directory = path.join(localNotebookDirectory(getUserDataPath), 'imported');
  await fsp.mkdir(directory, { recursive: true });
  const items = [];
  for (const rawPath of paths.slice(0, 30)) {
    if (typeof rawPath !== 'string') continue;
    let stat;
    try { stat = await fsp.stat(rawPath); } catch { continue; }
    if (!stat.isFile() || stat.size > IMPORT_FILE_MAX) continue;
    const ext = path.extname(rawPath).slice(1).toLowerCase();
    if (!allowed.has(ext)) continue;
    const buffer = await fsp.readFile(rawPath);
    if (buffer.subarray(0, 8192).includes(0)) continue;
    const base = path.basename(rawPath).replace(/[^\w.\-一-龥]/g, '_') || `学习文件.${ext}`;
    let target = path.join(directory, base);
    if (fs.existsSync(target)) target = path.join(directory, `${Date.now()}-${base}`);
    await fsp.writeFile(target, buffer);
    items.push({ name: base, ext, path: target, sourcePath: rawPath, content: buffer.toString('utf8') });
  }
  return { ok: true, items, imported: items.length, skipped: Math.max(0, paths.length - items.length) };
}

function registerNotebookIpc(ipcMain, { dialog, getWindow, getUserDataPath }) {
  ipcMain.handle('notebook:pickFolder', async () => {
    const result = await dialog.showOpenDialog(getWindow?.(), {
      title: '打开项目文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const root = result.filePaths[0];
    return { root, name: path.basename(root), hasGraph: !!graphPathIn(root) };
  });

  ipcMain.handle('notebook:listDir', (_e, payload) => listDir(payload || {}));
  ipcMain.handle('notebook:readFile', (_e, payload) => readFile(payload || {}));
  ipcMain.handle('notebook:createFile', (_e, payload) => writeFile({ ...(payload || {}), create: true }));
  ipcMain.handle('notebook:writeFile', (_e, payload) => writeFile(payload || {}));
  ipcMain.handle('notebook:searchProject', (_e, payload) => searchProject(payload || {}));
  ipcMain.handle('notebook:saveLocal', (_e, payload) => saveLocalNotebook(getUserDataPath, payload || {}));
  ipcMain.handle('notebook:loadLocal', () => loadLocalNotebook(getUserDataPath));
  ipcMain.handle('notebook:importFiles', (_e, payload) => importLocalFiles(getUserDataPath, payload));
  ipcMain.handle('notebook:folderInfo', (_e, root) => ({
    root, name: path.basename(root || ''), hasGraph: !!(root && graphPathIn(root)),
  }));

  ipcMain.handle('notebook:findGraphs', () => findGraphs());

  ipcMain.handle('notebook:pickGraph', async () => {
    const result = await dialog.showOpenDialog(getWindow?.(), {
      title: '选择跑过 /understand 的项目目录',
      properties: ['openDirectory'],
      message: '选项目根目录即可，里面要有 .ua/knowledge-graph.json',
    });
    if (result.canceled || !result.filePaths.length) return null;
    const root = result.filePaths[0];
    const info = describeGraph(root);
    if (!info) return { error: `${path.basename(root)} 里没有 .ua/knowledge-graph.json —— 先在那个项目跑一次 /understand。` };
    return info;
  });

  ipcMain.handle('notebook:loadGraph', (_e, root) => loadGraph(root));
  ipcMain.handle('notebook:readSource', (_e, payload) => readSource(payload || {}));
}

module.exports = { registerNotebookIpc, findGraphs, loadGraph, readSource, describeGraph, listDir, readFile, searchProject, saveLocalNotebook, loadLocalNotebook, importLocalFiles, writeFile };
