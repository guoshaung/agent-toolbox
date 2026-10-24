'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuota, parseStream, buildBody, QwenWork } = require('../src/main/ai-hub-qwenwork');
const frame = b => `data: ${JSON.stringify(b)}\n\n`;
test('QwenWork requires all three credit pools and never fabricates missing balances', () => {
  const data = { daily_credits: { total_balance: 100 }, monthly_credits: { total_balance: 0 }, longterm_credits: { total_balance: 3.5 } };
  assert.equal(parseQuota({ data }).remaining, 103.5);
  assert.equal(parseQuota({ data }).pools.length, 3);
  delete data.monthly_credits; assert.throws(() => parseQuota({ data }), /缺失/);
  assert.throws(() => parseQuota({ success: false, data }), /失败/);
});
test('QwenWork unwraps nested events, preserves real usage and requires finish', () => {
  const raw = frame({ statusCodeValue: 200, body: JSON.stringify({ choices: [{ delta: { content: '你' }, finish_reason: null }] }) }) + frame({ statusCodeValue: 200, body: { choices: [{ delta: { content: '好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2 } } });
  const value = parseStream(raw, 'flash'); assert.equal(value.choices[0].message.content, '你好'); assert.equal(value.usage.prompt_tokens, 8);
  assert.throws(() => parseStream(frame({ choices: [{ delta: { content: 'unfinished' } }] }), 'flash'), /未完整/);
  assert.throws(() => parseStream(raw + frame({ statusCodeValue: 429, body: 'private account error' }), 'flash'), e => e.status === 429 && !e.message.includes('private'));
  assert.throws(() => parseStream(raw + frame({ body: { code: 401, message: 'secret' } }), 'flash'), /业务错误/);
});
test('QwenWork rejects unsupported payloads instead of dropping tools or images', () => {
  const b = { model: 'flash', messages: [{ role: 'user', content: 'hello' }] };
  const p = buildBody(b); assert.equal(p.messages[0].content, 'hello'); assert.equal(p.business.product, 'qoder_work');
  assert.throws(() => buildBody({ ...b, tools: [] }), /工具调用/);
  assert.throws(() => buildBody({ ...b, messages: [{ role: 'user', content: [] }] }), /文本/);
});
test('QwenWork routes bounded requests without redirect and has no invented token usage', async () => {
  const q = new QwenWork({ authReader: async () => ({ token: 'private' }), fetchImpl: async (url, opts) => {
    assert.equal(opts.redirect, 'error');
    return new Response(frame({ body: { choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] } }));
  } });
  q.prepare = async () => ({ url: 'https://gateway.qwenwork.cn/test', headers: {}, body: 'sealed' });
  const r = await q.chat({}, { model: 'flash', messages: [{ role: 'user', content: 'hi' }], stream: false });
  const body = await r.json(); assert.equal(body.choices[0].message.content, 'OK'); assert(!Object.hasOwn(body, 'usage'));
});
