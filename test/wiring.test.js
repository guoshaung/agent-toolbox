'use strict';
/**
 * 接线静态检查，覆盖所有 preload（主窗口那个 + 桌宠/切换栏共用的 + 分隔条 / 站点浮窗 / 终端弹窗 / 数字人）。
 * 这几类问题在运行时才炸、而且只在点到那个按钮时炸，所以靠人测很难发现：
 *  - 渲染层 invoke 了一个主进程没 handle 的通道 → "No handler registered"
 *  - preload 监听了一个主进程从不发送的事件 → 那个功能永远不触发
 *  - 页面调了 window.<名字>.y，而 preload 根本没暴露 y → TypeError
 *  - preload 暴露的对象里同一个键写了两次 → 后者静默覆盖前者，前者的方法全没了（切换栏空白那次）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Windows 上 path.relative 给的是反斜杠，和这里写死的 'src/main/preload.js' 对不上 —— 统一成正斜杠
const rel = (f) => rel(f).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const ALL = walk(path.join(ROOT, 'src'));
const PRELOADS = ALL.filter((f) => /preload[^/\\]*\.js$/.test(f));
const MAIN_SIDE = ALL.filter((f) => !PRELOADS.includes(f) && /\.(js|mjs)$/.test(f))
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const HANDLED = new Set([...MAIN_SIDE.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
const SENT = new Set([...MAIN_SIDE.matchAll(/\.send\('([^']+)'/g)].map((m) => m[1]));

/** 解析 exposeInMainWorld('name', {...})：顶层键（含重复）、二级方法名 */
function parsePreload(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = [...src.matchAll(/exposeInMainWorld\('([^']+)'/g)].map((m) => m[1]);
  const ns = {}; const topKeys = []; let cur = null;
  for (const line of src.split('\n')) {
    const open = line.match(/^  ([a-zA-Z]+): \{/);
    if (open) { cur = open[1]; topKeys.push(cur); ns[cur] = ns[cur] || new Set(); continue; }
    const flat = line.match(/^  ([a-zA-Z]+): /);
    if (flat) { topKeys.push(flat[1]); ns[flat[1]] = ns[flat[1]] || new Set(); cur = null; continue; }
    const fn = line.match(/^    ([a-zA-Z]+): /);
    if (fn && cur) ns[cur].add(fn[1]);
  }
  const invoked = [...src.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]);
  const listened = [...src.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]);
  return { file: rel(file), names, ns, topKeys, invoked, listened };
}

const PARSED = PRELOADS.map(parsePreload);

test('每个 preload 都找到了、且暴露了东西', () => {
  assert.ok(PARSED.length >= 6, `只找到 ${PARSED.length} 个 preload`);
  const main = PARSED.find((p) => p.file === 'src/main/preload.js');
  assert.ok(main && main.names.includes('toolbox'));
});

for (const p of PARSED) {
  test(`${p.file}：顶层键不重复（重复 = 后者覆盖前者，前者的方法凭空消失）`, () => {
    const seen = new Set(); const dup = [];
    for (const k of p.topKeys) { if (seen.has(k)) dup.push(k); seen.add(k); }
    assert.deepEqual(dup, [], `重复的键：${dup.join(', ')}`);
  });

  test(`${p.file}：invoke 的每个通道主进程都有 handle`, () => {
    const missing = [...new Set(p.invoked)].filter((c) => !HANDLED.has(c));
    assert.deepEqual(missing, [], `没人处理的通道：${missing.join(', ')}`);
  });

  test(`${p.file}：监听的事件主进程确实会发`, () => {
    const dead = [...new Set(p.listened)].filter((c) => !SENT.has(c));
    assert.deepEqual(dead, [], `永远收不到的事件：${dead.join(', ')}`);
  });
}

test('页面调用的 window.<暴露名>.x(.y)，preload 里都存在', () => {
  const bad = new Set();
  for (const p of PARSED) {
    for (const name of p.names) {
      const two = new RegExp(`window\\.${name}\\??\\.([a-zA-Z]+)\\??\\.([a-zA-Z]+)`, 'g');
      const one = new RegExp(`window\\.${name}\\??\\.([a-zA-Z]+)`, 'g');
      for (const f of ALL) {
        if (PRELOADS.includes(f)) continue;
        const src = fs.readFileSync(f, 'utf8');
        if (!src.includes(`window.${name}`)) continue;
        for (const m of src.matchAll(two)) {
          const [, a, b] = m;
          if (!p.ns[a]) continue;                         // 一级键不存在的由下面那条报
          if (p.ns[a].size && !p.ns[a].has(b)) bad.add(`${rel(f)}: ${name}.${a}.${b} 不存在`);
        }
        for (const m of src.matchAll(one)) {
          if (!(m[1] in p.ns)) bad.add(`${rel(f)}: ${name}.${m[1]} 不存在`);
        }
      }
    }
  }
  assert.deepEqual([...bad], [], [...bad].join('\n'));
});
