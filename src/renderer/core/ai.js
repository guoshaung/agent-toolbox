import { extractJSON, BridgeError } from './deepseek-bridge.js';

/**
 * AI 能力的统一入口 —— 需求里说的「预留一个 ai 接口，后面导入」。
 *
 * 上层（出题、抓站、知识点整理）只调 ai.chat / ai.json，不关心底下是谁。
 * 现在有两个实现：
 *   deepseek-web  复用你已登录的 DeepSeek 网页会话，免费，但慢几秒
 *   openai-api    任何 OpenAI 兼容的 /chat/completions 接口，填 baseUrl + key + model 即用
 *                 （DeepSeek 官方 API、豆包、Kimi、本地 Ollama/vLLM 都是这个协议）
 *
 * 以后要接第三种，在 PROVIDERS 里加一项，再实现一个 _callXxx 即可，上层不用动。
 */
export const PROVIDERS = {
  'deepseek-web': {
    label: 'DeepSeek 网页版',
    hint: '复用你已登录的网页会话，不花钱；比 API 慢几秒',
    needsConfig: false,
  },
  'openai-api': {
    label: '自定义 API（OpenAI 兼容）',
    hint: '填 Base URL + API Key + 模型名。DeepSeek / 豆包 / Kimi / Ollama 都走这个协议',
    needsConfig: true,
  },
};

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // need-login | not-configured | http | empty | timeout
  }
}

export class AI {
  constructor({ config, bridge }) {
    this.config = config;
    this.bridge = bridge;
  }

  get provider() {
    const id = this.config.get('ai.provider', 'deepseek-web');
    return PROVIDERS[id] ? id : 'deepseek-web';
  }

  /** 当前这套配置能不能真的发出请求 */
  check() {
    if (this.provider !== 'openai-api') return { ok: true };
    const { baseUrl, apiKey, model } = this.apiConfig();
    if (!baseUrl || !apiKey || !model) {
      return { ok: false, reason: '自定义 API 还没填全（Base URL / API Key / 模型名），去「设置 → AI 接口」补上。' };
    }
    return { ok: true };
  }

  apiConfig() {
    return {
      baseUrl: this.config.get('ai.api.baseUrl', ''),
      apiKey: this.config.get('ai.api.key', ''),
      model: this.config.get('ai.api.model', ''),
      temperature: this.config.get('ai.api.temperature', 0.7),
    };
  }

  describe() {
    const id = this.provider;
    if (id === 'openai-api') {
      const { model, baseUrl } = this.apiConfig();
      return `自定义 API · ${model || '未设模型'} @ ${baseUrl || '未设地址'}`;
    }
    return 'DeepSeek 网页版（免费）';
  }

  async chat(prompt, options = {}) {
    const status = this.check();
    if (!status.ok) throw new AIError('not-configured', status.reason);

    if (this.provider === 'openai-api') return this._callApi(prompt, options);

    try {
      return await this.bridge.ask(prompt, options);
    } catch (err) {
      // 把桥接的错误码原样透出去，上层才能给出「去登录」这种针对性提示
      throw err instanceof BridgeError ? new AIError(err.code, err.message) : err;
    }
  }

  async json(prompt, options = {}) {
    const raw = await this.chat(prompt, options);
    const parsed = extractJSON(raw);
    if (!parsed) throw new AIError('empty', `模型没有返回可解析的 JSON。原始回复：\n${String(raw).slice(0, 400)}`);
    return parsed;
  }

  async _callApi(prompt, { timeout = 90000, system } = {}) {
    const { baseUrl, apiKey, model, temperature } = this.apiConfig();
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const result = await window.toolbox.ai.chat({ baseUrl, apiKey, model, messages, temperature, timeout });
    if (!result.ok) throw new AIError(result.code || 'http', result.error);
    if (!result.text) throw new AIError('empty', 'API 返回了空内容。');
    return result.text;
  }
}
