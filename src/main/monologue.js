'use strict';

/**
 * 内心独白：把一句话拆成「她到底在问什么 / 想要什么 / 该先做什么」，按概率摆出来。
 *
 * 两种触发：
 *  - 手动：在任意应用里选中一段话，按快捷键 —— 百分百是你想分析的那句，零配置
 *  - 自动：盯住某个应用的窗口，OCR 出最新一条对方消息，变了就分析
 *
 * 自动模式为什么要用户调区域：微信窗口是多栏的（侧边图标条 + 会话列表 + 聊天区，
 * 有时右边还有个面板），而且布局随窗口宽度变。实测硬猜分界线会把会话列表当成
 * 对方说的话。与其猜不准，不如给两个滑块让人拖一次，存下来就一直准。
 *
 * 只读屏幕 / 只读你选中的文字，不碰微信进程、不自动发消息。
 */

/** 解读模板。每个模板给 JEV 一组要回答的问题，它只需要在选项里选。 */
const TEMPLATES = {
  chat: {
    id: 'chat', name: '聊天语气', icon: '💬',
    desc: '这句话的言外之意、对方想要什么',
    questions: [
      { key: 'literal', q: '她说的是字面意思吗？', options: ['是字面意思', '话里有话'] },
      { key: 'intent', q: '当前真实意图', options: ['想确认你在不在乎', '单纯问个事', '在生气', '想让你做点什么'] },
      { key: 'need', q: '她现在需要什么？', options: ['道歉', '行动', '解释', '共情'] },
      { key: 'now', q: '现在最该做的', options: ['先认错再说', '直接给方案', '先问清楚', '什么都别急着说'] },
    ],
    risk: true,
  },
  work: {
    id: 'work', name: '工作消息', icon: '💼',
    desc: '这条消息到底要你干什么、急不急',
    questions: [
      { key: 'ask', q: '这条消息在要什么？', options: ['要一个结论', '要你做事', '同步信息', '要你表态'] },
      { key: 'urgency', q: '真实紧急程度', options: ['现在就要', '今天内', '不急', '看着办'] },
      { key: 'reply', q: '该怎么回', options: ['先回收到再做', '直接给结果', '问清楚再动', '不用回'] },
    ],
    risk: true,
  },
  demand: {
    id: 'demand', name: '需求澄清', icon: '📋',
    desc: '一条含糊的需求，拆出它真正想要的',
    questions: [
      { key: 'clear', q: '这个需求说清楚了吗？', options: ['清楚', '含糊'] },
      { key: 'real', q: '他真正想要的是', options: ['字面那个功能', '背后的某个目的', '他自己也没想清'] },
      { key: 'next', q: '下一步', options: ['直接做', '先确认范围', '给个方案让他选', '拒绝或改期'] },
    ],
    risk: false,
  },
};

const SYSTEM_PROMPT = `你是一个只做判断、不写文章的助手。
给你一段话和几个问题，每个问题都有固定选项。
你要给每个选项一个概率（整数，同一题加起来正好 100）。
只输出 JSON，不要任何解释、不要 markdown 代码块。

格式：
{"headline":"一句话点破这句话在干嘛（不超过20字）","answers":[{"key":"问题key","options":[{"label":"选项原文","p":70}]}],"risk":7,"advice":"一句话建议，不超过25字"}

risk 是 0-10 的整数，表示这句话背后的状况有多需要认真对待；不需要就给 0。`;

function buildPrompt(template, text, context) {
  const spec = (template.questions || [])
    .map((q) => `- key=${q.key}  问题：${q.q}  选项：${q.options.join(' / ')}`)
    .join('\n');
  return [
    context ? `【上下文，最近几条】\n${context}\n` : '',
    `【要分析的这句话】\n${text}\n`,
    `【要回答的问题】\n${spec}`,
  ].filter(Boolean).join('\n');
}

/** 模型偶尔会裹一层 ```json，或者前后带几个字，这里都剥掉 */
function parseJson(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* 再试着截出花括号那段 */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* 真的不是 JSON */ }
  }
  return null;
}

/**
 * 把模型返回的东西normalize成界面能直接渲染的卡片。
 * 概率做两件事：非负、每题归一到 100 —— 模型经常给出加起来 97 或 103 的数。
 */
