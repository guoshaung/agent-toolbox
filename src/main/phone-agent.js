'use strict';

/**
 * 手机精灵的两半「电脑端」：
 *
 *  1. 大脑（PhoneAgent）—— 手机把当前屏幕的控件树（无障碍服务读出来的，带文字、
 *     坐标、能不能点）和目标发过来，这里问模型「下一步做什么」，回一个动作。
 *     手机只做手和眼，模型配置、key、日志全在电脑端统一管。
 *
 *  2. 传文件（PhoneOutbox）—— 电脑拖文件到桌面精灵 = 放进出件箱，手机精灵每几秒来问
 *     一次、把文件取走；手机推文件走 /api/phone/upload，落到「下载/Agent工具箱/手机精灵」。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const MAX_NODES = 160;
const MAX_HISTORY = 12;

/** 手机端能执行的动作。模型只能从这里挑，挑了别的一律按「没听懂」处理。 */
const ACTIONS = new Set(['tap', 'type', 'swipe', 'scroll', 'back', 'home', 'open', 'wait', 'done', 'ask']);
const DIRS = new Set(['up', 'down', 'left', 'right']);

const SYSTEM_PROMPT = `你在替用户操作一台安卓手机。每一轮我给你：用户的目标、当前屏幕上的控件列表、你之前做过的动作。
你只回一个 JSON 对象，决定「下一步做的一个动作」，不要解释，不要 markdown。

控件列表每行一个：[编号] 类型 "文字" (描述) {id} 标记   —— 标记里 c=能点 e=能输入 s=能滚 ✓=已选中
动作格式（只能选一种）：
{"action":"tap","index":编号}                     点某个控件（优先点带 c 的；列表项点它本身）
{"action":"type","index":编号,"text":"要输入的字"}  往输入框里填字（会先清空）
{"action":"swipe","dir":"up|down|left|right"}      在屏幕中间滑一下（up = 内容往上走 = 看下面的）
{"action":"scroll","index":编号,"dir":"up|down"}   滚某个能滚的列表
{"action":"back"} / {"action":"home"}             返回 / 回桌面
{"action":"open","app":"应用名"}                    直接打开某个应用（比在桌面上找图标可靠得多）
{"action":"wait"}                                  页面还在加载，等一下再看
{"action":"done","say":"一句话告诉用户结果"}         目标已经完成
{"action":"ask","say":"一句话问用户"}                需要用户决定，或者做不下去了

规则：
- 一次只做一个动作。做完我会把新屏幕发给你。
- 要打开某个应用，直接用 open，不要在桌面上翻。
- 涉及付款、转账、输密码、验证码、删除、发送给别人的最后一步：**不要做**，用 ask 让用户自己来。
- 同一个动作连做两次没变化，就换思路或者 ask，别死磕。
- 目标达成就 done，别多做。`;

function compactNodes(nodes) {
  const out = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || typeof n !== 'object') continue;
    out.push({
      i: Number(n.i) | 0,
      cls: String(n.cls || '').slice(0, 24),
      t: String(n.t || '').replace(/\s+/g, ' ').slice(0, 80),
      d: String(n.d || '').replace(/\s+/g, ' ').slice(0, 60),
      id: String(n.id || '').slice(0, 40),
      c: Boolean(n.c), e: Boolean(n.e), s: Boolean(n.s), chk: n.chk === true,
      b: Array.isArray(n.b) ? n.b.slice(0, 4).map((v) => Number(v) | 0) : null,
    });
    if (out.length >= MAX_NODES) break;
  }
  return out;
}

function describeNodes(nodes) {
  if (!nodes.length) return '（屏幕上没有读到任何控件 —— 可能还在加载，或者这个应用不让读）';
  return nodes.map((n) => {
    const flags = [n.c && 'c', n.e && 'e', n.s && 's', n.chk && '✓'].filter(Boolean).join('');
    const bits = [`[${n.i}]`, n.cls || 'View'];
    if (n.t) bits.push(`"${n.t}"`);
    if (n.d && n.d !== n.t) bits.push(`(${n.d})`);
    if (n.id) bits.push(`{${n.id}}`);
    if (flags) bits.push(flags);
    return bits.join(' ');
  }).join('\n');
}

function buildStepPrompt({ goal, nodes, history = [], app = '' }) {
  const hist = history.slice(-MAX_HISTORY).map((h, k) => `${k + 1}. ${typeof h === 'string' ? h : JSON.stringify(h)}`).join('\n');
  return [
    `【目标】${goal}`,
    app ? `【当前应用】${app}` : '',
    `【之前做过的动作】\n${hist || '（还没开始）'}`,
    `【当前屏幕】\n${describeNodes(nodes)}`,
    '下一步做什么？只回 JSON。',
  ].filter(Boolean).join('\n\n');
}

