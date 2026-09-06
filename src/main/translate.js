'use strict';

/** Legacy remote translator kept for preload compatibility. */
const ENDPOINT = 'https://aidemo.youdao.com/trans';
const CHUNK_SIZE = 900;
const MAX_TOTAL = 20000;

function detectTarget(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > String(text).length * 0.2 ? 'en' : 'zh-CHS';
}

async function translateChunk(q, to, options = {}, attempt = 0) {
  const interactive = Boolean(options.interactive);
  const maxAttempt = interactive ? 1 : 2;
  const retryWait = interactive ? 12000 : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: new URLSearchParams({ q, from: 'auto', to }).toString(),
      signal: controller.signal,
    });
    const data = await response.json();
    const code = String(data.errorCode);
    if (attempt < maxAttempt && (code === '411' || code === '103')) {
      if (code === '103' && q.length > 500) {
        const half = Math.ceil(q.length / 2);
        const first = await translateChunk(q.slice(0, half), to, options, attempt + 1);
        const second = await translateChunk(q.slice(half), to, options, attempt + 1);
        return `${first}\n${second}`;
      }
      await new Promise((resolve) => setTimeout(resolve, retryWait));
      return translateChunk(q, to, options, attempt + 1);
    }
    if (code !== '0' || !Array.isArray(data.translation)) {
      if (code === '103') throw new Error('有道限流了，稍等几秒再试');
      if (code === '411') throw new Error('有道免费配额用完了，一分钟后再试');
      throw new Error(`有道返回错误（errorCode=${data.errorCode ?? '未知'}）`);
    }
    return data.translation.join('\n');
  } finally {
    clearTimeout(timer);
  }
}

function splitChunks(text) {
  const paragraphs = String(text).split(/\n/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > CHUNK_SIZE) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${paragraph}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translate(text, options = {}) {
  const input = String(text || '').trim();
  if (!input) return { ok: false, error: '没有要翻译的内容' };
  const clipped = input.slice(0, MAX_TOTAL);
  const to = detectTarget(clipped);
  const chunks = splitChunks(clipped);
  const parts = [];
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      parts.push(await translateChunk(chunks[index], to, options));
      options.onProgress?.(index + 1, chunks.length);
      if (index < chunks.length - 1) await new Promise((resolve) => setTimeout(resolve, options.interactive ? 300 : 12000));
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    translation: parts.join('\n'),
    to,
    truncated: input.length > MAX_TOTAL,
  };
}

module.exports = { translate };