function toCards(template, parsed) {
  if (!parsed) return null;
  const byKey = new Map((parsed.answers || []).map((a) => [String(a.key), a]));
  const cards = [];
  for (const question of template.questions || []) {
    const answer = byKey.get(question.key);
    if (!answer) continue;
    let options = (answer.options || [])
      .map((o) => ({ label: String(o.label ?? o.name ?? '').trim(), p: Math.max(0, Number(o.p ?? o.percent ?? 0)) }))
      .filter((o) => o.label);
    if (!options.length) continue;
    const total = options.reduce((sum, o) => sum + o.p, 0);
    if (total > 0) options = options.map((o) => ({ ...o, p: Math.round((o.p / total) * 100) }));
    options.sort((a, b) => b.p - a.p);
    cards.push({ q: question.q, options });
  }
  if (!cards.length) return null;
  return {
    headline: String(parsed.headline || '').slice(0, 40),
    cards,
    risk: template.risk ? Math.max(0, Math.min(10, Math.round(Number(parsed.risk) || 0))) : null,
    advice: String(parsed.advice || '').slice(0, 50),
  };
}

class Monologue {
  /**
   * @param {{ask:Function, readChat:Function, getUserDataPath:Function, store:any, onUpdate:Function}} deps
   *   ask(messages) → { ok, text }   走工具箱already配好的那个模型
   *   readChat(userDataDir, appName) → { ok, lines }
   */
  constructor({ ask, readChat, getUserDataPath, store, onUpdate } = {}) {
    this.ask = ask;
    this.readChat = readChat;
    this.getUserDataPath = getUserDataPath;
    this.store = store;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.busy = false;
    this.lastText = '';
    this.state = { watching: false, app: '微信', lastError: '', lastAt: 0 };
  }

  templates() {
    return Object.values(TEMPLATES).map(({ questions, ...rest }) => rest);
  }

  settings() {
    return {
      template: this.store?.get('monologue.template', 'chat') || 'chat',
      app: this.store?.get('monologue.app', '微信') || '微信',
      chatLeft: Number(this.store?.get('monologue.chatLeft', 0.3)) || 0.3,
      chatRight: Number(this.store?.get('monologue.chatRight', 1)) || 1,
      intervalMs: Math.max(2000, Number(this.store?.get('monologue.interval', 4000)) || 4000),
    };
  }

