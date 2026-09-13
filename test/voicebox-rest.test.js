'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VoiceboxRestClient, parseHealth, parseGeneration } = require('../src/main/voicebox-rest');

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(body),
  };
}

test('rest：解析 health / generation', () => {
  assert.deepEqual(parseHealth({ status: 'healthy', backend_type: 'pytorch', gpu_available: true }), { healthy: true, backend: 'pytorch', gpuAvailable: true });
  assert.equal(parseHealth({ status: 'starting' }).healthy, false);
  assert.deepEqual(parseGeneration({ id: 'g1', status: 'completed', duration: 2.5, audio_path: 'x.wav', model_size: '0.6B' }), { id: 'g1', status: 'completed', duration: 2.5, audioPath: 'x.wav', error: null, modelSize: '0.6B' });
});

test('rest：probeHealth 网络错误返回未运行', async () => {
  const client = new VoiceboxRestClient({ fetchImpl: async () => { throw new Error('connection refused'); }, retryBaseMs: 1, maxRetries: 1 });
  const result = await client.probeHealth();
  assert.equal(result.running, false);
  assert.match(result.error, /connection refused/);
});

test('rest：generate payload 显式带 model_size 0.6B', async () => {
  let body;
  const client = new VoiceboxRestClient({ fetchImpl: async (url, init) => {
    if (url.endsWith('/profiles') && (!init || init.method === 'GET')) return response(200, []);
    if (url.endsWith('/profiles')) return response(200, { id: 'profile-1' });
    body = JSON.parse(init.body);
    return response(200, { id: 'g1', status: 'generating', model_size: '0.6B' });
  } });
  const result = await client.generate({ text: '你好' });
  assert.equal(result.ok, true);
  assert.equal(result.modelSize, '0.6B');
  assert.equal(body.model_size, '0.6B');
  assert.equal(body.engine, 'qwen_custom_voice');
});

test('rest：ensureZhPresetProfile 只创建一次并缓存', async () => {
  let creates = 0;
  const client = new VoiceboxRestClient({ fetchImpl: async (url, init) => {
    if (url.endsWith('/profiles') && (!init || init.method === 'GET')) return response(200, []);
    if (url.endsWith('/profiles')) { creates += 1; return response(200, { id: 'profile-1' }); }
    return response(200, {});
  } });
  assert.equal((await client.ensureZhPresetProfile()).profileId, 'profile-1');
  assert.equal((await client.ensureZhPresetProfile()).profileId, 'profile-1');
  assert.equal(creates, 1);
});

test('rest：普通 REST 请求遇到 429 退避后成功', async () => {
  let calls = 0;
  const client = new VoiceboxRestClient({ retryBaseMs: 1, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? response(429, { detail: 'busy' }, { 'retry-after': '0' }) : response(200, []);
  } });
  const result = await client.listProfiles();
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test('rest：健康探测连接失败时不做指数退避', async () => {
  let calls = 0;
  const client = new VoiceboxRestClient({ retryBaseMs: 1000, fetchImpl: async () => { calls += 1; throw new Error('connection refused'); } });
  const started = Date.now();
  const result = await client.probeHealth();
  assert.equal(result.running, false);
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 500, '健康探测应快速失败，避免点击按钮后长时间无反馈');
});

test('rest：pollGeneration completed 与超时', async () => {
  const completed = new VoiceboxRestClient({ fetchImpl: async () => response(200, { id: 'g1', status: 'completed', duration: 3, audio_path: 'a.wav' }) });
  const result = await completed.pollGeneration('g1', { timeoutMs: 50, intervalMs: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.duration, 3);

  const timeout = new VoiceboxRestClient({ fetchImpl: async () => response(200, { id: 'g2', status: 'generating' }) });
  const timed = await timeout.pollGeneration('g2', { timeoutMs: 5, intervalMs: 2 });
  assert.equal(timed.ok, false);
  assert.match(timed.error, /超时/);
});

test('rest：pollGeneration 兼容 SSE 状态响应（data: {...}）', async () => {
  const client = new VoiceboxRestClient({ fetchImpl: async () => response(200, {}) , });
  // 手动覆盖：request() 对 SSE 文本解析不出 json，但 text 保留原始内容
  client.request = async () => ({ ok: true, text: 'data: {"id":"g3","status":"completed","duration":4.8}', json: null, attempts: 1, status: 200 });
  const result = await client.pollGeneration('g3', { timeoutMs: 100, intervalMs: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.duration, 4.8);
});

test('rest：fetchAudio 返回二进制 buffer 与播放 URL', async () => {
  const client = new VoiceboxRestClient({ fetchImpl: async () => response(200, Buffer.from('RIFF-test')) });
  const result = await client.fetchAudio('g1');
  assert.equal(result.ok, true);
  assert.equal(result.buffer.toString(), 'RIFF-test');
  assert.equal(VoiceboxRestClient.getAudioUrl('g1'), 'http://127.0.0.1:17493/audio/g1');
});