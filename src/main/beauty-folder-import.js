'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fsp = fs.promises;
const FOLDER_LIMITS = Object.freeze({ files: 120, bytes: 256 * 1024 * 1024, imageBytes: 25 * 1024 * 1024, entries: 4096, directories: 64, depth: 3 });
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;

class BeautyFolderImport {
  constructor({ limits = FOLDER_LIMITS, now = Date.now } = {}) { this.limits = limits; this.now = now; this.plan = null; this.generation = 0; }
  async scan(folder) {
    const generation = ++this.generation; this.plan = null;
    const initial = await fsp.lstat(folder, { bigint: true });
    if (!initial.isDirectory() || initial.isSymbolicLink()) throw new Error('请选择实际的图片文件夹，不支持链接或联接');
    const root = await fsp.realpath(folder), rootStat = await fsp.lstat(root, { bigint: true });
    if (initial.dev !== rootStat.dev || initial.ino !== rootStat.ino) throw new Error('文件夹已变化，请重新选择');
    const limits = this.limits, queue = [{ folder: root, depth: 0 }], entries = [];
    const skipped = { unsupported: 0, links: 0, oversized: 0, unreadable: 0, depth: 0 };
    const reached = new Set(); let examined = 0, directories = 1, bytes = 0;
    scan: while (queue.length) {
      const current = queue.shift();
      try {
        // Reject a queued directory replaced by a junction while the scan was in progress.
        const directoryStat = await fsp.lstat(current.folder, { bigint: true });
        const real = await fsp.realpath(current.folder);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || (real !== root && !inside(root, real))) { skipped.links++; continue; }
        const directory = await fsp.opendir(current.folder);
        for await (const item of directory) {
          if (++examined > limits.entries) { reached.add('entries'); break scan; }
          const file = path.join(current.folder, item.name);
          if (item.isSymbolicLink()) { skipped.links++; continue; }
          if (!item.isDirectory() && !IMAGE_EXTENSIONS.has(path.extname(item.name).toLowerCase())) { skipped.unsupported++; continue; }
          let stat;
          try { stat = await fsp.lstat(file, { bigint: true }); } catch { skipped.unreadable++; continue; }
          if (stat.isSymbolicLink()) { skipped.links++; continue; }
          if (stat.isDirectory()) {
            if (current.depth >= limits.depth) { skipped.depth++; continue; }
            if (directories >= limits.directories) { reached.add('directories'); continue; }
            directories++; queue.push({ folder: file, depth: current.depth + 1 }); continue;
          }
          if (!stat.isFile()) { skipped.unsupported++; continue; }
          if (stat.size > BigInt(limits.imageBytes)) { skipped.oversized++; continue; }
          if (bytes + Number(stat.size) > limits.bytes) { reached.add('bytes'); continue; }
          if (entries.length >= limits.files) { reached.add('files'); break scan; }
          bytes += Number(stat.size);
          entries.push({ file, name: path.relative(root, file), ...identity(stat) });
        }
      } catch { skipped.unreadable++; }
    }
    if (generation !== this.generation) throw new Error('扫描已被新的文件夹选择替代');
    const plan = { id: crypto.randomUUID(), root, rootIdentity: identity(rootStat), entries, createdAt: this.now() };
    this.plan = plan;
    return { id: plan.id, name: path.basename(root), count: entries.length, bytes, samples: entries.slice(0, 12).map(item => item.name), skipped, limits: { ...limits }, reached: [...reached] };
  }
  cancel(id) { if (this.plan?.id === id) { this.plan = null; this.generation++; } return {}; }
  async readEntry(plan, entry) {
    const rootStat = await fsp.lstat(plan.root, { bigint: true });
    if (rootStat.isSymbolicLink() || rootStat.dev !== plan.rootIdentity.dev || rootStat.ino !== plan.rootIdentity.ino) throw new Error('文件夹已被替换，请重新扫描');
    if (!inside(plan.root, entry.file)) throw new Error('图片不在所选文件夹内');
    let current = plan.root;
    for (const component of path.relative(plan.root, entry.file).split(path.sep)) {
      current = path.join(current, component);
      if ((await fsp.lstat(current, { bigint: true })).isSymbolicLink()) throw new Error('图片路径变成链接，请重新扫描');
    }
    const real = await fsp.realpath(entry.file);
    if (!inside(plan.root, real)) throw new Error('图片已移出所选文件夹');
    const handle = await fsp.open(entry.file, 'r');
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || !sameFile(entry, identity(stat))) throw new Error('图片已变化，请重新扫描');
      const buffer = Buffer.alloc(Number(stat.size)); let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) throw new Error('图片读取不完整，请重新扫描'); offset += bytesRead;
      }
      if (!sameFile(entry, identity(await handle.stat({ bigint: true })))) throw new Error('图片读取期间已变化，请重新扫描');
      return buffer;
    } finally { await handle.close(); }
  }
  async consume(id, store) {
    const plan = this.plan;
    if (!plan || typeof id !== 'string' || plan.id !== id || this.now() - plan.createdAt > 15 * 60 * 1000) throw new Error('文件夹预览已失效，请重新选择文件夹');
    this.plan = null; // Single-use plan: a repeated click cannot replay an import.
    const imported = [], errors = [];
    for (const entry of plan.entries) {
      try { imported.push(await store(await this.readEntry(plan, entry), entry.name)); }
      catch (error) { errors.push({ name: entry.name, error: error.message }); }
    }
    return { imported, errors, attempted: plan.entries.length };
  }
}
module.exports = { BeautyFolderImport, FOLDER_LIMITS };
