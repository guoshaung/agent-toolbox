'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('科研演示数据：正文行转换为要点并过滤不安全图片', async () => {
  const { normalizeDeck, normalizeSlide } = await import('../src/renderer/tools/research/presentation.js');
  const slide = normalizeSlide({ title: '结果', body: '第一条\n\n第二条', imageDataUrl: 'file:///tmp/x.png' }, 0);
  assert.deepEqual(slide.bullets, ['第一条', '第二条']);
  assert.equal(slide.imageDataUrl, '');

  const deck = normalizeDeck({ title: '  Demo  ', slides: Array.from({ length: 40 }, (_, index) => ({ title: `页 ${index + 1}` })) });
  assert.equal(deck.title, 'Demo');
  assert.equal(deck.slides.length, 30);
});
