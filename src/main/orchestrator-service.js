'use strict';

/**
 * Research Orchestrator：GPT 审稿 ↔ Claude 查证的自动循环，两边都用官方模型里你指定的那条对话、不走 API。
 *   - Reviewer = 真·Edge 里的 chatgpt.com 对话：主进程用 CDP（调试端口）往那条标签页打字/发送/读回。
 *     真浏览器登录（Google/Cloudflare 都正常），工具箱只当桥梁传话。
 *   - Executor = Claude Code 某条会话：`claude --resume <id> -p` 续那条对话、用订阅登录。
 * 文件桥 ~/.agent-toolbox/rsi-research/。整个循环在主进程跑。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const cdp = require('./cdp-client');

const ROOT = path.join(os.homedir(), '.agent-toolbox', 'rsi-research');
const HIST = path.join(ROOT, 'history');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DECISIONS = ['STOP', 'PIVOT', 'PROCEED', 'ANALYZE', 'SEARCH'];

const EDGE_PORT = 9335;
const EDGE_PROFILE = path.join(os.homedir(), '.agent-toolbox', 'orch-edge');
const EDGE_BINS = {
  darwin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  win32: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  linux: 'microsoft-edge',
};

function resolveClaude() {
  const dirs = [
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.23.1', 'bin'),
    path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.bun', 'bin'),
  ];
  for (const d of dirs) { const p = path.join(d, 'claude'); if (fs.existsSync(p)) return p; }
  try { const r = path.join(os.homedir(), '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(r)) { const p = path.join(r, v, 'bin', 'claude'); if (fs.existsSync(p)) return p; } } catch { /* */ }
  return '';
}

function edgeBin() { const b = EDGE_BINS[process.platform]; return b && fs.existsSync(b) ? b : (process.platform === 'linux' ? 'microsoft-edge' : ''); }

// chatgpt 当前 DOM（2026-10 实测）：输入框是 .ProseMirror；发送按钮 aria-label=发送；
// 生成中有 aria-label=停止 的按钮、正文含「ChatGPT 正在回应」；对话文本在 main.innerText，用户轮以「你说：」开头。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 从 main.innerText 里切出最后一条助手回复：取最后一个「你说：」之后，去掉我发的 prompt 和尾部 chrome
function extractReply(full, prompt) {
  const i = full.lastIndexOf('你说：');
  let seg = i >= 0 ? full.slice(i + 3) : full;
  // 去掉我 prompt（定位 prompt 去空白后的末 40 字）
  const needle = String(prompt).replace(/\s+/g, ' ').trim().slice(-40);
  if (needle) {
    const flat = seg.replace(/\s+/g, ' ');
    const at = flat.indexOf(needle);
    if (at >= 0) seg = flat.slice(at + needle.length);
  }
  return seg
    .replace(/ChatGPT 正在回应/g, '')
    .replace(/ChatGPT 可能会出错[\s\S]*$/, '')
    .replace(/最新一条回复[\s\S]*$/, '')
    .replace(/\bHigh\s*$/, '')
    .replace(/^[\s…·]*(显示更多\s*)?ChatGPT\s*说[:：]\s*/, '')
    .trim();
}

class OrchestratorService {
  constructor({ getWindow } = {}) {
    this.getWindow = getWindow || (() => null);
    this.child = null;
    this.edgeProc = null;
    this.running = false;
    this.cancelFlag = false;
  }

