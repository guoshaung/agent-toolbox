'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractArxivId, looksLikeId } = require('../src/main/pdf-title');

test('编号命名识别支持 arXiv 前缀和版本号', () => {
  assert.equal(extractArxivId('arXiv 2410.06153.pdf'), '2410.06153');
  assert.equal(extractArxivId('arxiv:2408.08435v2.pdf'), '2408.08435');
  assert.equal(extractArxivId('2408.08435.pdf'), '2408.08435');
  assert.equal(looksLikeId('arXiv 2410.06153.pdf'), true);
});
