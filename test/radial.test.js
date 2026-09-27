'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// radial.js 是 ESM 且顶部 import 了 DOM 组件，这里只验两个纯布局函数：把源码里的函数抠出来跑
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'core', 'radial.js'), 'utf8');
const pick = (name) => { const i = src.indexOf(`export function ${name}`); const j = src.indexOf('\nexport function', i + 10); return src.slice(i, j > 0 ? j : undefined).replace('export function', 'function'); };
const mod = new Function(`const NODE = 56; const STEP2 = 17; ${pick('fitArc')} ${pick('placeOnArc')} return { fitArc, placeOnArc };`)();

test('轮盘：左下角的锚点，弧线落在右上方且不出视口', () => {
  const [from, to] = mod.fitArc({ x: 46, y: 900, radius: 206, width: 1400, height: 950 });
  assert.ok(from >= -100 && from < 0, `from=${from}`);
  assert.ok(to <= 10 && to > from, `to=${to}`);   // 稍微压过水平线一点没关系，下面还有几十像素
  const rad = (from * Math.PI) / 180;
  assert.ok(46 + 206 * Math.cos(rad) < 1400 && 900 + 206 * Math.sin(rad) > 0);
});

test('轮盘：窗口高度不够时弧段变窄但仍然有', () => {
  const [from, to] = mod.fitArc({ x: 46, y: 300, radius: 306, width: 1400, height: 400 });
  assert.ok(to - from > 0);
});

test('轮盘：等距摆放，围绕中心，放不下就压缩角距', () => {
  const a = mod.placeOnArc(3, { from: -90, to: 0, center: -45 });
  assert.deepEqual(a, [-62, -45, -28]);
  const b = mod.placeOnArc(8, { from: -60, to: 0, center: -30 });
  assert.equal(b.length, 8);
  assert.ok(b[0] >= -60 && b[7] <= 0);
  assert.ok(Math.abs((b[1] - b[0]) - 60 / 7) < 1e-9);
  assert.deepEqual(mod.placeOnArc(0, { from: 0, to: 10 }), []);
  const c = mod.placeOnArc(2, { from: -90, to: 0, center: -85 });   // 中心太靠边，整体往里挪
  assert.ok(c[0] >= -90);
});
