'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NetCapture, matchFilter } = require('../src/main/net-capture');

const entry = { method: 'POST', url: 'https://api.x.com/v1/pay?a=1', host: 'api.x.com', path: '/v1/pay?a=1', type: 'xhr', status: 500, size: 2048, ms: 120 };

test('过滤器：关键词、比较、字段、排除，多个条件是 AND', () => {
  assert.equal(matchFilter(entry, ''), true);
  assert.equal(matchFilter(entry, 'pay'), true);
  assert.equal(matchFilter(entry, 'refund'), false);
  assert.equal(matchFilter(entry, 'status>=400'), true);
  assert.equal(matchFilter(entry, 'status<400'), false);
  assert.equal(matchFilter(entry, 'method==POST'), true);
  assert.equal(matchFilter(entry, 'method==GET'), false);
  assert.equal(matchFilter(entry, 'host~x.com'), true);
  assert.equal(matchFilter(entry, '-pay'), false, '减号是排除');
  assert.equal(matchFilter(entry, 'pay status>=500 -png'), true, '几个条件要同时满足');
  assert.equal(matchFilter(entry, 'pay status<500'), false);
});

test('header 值是数组时压成一行', () => {
  assert.deepEqual(NetCapture.flatHeaders({ 'set-cookie': ['a=1', 'b=2'], 'x': 'y' }), [['set-cookie', 'a=1, b=2'], ['x', 'y']]);
});

test('超过上限的老记录会被挤掉，不会无限吃内存', () => {
  const cap = new NetCapture({});
  for (let i = 0; i < 3100; i += 1) cap._push({ id: `a${i}`, key: `k${i}`, done: true, type: 'xhr' });
  assert.equal(cap.entries.length, 3000);
  assert.equal(cap.entries[0].id, 'a100');
});

test('导出的 HAR 跳过加密隧道和没跑完的，格式能被 DevTools 认', () => {
  const cap = new NetCapture({});
  cap.entries = [
    { done: true, type: 'xhr', startedAt: Date.now(), ms: 10, method: 'GET', url: 'https://a.com/x', reqHeaders: [['a', '1']], resHeaders: [['content-type', 'application/json']], reqBody: '', resBody: '{}', status: 200, statusText: 'OK', size: 2 },
    { done: true, type: 'tunnel', startedAt: Date.now(), ms: 5, method: 'CONNECT', url: 'https://b.com', reqHeaders: [], resHeaders: [], reqBody: '', resBody: '', status: 200, size: 9 },
    { done: false, type: 'xhr', startedAt: Date.now(), ms: 0, method: 'GET', url: 'https://c.com', reqHeaders: [], resHeaders: [], reqBody: '', resBody: '', status: 0, size: 0 },
  ];
  const har = cap.toHar();
  assert.equal(har.log.entries.length, 1);
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.entries[0].request.url, 'https://a.com/x');
  assert.equal(har.log.entries[0].response.status, 200);
});
