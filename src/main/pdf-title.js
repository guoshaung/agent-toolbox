'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');

/**
 * 极简 PDF 标题提取。
 * 策略：解开 FlateDecode 内容流 → 跟踪 Tf 字号 → 标题几乎总是首页最大字号的文字。
 * 对 arxiv / 会议论文这类标准 PDF 很稳；自定义字体编码的 PDF（如网页打印件）
 * 抠出来会是乱码，用字母占比过滤掉，调用方兜底「保持原名」。
 */

const MAX_SCAN_BYTES = 8 * 1024 * 1024; // 标题在开头几页，扫前 8MB 足够

function decodePdfString(raw) {
  const out = raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g) => {
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[g];
    if (simple !== undefined) return simple;
    return String.fromCharCode(parseInt(g, 8));
  });
  // UTF-16BE BOM 的字符串（macOS Quartz 等会这么写）
  if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < out.length; i += 2) {
      s += String.fromCharCode(out.charCodeAt(i) * 256 + out.charCodeAt(i + 1));
    }
    return s;
  }
  return out;
}

/** 从单个内容流里按顺序拿 { size, text } 片段 */
function extractChunks(content) {
  const chunks = [];
  // 依次匹配：Tf 字号切换 / Tj 文本 / TJ 文本数组
  const re = /\/\S+\s+([\d.]+)\s+Tf|\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:[^\]]*))\]\s*TJ/g;
  let fontSize = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) {
      fontSize = parseFloat(m[1]);
      continue;
    }
    if (m[2] !== undefined) {
      chunks.push({ size: fontSize, text: decodePdfString(m[2]) });
      continue;
    }
    // TJ 数组：字距调整值很小（负得离谱）说明视觉上是一个空格
    const parts = [];
    const segRe = /\(((?:\\.|[^\\()])*)\]|(-?\d+(?:\.\d+)?)/g;
    const inner = m[3];
    const tokRe = /\(((?:\\.|[^\\()])*)\)|(-?\d+(?:\.\d+)?)/g;
    let t;
    while ((t = tokRe.exec(inner)) !== null) {
      if (t[1] !== undefined) parts.push(decodePdfString(t[1]));
      else if (parseFloat(t[2]) < -120) parts.push(' '); // 大负字距 ≈ 空格
    }
    chunks.push({ size: fontSize, text: parts.join('') });
  }
  return chunks;
}

/** 逐个内容流产出 { size, text } 片段，调用方控制停在第几页 */
function* streamChunks(buffer) {
  const haystack = buffer.toString('latin1');
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(haystack)) !== null) {
    const start = m.index + m[0].length;
    const end = haystack.indexOf('endstream', start);
    if (end === -1) continue;
    let inflated;
    try {
      inflated = zlib.inflateSync(buffer.subarray(start, end));
    } catch {
      continue;
    }
    const text = inflated.toString('latin1');
    if (!text.includes('Tj') && !text.includes('TJ')) continue;
    yield extractChunks(text);
  }
}

function letterScore(text) {
  const letters = (text.match(/[A-Za-z一-鿿]/g) || []).length;
  const visible = text.replace(/\s/g, '').length;
  return { letters, ratio: visible ? letters / visible : 0 };
}

function cleanTitle(raw) {
  let line = raw.replace(/\s+/g, ' ').trim();
  if (!line || line.length < 6) return null;
  if (/^arxiv:/i.test(line)) return null;
  const { letters, ratio } = letterScore(line);
  if (letters < 3 || ratio < 0.5) return null; // 乱码行：符号比字多
  // 作者/单位标记常见的截断点
  line = line.replace(/\s+[*†‡]\d.*$/, '').replace(/\s+Abstract\b.*$/i, '');
  if (line.length < 6) return null;
  return line.slice(0, 120);
}

function pickTitle(buffer) {
  let streamsSeen = 0;
  for (const chunks of streamChunks(buffer)) {
    streamsSeen += 1;
    if (streamsSeen > 3) break; // 标题只可能在首页
    const usable = chunks.filter((c) => c.text.trim() && c.size > 6);
    if (!usable.length) continue;
    const maxSize = Math.max(...usable.map((c) => c.size));
    const joined = usable
      .filter((c) => c.size >= maxSize - 2)
      .map((c) => c.text)
      .join('')
      .trim();
    const title = cleanTitle(joined);
    if (title) return title;
  }
  return null;
}

/** 文件名是否像编号：2301.12345 / 2301.12345v2 / 一长串 hash / 纯数字 */
function looksLikeId(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(stem)) return true;          // arxiv 新式
  if (/^\d{7}$/.test(stem)) return true;                           // arxiv 旧式
  if (/^\d{4}\.\d{4,5}v\d+_.*$/i.test(stem)) return true;          // arxiv + 后缀（翻译件等）
  if (/^[0-9a-f]{20,}$/i.test(stem)) return true;                  // 哈希
  if (/^\d{6,}$/.test(stem)) return true;                          // 纯数字编号
  return false;
}

function sanitizeFileStem(title) {
  return String(title)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
}

/** 主入口：读 PDF 拿标题。拿不到（乱码/扫图/无文本）返回 null。 */
function extractPdfTitle(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, MAX_SCAN_BYTES);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    fs.closeSync(fd);
    return pickTitle(buffer);
  } catch {
    return null;
  }
}

module.exports = { extractPdfTitle, looksLikeId, sanitizeFileStem };
