'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VOICEBOX_BASE_URL = 'http://127.0.0.1:17493';

function apiError(message, code = 'voicebox-api') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function request(pathname, options = {}) {
  let response;
  try {
    response = await fetch(`${VOICEBOX_BASE_URL}${pathname}`, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
  } catch (error) {
    throw apiError(`Voicebox 未运行：${error.message}`, 'not-running');
  }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const rawDetail = typeof body === 'string' ? body : body?.detail || body?.error || body;
    const detail = typeof rawDetail === 'string' ? rawDetail : rawDetail?.message || JSON.stringify(rawDetail);
    throw apiError(`Voicebox API ${response.status}：${String(detail).slice(0, 400)}`, 'http');
  }
  return body;
}

async function health() {
  return request('/health');
}

async function profiles() {
  const result = await request('/profiles');
  return Array.isArray(result) ? result : [];
}

async function transcribeFile(filePath, { language = 'auto', model = 'turbo', retryDelay = 2000, retryTimeout = 30 * 60 * 1000 } = {}) {
  const file = path.resolve(String(filePath || ''));
  let stat;
  try { stat = await fs.promises.stat(file); } catch (error) { throw apiError(`读取视频失败：${error.message}`, 'file'); }
  if (!stat.isFile()) throw apiError('转写目标不是文件。', 'file');
  const mime = /\.(mp4|m4v)$/i.test(file) ? 'video/mp4' : /\.mov$/i.test(file) ? 'video/quicktime' : 'application/octet-stream';
  const blob = typeof fs.openAsBlob === 'function'
    ? await fs.openAsBlob(file, { type: mime })
    : new Blob([await fs.promises.readFile(file)], { type: mime });
  const buildForm = () => {
    const form = new FormData();
    form.append('file', blob, path.basename(file));
    form.append('model', model);
    form.append('language', language);
    return form;
  };
  const started = Date.now();
  let result;
  while (!result) {
    try {
      result = await request('/transcribe', { method: 'POST', body: buildForm() });
    } catch (error) {
      const downloading = error.code === 'http' && /model .*(?:download|downloading)|being downloaded/i.test(error.message);
      if (!downloading || Date.now() - started >= retryTimeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(retryDelay) || 0)));
    }
  }
  const text = String(result?.text || '').trim();
  if (!text) {
    try {
      const downloads = await activeTasks();
      const modelName = `whisper-${String(model || '').trim().toLowerCase()}`;
      const task = (Array.isArray(downloads?.downloads) ? downloads.downloads : []).find((candidate) => (
        String(candidate?.model_name || '').toLowerCase() === modelName
        && ['downloading', 'queued', 'pending'].includes(String(candidate?.status || '').toLowerCase())
      ));
      if (task) {
        const progress = Number(task.progress);
        const progressText = Number.isFinite(progress) && progress > 0 ? `当前约 ${progress.toFixed(1)}%` : '正在下载';
        throw apiError(`Voicebox 的 Whisper ${model} 模型${progressText}，暂时不能转写。请等待模型下载完成，或在视频页切换较小的 Whisper 模型后重试。`, 'model-downloading');
      }
    } catch (error) {
      if (error.code === 'model-downloading') throw error;
    }
    throw apiError('Voicebox 转写返回了空文本：没有识别到语音内容，可能是视频没有音轨、音量过低或格式暂不支持。请确认视频可正常播放，或放置同名字幕文件后重试。', 'empty-transcript');
  }
  return { ok: true, text, duration: Number(result?.duration || 0), model };
}

async function history(limit = 20) {
  const result = await request(`/history?limit=${Math.min(100, Math.max(1, Number(limit) || 20))}`);
  return Array.isArray(result) ? result : result?.items || [];
}

async function activeTasks() {
  return request('/tasks/active');
}

async function cancelDownload(modelName) {
  return request('/models/download/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_name: String(modelName || '') }),
  });
}

async function generate({ text, profileId, language = 'zh', maxChunkChars = 1200 } = {}) {
  if (!String(text || '').trim()) throw apiError('朗读文本为空。', 'invalid-input');
  if (!String(profileId || '').trim()) throw apiError('还没有选择 Voicebox 音色。', 'invalid-input');
  return request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: String(text).slice(0, 50000),
      profile_id: String(profileId),
      language,
      max_chunk_chars: Math.min(5000, Math.max(100, Number(maxChunkChars) || 1200)),
      crossfade_ms: 50,
      normalize: true,
    }),
  });
}

async function getGeneration(id) {
  if (!id) throw apiError('Voicebox 没有返回生成任务 ID。', 'invalid-response');
  return request(`/history/${encodeURIComponent(id)}`);
}

async function waitForGeneration(id, { timeout = 10 * 60 * 1000, interval = 500, onProgress } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await getGeneration(id);
    const status = String(last?.status || '').toLowerCase();
    onProgress?.(last);
    if (['completed', 'complete', 'done'].includes(status)) return last;
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw apiError(`Voicebox 生成失败：${last?.error || status}`, 'generation-failed');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw apiError(`Voicebox 生成超时（${Math.round(timeout / 60000)} 分钟），可在 Voicebox 历史记录中查看。`, 'timeout');
}

async function audioDataUrl(id) {
  let response;
  try {
    response = await fetch(`${VOICEBOX_BASE_URL}/audio/${encodeURIComponent(id)}`);
  } catch (error) {
    throw apiError(`读取 Voicebox 音频失败：${error.message}`, 'audio');
  }
  if (!response.ok) throw apiError(`读取 Voicebox 音频失败：HTTP ${response.status}`, 'audio');
  const mime = response.headers.get('content-type') || 'audio/wav';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw apiError('Voicebox 返回了空音频。', 'audio');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function generateAudio(options = {}) {
  const initial = await generate(options);
  const id = initial?.id;
  if (!id) throw apiError('Voicebox 返回中没有任务 ID。', 'invalid-response');
  const generation = ['completed', 'complete', 'done'].includes(String(initial.status || '').toLowerCase())
    ? initial
    : await waitForGeneration(id, options);
  return { ok: true, id, generation, audioDataUrl: await audioDataUrl(id) };
}

module.exports = {
  VOICEBOX_BASE_URL,
  audioDataUrl,
  activeTasks,
  cancelDownload,
  generate,
  generateAudio,
  getGeneration,
  health,
  history,
  profiles,
  transcribeFile,
  waitForGeneration,
};
