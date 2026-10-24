'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quota, parseReply, promptOf, targetAllowed, DoubaoWork, MODEL } = require('../src/main/ai-hub-doubao-work');
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const reply = event('FULL_MSG_NOTIFY', { message: { content_block: [{ content: { text_block: { text: 'user text must not echo' } } }] } }) + event('STREAM_CHUNK', { patch_op: [{ patch_value: { content_block: [{ block_type: 10000, content: { text_block: { text: 'OK' } } }] } }] }) + event('SSE_REPLY_END', { answer_finish_attr: {} });
test('Doubao work quota preserves unknown and less-than-one windows without fabricating balances', () => {
  const q = quota({ code: 0, data: { window_limit_section: { window_limit_groups: [{ feature_group: 'general', window_limits: [{ window_type: 1, used_amount: '<1', total_amount: '2,100', less_than_one_percent: true }] }] } } });
  assert.equal(q.windows[0].usedText, '<1'); assert.equal(q.windows[0].usedPercent, null);
  assert.equal(q.windows[0].resetAt, null); assert.equal(q.remaining, undefined);
  assert.throws(() => quota({ code: 710012001 }), /expired/);
  assert.throws(() => quota({ code: 0, data: {} }), /unavailable/);
});
test('Doubao parser requires a completed answer and rejects business errors even on HTTP 200', () => {
  assert.deepEqual(parseReply(reply), { content: 'OK' });
  assert.throws(() => parseReply(reply.split('event: SSE_REPLY_END')[0]), /完整/);
  assert.throws(() => parseReply(reply + event('STREAM_ERROR', { error_code: 710022004 })), e => e.status === 429);
  assert.throws(() => parseReply(event('SSE_REPLY_END', {})), /完整/);
});
test('Doubao rejects unsupported capabilities and unrelated browser targets', () => {
  const b = { model: MODEL, messages: [{ role: 'user', content: 'hello' }] };
  assert.equal(promptOf(b), 'hello');
  assert.throws(() => promptOf({ ...b, tools: [] }), /工具调用/);
  assert.throws(() => promptOf({ ...b, messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }), /文本/);
  assert.throws(() => promptOf({ ...b, model: 'made-up-model' }), /自动模型/);
  assert(targetAllowed({ type: 'page', url: 'doubaowork://doubaowork-chat/chat' }));
  assert(!targetAllowed({ type: 'page', url: 'https://evil.example/doubaowork-chat/chat' }));
});
test('Doubao session binding rejects account changes and never returns the cookie from inspect', async () => {
  let closed = 0;
  const bridge = new DoubaoWork({ connectImpl: async () => ({ command: async () => ({ cookies: [{ name: 'uid_tt', value: 'private-session', domain: '.doubao.com' }] }), close: () => closed++ }), fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://www.doubao.com'); assert.equal(options.redirect, 'error');
    return Response.json({ code: 0, data: { current_subscription: { merchant_user_id: 'user-A' }, window_limit_section: { window_limit_groups: [{ window_limits: [{ window_type: 1, used_percent: 0 }] }] } } });
  } });
  const info = await bridge.inspect(); assert(!JSON.stringify(info).includes('private-session'));
  await assert.rejects(bridge.inspect({ fingerprint: 'different' }), e => e.status === 401);
  assert.equal(closed, 2);
});
