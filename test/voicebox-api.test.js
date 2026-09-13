'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const voiceboxApi = require('../src/main/voicebox-api');

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) };
}

test('Voicebox REST 客户端读取健康状态和音色列表', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/health')) return jsonResponse({ status: 'healthy', model_loaded: true });
    return jsonResponse([{ id: 'profile-1', name: '研究员' }]);
  };
  try {
    assert.equal((await voiceboxApi.health()).status, 'healthy');
    assert.equal((await voiceboxApi.profiles())[0].id, 'profile-1');
    assert.deepEqual(calls, ['http://127.0.0.1:17493/health', 'http://127.0.0.1:17493/profiles']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Voicebox REST 客户端读取活动模型下载进度', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:17493/tasks/active');
    return jsonResponse({ downloads: [{ model_name: 'whisper-turbo', status: 'downloading', progress: 47.5 }] });
  };
  try {
    const result = await voiceboxApi.activeTasks();
    assert.equal(result.downloads[0].model_name, 'whisper-turbo');
    assert.equal(result.downloads[0].progress, 47.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Voicebox REST 客户端提交异步生成、轮询完成并返回可播放音频', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/generate')) return jsonResponse({ id: 'generation-1', status: 'generating' });
    if (url.endsWith('/history/generation-1')) return jsonResponse({ id: 'generation-1', status: 'completed', duration: 1.2 });
    return { ok: true, status: 200, headers: { get: (name) => name === 'content-type' ? 'audio/wav' : '' }, arrayBuffer: async () => Uint8Array.from([82, 73, 70, 70]).buffer };
  };
  try {
    const result = await voiceboxApi.generateAudio({ text: '今天学习注意力机制。', profileId: 'profile-1', language: 'zh', interval: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.id, 'generation-1');
    assert.match(result.audioDataUrl, /^data:audio\/wav;base64,/);
    assert.equal(JSON.parse(calls[0].options.body).profile_id, 'profile-1');
    assert.equal(JSON.parse(calls[0].options.body).language, 'zh');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Voicebox REST 客户端可以把本地视频送入 Whisper 转写接口', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-transcribe-'));
  const file = path.join(dir, 'lecture.mp4');
  fs.writeFileSync(file, 'video fixture');
  let request;
  global.fetch = async (url, options = {}) => {
    request = { url, options };
    return jsonResponse({ text: '这是 Voicebox 转写的字幕。', duration: 3.2 });
  };
  try {
    const result = await voiceboxApi.transcribeFile(file);
    assert.equal(result.ok, true);
    assert.match(result.text, /Voicebox 转写/);
    assert.equal(result.model, 'turbo');
    assert.equal(request.url, 'http://127.0.0.1:17493/transcribe');
    assert.equal(request.options.method, 'POST');
    assert.equal(typeof request.options.body?.get, 'function');
    assert.equal(request.options.body.get('model'), 'turbo');
    assert.equal(request.options.body.get('language'), 'auto');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox API 对象错误会保留模型下载提示', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-error-'));
  const file = path.join(dir, 'sample.wav');
  fs.writeFileSync(file, 'audio fixture');
  global.fetch = async () => jsonResponse({ detail: { message: 'Whisper model turbo is being downloaded. Please wait and try again.', downloading: true } }, 400);
  try {
    await assert.rejects(
      () => voiceboxApi.transcribeFile(file, { retryTimeout: 0 }),
      /Whisper model turbo is being downloaded/,
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox 转写会在 Whisper 模型下载完成后自动重试', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-retry-'));
  const file = path.join(dir, 'sample.wav');
  fs.writeFileSync(file, 'audio fixture');
  let attempts = 0;
  global.fetch = async (url) => {
    if (!url.endsWith('/transcribe')) throw new Error(`unexpected url: ${url}`);
    attempts += 1;
    if (attempts === 1) return jsonResponse({ detail: { message: 'Whisper model turbo is being downloaded. Please wait and try again.', downloading: true } }, 400);
    return jsonResponse({ text: '模型下载完成后的字幕。', duration: 1.5 });
  };
  try {
    const result = await voiceboxApi.transcribeFile(file, { retryDelay: 1, retryTimeout: 1000 });
    assert.equal(result.text, '模型下载完成后的字幕。');
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox 视频上传使用正确的 MP4 MIME 类型', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-mime-'));
  const file = path.join(dir, 'clip.mp4');
  fs.writeFileSync(file, 'video fixture');
  let uploaded;
  global.fetch = async (_url, options = {}) => {
    uploaded = options.body?.get('file');
    return jsonResponse({ text: '字幕', duration: 1 });
  };
  try {
    await voiceboxApi.transcribeFile(file);
    assert.equal(uploaded.type, 'video/mp4');
    assert.equal(uploaded.name, 'clip.mp4');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox 返回空文本且 Whisper 模型正在下载时会报告真实原因', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-empty-download-'));
  const file = path.join(dir, 'sample.mp4');
  fs.writeFileSync(file, 'video fixture');
  global.fetch = async (url) => {
    if (url.endsWith('/transcribe')) return jsonResponse({ text: '', duration: 0 });
    if (url.endsWith('/tasks/active')) return jsonResponse({ downloads: [{ model_name: 'whisper-turbo', status: 'downloading', progress: 47.471 }] });
    throw new Error(`unexpected url: ${url}`);
  };
  try {
    await assert.rejects(
      () => voiceboxApi.transcribeFile(file),
      (error) => error.code === 'model-downloading' && /47\.5%/.test(error.message) && /暂时不能转写/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox 真正没有识别到语音时会给出可操作的空文本提示', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-empty-audio-'));
  const file = path.join(dir, 'silent.mp4');
  fs.writeFileSync(file, 'video fixture');
  global.fetch = async (url) => {
    if (url.endsWith('/transcribe')) return jsonResponse({ text: '', duration: 2 });
    if (url.endsWith('/tasks/active')) return jsonResponse({ downloads: [] });
    throw new Error(`unexpected url: ${url}`);
  };
  try {
    await assert.rejects(
      () => voiceboxApi.transcribeFile(file),
      (error) => error.code === 'empty-transcript' && /没有识别到语音内容/.test(error.message) && /同名字幕/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Voicebox REST 客户端可以取消模型下载任务', async () => {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (url, options = {}) => {
    assert.equal(url, 'http://127.0.0.1:17493/models/download/cancel');
    body = JSON.parse(options.body);
    return jsonResponse({ cancelled: true });
  };
  try {
    assert.deepEqual(await voiceboxApi.cancelDownload('whisper-turbo'), { cancelled: true });
    assert.deepEqual(body, { model_name: 'whisper-turbo' });
  } finally {
    global.fetch = originalFetch;
  }
});
