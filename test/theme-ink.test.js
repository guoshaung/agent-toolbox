'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inkOn, THEMES } = require('../src/renderer/core/themes.js');

test('黑白各算一遍取对比度高的那个', () => {
  assert.equal(inkOn('#39ff9a'), '#0b1410', '荧光绿太亮，白字看不清');
  // 这个蓝看着挺深，但配白字只有 3.16:1、配黑字有 5.92:1 —— 凭感觉会选错
  assert.equal(inkOn('#5b8cff'), '#0b1410');
  assert.equal(inkOn('#ffffff'), '#0b1410');
  assert.equal(inkOn('#000000'), '#ffffff');
  assert.equal(inkOn('#1f3d7a'), '#ffffff', '真正的深色才该配白字');
});

test('坏输入不崩，退回白字', () => {
  assert.equal(inkOn(''), '#ffffff');
  assert.equal(inkOn('rgb(1,2,3)'), '#ffffff');
  assert.equal(inkOn(null), '#ffffff');
});

test('每套皮肤的主按钮字色都要达到 4.5:1', () => {
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const ch = (v) => { const x = parseInt(v, 16) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(h.slice(0, 2)) + 0.7152 * ch(h.slice(2, 4)) + 0.0722 * ch(h.slice(4, 6));
  };
  for (const theme of THEMES) {
    const accent = theme.vars['--accent'];
    const ink = inkOn(accent);
    const a = lum(accent); const b = lum(ink);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${theme.name} 的主按钮 ${ink} on ${accent} 只有 ${ratio.toFixed(2)}:1`);
  }
});
