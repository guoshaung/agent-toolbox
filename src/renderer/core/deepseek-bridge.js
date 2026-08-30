import { PAGE_AGENT } from './page-agent.js';

export const DEEPSEEK_URL = 'https://chat.deepseek.com/';
export const DEEPSEEK_PARTITION = 'persist:deepseek';

export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // need-login | not-ready | no-input | timeout | empty
  }
}

/**
 * 把一个隐藏的 DeepSeek 网页当成「无界面 LLM」用。
 *
 * 它和「快问」面板共用 persist:deepseek 分区，所以登录一次两边都通。
 * 打字纠错、专注模式的 AI 建议都走这里 —— 全程用用户自己的网页会话，不花钱。
 */
export class DeepSeekBridge {
  constructor() {
    this.webview = null;
    this._ready = null;
    this._queue = Promise.resolve(); // 串行化：同一个网页同时只能跑一轮对话
    this.listeners = new Set();
  }

  onStatus(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(state, detail) {
    for (const fn of this.listeners) fn(state, detail);
  }

  /** 开机就把隐藏 webview 挂上，用的时候页面早就热好了。 */
  attach(host) {
    if (this.webview) return this.webview;
    const view = document.createElement('webview');
    view.setAttribute('partition', DEEPSEEK_PARTITION);
    view.setAttribute('src', DEEPSEEK_URL);
    view.style.cssText = 'width:1200px;height:900px;border:0;';
    host.appendChild(view);
    this.webview = view;

    view.addEventListener('did-finish-load', () => {
      this._ready = null; // 导航过就得重新注入探针
      this._emit('loaded', { url: view.getURL() });
    });
    view.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return; // -3 是主动取消的导航，不是故障
      this._emit('error', { code: e.errorCode, desc: e.errorDescription });
    });
    return view;
  }

  async _run(code, userGesture = false) {
    if (!this.webview) throw new BridgeError('not-ready', '桥接还没初始化');
    return this.webview.executeJavaScript(code, userGesture);
  }

  /** 确保探针已注入且页面处于可用状态（已登录、有输入框）。 */
  async ensureAgent({ timeout = 25000 } = {}) {
    const deadline = Date.now() + timeout;
    let lastStatus = null;
    while (Date.now() < deadline) {
      try {
        await this._run(PAGE_AGENT);
        lastStatus = await this._run('window.__tbx.status()');
        if (lastStatus?.ready) return lastStatus;
        if (lastStatus?.needLogin) {
          throw new BridgeError('need-login', '需要先登录 DeepSeek：打开「DeepSeek 快问」登录一次即可，登录态会长期保留。');
        }
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        // 页面还在加载时 executeJavaScript 会失败，等下一轮重试
      }
      await sleep(500);
    }
    if (lastStatus && !lastStatus.hasInput) {
      throw new BridgeError('need-login', '页面上找不到输入框，通常是还没登录。请打开「DeepSeek 快问」登录一次。');
    }
    throw new BridgeError('not-ready', 'DeepSeek 页面在 25 秒内没准备好，检查一下网络。');
  }

  /** 开一轮干净的对话，避免上一次的上下文影响这次判断。 */
  async _newChat() {
    this.webview.loadURL(DEEPSEEK_URL);
    await new Promise((resolve) => {
      const done = () => { this.webview.removeEventListener('did-finish-load', done); resolve(); };
      this.webview.addEventListener('did-finish-load', done);
      setTimeout(done, 15000);
    });
    return this.ensureAgent();
  }

  /**
   * 问一个问题，等它答完，返回纯文本。
   *
   * 「答完」的判定不依赖对方的「停止生成」按钮（那个按钮的 DOM 一直在变），
   * 而是：文本连续 stableFor 毫秒没有增长，就认为流式输出结束了。
   */
  async ask(prompt, { timeout = 90000, stableFor = 1400, onProgress, freshChat = true } = {}) {
    const task = this._queue.then(() => this._ask(prompt, { timeout, stableFor, onProgress, freshChat }));
    // 失败也不能卡死队列，后面的请求还要跑
    this._queue = task.catch(() => {});
    return task;
  }

  async _ask(prompt, { timeout, stableFor, onProgress, freshChat }) {
    this._emit('busy');
    try {
      await this.ensureAgent();
      if (freshChat) await this._newChat();

      await this._run('window.__tbx.watch()');
      const filled = await this._run(`window.__tbx.setText(${JSON.stringify(prompt)})`, true);
      if (!filled) throw new BridgeError('no-input', '没找到 DeepSeek 的输入框，页面结构可能变了（设置页可做桥接自检）。');

      await sleep(120); // 给 React 一帧时间把受控输入框的状态同步过来
      await this._run('window.__tbx.send()', true);

      const deadline = Date.now() + timeout;
      let text = '';
      let lastChangeAt = Date.now();

      while (Date.now() < deadline) {
        await sleep(350);
        const { text: current } = await this._run('window.__tbx.reply()');
        if (current && current !== text) {
          text = current;
          lastChangeAt = Date.now();
          onProgress?.(text);
        }
        // 有内容 + 一段时间不再变 = 生成结束
        if (text && Date.now() - lastChangeAt > stableFor) break;
      }

      await this._run('window.__tbx.unwatch()');
      if (!text) {
        if (Date.now() >= deadline) throw new BridgeError('timeout', `等了 ${Math.round(timeout / 1000)} 秒没等到回复。可能是网络慢或被限流了。`);
        throw new BridgeError('empty', 'DeepSeek 没有返回内容。');
      }
      this._emit('idle');
      return text.trim();
    } catch (err) {
      this._emit('error', { message: err.message, code: err.code });
      throw err;
    }
  }

  /**
   * 要求模型返回 JSON。模型经常会裹一层 ```json 代码块或加几句废话，
   * 所以这里做兜底解析：先直接 parse，不行就抠出第一个平衡的花括号块。
   */
  async askJSON(prompt, options) {
    const raw = await this.ask(prompt, options);
    const parsed = extractJSON(raw);
    if (!parsed) throw new BridgeError('empty', `模型没有返回可解析的 JSON。原始回复：\n${raw.slice(0, 400)}`);
    return parsed;
  }

  async probe() {
    await this._run(PAGE_AGENT);
    return this._run('window.__tbx.probe()');
  }

  reload() {
    this._ready = null;
    this.webview?.loadURL(DEEPSEEK_URL);
  }
}

export function extractJSON(raw) {
  const text = String(raw || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(text);
  } catch { /* 继续用括号配对兜底 */ }

  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
