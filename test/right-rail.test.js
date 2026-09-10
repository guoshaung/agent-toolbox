'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('右侧栏：左侧未满时星标直接加入左侧', async () => {
  const { togglePinned } = await import('../src/renderer/core/right-rail.js');
  const result = togglePinned({ left: ['a'], right: [] }, 'b', ['a', 'b', 'c']);
  assert.deepEqual(result.left, ['a', 'b']);
  assert.deepEqual(result.right, []);
  assert.equal(result.overflow, false);
});

test('右侧栏：左侧满 7 时返回 overflow 提示询问右侧栏', async () => {
  const { togglePinned } = await import('../src/renderer/core/right-rail.js');
  const left = ['1', '2', '3', '4', '5', '6', '7'];
  const result = togglePinned({ left, right: [] }, 'x', ['1', '2', '3', '4', '5', '6', '7', 'x']);
  assert.equal(result.overflow, true, '左侧已满应标记溢出');
  assert.deepEqual(result.left, left, '左侧不应变化');
});

test('右侧栏：确认后加入右侧栏', async () => {
  const { addToRight } = await import('../src/renderer/core/right-rail.js');
  const result = addToRight({ left: ['1'], right: ['a'] }, 'x', ['1', 'a', 'x']);
  assert.deepEqual(result.right, ['a', 'x']);
  assert.equal(result.full, false);
});

test('右侧栏：左右栏各自去重且过滤非法 id', async () => {
  const { sanitize } = await import('../src/renderer/core/right-rail.js');
  assert.deepEqual(sanitize(['a', 'a', 'bad', 'b'], ['a', 'b', 'c'], 7), ['a', 'b']);
});

test('右侧栏：移除收藏可从任意栏删除', async () => {
  const { removePinned } = await import('../src/renderer/core/right-rail.js');
  const result = removePinned({ left: ['a', 'b'], right: ['c'] }, 'c');
  assert.deepEqual(result.left, ['a', 'b']);
  assert.deepEqual(result.right, []);
});

test('右侧栏：再次点击已固定到右侧的工具等于取消收藏', async () => {
  const { togglePinned } = await import('../src/renderer/core/right-rail.js');
  const result = togglePinned({ left: ['a'], right: ['b'] }, 'b', ['a', 'b']);
  assert.deepEqual(result.left, ['a']);
  assert.deepEqual(result.right, []);
  assert.equal(result.overflow, false);
});

test('右侧栏：右侧满上限后 full=true', async () => {
  const { addToRight, RIGHT_MAX } = await import('../src/renderer/core/right-rail.js');
  const right = Array.from({ length: RIGHT_MAX }, (_, i) => `r${i}`);
  const eligible = [...right, 'x'];
  const result = addToRight({ left: [], right }, 'x', eligible);
  assert.equal(result.full, true);
});
