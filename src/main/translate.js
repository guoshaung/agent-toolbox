'use strict';

/**
 * 免费翻译：有道 aidemo 接口（fanyi.youdao.com 的 WAF 签名接口已失效，
 * 这个 demo 接口无签名、国内直连快，沙拉翻译同款来源）。
 * Google 翻译在本网络不可达，不用。
 *
 * 方向自动判断：中文为主 → 译成英文；其他 → 译成中文。
 * 长文本按段落切块（每块 ≤900 字，实测 1024 附近有硬限制），逐块请求后拼回。
 */

const ENDPOINT = 'https://aidemo.youdao.com/trans';
const CHUNK_SIZE = 900; // 实测 1024 附近有硬限制，留余量
const MAX_TOTAL = 20000; // 整篇对照翻译的字符上限，超出截断

function detectTarget(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > String(text).length * 0.2 ? 'en' : 'zh-CHS';
}

async function translateChunk(q, to, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: new URLSearchParams({ q, from: 'auto', to }).toString(),
      signal: controller.signal,
    });
    const data = await res.json();
    const code = String(data.errorCode);
    if (code === '411' && attempt < 2) {
      // 411 = 新内容配额耗尽（实测约每分钟 5 条新翻译）：等 30s 再试
      await new Promise((r) => setTimeout(r, 30000));
      return translateChunk(q, to, attempt + 1);
    }
    if (code === '103' && attempt < 2) {
      // 103 = 单次文本超长（实测 ~1000 字上限）或被风控：对半切再试
      if (q.length > 500) {
        const half = Math.ceil(q.length / 2);
        const a = await translateChunk(q.slice(0, half), to, attempt + 1);
        const b = await translateChunk(q.slice(half), to, attempt + 1);
        return `${a}\n${b}`;
      }
      await new Promise((r) => setTimeout(r, 30000));
      return translateChunk(q, to, attempt + 1);
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

/** 把长文本按段落切成 ≤CHUNK_SIZE 的块 */
function splitChunks(text) {
  const paras = String(text).split(/\n/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > CHUNK_SIZE) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * 翻译入口。返回 { ok, translation, to } 或 { ok: false, error }。
 * options.onProgress(done, total) 用于长文本进度。
 */
async function translate(text, options = {}) {
  const input = String(text || '').trim();
  if (!input) return { ok: false, error: '没有要翻译的内容' };
  const clipped = input.slice(0, MAX_TOTAL);
  const to = detectTarget(clipped);
  const chunks = splitChunks(clipped);
  const parts = [];
  try {
    for (let i = 0; i < chunks.length; i += 1) {
      parts.push(await translateChunk(chunks[i], to));
      options.onProgress?.(i + 1, chunks.length);
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 12000)); // 配额 ~5 条新内容/分钟
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return {
    ok: true,
    translation: parts.join('\n'),
    to,
    truncated: input.length > MAX_TOTAL,
  };
}

module.exports = { translate };
