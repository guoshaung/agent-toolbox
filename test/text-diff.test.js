'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('local word diff marks insertions and deletions without an AI call', async () => {
  const { diffWords } = await import('../src/renderer/tools/research/text-diff.js');
  const result = diffWords('static policy', 'adaptive policy');
  assert.deepEqual(result.filter((part) => part.type !== 'same').map((part) => [part.type, part.text]), [
    ['delete', 'static'], ['insert', 'adaptive'],
  ]);
});
