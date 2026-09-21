'use strict';
/**
 * 接线静态检查。这几类问题在运行时才炸、而且只在点到那个按钮时炸，所以靠人测很难发现：
 *  - 渲染层 invoke 了一个主进程没 handle 的通道 → "No handler registered"
 *  - 渲染层调了 window.toolbox.x.y，而 preload 根本没暴露 y → TypeError
 *  - preload 暴露的对象里同一个键写了两次 → 后者静默覆盖前者，前者的方法全没了（切换栏空白那次）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 解析 preload 里 exposeInMainWorld('toolbox', {...}) 的两级结构：{ ns: Set(fn) } */
function parsePreload() {
  const src = read('src/main/preload.js');
  const ns = {};
  const topKeys = [];
  let cur = null;
  for (const line of src.split('\n')) {
    const open = line.match(/^  ([a-zA-Z]+): \{/);
    if (open) { cur = open[1]; topKeys.push(cur); ns[cur] = ns[cur] || new Set(); continue; }
    const flat = line.match(/^  ([a-zA-Z]+): /);
    if (flat) { topKeys.push(flat[1]); ns[flat[1]] = ns[flat[1]] || new Set(); cur = null; continue; }
    const fn = line.match(/^    ([a-zA-Z]+): /);
    if (fn && cur) ns[cur].add(fn[1]);
  }
  return { ns, topKeys, src };
}

test('preload 暴露的顶层键不能重复（重复 = 后者覆盖前者，前者的方法凭空消失）', () => {
  const { topKeys } = parsePreload();
  const seen = new Set(); const dup = [];
  for (const k of topKeys) { if (seen.has(k)) dup.push(k); seen.add(k); }
  assert.deepEqual(dup, [], `重复的键：${dup.join(', ')}`);
});

test('渲染层 invoke 的每个通道，主进程都有 handle', () => {
  const invoked = new Set([...read('src/main/preload.js').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]));
  const handled = new Set();
  for (const f of walk(path.join(ROOT, 'src/main'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/ipcMain\.handle\('([^']+)'/g)) handled.add(m[1]);
  }
  const missing = [...invoked].filter((c) => !handled.has(c));
  assert.deepEqual(missing, [], `没人处理的通道：${missing.join(', ')}`);
});

test('渲染层调用的 window.toolbox.x.y，preload 里都存在', () => {
  const { ns } = parsePreload();
  const dirs = ['src/renderer', 'src/pet', 'src/monologue', 'src/overlay', 'src/gesture', 'src/switcher'].filter((d) => fs.existsSync(path.join(ROOT, d)));
  const bad = new Set();
  for (const dir of dirs) {
    for (const f of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/window\.toolbox\??\.([a-zA-Z]+)\??\.([a-zA-Z]+)/g)) {
        const [, a, b] = m;
        if (!ns[a]) bad.add(`${path.relative(ROOT, f)}: toolbox.${a} 不存在`);
        else if (ns[a].size && !ns[a].has(b)) bad.add(`${path.relative(ROOT, f)}: toolbox.${a}.${b} 不存在`);
      }
    }
  }
  assert.deepEqual([...bad], [], [...bad].join('\n'));
});
