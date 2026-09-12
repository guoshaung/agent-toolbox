'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('科研检索历史：相同条件置顶、去重并限制数量', async () => {
  const { pushSearchHistory, searchHistoryKey } = await import('../src/renderer/tools/research/search-history.js');
  const first = { query: '多模态 幻觉', yearFrom: 2022, yearTo: 2026, openAccessOnly: true, savedAt: 1 };
  const second = { query: 'RAG 评测', yearFrom: 2023, yearTo: 2026, openAccessOnly: false, savedAt: 2 };
  let history = pushSearchHistory([], first, 2);
  history = pushSearchHistory(history, second, 2);
  history = pushSearchHistory(history, { ...first, savedAt: 3 }, 2);
  assert.deepEqual(history.map(searchHistoryKey), [searchHistoryKey(first), searchHistoryKey(second)]);
  assert.equal(pushSearchHistory(history, { query: '  ' }, 2).length, 2);
});