/** 模型偶尔裹 ```json 或前后带字，剥掉；再校验成手机端敢执行的动作 */
function parseAction(raw, nodeCount = 0) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* 下面再截花括号 */ }
  if (!obj) {
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    if (s >= 0 && e > s) { try { obj = JSON.parse(text.slice(s, e + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: `模型回的不是动作：${text.slice(0, 80)}` };
  const action = String(obj.action || '').toLowerCase();
  if (!ACTIONS.has(action)) return { ok: false, error: `不认识的动作：${action || '(空)'}` };
  const out = { action };
  if (action === 'tap' || action === 'type' || action === 'scroll') {
    const index = Number(obj.index);
    if (!Number.isInteger(index) || index < 0 || index >= nodeCount) return { ok: false, error: `编号 ${obj.index} 不在屏幕上` };
    out.index = index;
  }
  if (action === 'type') {
    out.text = String(obj.text ?? '').slice(0, 500);
  }
  if (action === 'swipe' || action === 'scroll') {
    const dir = String(obj.dir || 'up').toLowerCase();
    if (!DIRS.has(dir)) return { ok: false, error: `方向不对：${dir}` };
    out.dir = dir;
  }
  if (action === 'open') {
    out.app = String(obj.app || '').trim().slice(0, 60);
    if (!out.app) return { ok: false, error: 'open 少了应用名' };
  }
  if (action === 'done' || action === 'ask') out.say = String(obj.say || '').slice(0, 200);
  return { ok: true, action: out };
}

function sameAction(a, b) {
  return Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);
}

class PhoneAgent {
  /** @param {{ask:Function, onEvent?:Function}} deps  ask(messages) → { ok, text } */
  constructor({ ask, onEvent } = {}) {
    this.ask = ask;
    this.onEvent = onEvent;
    this.log = [];
  }

  _push(entry) {
    const item = { at: Date.now(), ...entry };
    this.log = [item, ...this.log].slice(0, 80);
    this.onEvent?.(item);
    return item;
  }

  /**
   * 手机每一步来问一次。history 是手机端记的（它知道每步真实执行结果），
   * 这里只负责判断 + 一个「连做三次同样的事」的刹车。
   */
  async step({ goal, nodes: rawNodes, history = [], app = '' } = {}) {
    const clean = String(goal || '').trim();
    if (!clean) return { ok: false, error: '目标是空的。' };
    const nodes = compactNodes(rawNodes);
    const hist = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

    const last3 = hist.slice(-3).map((h) => h?.action).filter(Boolean);
    if (last3.length === 3 && sameAction(last3[0], last3[1]) && sameAction(last3[1], last3[2])) {
      const action = { action: 'ask', say: '我在同一个地方转了三圈，你看一下屏幕再告诉我怎么走？' };
      this._push({ type: 'stuck', goal: clean, action });
      return { ok: true, action };
    }

    const result = await this.ask([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildStepPrompt({ goal: clean, nodes, history: hist.map((h) => h.text || h), app }) },
    ]);
    if (!result?.ok) {
      this._push({ type: 'error', goal: clean, error: result?.error || '模型没返回' });
      return { ok: false, error: result?.error || '模型没返回。' };
    }
    const parsed = parseAction(result.text, nodes.length);
    if (!parsed.ok) {
      this._push({ type: 'error', goal: clean, error: parsed.error });
      return { ok: false, error: parsed.error };
    }
    const node = 'index' in parsed.action ? nodes[parsed.action.index] : null;
    this._push({ type: 'step', goal: clean, app, action: parsed.action, target: node ? (node.t || node.d || node.id || node.cls) : '' });
    return { ok: true, action: parsed.action, target: node ? (node.t || node.d || '') : '' };
  }
}

// ---------- 传文件 ----------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mimeFor = (name) => MIME[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';

const MAX_FILE = 512 * 1024 * 1024;

/** 文件名只留下安全的那部分：没有路径、没有控制字符，空了就给个默认名 */
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[ -\\/:*?"<>|]/g, '_').trim();
  return (base && base !== '.' && base !== '..') ? base.slice(0, 180) : `文件-${Date.now()}`;
}

/** 同名不覆盖：a.pdf → a (2).pdf */
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let k = 2; fs.existsSync(candidate); k += 1) candidate = path.join(dir, `${stem} (${k})${ext}`);
  return candidate;
}

class PhoneOutbox {
  /** @param {{inboxDir?:string}} opts inboxDir：手机推过来的文件落在哪 */
  constructor({ inboxDir } = {}) {
    this.items = [];                                  // 等手机来取的
    this.inboxDir = inboxDir || path.join(os.homedir(), 'Downloads', 'Agent工具箱', '手机精灵');
  }

  /** 电脑这边放一个文件进去（拖到精灵身上 / 点按钮选的） */
  add(filePath) {
    const abs = path.resolve(String(filePath || ''));
    let stat;
    try { stat = fs.statSync(abs); } catch { return { ok: false, error: `找不到文件：${abs}` }; }
    if (!stat.isFile()) return { ok: false, error: '只能发文件，不能发文件夹。' };
    if (stat.size > MAX_FILE) return { ok: false, error: '文件超过 512MB，走网盘吧。' };
    const item = { id: crypto.randomUUID(), name: path.basename(abs), path: abs, size: stat.size, mime: mimeFor(abs), addedAt: Date.now() };
    this.items = [...this.items.filter((x) => x.path !== abs), item].slice(-50);
    return { ok: true, item: this.publicItem(item) };
  }

  publicItem(item) { const { path: _p, ...rest } = item; return rest; }
  list() { return this.items.map((x) => this.publicItem(x)); }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  remove(id) { const before = this.items.length; this.items = this.items.filter((x) => x.id !== id); return before !== this.items.length; }

  /** 手机推上来的文件：流式落盘，不经过 base64，不受 8MB 的限制 */
  async receive(stream, { name, size }) {
    const wanted = Number(size) || 0;
    if (wanted > MAX_FILE) throw new Error('文件超过 512MB。');
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const target = uniquePath(this.inboxDir, safeName(name));
    const out = fs.createWriteStream(target);
    let total = 0;
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_FILE) { stream.destroy(); out.destroy(); reject(new Error('文件超过 512MB。')); }
      });
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      stream.pipe(out);
    });
    return { path: target, name: path.basename(target), size: total, mime: mimeFor(target) };
  }
}

module.exports = { PhoneAgent, PhoneOutbox, parseAction, buildStepPrompt, compactNodes, describeNodes, mimeFor, safeName, uniquePath, SYSTEM_PROMPT, ACTIONS };
