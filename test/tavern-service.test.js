'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findFreePort, probe, resolveCommand, tavernRoot } = require('../src/main/tavern-service');

test('探测空闲端口返回可用端口号', async () => {
  const port = await findFreePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
});

test('未监听端口探测为未运行', async () => {
  // 找一个真正空闲的端口再探测，避免撞上本地恰好跑着的服务。
  const port = await findFreePort();
  const result = await probe(port);
  assert.equal(result.running, false);
  assert.equal(result.isTavern, false);
});

test('tavernRoot 落在 userData 下', () => {
  const root = tavernRoot('C:/fake-user-data');
  assert.ok(root.replace(/\\/g, '/').endsWith('/fake-user-data/tavern-runtime'));
});

test('本机能解析到 node 命令（酒馆依赖它启动）', () => {
  assert.ok(resolveCommand('node'));
});
