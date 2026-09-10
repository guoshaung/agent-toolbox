'use strict';

/**
 * Voicebox REST client。本地服务地址固定 127.0.0.1:17493（与官方一致）。
 * 统一走 POST /generate（可指定 model_size:"0.6B"），不依赖 MCP speak，
 * 避免触发默认 1.7B 大模型下载。MCP 端点信息只作为 Agent 侧的附加入口。
 *
 * 模块可被纯 Node require（无 electron 依赖），便于单测。
 */

const DEFAULT_PORT = 17493;
const MODEL_SIZE = '0.6B';        // 默认轻量模型，符合接入约束
const PRESET_ENGINE = 'qwen_custom_voice';
const PRESET_VOICE = 'Vivian';    // 中文预设音色（qwen_custom_voice 提供 zh 预设）
const PROFILE_NAME = 'Toolbox 默认语音（中文）';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 解析 /health 响应为状态对象。 */
function parseHealth(body) {
  const data = body && typeof body === 'object' ? body : {};
  return {
    healthy: data.status === 'healthy',
    backend: data.backend_type || data.backend_variant || null,
    gpuAvailable: Boolean(data.gpu_available),
  };
}

/**
 * 解析 status 响应体：该端点返回 SSE（`data: {...}`），也可能直接返回 JSON。
 * 两种形式都兼容。
 */
function parseStatusBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const line = raw.split(/\r?\n/).find((item) => item.startsWith('data: '));
  const candidate = line ? line.slice('data: '.length) : raw;
  try { return JSON.parse(candidate); } catch { return null; }
}

/** 解析 /generate 或 status 响应为最小 generation 状态。 */
function parseGeneration(body) {
  const data = body && typeof body === 'object' ? body : {};
  return {
    id: String(data.id || ''),
    status: String(data.status || ''),
    duration: typeof data.duration === 'number' ? data.duration : null,
    audioPath: data.audio_path || '',
    error: data.error || null,
    modelSize: data.model_size || null,
  };
}

