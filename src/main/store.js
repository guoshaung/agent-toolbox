'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * 极简的 JSON 配置存储。所有工具的设置都落在 userData/config.json，
 * 写入是原子的（先写临时文件再 rename），避免崩溃时把配置写坏。
 */
class Store {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'config.json');
    this.data = this._read();
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[store] 配置文件损坏，已忽略并从空配置开始:', err.message);
      }
      return {};
    }
  }

  _write() {
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** 点分路径读取：get('ask.background') */
  get(key, fallback) {
    if (key == null) return this.data;
    const value = key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), this.data);
    return value === undefined ? fallback : value;
  }

  set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    let node = this.data;
    for (const part of parts) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part];
    }
    if (value === undefined) delete node[last];
    else node[last] = value;
    this._write();
    return value;
  }

  all() {
    return this.data;
  }
}

module.exports = { Store };
