'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ID = /^[a-zA-Z0-9-]{1,64}$/;
const IMAGE = /^[a-f0-9]{64}\.png$/;
const SOURCE = /^https:\/\/winmoes\.com\/workshop\/packages\/[a-z0-9]{1,32}$/;
const ROLES = new Set(['character', 'wallpaper', 'icon', 'preview']);
function same(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }
class PreparedBeautyPackages {
  constructor(root) { this.root = path.join(root, 'incoming'); }
  rootStat() {
    const stat = fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('解析素材目录不能是链接');
    return stat;
  }
  readFile(name, limit) {
    if (name !== 'manifest.json' && !IMAGE.test(name || '')) throw new Error('解析素材路径无效');
    const beforeRoot = this.rootStat(), file = path.join(this.root, name), before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw new Error('解析素材文件类型或大小无效');
    const fd = fs.openSync(file, 'r');
    try {
      if (!same(before, fs.fstatSync(fd))) throw new Error('解析素材文件已替换');
      const buffer = fs.readFileSync(fd);
      if (buffer.length > limit || !same(before, fs.fstatSync(fd)) || !same(beforeRoot, this.rootStat())) throw new Error('解析素材文件已改变');
      return buffer;
    } finally { fs.closeSync(fd); }
  }
  plan() {
    const value = JSON.parse(this.readFile('manifest.json', 2 * 1024 * 1024).toString('utf8'));
    if (value.format !== 'toolbox-prepared-beauty' || value.version !== 1 || !Array.isArray(value.packages) || value.packages.length > 256) throw new Error('解析素材清单无效');
    const ids = new Set(); let count = 0;
    const packages = value.packages.map(item => {
      if (!ID.test(item.id || '') || ids.has(item.id) || !SOURCE.test(item.source || '') || !Array.isArray(item.images) || item.images.length > 256) throw new Error('预设记录无效或重复');
      ids.add(item.id); count += item.images.length;
      const images = item.images.map(image => {
        if (!IMAGE.test(image.file || '') || !ROLES.has(image.role)) throw new Error('预设素材路径或类型无效');
        return { file: image.file, role: image.role, name: String(image.name || '素材').slice(0, 120) };
      });
      return { id: item.id, title: String(item.title || '未命名预设').slice(0, 100), author: String(item.author || '').slice(0, 80), source: item.source, images };
    });
    if (count > 8192) throw new Error('解析素材数量超过8192');
    return packages;
  }
  image(name) {
    if (!IMAGE.test(name || '')) throw new Error('解析素材路径无效');
    const buffer = this.readFile(name, 25 * 1024 * 1024);
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== name.slice(0, 64)) throw new Error('解析素材内容校验失败');
    return buffer;
  }
}
module.exports = { PreparedBeautyPackages };