class VoiceboxRestClient {
  /**
   * @param {object} [options]
   * @param {number} [options.port]
   * @param {Function} [options.fetchImpl]
   * @param {number} [options.maxRetries]  429/5xx 重试上限（默认 3）
   * @param {number} [options.retryBaseMs]
   */
  constructor({ port = DEFAULT_PORT, fetchImpl, maxRetries = 3, retryBaseMs = 1200 } = {}) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.fetch = fetchImpl || globalThis.fetch;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this._presetProfileId = null;
  }

  /** 带退避的请求包装；只对 429/5xx 重试，其余状态立即返回。 */
  async request(path, { method = 'GET', body } = {}) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let response;
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        if (attempt <= this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, error: `网络错误：${error.message}`, attempts: attempt };
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt <= this.maxRetries) {
          const retryAfter = Number(response.headers?.get?.('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.retryBaseMs * 2 ** (attempt - 1);
          await sleep(delay);
          continue;
        }
        return { ok: false, error: `HTTP ${response.status}（已重试 ${this.maxRetries} 次）`, attempts: attempt };
      }
      const text = await response.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* 保留 text */ }
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}：${(json?.detail || text).slice(0, 300)}`, attempts: attempt, status: response.status };
      }
      return { ok: true, json, text, attempts: attempt, status: response.status };
    }
  }

  /** 健康探测：未运行也返回 { ok:false, running:false }，不抛异常。 */
  async probeHealth() {
    const result = await this.request('/health', {});
    if (!result.ok && !result.status) {
      // 网络层失败（连接被拒）
      return { ok: false, running: false, healthy: false, error: result.error };
    }
    if (result.status === 404 || result.status === 401 || result.status === 200) {
      const parsed = parseHealth(result.json);
      return { ok: true, running: true, healthy: parsed.healthy, ...parsed };
    }
    return { ok: false, running: false, healthy: false, error: result.error };
  }

  async listProfiles() {
    const result = await this.request('/profiles');
    if (!result.ok) return result;
    return { ok: true, profiles: result.json || [] };
  }

  /** 确保存在中文预设 profile（只创建一次，结果缓存）。 */
  async ensureZhPresetProfile() {
    if (this._presetProfileId) return { ok: true, profileId: this._presetProfileId, cached: true };

    const list = await this.listProfiles();
    if (list.ok) {
      const existing = list.profiles.find((p) => p && (p.name === PROFILE_NAME || (p.preset_engine === PRESET_ENGINE && p.preset_voice_id === PRESET_VOICE)));
      if (existing && existing.id) {
        this._presetProfileId = existing.id;
        return { ok: true, profileId: existing.id, cached: true };
      }
    }

    const created = await this.request('/profiles', {
      method: 'POST',
      body: {
        name: PROFILE_NAME,
        language: 'zh',
        voice_type: 'preset',
        preset_engine: PRESET_ENGINE,
        preset_voice_id: PRESET_VOICE,
        default_engine: PRESET_ENGINE,
      },
    });
    if (!created.ok) return created;
    const id = created.json && created.json.id;
    if (!id) return { ok: false, error: '创建 profile 后未返回 id' };
    this._presetProfileId = id;
    return { ok: true, profileId: id, cached: false };
  }

  /** 生成 TTS：显式指定 model_size 0.6B。返回 { ok, generationId, status }。 */
  async generate({ text, language = 'zh', modelSize = MODEL_SIZE, profileId, engine = PRESET_ENGINE } = {}) {
    if (!text || !String(text).trim()) return { ok: false, error: 'text 不能为空' };
    let pid = profileId;
    if (!pid) {
      const profile = await this.ensureZhPresetProfile();
      if (!profile.ok) return profile;
      pid = profile.profileId;
    }
    const result = await this.request('/generate', {
      method: 'POST',
      body: {
        profile_id: pid,
        text: String(text),
        language,
        engine,
        model_size: modelSize,
        n: 1,
      },
    });
    if (!result.ok) return result;
    const gen = parseGeneration(result.json);
    if (!gen.id) return { ok: false, error: '响应缺少 generation id' };
    return { ok: true, generationId: gen.id, status: gen.status, modelSize: gen.modelSize || modelSize };
  }

  /** 轮询 generation 状态直到 completed/failed/超时。不无限等待。 */
  async pollGeneration(id, { timeoutMs = 300000, intervalMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.request(`/generate/${encodeURIComponent(id)}/status`);
      if (result.ok) {
        const gen = parseGeneration(parseStatusBody(result.text));
        if (gen.status === 'completed') {
          return { ok: true, status: 'completed', duration: gen.duration, audioPath: gen.audioPath, id };
        }
        if (gen.status === 'error' || gen.status === 'failed') {
          return { ok: false, error: gen.error || `生成失败：${gen.status}` };
        }
      } else if (!result.status) {
        // 网络层失败：poll 时服务可能短暂重启，继续按轮询节奏重试，直到超时
        // （不抛错，避免把一次瞬时断连当成失败）
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: `生成超时（${Math.round(timeoutMs / 1000)}s），请检查服务状态` };
      }
      await sleep(intervalMs);
    }
  }

  /** 取音频字节；id 即 generation id。二进制不走通用 JSON request。 */
  async fetchAudio(id) {
    try {
      const response = await this.fetch(`${this.baseUrl}/audio/${encodeURIComponent(id)}`);
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status };
      const buffer = Buffer.from(await response.arrayBuffer());
      return { ok: true, buffer };
    } catch (error) {
      return { ok: false, error: `网络错误：${error.message}` };
    }
  }

  /** 渲染层 <audio> 可直接播放的 URL。 */
  static getAudioUrl(id, port = DEFAULT_PORT) {
    return `http://127.0.0.1:${port}/audio/${encodeURIComponent(id)}`;
  }
}

module.exports = { DEFAULT_PORT, MODEL_SIZE, VoiceboxRestClient, parseHealth, parseGeneration, parseStatusBody };