  _emit(payload) { try { this.getWindow()?.webContents.send('orchestrator:progress', payload); } catch { /* */ } }
  _cfgPath() { return path.join(ROOT, 'config.json'); }
  _cfg() { try { return JSON.parse(fs.readFileSync(this._cfgPath(), 'utf8')); } catch { return {}; } }
  _saveCfg(patch) { const c = { ...this._cfg(), ...patch }; fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(this._cfgPath(), JSON.stringify(c, null, 2)); return c; }
  _read(f, fb = '') { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return fb; } }
  _lineage() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'lineage.json'), 'utf8')); } catch { return []; } }

  /** 从你指定的那条（几百 M）对话尾部抽最近十几条消息当"近况摘录"，几 KB，注进第一轮，不整条重吃 */
  _recap(sid) {
    try {
      let fp = '';
      for (const d of fs.readdirSync(PROJECTS_DIR)) { const c = path.join(PROJECTS_DIR, d, `${sid}.jsonl`); if (fs.existsSync(c)) { fp = c; break; } }
      if (!fp) return '';
      const size = fs.statSync(fp).size;
      const start = Math.max(0, size - 400 * 1024);
      const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
      const msgs = [];
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; }
        if ((o.type === 'user' || o.type === 'assistant') && o.message) {
          const c = o.message.content;
          let t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join(' ') : '');
          t = String(t).replace(/\s+/g, ' ').trim();
          if (t && !t.startsWith('<')) msgs.push(`${o.type === 'user' ? '我' : 'Claude'}：${t.slice(0, 280)}`);
        }
      }
      return msgs.slice(-14).join('\n').slice(0, 4000);
    } catch { return ''; }
  }

  // ---------- Claude 会话 ----------
  listClaudeSessions(limit = 40) {
    const out = []; let dirs = [];
    try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return { ok: true, sessions: [] }; }
    for (const d of dirs) {
      const full = path.join(PROJECTS_DIR, d); let files = [];
      try { files = fs.readdirSync(full).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const fp = path.join(full, f); let stat; try { stat = fs.statSync(fp); } catch { continue; }
        const sid = f.replace(/\.jsonl$/, '');
        let cwd = ''; let userMsg = ''; let ct = ''; let at = ''; let ctAny = ''; let atAny = '';
        try {
          // Claude Code 把对话名字存成 custom-title（你手动起的）/ ai-title（AI 起的），比第一句话好认；
          // 这些行每隔十几行就出现一次，读前 400 行足够拿到，也不用读完整个大 jsonl。
          for (const line of fs.readFileSync(fp, 'utf8').split('\n').slice(0, 400)) {
            if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; }
            if (!cwd && o.cwd) cwd = o.cwd;
            if (!userMsg && o.type === 'user' && o.message) { const c = o.message.content; const t = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text || '') : ''); if (t && !t.startsWith('<')) userMsg = t.replace(/\s+/g, ' ').slice(0, 80); }
            if (o.type === 'custom-title' && o.customTitle) { ctAny = o.customTitle; if (o.sessionId === sid) ct = o.customTitle; }
            if (o.type === 'ai-title' && o.aiTitle) { atAny = o.aiTitle; if (o.sessionId === sid) at = o.aiTitle; }
          }
        } catch { /* */ }
        const title = ct || at || ctAny || atAny || userMsg || '(无标题)';
        out.push({ id: sid, cwd, title: title.slice(0, 80), mtime: stat.mtimeMs });
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, sessions: out.slice(0, limit) };
  }

  // ---------- Edge（GPT 那条对话的宿主）----------
  async _edgeUp() { try { await cdp.httpJson(EDGE_PORT, '/json/version'); return true; } catch { return false; } }

  async ensureEdge() {
    if (await this._edgeUp()) return { ok: true, already: true };
    const bin = edgeBin();
    if (!bin) return { ok: false, error: '没找到 Microsoft Edge。装了 Edge 再用这个（或改用别的 Chromium 浏览器）。' };
    fs.mkdirSync(EDGE_PROFILE, { recursive: true });
    this.edgeProc = spawn(bin, [
      `--remote-debugging-port=${EDGE_PORT}`, `--user-data-dir=${EDGE_PROFILE}`,
      '--no-first-run', '--no-default-browser-check', '--new-window', 'https://chatgpt.com',
    ], { detached: true, stdio: 'ignore' });
    this.edgeProc.unref();
    for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 600)); if (await this._edgeUp()) return { ok: true, launched: true }; }
    return { ok: false, error: 'Edge 起来了但调试端口没通，重试一下。' };
  }

  async edgeStatus() {
    const up = await this._edgeUp();
    let chatgptTabs = [];
    if (up) { try { chatgptTabs = (await cdp.listPages(EDGE_PORT)).filter((p) => /chatgpt\.com/i.test(p.url)).map((p) => ({ url: p.url, title: p.title })); } catch { /* */ } }
    return { ok: true, up, bin: Boolean(edgeBin()), chatgptTabs };
  }

  /** 打开/聚焦一个 chatgpt 标签让用户登录 */
  async openChatgpt() {
    const e = await this.ensureEdge(); if (!e.ok) return e;
    try {
      const pages = await cdp.listPages(EDGE_PORT);
      if (pages.some((p) => /chatgpt\.com/i.test(p.url))) return { ok: true };
      const ver = await cdp.httpJson(EDGE_PORT, '/json/version');
      const sess = await cdp.connect(ver.webSocketDebuggerUrl);
      await sess.send('Target.createTarget', { url: 'https://chatgpt.com' });
      sess.close();
      return { ok: true };
    } catch (e2) { return { ok: false, error: e2.message }; }
  }

  async _pickChatgptTarget() {
    const pages = await cdp.listPages(EDGE_PORT);
    const chat = pages.filter((p) => /chatgpt\.com/i.test(p.url));
    if (!chat.length) return null;
    const want = (this._cfg().gptUrl || '').trim();
    return (want && chat.find((p) => p.url === want)) || (want && chat.find((p) => p.url.startsWith(want.split('?')[0]))) || chat[0];
  }

  /** 往指定的 chatgpt 对话发话、等它答完、抓回复（CDP 驱动真 Edge） */
  async gptAsk(text) {
    const e = await this.ensureEdge(); if (!e.ok) return { ok: false, error: e.error };
    const target = await this._pickChatgptTarget();
    if (!target) return { ok: false, error: 'Edge 里没有打开的 ChatGPT 对话，先「打开 Edge 登录」并切到那条对话。' };
    let sess;
    try {
      sess = await cdp.connect(target.webSocketDebuggerUrl);
      await sess.send('Runtime.enable');
      const ready = await sess.evaluate('(()=>{const pm=document.querySelector(".ProseMirror");if(!pm)return false;pm.focus();return true})()').catch(() => false);
      if (!ready) { sess.close(); return { ok: false, error: '没找到输入框（没登录 / 不在对话里 / 页面改版）' }; }
      const busy = await sess.evaluate('!!document.querySelector("button[aria-label*=停止]")').catch(() => false);
      if (busy) { sess.close(); return { ok: false, error: 'ChatGPT 还在生成上一条，等它停了再跑' }; }
      // 全选清空 + 插入（CDP 原生输入，ProseMirror 才吃得进）
      await sess.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 4, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
      await sess.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 4, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
      await sess.send('Input.insertText', { text: String(text) });
      await sleep(500);
      const sent = await sess.evaluate('(()=>{const b=document.querySelector("button[aria-label=发送]");if(b&&!b.disabled){b.click();return "sent"}return "no-send"})()').catch((er) => 'err:' + er.message);
      if (sent !== 'sent') { sess.close(); return { ok: false, error: `发送失败：${sent}（没打上字 / 页面改版）` }; }
      await sleep(1200);
      let prev = ''; let stable = 0;
      for (let i = 0; i < 300; i += 1) {
        if (this.cancelFlag) { sess.close(); return { ok: false, error: '已取消' }; }
        await sleep(1800);
        const raw = await sess.evaluate('JSON.stringify((()=>{const m=document.querySelector("main")||document.body;const full=m.innerText;const streaming=!!document.querySelector("button[aria-label*=停止]")||full.includes("ChatGPT 正在回应");return {streaming,full}})())').catch(() => null);
        if (!raw) continue;
        let o; try { o = JSON.parse(raw); } catch { continue; }
        if (!o.streaming) {
          const reply = extractReply(o.full, text);
          if (reply) { if (reply === prev) { stable += 1; if (stable >= 2) { sess.close(); return { ok: true, text: reply }; } } else { prev = reply; stable = 0; } }
        }
        if (i % 5 === 0) this._emit({ phase: 'reviewer', line: `等 GPT 回复…${o.streaming ? '（生成中）' : '（收尾）'}` });
      }
      sess.close(); return prev ? { ok: true, text: prev } : { ok: false, error: 'GPT 等超时 / 读不到回复（可能这条对话卡住了）' };
    } catch (err) { try { sess?.close(); } catch { /* */ } return { ok: false, error: `CDP 失败：${err.message}` }; }
  }

  // ---------- 状态 / 配置 ----------
  status() {
    const cfg = this._cfg();
    return {
      ok: true, workspace: ROOT, running: this.running,
      goal: cfg.goal || '', round: cfg.round || 0, allowImpl: Boolean(cfg.allowImpl),
      targetRepo: cfg.targetRepo || '',
      claudeSessionId: cfg.claudeSessionId || '', claudeSessionCwd: cfg.claudeSessionCwd || '', gptUrl: cfg.gptUrl || '',
      hasClaude: Boolean(resolveClaude()), hasEdge: Boolean(edgeBin()),
      lastDecision: cfg.lastDecision || null,
      state: this._read('STATE.md'), review: this._read('GPT_REVIEW.md'), report: this._read('CLAUDE_REPORT.md'),
      decision: (() => { try { return JSON.parse(this._read('DECISION.json', '{}')); } catch { return {}; } })(),
      lineage: this._lineage(),
    };
  }

  setup(patch = {}) {
    fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(HIST, { recursive: true }); fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
    const allow = ['targetRepo', 'goal', 'claudeSessionId', 'claudeSessionCwd', 'gptUrl', 'allowImpl'];
    const clean = {}; for (const k of allow) if (patch[k] !== undefined) clean[k] = k === 'allowImpl' ? Boolean(patch[k]) : String(patch[k] || '');
    // 换了指定的 Claude 对话：清掉编排线程，下轮从新对话重新 fork
    if (patch.claudeSessionId !== undefined && patch.claudeSessionId !== this._cfg().claudeSessionId) clean.orchRunSid = '';
    const cfg = this._saveCfg(clean);
    if (!fs.existsSync(path.join(ROOT, 'STATE.md'))) {
      fs.writeFileSync(path.join(ROOT, 'STATE.md'), ['# Current research status', '', `Goal: ${cfg.goal || '（待定）'}`, '', 'Rejected directions:', '- （还没有）', '', 'Confirmed facts:', '- （还没有）', '', 'Important:', 'Do not implement until DECISION 明确返回 PROCEED。', '', '## Research log', ''].join('\n'), 'utf8');
    } else if (patch.goal !== undefined) { fs.writeFileSync(path.join(ROOT, 'STATE.md'), this._read('STATE.md').replace(/^Goal:.*$/m, `Goal: ${cfg.goal || '（待定）'}`), 'utf8'); }
    return { ok: true, ...this.status() };
  }

  openFolder() { try { require('electron').shell.openPath(ROOT); } catch { /* */ } return { ok: true }; }

  cancel() {
    this.cancelFlag = true;
    if (this.child) { try { process.platform === 'win32' ? this.child.kill() : process.kill(-this.child.pid, 'SIGKILL'); } catch { try { this.child.kill(); } catch { /* */ } } }
    return { ok: true };
  }

  // ---------- Executor（claude --resume）----------
  runExecutor({ prompt, implement } = {}) {
    const cfg = this._cfg(); const userSid = cfg.claudeSessionId;
    if (!userSid) return Promise.resolve({ ok: false, error: '还没指定 Claude 会话' });
    const bin = resolveClaude(); if (!bin) return Promise.resolve({ ok: false, error: '没找到 claude CLI' });
    const cwd = (cfg.targetRepo && fs.existsSync(cfg.targetRepo)) ? cfg.targetRepo : ((cfg.claudeSessionCwd && fs.existsSync(cfg.claudeSessionCwd)) ? cfg.claudeSessionCwd : ROOT);
    const readOnly = ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch']; const writeTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    const allowed = implement ? [...readOnly, ...writeTools] : readOnly;
    // 编排用自己的一条新线程：第一轮全新（不 resume 你那条几百 M 的大对话，省钱），之后 resume 它（便宜、连贯）。
    // 你指定对话的上下文靠「近况摘录」注进第一轮 prompt，不整条重吃。
    const runSid = cfg.orchRunSid || '';
    const args = runSid ? ['--resume', runSid] : [];
    args.push('-p', String(prompt || ''), '--output-format', 'json', '--allowedTools', allowed.join(' '));
    if (!implement) args.push('--disallowedTools', writeTools.join(' '));
    // 清理环境：别让桌面 app 注入的 ANTHROPIC_*/CLAUDE_CODE_* 覆盖 settings.json 的订阅代理（否则 401 Invalid bearer token）
    const env = { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH || ''}` };
    for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$|^CLAUDE_EFFORT$/.test(k)) delete env[k];
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      this.child = child; let out = ''; let err = ''; let n = 0;
      const hb = setInterval(() => { n += 10; this._emit({ phase: 'executor', line: `Claude 还在查证…已 ${n}s` }); }, 10000);
      const killer = setTimeout(() => { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }, 15 * 60 * 1000);
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', (e) => { clearInterval(hb); clearTimeout(killer); this.child = null; resolve({ ok: false, error: e.message }); });
      child.on('close', (code) => {
        clearInterval(hb); clearTimeout(killer); this.child = null;
        let text = out.trim(); let sessionId = ''; let isErr = false; let errMsg = '';
        try { const j = JSON.parse(text); sessionId = j.session_id || ''; isErr = Boolean(j.is_error); text = String(j.result ?? j.text ?? text); if (isErr) errMsg = text; } catch { /* 非 json 用原文 */ }
        if (isErr) return resolve({ ok: false, error: `claude：${errMsg}`.slice(0, 300), sessionId });
        resolve({ ok: code === 0 && text.length > 0, text, sessionId, error: text ? '' : (err.trim() || `claude 退出码 ${code}`) });
      });
    });
  }

  _parseDecision(reviewText) {
    const m = String(reviewText).match(/```json\s*([\s\S]*?)```/i) || String(reviewText).match(/\{[\s\S]*"decision"[\s\S]*\}/);
    let d = {}; try { d = JSON.parse(m ? (m[1] || m[0]) : '{}'); } catch { d = {}; }
    if (!DECISIONS.includes(d.decision)) { const up = String(reviewText).toUpperCase(); d.decision = DECISIONS.find((k) => up.includes(k)) || 'ANALYZE'; }
    d.confidence = Number(d.confidence) || 0; d.next_question = String(d.next_question || '').slice(0, 500);
    return d;
  }

  _persist({ round, question, report, review }) {
    const stamp = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(ROOT, 'CLAUDE_REPORT.md'), String(report || ''), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'GPT_REVIEW.md'), String(review || ''), 'utf8');
    const decision = this._parseDecision(review || '');
    fs.writeFileSync(path.join(ROOT, 'DECISION.json'), JSON.stringify(decision, null, 2), 'utf8');
    fs.appendFileSync(path.join(ROOT, 'STATE.md'), `- ${stamp} round ${round} [${decision.decision}] ${question} → ${decision.next_question || '(结束)'}\n`, 'utf8');
    fs.writeFileSync(path.join(HIST, `round-${String(round).padStart(3, '0')}.md`), `# Round ${round} · ${stamp}\n\nQ: ${question}\n\n## CLAUDE_REPORT\n\n${report || ''}\n\n## GPT_REVIEW\n\n${review || ''}\n`, 'utf8');
    const lineage = this._lineage(); lineage.push({ round, at: Date.now(), question, decision: decision.decision, confidence: decision.confidence, next_question: decision.next_question });
    fs.writeFileSync(path.join(ROOT, 'lineage.json'), JSON.stringify(lineage, null, 2), 'utf8');
    this._saveCfg({ round, lastDecision: decision.decision, nextQuestion: decision.next_question || '' });
    return decision;
  }

  // ---------- 一轮 / 自动连跑（整个循环在主进程）----------
  async runRound({ question } = {}) {
    if (this.running) return { ok: false, error: '已经在跑了' };
    this.running = true; this.cancelFlag = false;
    try { const r = await this._oneRound(String(question || '').trim()); this.running = false; await this._emitDone(); return r; }
    catch (e) { this.running = false; this._emit({ phase: 'error', line: e.message }); return { ok: false, error: e.message }; }
  }

  async runAuto({ question, maxRounds = 6 } = {}) {
    if (this.running) return { ok: false, error: '已经在跑了' };
    this.running = true; this.cancelFlag = false;
    const cap = Math.max(1, Math.min(20, Number(maxRounds) || 6));
    let q = String(question || '').trim(); let last = null;
    try {
      for (let i = 0; i < cap; i += 1) {
        if (this.cancelFlag) { this._emit({ phase: 'auto', line: '已停止' }); break; }
        this._emit({ phase: 'auto', line: `—— 第 ${i + 1}/${cap} 轮 ——` });
        last = await this._oneRound(q);
        if (!last.ok) break;
        const d = last.decision.decision;
        if (d === 'STOP' || d === 'PROCEED') { this._emit({ phase: 'auto', line: `遇到 ${d}，停下交给你` }); break; }
        q = last.decision.next_question || q; if (!q) break;
      }
    } finally { this.running = false; await this._emitDone(); }
    return last || { ok: false, error: '没跑成' };
  }

  async _oneRound(question) {
    const cfg = this._cfg();
    const q = question || cfg.nextQuestion || cfg.goal || '';
    if (!q) return { ok: false, error: '先填研究目标 / 研究问题' };
    if (!cfg.claudeSessionId) return { ok: false, error: '先指定 Claude 会话' };
    const round = (cfg.round || 0) + 1;
    const implement = Boolean(cfg.allowImpl) && cfg.lastDecision === 'PROCEED';
    const state = this._read('STATE.md').slice(0, 12000);

    // 1) Claude 查证
    const firstRound = !cfg.orchRunSid;
    const recap = firstRound ? this._recap(cfg.claudeSessionId) : '';
    this._emit({ phase: 'executor', line: firstRound ? '① Claude 查证中（新线程，已带入你那条对话的近况）…' : '① Claude 查证中（续编排线程）…' });
    const exPrompt = [
      '你是科研编排里的 Evidence / Engineering Agent，在目标仓库里只读查证。',
      implement ? '本轮已获授权进入【实现】，只围绕研究问题改代码，别扩张。' : '本轮【只读分析】：绝不改文件、不跑超贵实验，只读代码/日志/数据给证据。',
      recap ? `\n=== 你（Claude）之前在这条研究对话里聊到的近况（摘录，供参考）===\n${recap}` : '',
      '', '=== STATE ===', state, '', `=== 研究问题 ===\n${q}`,
      '', '产出简洁证据报告（Markdown）：1) 代码/日志/数据显示了什么（引文件路径）2) 统计 3) 局限 4) 一句话 verdict。不要提新算法、不要重定义方向。',
    ].join('\n');
    const ex = await this.runExecutor({ prompt: exPrompt, implement });
    if (!ex.ok) return { ok: false, error: `Claude 失败：${ex.error}` };
    // 第一轮 fork 出来的新线程 id 记下来，后面 resume 它（便宜、连贯）
    if (ex.sessionId && !this._cfg().orchRunSid) this._saveCfg({ orchRunSid: ex.sessionId });
    if (this.cancelFlag) return { ok: false, error: '已取消' };
    this._emit({ phase: 'executor', line: `证据已出（${ex.text.length} 字）` });

    // 2) GPT 审稿（Edge）
    this._emit({ phase: 'reviewer', line: '② GPT 审稿中（Edge 里的 ChatGPT）…' });
    const revPrompt = [
      '你现在固定当 Research Lead / Reviewer（审稿人兼刹车）。严格按结构输出：',
      '1. 证据证明了什么 2. 证据【没】证明什么 3. 创新性/撞车风险 4. 实验漏洞 5. 决策（STOP/PIVOT/PROCEED/ANALYZE/SEARCH 之一+理由）6. 下一轮研究问题（一句话）',
      '然后另起一段输出 json 代码块：{"decision":"...","confidence":0~1,"next_action":"...","allow_code_changes":false,"next_question":"..."}',
      '刹车：没有扎实只读证据前一律不要 PROCEED，不确定就 ANALYZE / SEARCH。',
      '', `=== STATE ===\n${state.slice(0, 8000)}`, '', `=== 研究问题 ===\n${q}`, '', `=== Claude 证据 ===\n${ex.text.slice(0, 14000)}`,
    ].join('\n');
    const rev = await this.gptAsk(revPrompt);
    if (!rev.ok) return { ok: false, error: `GPT 失败：${rev.error}` };

    // 3) 落盘
    const decision = this._persist({ round, question: q, report: ex.text, review: rev.text });
    this._emit({ phase: 'round', line: `③ 决策：${decision.decision}${decision.next_question ? ' → ' + decision.next_question : ''}` });
    return { ok: true, round, decision };
  }

  async _emitDone() { this._emit({ phase: 'done' }); }
}

module.exports = { OrchestratorService, ROOT, resolveClaude };
