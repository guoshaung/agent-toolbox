'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = { L: '学习', T: '工具', E: '娱乐' };
const LIMITS = { L: 60, T: 100, E: 40 };
function validFeatureId(id) {
  const match = typeof id === 'string' && id.match(/^([LTE])(\d{3})$/);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= LIMITS[match[1]];
}
function regular(file, directory = false) {
  try {
    const stat = fs.lstatSync(file);
    return !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile());
  } catch { return false; }
}
/** Discover shipped code only. Never accept a renderer-supplied path or load user files. */
function listFeatures(base) {
  if (!regular(base, true)) return { features: [], errors: [] };
  const features = []; const errors = [];
  for (const entry of fs.readdirSync(base).sort()) {
    if (!validFeatureId(entry)) continue;
    try {
      const folder = path.join(base, entry);
      const manifest = path.join(folder, 'meta.json');
      if (!regular(folder, true) || !regular(manifest) || !regular(path.join(folder, 'index.js'))) {
        throw new Error('缺少普通文件 meta.json / index.js，或目录含符号链接');
      }
      if (fs.statSync(manifest).size > 16384) throw new Error('功能描述超过 16KB');
      const meta = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (meta.id !== entry || meta.category !== CATEGORIES[entry[0]]) throw new Error('编号或分类不匹配');
      for (const [key, max] of [['title', 80], ['group', 80], ['description', 500]]) {
        if (typeof meta[key] !== 'string' || !meta[key].trim() || meta[key].length > max) throw new Error(`无效 ${key}`);
      }
      features.push({ id: entry, category: meta.category, group: meta.group, title: meta.title, description: meta.description });
    } catch (error) { errors.push({ id: entry, error: error.message }); }
  }
  return { features, errors };
}
module.exports = { listFeatures, validFeatureId };
