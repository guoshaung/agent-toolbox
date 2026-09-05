'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('视频工具渲染器模块可以被 Electron 加载', async () => {
  const module = await import('../src/renderer/tools/video/index.js');
  assert.equal(typeof module.default.create, 'function');
});
