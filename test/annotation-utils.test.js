'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('科研批注搜索覆盖原文、译文、备注和标签', async () => {
  const { annotationMatches } = await import('../src/renderer/tools/research/annotation-utils.js');
  const item = { quote: 'attention map', note: '检查消融实验', translated_text: '注意力图', highlight_type: 'method' };
  assert.equal(annotationMatches(item, '消融'), true);
  assert.equal(annotationMatches(item, '注意力图'), true);
  assert.equal(annotationMatches(item, 'result'), false);
  assert.equal(annotationMatches(item, ''), true);
});

test('科研批注锚点兼容新旧字段并规范页码', async () => {
  const { annotationAnchor } = await import('../src/renderer/tools/research/annotation-utils.js');
  assert.deepEqual(annotationAnchor({ paragraph_id: 'p_004', page: '8' }), { paragraphId: 'p_004', page: 8 });
  assert.deepEqual(annotationAnchor({ paragraphId: 'p_text', page: 0 }), { paragraphId: 'p_text', page: null });
});
