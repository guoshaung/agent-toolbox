'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SKIP_NAMES = new Set(['.DS_Store', '.container-imports.json']);
const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_IMPORT_FILES = 1000;
const FOLDERS = ['文档', '图片', '视频', '音频', '代码', '数据', '压缩包', '其他'];

function containerRoot(getUserDataPath) {
  const root = path.join(getUserDataPath(), 'container');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * 首次启动时把随包附带的工具铺进容器。
 *
 * 为什么要这一步：容器在 userData 下，是每个人自己的数据目录，不在安装包里。
 * 装了新版本如果容器是空的，「放进容器就能启动」这件事就无从谈起。
 * 所以随包带一份种子，第一次运行时复制过去。
 *
 * 只在目标不存在时复制 —— 你自己改过的东西不会被新版本覆盖。
 */
function seedContainer(getUserDataPath, seedDir) {
  if (!seedDir || !fs.existsSync(seedDir)) return { ok: true, copied: [] };
  const root = containerRoot(getUserDataPath);
  const copied = [];
  for (const name of fs.readdirSync(seedDir)) {
    if (name.startsWith('.')) continue;
    const target = path.join(root, name);
    if (fs.existsSync(target)) continue;      // 已经有了就别动，尊重用户的修改
    try {
      fs.cpSync(path.join(seedDir, name), target, { recursive: true });
      copied.push(name);
    } catch (err) {
      console.warn('[container] 种子复制失败', name, err.message);
    }
  }
  return { ok: true, copied };
}

async function safeDirectory(getUserDataPath, relPath = '') {
  const root = await fsp.realpath(containerRoot(getUserDataPath));
  const target = path.resolve(root, relPath || '.');
  const real = await fsp.realpath(target);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('拒绝访问容器以外的路径。');
  const stat = await fsp.stat(real);
  if (!stat.isDirectory()) throw new Error('目标不是文件夹。');
  return { root, directory: real, relPath: path.relative(root, real).split(path.sep).join('/') };
}

function safeFolderName(name) {
  const value = String(name || '').trim();
  if (!value || value === '.' || value === '..' || /[\\/:*?"<>|]/.test(value) || value.length > 80) throw new Error('文件夹名称无效。');
  return value;
}

function safeFileName(name) {
  const value = String(name || '').trim();
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) throw new Error('文件名称无效。');
  return value;
}

async function listContainer(getUserDataPath, relPath = '') {
  let location;
  try { location = await safeDirectory(getUserDataPath, relPath); } catch (err) { return { ok: false, error: err.message }; }
  let entries;
  try { entries = await fsp.readdir(location.directory, { withFileTypes: true }); } catch (err) { return { ok: false, error: `容器读取失败：${err.message}` }; }
  const items = [];
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const target = path.join(location.directory, entry.name);
    let stat;
    try { stat = await fsp.stat(target); } catch { continue; }
    items.push({
      name: entry.name,
      isDir: entry.isDirectory(),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      relPath: path.posix.join(location.relPath, entry.name),
      kind: entry.isDirectory() ? 'folder' : path.extname(entry.name).slice(1).toLowerCase(),
    });
  }
  items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN') : a.isDir ? -1 : 1));
  return { ok: true, root: location.root, relPath: location.relPath, items, truncated: entries.length > MAX_ENTRIES };
}

async function makeFolder(getUserDataPath, relPath, name) {
  let location;
  try { location = await safeDirectory(getUserDataPath, relPath); const folder = safeFolderName(name); await fsp.mkdir(path.join(location.directory, folder)); return { ok: true, relPath: path.posix.join(location.relPath, folder) }; }
  catch (err) { return { ok: false, error: err.code === 'EEXIST' ? '这个文件夹已经存在。' : `创建文件夹失败：${err.message}` }; }
}

async function uniqueTarget(directory, name) {
  const parsed = path.parse(name);
  let candidate = path.join(directory, name);
  let index = 2;
  while (fs.existsSync(candidate)) candidate = path.join(directory, `${parsed.name} (${index++})${parsed.ext}`);
  return candidate;
}

function categoryFor(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (['pdf', 'doc', 'docx', 'md', 'txt', 'rtf', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return '文档';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(ext)) return '图片';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv'].includes(ext)) return '视频';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext)) return '音频';
  if (['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'vue', 'sh', 'sql'].includes(ext)) return '代码';
  if (['csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'parquet', 'npy', 'npz'].includes(ext)) return '数据';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '压缩包';
  return '其他';
}

async function moveFiles(getUserDataPath, relPath, groups) {
  let location;
  try { location = await safeDirectory(getUserDataPath, relPath); } catch (err) { return { ok: false, error: err.message }; }
  const moves = [];
  try {
    for (const group of Array.isArray(groups) ? groups : []) {
      const folder = safeFolderName(group.folder);
      const names = Array.isArray(group.files) ? group.files.slice(0, MAX_ENTRIES) : [];
      if (!names.length) continue;
      const destination = path.join(location.directory, folder);
      await fsp.mkdir(destination, { recursive: true });
      for (const rawName of names) {
        const name = safeFileName(rawName);
        const source = path.join(location.directory, name);
        let stat;
        try { stat = await fsp.stat(source); } catch { continue; }
        if (!stat.isFile()) continue;
        const target = await uniqueTarget(destination, name);
        await fsp.rename(source, target);
        moves.push({ name, folder, to: path.basename(target) });
      }
    }
    return { ok: true, moved: moves.length, moves };
  } catch (err) { return { ok: false, error: `整理失败：${err.message}`, moved: moves.length, moves }; }
}

async function organize(getUserDataPath, relPath = '') {
  const listed = await listContainer(getUserDataPath, relPath);
  if (!listed.ok) return listed;
  const files = listed.items.filter((item) => !item.isDir);
  const grouped = new Map();
  for (const file of files) {
    const folder = categoryFor(file.name);
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder).push(file.name);
  }
  return moveFiles(getUserDataPath, relPath, [...grouped].map(([folder, names]) => ({ folder, files: names })));
}

async function openContainer(getUserDataPath, shell) {
  const root = containerRoot(getUserDataPath);
  const error = await shell.openPath(root);
  return error ? { ok: false, error } : { ok: true, path: root };
}

async function importIntoContainer(getUserDataPath, sources, relPath = '') {
  if (!Array.isArray(sources) || !sources.length) return { ok: false, error: '没有拿到要导入的文件。' };
  let location;
  try { location = await safeDirectory(getUserDataPath, relPath); } catch (err) { return { ok: false, error: err.message }; }
  const manifestPath = path.join(location.root, '.container-imports.json');
  let manifest = {};
  try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch {}
  let importedFiles = 0;
  let importedFolders = 0;
  let skipped = 0;
  const copyFile = async (source, destination) => {
    if (importedFiles >= MAX_IMPORT_FILES) { skipped += 1; return; }
    let stat;
    try { stat = await fsp.lstat(source); } catch { skipped += 1; return; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { skipped += 1; return; }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const target = await uniqueTarget(path.dirname(destination), path.basename(destination));
    await fsp.copyFile(source, target);
    importedFiles += 1;
    return target;
  };
  const copyFolder = async (source, destination) => {
    let entries;
    try { entries = await fsp.readdir(source, { withFileTypes: true }); } catch { skipped += 1; return; }
    for (const entry of entries) {
      if (importedFiles >= MAX_IMPORT_FILES) { skipped += 1; break; }
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.venv') continue;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) await copyFolder(from, to);
      else if (entry.isFile()) await copyFile(from, to);
    }
  };
  for (const rawSource of sources.slice(0, 30)) {
    if (typeof rawSource !== 'string') { skipped += 1; continue; }
    let stat;
    try { stat = await fsp.lstat(rawSource); } catch { skipped += 1; continue; }
    const base = path.basename(rawSource).replace(/[\\/:*?"<>|]/g, '_') || '导入内容';
    let sourceKey;
    try { sourceKey = await fsp.realpath(rawSource); } catch { skipped += 1; continue; }
    const previous = manifest[sourceKey];
    if (previous && fs.existsSync(path.join(location.root, previous))) { skipped += 1; continue; }
    if (stat.isDirectory()) {
      const destination = await uniqueTarget(location.directory, base);
      await fsp.mkdir(destination, { recursive: true });
      await copyFolder(rawSource, destination);
      importedFolders += 1;
      manifest[sourceKey] = path.relative(location.root, destination).split(path.sep).join('/');
    } else if (stat.isFile()) {
      const destination = await copyFile(rawSource, path.join(location.directory, base));
      if (destination) manifest[sourceKey] = path.relative(location.root, destination).split(path.sep).join('/');
    } else skipped += 1;
  }
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { ok: true, importedFiles, importedFolders, skipped };
}

function registerContainerIpc(ipcMain, { shell, getUserDataPath }) {
  ipcMain.handle('container:list', (_event, relPath) => listContainer(getUserDataPath, relPath || ''));
  ipcMain.handle('container:mkdir', (_event, payload = {}) => makeFolder(getUserDataPath, payload.relPath || '', payload.name));
  ipcMain.handle('container:organize', (_event, relPath) => organize(getUserDataPath, relPath || ''));
  ipcMain.handle('container:applyPlan', (_event, payload = {}) => moveFiles(getUserDataPath, payload.relPath || '', payload.groups));
  ipcMain.handle('container:import', (_event, payload = {}) => importIntoContainer(getUserDataPath, payload.sources, payload.relPath || ''));
  ipcMain.handle('container:open', () => openContainer(getUserDataPath, shell));
}

module.exports = { categoryFor, importIntoContainer, listContainer, makeFolder, moveFiles, organize, registerContainerIpc, seedContainer };
