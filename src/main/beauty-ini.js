'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const MAX_INI = 1024 * 1024;
// Merge visual fields only. Engine scope, battery behavior and toolbar options stay intact.
const VISUAL_KEYS = {
  dwm: { config: ['effectType', 'customAmount', 'blurAmount', 'customBlurAmount', 'activeBlendColor', 'inactiveBlendColor', 'activeBlendColorDark', 'inactiveBlendColorDark', 'useAccentColor'] },
  explorer: { config: ['effect'], light: ['r', 'g', 'b', 'a'], dark: ['r', 'g', 'b', 'a'] },
};

function decodeIni(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_INI) throw new Error('INI 文件为空或超过 1 MB');
  let encoding = 'utf8', bom = Buffer.alloc(0), start = 0;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf16le'; start = 2; }
  else if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) start = 3;
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error('请先将 INI 转为 UTF-8 或带 BOM 的 UTF-16LE');
  bom = buffer.subarray(0, start);
  let text;
  try { text = new TextDecoder(encoding === 'utf16le' ? 'utf-16le' : 'utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(start)); }
  catch { throw new Error('INI 编码无效，请先转为 UTF-8 或带 BOM 的 UTF-16LE'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufeff]/.test(text)) throw new Error('INI 包含不支持的控制字符或编码');
  return { text, encoding, bom };
}

function parseLines(text) {
  let section = '';
  return (text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []).filter(Boolean).map(raw => {
    const body = raw.replace(/[\r\n]+$/, ''), eol = raw.slice(body.length);
    const trimmed = body.trim();
    if (!trimmed || trimmed.startsWith(';')) return { raw, body, eol, section };
    const header = /^\[([^\[\]]+)\]$/.exec(trimmed);
    if (header) { section = header[1].trim().toLowerCase(); return { raw, body, eol, section, header: true }; }
    const entry = /^(\s*([^=\s][^=]*?)\s*=)(.*)$/.exec(body);
    if (!entry || trimmed.startsWith('[')) throw new Error('INI 结构无法可靠合并，请使用标准 [段名] 和 key=value 格式');
    return { raw, body, eol, section, key: entry[2].trim().toLowerCase(), prefix: entry[1] };
  });
}

function mergeNativeIni(buffer, recipe) {
  const fields = Object.hasOwn(VISUAL_KEYS, recipe?.engine) ? VISUAL_KEYS[recipe.engine] : null;
  if (!fields) throw new Error('不支持的原生引擎');
  const decoded = decodeIni(buffer), lines = parseLines(decoded.text);
  if (!lines.some(line => line.header && line.section === 'config')) throw new Error('未找到 [config]，请选择对应引擎的 INI 配置');
  const values = new Map();
  for (const line of parseLines(recipe.text)) {
    if (line.key && Object.hasOwn(fields, line.section) && fields[line.section].some(key => key.toLowerCase() === line.key)) {
      if (!values.has(line.section)) values.set(line.section, new Map());
      values.get(line.section).set(line.key, { key: fields[line.section].find(key => key.toLowerCase() === line.key), value: line.body.slice(line.prefix.length) });
    }
  }
  const eol = lines.find(line => line.eol)?.eol || '\r\n';
  const seen = new Map(), firstEnd = new Map();
  let current = '', first = false;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].header) {
      if (first && values.has(current)) firstEnd.set(current, i);
      if (i < lines.length) { current = lines[i].section; first = !seen.has(current); seen.set(current, true); }
    }
    if (i < lines.length) lines[i].firstSection = first;
  }
  // Update every duplicate target key, including case variants and repeated sections.
  const present = new Map();
  for (const line of lines) {
    const replacement = values.get(line.section)?.get(line.key);
    if (!replacement) continue;
    line.raw = line.prefix + replacement.value + line.eol;
    if (line.firstSection) {
      if (!present.has(line.section)) present.set(line.section, new Set());
      present.get(line.section).add(line.key);
    }
  }
  const additions = new Map();
  for (const [section, entries] of values) {
    const missing = [...entries].filter(([key]) => !present.get(section)?.has(key)).map(([, item]) => `${item.key}=${item.value}${eol}`).join('');
    if (!missing) continue;
    const index = firstEnd.get(section) ?? lines.length;
    additions.set(index, (additions.get(index) || '') + (firstEnd.has(section) ? '' : `[${section}]${eol}`) + missing);
  }
  let text = '';
  for (let i = 0; i <= lines.length; i++) {
    if (additions.has(i)) { if (text && !/[\r\n]$/.test(text)) text += eol; text += additions.get(i); }
    if (i < lines.length) text += lines[i].raw;
  }
  const output = Buffer.concat([decoded.bom, Buffer.from(text, decoded.encoding)]);
  if (output.length > MAX_INI) throw new Error('合并后的 INI 超过 1 MB');
  return { buffer: output, encoding: decoded.encoding, sections: [...values.keys()] };
}

function readIni(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INI) throw new Error('请选择不超过 1 MB 的 INI 文件');
    const data = Buffer.alloc(MAX_INI + 1);
    let size = 0, count;
    while (size < data.length && (count = fs.readSync(fd, data, size, data.length - size, null))) size += count;
    return data.subarray(0, size);
  } finally { fs.closeSync(fd); }
}

function writeNewIni(file, buffer) {
  if (path.extname(file).toLowerCase() !== '.ini') throw new Error('请使用 .ini 文件名另存');
  // Exclusive creation also rejects symlinks and hard links to the original or any existing file.
  try { fs.writeFileSync(file, buffer, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('为保留原配置，请选择尚不存在的新 INI 文件名'); throw error; }
}

module.exports = { MAX_INI, decodeIni, mergeNativeIni, readIni, writeNewIni };
