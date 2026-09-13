'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('科研画板删除对象会同时移除关联连线，并且可完整撤销', async () => {
  const { removeFigureItems } = await import('../src/renderer/tools/research/figureboard.js');
  const items = [
    { id: 'a', type: 'rect' },
    { id: 'b', type: 'rect' },
    { id: 'c', type: 'rect' },
    { id: 'ab', type: 'wire', from: { id: 'a' }, to: { id: 'b' } },
    { id: 'bc', type: 'wire', from: { id: 'b' }, to: { id: 'c' } },
  ];
  const next = removeFigureItems(items, new Set(['a', 'b']));
  assert.deepEqual(next.map((item) => item.id), ['c']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c', 'ab', 'bc']);
});

test('科研画板删除悬空连线本身不会误删其他对象', async () => {
  const { removeFigureItems } = await import('../src/renderer/tools/research/figureboard.js');
  const items = [
    { id: 'a', type: 'rect' },
    { id: 'wire', type: 'wire', from: { id: 'a' }, toPoint: { x: 120, y: 80 } },
  ];
  assert.deepEqual(removeFigureItems(items, new Set(['wire'])).map((item) => item.id), ['a']);
});
