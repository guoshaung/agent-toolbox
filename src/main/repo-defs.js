'use strict';

/**
 * 在仓库里找一个名字的定义（学 GitHub 仓库时 NameError 用）：
 * .py 找顶层 def / class / 赋值；.ipynb 找代码格。找到的块连同该文件的顶层 import 一起返回。
 */

const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target']);

/** 从一段源码里抠出 name 的顶层定义块（def / class / 赋值），没有返回 '' */
function extractDefinition(source, name) {
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  const re = new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${name}\\b|^${name}\\s*=`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) if (re.test(lines[i])) { start = i; break; }
  if (start < 0) return '';
  // 装饰器归到定义里
  while (start > 0 && /^@/.test(lines[start - 1])) start -= 1;
  let end = start + 1;
  if (/^(?:async\s+)?(?:def|class)\s/.test(lines[start]) || /^@/.test(lines[start])) {
    // 直到下一行「顶格且非空、非续行括号」为止
    while (end < lines.length && !(/^\S/.test(lines[end]) && !/^[)\]}]/.test(lines[end]) && lines[end - 1] === '')) end += 1;
    // 收尾时去掉尾部空行
  } else {
    // 赋值：多行括号要吃完
    let depth = 0;
    for (let i = start; i < lines.length; i += 1) {
      for (const ch of lines[i]) { if ('([{'.includes(ch)) depth += 1; else if (')]}'.includes(ch)) depth -= 1; }
      end = i + 1;
      if (depth <= 0) break;
    }
  }
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

function topImports(source) {
  return String(source || '').split('\n').filter((l) => /^(import|from)\s/.test(l)).join('\n');
}

function notebookCodeCells(file) {
  try {
    const nb = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (nb.cells || []).filter((c) => c.cell_type === 'code').map((c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || '')).replace(/\s+$/, '')).filter((c) => c.trim());
  } catch { return []; }
}

/** 遍历仓库找定义。返回 { ok, rel, code, imports } */
function findDefinition(root, name) {
  if (!/^[A-Za-z_]\w*$/.test(String(name || ''))) return { ok: false, error: '名字不合法' };
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4 || hits.length) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (hits.length) return;
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (/\.py$/i.test(e.name)) {
        let src = ''; try { if (fs.statSync(full).size > 400 * 1024) continue; src = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const code = extractDefinition(src, name);
        if (code) hits.push({ rel, code, imports: topImports(src), kind: 'file' });
      } else if (/\.ipynb$/i.test(e.name)) {
        const cells = notebookCodeCells(full);
        for (const cell of cells) {
          const code = extractDefinition(cell, name);
          if (code) { hits.push({ rel, code: cell.trim() === code.trim() ? code : cell, imports: cells.map(topImports).filter(Boolean).join('\n'), kind: 'notebook' }); break; }
        }
      }
    }
  };
  walk(root, 0);
  if (!hits.length) return { ok: false, error: `仓库里没找到 ${name} 的定义` };
  const hit = hits[0];
  // 把 import 里和定义重名 / 已在定义块里的去掉，别重复
  const imports = hit.imports.split('\n').filter((l) => l && !hit.code.includes(l)).join('\n');
  return { ok: true, ...hit, imports };
}

module.exports = { extractDefinition, topImports, notebookCodeCells, findDefinition };
