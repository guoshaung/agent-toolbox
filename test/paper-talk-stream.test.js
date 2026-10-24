'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestPaperText } = require('../src/main/paper-talk-api');

function response(body) {
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(c) {
    // Split inside UTF-8 characters and SSE lines, as real network packets do.
    for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
    c.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const cfg = { endpoint: 'https://example.test/chat/completions', apiKey: 'test-secret', model: 'test', prompt: 'lesson' };

test('长脚本通过 SSE 完整收集，跨数据块中文不损坏', async () => {
  const text = await requestPaperText({ ...cfg, fetchFn: async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"论文"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
  } });
  assert.equal(text, '你好论文');
});

test('中断的流不能冒充完整脚本', async () => {
  await assert.rejects(requestPaperText({ ...cfg, fetchFn: async () => response('data: {"choices":[{"delta":{"content":"部分正文"}}]}\n') }), /连接中断/);
});

test('上游报错中的密钥被遮蔽', async () => {
  await assert.rejects(requestPaperText({ ...cfg, fetchFn: async () => new Response('test-secret', { status: 401 }) }), e => e.message.includes('[已隐藏]') && !e.message.includes('test-secret'));
});
