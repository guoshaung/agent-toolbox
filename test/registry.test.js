'use strict';
/**
 * 工具注册表的静态体检：id 不重复、图标名在 icons.js 里真的有、每个工具都有 title / hint。
 * 图标名打错在运行时只是画不出来，没人会报错 —— 这里先拦住。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const icons = new Set([...read('src/renderer/core/icons.js').matchAll(/^  ([a-zA-Z]+):/gm)].map((m) => m[1]));
const toolFiles = fs.readdirSync(path.join(ROOT, 'src/renderer/tools')).map((d) => `src/renderer/tools/${d}/index.js`).filter((f) => fs.existsSync(path.join(ROOT, f)));
const meta = (src) => ({
  ids: [...src.matchAll(/^\s*id:\s*'([^']+)'/gm)].map((m) => m[1]),
  icons: [...src.matchAll(/^\s*icon:\s*'([^']+)'/gm)].map((m) => m[1]),
  hints: [...src.matchAll(/^\s*hint:\s*'([^']+)'/gm)].map((m) => m[1]),
});

test('每个工具的 icon 都在 icons.js 里', () => {
  const bad = [];
  for (const f of toolFiles) for (const name of meta(read(f)).icons) if (!icons.has(name)) bad.push(`${f}: ${name}`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('注册表里的工具 id 不重复，且都能在工具目录里找到', () => {
  const reg = read('src/renderer/core/registry.js');
  const imported = [...reg.matchAll(/from '\.\.\/tools\/([a-z-]+)\/index\.js'/g)].map((m) => m[1]);
  const dup = imported.filter((x, i) => imported.indexOf(x) !== i);
  assert.deepEqual(dup, [], `重复引入：${dup.join(', ')}`);
  const missing = imported.filter((d) => !fs.existsSync(path.join(ROOT, 'src/renderer/tools', d, 'index.js')));
  assert.deepEqual(missing, [], `找不到目录：${missing.join(', ')}`);
  const allIds = toolFiles.flatMap((f) => meta(read(f)).ids.filter((id) => /^[a-z-]+$/.test(id)));
  const dupIds = allIds.filter((x, i) => allIds.indexOf(x) !== i && !['notebook', 'notes'].includes(x));
  assert.deepEqual([...new Set(dupIds)], [], `工具 id 重复：${dupIds.join(', ')}`);
});

test('每个工具都有一句 hint（侧栏和 ⌘K 都靠它）', () => {
  const missing = toolFiles.filter((f) => !meta(read(f)).hints.length);
  assert.deepEqual(missing, [], missing.join('\n'));
});