  /** 分析一段文字，返回能直接渲染的卡片 */
  async analyze(text, { templateId, context = '' } = {}) {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, error: '没有内容可以分析。' };
    if (clean.length > 1500) return { ok: false, error: '这段太长了，选短一点。' };
    const template = TEMPLATES[templateId || this.settings().template] || TEMPLATES.chat;
    const result = await this.ask([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(template, clean, context) },
    ]);
    if (!result?.ok) return { ok: false, error: result?.error || '模型没返回。' };
    const cards = toCards(template, parseJson(result.text));
    if (!cards) return { ok: false, error: `模型返回的不是预期格式：${String(result.text).slice(0, 80)}` };
    return { ok: true, source: clean, template: template.id, ...cards, at: Date.now() };
  }

  /** 盯着某个应用的窗口，发现新的对方消息就分析 */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { app, chatLeft, chatRight, template } = this.settings();
      const read = await this.readChat(this.getUserDataPath(), app);
      if (!read.ok) {
        this.state.lastError = read.error || '读不到窗口';
        this.onUpdate?.({ type: 'error', error: this.state.lastError });
        return;
      }
      this.state.lastError = '';
      const { toMessages, latestIncoming } = require('./chat-read');
      const messages = toMessages(read.lines, { chatLeft, chatRight });
      const latest = latestIncoming(messages);
      if (!latest || latest.text === this.lastText) return;
      this.lastText = latest.text;
      const context = messages.slice(-6).map((m) => `${m.side === 'them' ? '对方' : '我'}：${m.text}`).join('\n');
      this.onUpdate?.({ type: 'thinking', text: latest.text });
      const analysis = await this.analyze(latest.text, { templateId: template, context });
      this.state.lastAt = Date.now();
      this.onUpdate?.(analysis.ok ? { type: 'result', ...analysis } : { type: 'error', error: analysis.error });
    } finally {
      this.busy = false;
    }
  }

  // ---------- 覆盖层：把卡片贴在微信窗口上 ----------

  /**
   * 两个循环，频率差很多：
   *  - 跟踪（快）：只问窗口在哪、是不是前台，很轻，用来让覆盖层贴住微信
   *  - 扫描（慢）：截图 + OCR + 分析，贵，所以按文本缓存，滚回去看过的不会重算
   */
  startOverlay({ onBounds, onCards, onNotice } = {}) {
    if (this.trackTimer) return { ok: true, already: true };
    this.onBounds = onBounds;
    this.onCards = onCards;
    this.onNotice = onNotice;
    this.noticed = false;
    this.cache = this.cache || new Map();
    this.overlayOn = true;
    const { intervalMs } = this.settings();
    this.trackTimer = setInterval(() => this.trackTick().catch(() => {}), 500);
    this.scanTimer = setInterval(() => this.scanTick().catch(() => {}), Math.max(2000, intervalMs));
    this.trackTick().catch(() => {});
    this.scanTick().catch(() => {});
    return { ok: true };
  }

  stopOverlay() {
    clearInterval(this.trackTimer);
    clearInterval(this.scanTimer);
    this.trackTimer = null;
    this.scanTimer = null;
    this.overlayOn = false;
    this.onCards?.([]);
    return { ok: true };
  }

  async trackTick() {
    const { windowBounds } = require('./chat-read');
    const b = await windowBounds(this.getUserDataPath(), this.settings().app);
    this.onBounds?.(b.ok ? b : null);
  }

  /** 截一次、OCR 一次，把看得见的对方消息都配上卡片 */
  async scanTick() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const { app, chatLeft, chatRight, template } = this.settings();
      const read = await this.readChat(this.getUserDataPath(), app);
      if (!read.ok) {
        this.state.lastError = read.error || '读不到窗口';
        // 没权限的话覆盖层上什么都不会出现，用户只会觉得「点了没反应」——把原因直接贴在覆盖层上
        this.onCards?.([{ notice: true, code: read.code || 'error', text: this.state.lastError }]);
        if (!this.noticed) { this.noticed = true; this.onNotice?.({ code: read.code || 'error', error: this.state.lastError }); }
        return;
      }
      this.state.lastError = '';
      const { toMessages } = require('./chat-read');
      const messages = toMessages(read.lines, { chatLeft, chatRight });
      const incoming = messages.filter((m) => m.side === 'them' && m.text.length >= 2);

      // 卡片贴在气泡下面一点、往右缩一档，看着像从那句话里长出来的
      const place = (m) => ({ x: Math.min(0.72, m.x + 0.02), y: Math.min(0.94, m.yEnd + 0.03) });
      const cards = incoming.map((m) => {
        const hit = this.cache.get(m.text);
        return hit ? { ...hit, ...place(m) } : { pending: true, ...place(m) };
      });
      this.onCards?.(cards);

      // 一轮最多分析 2 条没见过的，别一屏几十条把额度打光
      const todo = incoming.filter((m) => !this.cache.has(m.text)).slice(-2);
      for (const m of todo) {
        const context = messages.slice(-6).map((x) => `${x.side === 'them' ? '对方' : '我'}：${x.text}`).join('\n');
        const analysis = await this.analyze(m.text, { templateId: template, context });
        if (analysis.ok) {
          this.cache.set(m.text, { headline: analysis.headline, cards: analysis.cards, risk: analysis.risk, advice: analysis.advice });
          if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
        } else {
          this.cache.set(m.text, { headline: '读不出来', cards: [], risk: null, advice: analysis.error?.slice(0, 40) || '' });
        }
      }
      if (todo.length) {
        this.onCards?.(incoming.map((m) => ({ ...(this.cache.get(m.text) || { pending: true }), ...place(m) })));
      }
    } finally {
      this.scanning = false;
    }
  }

  start() {
    if (this.timer) return { ok: true, already: true };
    const { intervalMs } = this.settings();
    this.lastText = '';
    this.state.watching = true;
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs);
    this.tick().catch(() => {});
    return { ok: true };
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.state.watching = false;
    this.stopOverlay();
    return { ok: true };
  }

  status() {
    return { ...this.state, ...this.settings(), overlay: Boolean(this.overlayOn) };
  }
}

module.exports = { Monologue, TEMPLATES, parseJson, toCards, buildPrompt, SYSTEM_PROMPT };
