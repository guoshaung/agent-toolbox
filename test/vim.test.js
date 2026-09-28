'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'notebook', 'vim.js'), 'utf8');
const body = src.slice(0, src.indexOf('// ---- DOM 侧')).replace(/export function/g, 'function');
const m = new Function(`${body}; return { lineBounds, columnOf, moveVertical, lineStart, lineEnd, firstNonBlank, wordForward, wordBackward, wordEnd };`)();

test('vim 运动：行边界、列、行首非空白', () => {
  const t = 'abc\n  def\nghi';
  assert.deepEqual(m.lineBounds(t, 5), { start: 4, end: 9 });
  assert.equal(m.columnOf(t, 6), 2);
  assert.equal(m.lineStart(t, 6), 4);
  assert.equal(m.lineEnd(t, 6), 9);
  assert.equal(m.firstNonBlank(t, 4), 6);   // 跳过两个空格
});

test('vim 运动：上下移动保持列', () => {
  const t = 'hello\nhi\nworld';
  const down = m.moveVertical(t, 4, 1, null);   // 在 'o'(col4)，下一行 'hi' 只有 2 长
  assert.equal(down.pos, 8); assert.equal(down.col, 4);
  const down2 = m.moveVertical(t, down.pos, 1, down.col);   // 再下到 'world' 回到 col4
  assert.equal(m.columnOf(t, down2.pos), 4);
  const top = m.moveVertical(t, 2, -1, null);   // 第一行往上不动
  assert.equal(top.pos, 2);
});

test('vim 运动：词前进 / 后退 / 词尾', () => {
  const t = 'foo bar_baz  qux';
  assert.equal(m.wordForward(t, 0), 4);   // foo → bar
  assert.equal(m.wordForward(t, 4), 13);  // bar_baz → qux（下划线算词内）
  assert.equal(m.wordBackward(t, 13), 4);
  assert.equal(m.wordBackward(t, 4), 0);
  assert.equal(m.wordEnd(t, 0), 2);       // foo 的 'o'
});
