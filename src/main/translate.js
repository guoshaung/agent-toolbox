'use strict';

/** Legacy remote translator kept for preload compatibility. */
const ENDPOINT = 'https://aidemo.youdao.com/trans';
const CHUNK_SIZE = 900;
const FAST_CHUNK_SIZE = 450;
const MAX_TOTAL = 20000;

function detectTarget(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > String(text).length * 0.2 ? 'en' : 'zh-CHS';
}

async function translateChunk(q, to, options = {}, attempt = 0) {
  const interactive = Boolean(options.interactive);
  const fast = Boolean(options.fast);
  const maxAttempt = fast ? 0 : interactive ? 1 : 2;
  const retryWait = interactive ? 12000 : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fast ? 6000 : 20000);
  try {
    const response = await (options.fetchImpl || fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: new URLSearchParams({ q, from: 'auto', to }).toString(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`快速翻译服务返回 HTTP ${response.status}`);
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

function splitFastChunks(text) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length > FAST_CHUNK_SIZE) {
    const head = rest.slice(0, FAST_CHUNK_SIZE);
    const candidates = ['\n', '。', '！', '？', '.', '!', '?', '；', ';', '，', ',', ' '].map(mark => head.lastIndexOf(mark) + 1).filter(index => index >= 220);
    const cut = candidates.length ? Math.max(...candidates) : FAST_CHUNK_SIZE;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function translateFast(text, options = {}) {
  const input = String(text || '').trim();
  if (!input) return { ok: false, error: '没有要翻译的内容' };
  if (input.length > MAX_TOTAL) return { ok: false, error: `单次翻译不能超过 ${MAX_TOTAL} 字符` };
  const selected = String(options.to || 'auto');
  if (!['auto', 'en', 'zh-CHS'].includes(selected)) return { ok: false, error: '不支持的翻译方向' };
  const to = selected === 'auto' ? detectTarget(input) : selected;
  const chunks = splitFastChunks(input);
  const parts = Array(chunks.length);
  let next = 0;
  const started = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, async () => {
      while (next < chunks.length) {
        const index = next++;
        parts[index] = await translateChunk(chunks[index], to, { fast: true, fetchImpl: options.fetchImpl });
      }
    }));
    return { ok: true, translation: parts.join('\n'), to, provider: 'youdao', chunks: chunks.length, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? '快速翻译超时，请重试' : error.message };
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

module.exports = { translate, translateFast, splitFastChunks };
