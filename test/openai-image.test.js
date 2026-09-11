'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { OpenAIImageClient, parseSize, validateSize, resolveApiKey } = require('../src/main/openai-image');

const PNG_B64 = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test('image：尺寸解析与校验遵循官方任意尺寸规则', () => {
  assert.deepEqual(parseSize('1536x864'), { width: 1536, height: 864 });
  assert.equal(parseSize('abc'), null);
  assert.equal(parseSize('0x512'), null);

  assert.equal(validateSize('1536x864').ok, true);
  assert.equal(validateSize('1024x1024').ok, true);
  assert.equal(validateSize('1536x863').ok, false, '未被 16 整除');
  assert.equal(validateSize('5000x512').ok, false, '超过 3840');
  assert.equal(validateSize('3840x1024').ok, false, '宽高比超过 3:1');
  assert.equal(validateSize('512x3840').ok, false, '宽高比超过 1:3');
  assert.equal(validateSize('1024').ok, false);
});

test('image：resolveApiKey 只用注入与环境变量，不落日志', () => {
  assert.equal(resolveApiKey('sk-explicit'), 'sk-explicit');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env';
  assert.equal(resolveApiKey(), 'sk-env');
  if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
});

test('image：缺 Key 时直接失败且不发起网络请求', async () => {
  const client = new OpenAIImageClient({ apiKey: '', fetchImpl: async () => { throw new Error('should not fetch'); } });
  const result = await client.generateImage('hello', { model: 'gpt-image-2', outputDir: os.tmpdir() });
  assert.equal(result.ok, false);
  assert.match(result.error, /API Key/);
});

test('image：429 指数退避后成功，usage 透传', async () => {
  let calls = 0;
  const client = new OpenAIImageClient({
    apiKey: 'sk-test',
    retryBaseMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: 'rate limited' }, { 'retry-after': '0' });
      return jsonResponse(200, {
        created: 123,
        data: [{ b64_json: PNG_B64 }],
        usage: { input_tokens: 10, output_tokens: 800, total_tokens: 810 },
      });
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicebox-img-'));
  const result = await client.generateImage('a circle', { model: 'gpt-image-2', size: '1024x1024', outputDir: dir, filename: 'test.png' });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(result.meta.usage, { input_tokens: 10, output_tokens: 800, total_tokens: 810 });
  assert.equal(result.meta.attempts, 2);
  const saved = fs.readFileSync(path.join(dir, 'test.png'));
  assert.equal(saved.subarray(0, 4).toString('hex'), '89504e47');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('image：超过重试上限返回错误而不是无限重试', async () => {
  let calls = 0;
  const client = new OpenAIImageClient({
    apiKey: 'sk-test',
    maxRetries: 2,
    retryBaseMs: 1,
    fetchImpl: async () => { calls += 1; return jsonResponse(429, {}); },
  });
  const result = await client.generateImage('a circle', { model: 'gpt-image-2', size: '1024x1024' });
  assert.equal(result.ok, false);
  assert.match(result.error, /429/);
  assert.equal(calls, 3, '1 次原始 + 2 次重试');
});

test('image：批量 concurrency=2 限制并发且单张失败不拖垮整体', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const client = new OpenAIImageClient({
    apiKey: 'sk-test',
    retryBaseMs: 1,
    fetchImpl: async (url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const prompt = JSON.parse(init.body).prompt;
      await new Promise((resolve) => setTimeout(resolve, prompt.includes('SLOW') ? 30 : 5));
      inFlight -= 1;
      if (prompt.includes('FAIL')) return jsonResponse(500, { error: { message: 'boom' } });
      return jsonResponse(200, { data: [{ b64_json: PNG_B64 }], usage: { total_tokens: 10 } });
    },
  });
  const results = await client.generateImages(['p1', 'p2 SLOW', 'p3 FAIL', 'p4'], { concurrency: 2, model: 'gpt-image-2', size: '1024x1024' });
  assert.equal(results.length, 4);
  assert.equal(maxInFlight <= 2, true, `最大并发应 ≤2，实际 ${maxInFlight}`);
  assert.equal(results.filter((r) => r.ok).length, 3, '3 张成功');
  assert.equal(results[2].ok, false, '失败的 1 张独立返回错误');
  assert.match(results[2].error, /boom|500/);
  assert.equal(results.every((r, i) => r.promptIndex === i), true, '结果顺序与输入一致');
});

test('image：非法 size 不发起网络请求', async () => {
  const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchImpl: async () => { throw new Error('should not fetch'); } });
  const result = await client.generateImage('hello', { size: '100x100' });
  assert.equal(result.ok, false);
  assert.match(result.error, /16/);
});
