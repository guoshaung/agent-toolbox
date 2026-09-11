'use strict';

/**
 * OpenAI 兼容 Image API 客户端（当前官方参数，见 developers.openai.com /images/generations）。
 *
 * 设计约束：
 *  - API Key 只从环境变量（OPENAI_API_KEY）或调用方注入读取，绝不写入 Git / 源码 / 日志。
 *  - GPT Image 系列始终返回 b64_json（官方文档：response_format 仅对 dall-e 系列有效）。
 *  - size 支持 GPT-image-2/2.5 的任意 WxH：两边都被 16 整除，宽高比 1:3 ~ 3:1，上限 3840x2160。
 *  - 429/5xx 指数退避重试，有上限，不做无限重试。
 *  - 批量 generateImages 并发受限（默认 2），单张失败不影响其余结果。
 */

const DEFAULT_MODEL = 'gpt-image-2.5-flare';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const SIZE_DIVISOR = 16;
const MAX_EDGE = 3840;
const ASPECT_MIN = 1 / 3;
const ASPECT_MAX = 3;

/** 解析 "1536x864" → {width, height}；非法返回 null */
function parseSize(size) {
  const match = /^(\d+)[xX](\d+)$/.exec(String(size || '').trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return { width, height };
}

/** 校验 GPT-image-2/2.5 任意尺寸规则（docs: divisible by 16, aspect 1:3~3:1, ≤3840） */
function validateSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return { ok: false, error: `size 必须是 WxH 格式，收到：${size}` };
  const { width, height } = parsed;
  if (width % SIZE_DIVISOR !== 0 || height % SIZE_DIVISOR !== 0) {
    return { ok: false, error: `size 宽高都必须被 ${SIZE_DIVISOR} 整除，收到：${width}x${height}` };
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    return { ok: false, error: `size 不能超过 ${MAX_EDGE}px，收到：${width}x${height}` };
  }
  const aspect = width / height;
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) {
    return { ok: false, error: `size 宽高比必须在 1:3 ~ 3:1 之间，收到：${width}x${height}` };
  }
  return { ok: true, parsed };
}

/** 读取 API Key：显式注入 > 环境变量。缺失返回空串（调用方决定如何报错）。 */
function resolveApiKey(explicit) {
  if (explicit) return String(explicit);
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class OpenAIImageClient {
  /**
   * @param {object} options
   * @param {string} [options.apiKey]     不传则读 OPENAI_API_KEY
   * @param {string} [options.baseUrl]    默认 https://api.openai.com/v1，可指向兼容网关
   * @param {Function} [options.fetchImpl] 测试注入
   * @param {number} [options.maxRetries] 429/5xx 最大重试次数（默认 3，总尝试 = 1+3）
   * @param {number} [options.retryBaseMs] 退避基数（默认 1500ms，指数递增）
   * @param {number} [options.timeoutMs]  单请求超时（默认 300000ms，图片生成可能 >60s）
   */
  constructor({ apiKey, baseUrl, fetchImpl, maxRetries = 3, retryBaseMs = 1500, timeoutMs = 300000 } = {}) {
    this.apiKey = resolveApiKey(apiKey);
    this.baseUrl = String(baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetch = fetchImpl || fetch;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.timeoutMs = timeoutMs;
  }

  /** 生成单图并落盘。返回 { ok, filePath, meta | error }，不抛异常。 */
  async generateImage(prompt, options = {}) {
    const {
      model = DEFAULT_MODEL,
      size = '1536x864',
      quality = 'medium',
      outputFormat = 'png',
      outputDir,
      filename,
      moderation,
      background,
    } = options;

    const sizeCheck = validateSize(size);
    if (!sizeCheck.ok) return { ok: false, error: sizeCheck.error, meta: { model, size } };
    if (!prompt || !String(prompt).trim()) return { ok: false, error: 'prompt 不能为空', meta: { model, size } };
    if (!this.apiKey) return { ok: false, error: '缺少 API Key：请设置 OPENAI_API_KEY 或注入 apiKey', meta: { model, size } };

    const payload = {
      model,
      prompt: String(prompt),
      size: sizeCheck.parsed ? `${sizeCheck.parsed.width}x${sizeCheck.parsed.height}` : size,
      n: 1,
    };
    if (quality) payload.quality = quality;
    if (outputFormat) payload.output_format = outputFormat;
    if (moderation) payload.moderation = moderation;
    if (background) payload.background = background;

    const started = Date.now();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        response = await this.fetch(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
      } catch (error) {
        // 网络层错误也走退避（网关偶发断连），但计入重试上限
        if (attempt <= this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, error: `网络错误：${error.message}`, meta: { model, size: payload.size, attempts: attempt } };
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt <= this.maxRetries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.retryBaseMs * 2 ** (attempt - 1);
          await sleep(delay);
          continue;
        }
        return { ok: false, error: `HTTP ${response.status}（已重试 ${this.maxRetries} 次）`, meta: { model, size: payload.size, attempts: attempt } };
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, error: `HTTP ${response.status}：${detail.slice(0, 300)}`, meta: { model, size: payload.size, attempts: attempt } };
      }

      let data;
      try { data = await response.json(); } catch (error) {
        return { ok: false, error: `响应不是 JSON：${error.message}`, meta: { model, size: payload.size } };
      }
      const item = data && data.data && data.data[0];
      if (!item || !item.b64_json) {
        return { ok: false, error: '响应缺少 data[0].b64_json', meta: { model, size: payload.size } };
      }

      const meta = {
        model,
        size: payload.size,
        outputFormat,
        quality,
        elapsedMs: Date.now() - started,
        attempts: attempt,
        usage: data.usage || null,
        created: data.created || null,
      };

      if (outputDir) {
        const saved = this.saveImage(item.b64_json, outputDir, filename, outputFormat);
        if (!saved.ok) return { ok: false, error: saved.error, meta };
        meta.filePath = saved.filePath;
        meta.bytes = saved.bytes;
      }
      return { ok: true, base64: item.b64_json, meta };
    }
  }

  /** b64 → 文件。独立成函数便于测试。 */
  saveImage(b64, outputDir, filename, outputFormat = 'png') {
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(outputDir, { recursive: true });
      const ext = outputFormat === 'jpeg' ? 'jpg' : (outputFormat || 'png');
      const safeName = filename || `image-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`;
      const filePath = path.join(outputDir, safeName);
      const buffer = Buffer.from(b64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { ok: true, filePath, bytes: buffer.byteLength };
    } catch (error) {
      return { ok: false, error: `保存失败：${error.message}` };
    }
  }

  /**
   * 批量生成。concurrency 默认 2；单张失败不影响其余。
   * @returns {Promise<Array<{ ok, promptIndex, meta | error }>>} 顺序与 prompts 一致
   */
  async generateImages(prompts, options = {}) {
    const { concurrency = 2, ...perCall } = options;
    const list = Array.isArray(prompts) ? prompts : [];
    const results = new Array(list.length);
    let cursor = 0;

    const workers = new Array(Math.max(1, Math.min(concurrency, list.length || 1))).fill(0).map(async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= list.length) return;
        try {
          const result = await this.generateImage(list[index], perCall);
          results[index] = { ...result, promptIndex: index };
        } catch (error) {
          results[index] = { ok: false, promptIndex: index, error: error.message, meta: {} };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }
}

module.exports = { OpenAIImageClient, DEFAULT_MODEL, DEFAULT_BASE_URL, parseSize, validateSize, resolveApiKey };
