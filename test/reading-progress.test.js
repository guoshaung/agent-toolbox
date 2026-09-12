'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('科研阅读进度：滚动位置可归一化、恢复并显示页码', async () => {
  const progress = await import('../src/renderer/tools/research/reading-progress.js');
  const {
    clampProgress, scrollProgress, scrollTopForProgress, visiblePage, progressLabel,
  } = progress;

  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(1.5), 1);
  assert.equal(scrollProgress({ scrollTop: 300, scrollHeight: 1300, clientHeight: 300 }), 0.3);
  assert.equal(scrollTopForProgress(0.3, 1300, 300), 300);
  assert.equal(scrollTopForProgress(9, 1300, 300), 1000);
  assert.equal(visiblePage([{ page: 1, offset: 0 }, { page: 2, offset: 800 }, { page: 3, offset: 1600 }], 900, 500), 2);
  assert.equal(progressLabel({ progress: 0.3, page: 2, pageCount: 8 }), '30% · 第 2/8 页');
  assert.equal(progressLabel({ progress: 1, page: 8, pageCount: 8 }), '已读');
});
