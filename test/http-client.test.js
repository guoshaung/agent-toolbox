'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('../src/main/http-client');

test('只放行 http/https，别的协议直接拒', () => {
  assert.equal(http.parseUrl('example.com/a').href, 'http://example.com/a');
  assert.equal(http.parseUrl(' https://a.b/c ').href, 'https://a.b/c');
  assert.throws(() => http.parseUrl('file:///etc/passwd'), /只支持 http/);
  assert.throws(() => http.parseUrl(''), /没有填网址/);
});

test('{{变量}} 替换；没定义的原样留着，好让人看出漏了哪个', () => {
  assert.equal(http.applyVars('{{base}}/u/{{id}}', { base: 'http://x', id: 7 }), 'http://x/u/7');
  assert.equal(http.applyVars('{{miss}}/a', {}), '{{miss}}/a');
});

test('请求头一行一条，空行和 # 注释跳过', () => {
  assert.deepEqual(http.parseHeaderLines('A: 1\n\n# 注释\nB:2\n坏行'), [['A', '1'], ['B', '2']]);
});

test('curl 拆解：方法、头、体、Copy as cURL 那些没用的开关都能吃', () => {
  const r = http.fromCurl(`curl 'https://api.x.com/v1/items?q=1' \\
  -X POST --compressed -L \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer tok' \\
  --data-raw '{"a":1}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.x.com/v1/items?q=1');
  assert.equal(r.bodyType, 'json');
  assert.equal(r.body, '{"a":1}');
  assert.match(r.headers, /Authorization: Bearer tok/);
});

test('curl 里 -u 变成 Basic 头；没写 -X 但有 body 就当 POST', () => {
  const r = http.fromCurl("curl http://x.com -u ann:pw -d 'a=1'");
  assert.equal(r.method, 'POST');
  assert.match(r.headers, new RegExp(`Authorization: Basic ${Buffer.from('ann:pw').toString('base64')}`));
});

test('拼回 curl 时把单引号转义掉，粘进终端不会断成两条命令', () => {
  const curl = http.toCurl({ method: 'POST', url: 'http://x.com', headers: '', body: "it's" });
  assert.match(curl, /--data-raw 'it'\\''s'/);
  assert.doesNotMatch(curl.replace(/'\\''/g, ''), /'.*'.*'/);
});

test('发请求：带上真实发出的头，超时报人话', async () => {
  const fake = async (url, init) => new Response('{"ok":1}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } });
  const r = await http.send({ method: 'POST', url: '{{base}}/x', vars: { base: 'http://h' }, headers: 'X-A: 1', body: '{}', bodyType: 'json' }, { fetchImpl: fake });
  assert.equal(r.ok, true);
  assert.equal(r.status, 201);
  assert.equal(r.body, '{"ok":1}');
  assert.equal(r.request.url, 'http://h/x');
  assert.ok(r.request.headers.some(([k, v]) => k === 'x-a' && v === '1'));
  assert.ok(r.request.headers.some(([k]) => k === 'content-type'), 'json 体自动补 content-type');

  const boom = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  const bad = await http.send({ url: 'http://127.0.0.1:1' }, { fetchImpl: boom });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /端口没开/);
});

test('头里有中文时按 UTF-8 字节发出去（和 curl 一致），并如实报告，不再悄悄丢掉', async () => {
  let seen = null;
  const fake = async (url, init) => { seen = [...init.headers.entries()]; return new Response('', { status: 200 }); };
  const r = await http.send({ url: 'http://h', headers: 'X-Demo: 工具箱' }, { fetchImpl: fake });
  const sent = seen.find(([k]) => k === 'x-demo')[1];
  assert.equal(Buffer.from(sent, 'latin1').toString('utf8'), '工具箱', '服务端收到的应该是正确的 UTF-8 字节');
  assert.match(r.warnings.join(), /非 ASCII/);
});

test('被内核拉黑的端口给一句能懂的话，而不是 "bad port"', () => {
  assert.match(http.describeFetchError({ cause: { message: 'bad port' } }), /端口被浏览器内核拉黑/);
});
