'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPLOAD_URL = 'https://member.bilibili.com/platform/upload/video/frame';
function officialUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)bilibili\.com$/i.test(u.hostname); } catch { return false; }
}
function uploadOrigin(value) {
  try { return new URL(value).origin === 'https://member.bilibili.com'; } catch { return false; }
}
function cleanDraft(data) {
  const title = String(data.title || '').trim();
  const description = String(data.description || '').trim();
  const tags = [...new Set((Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(/[,，]/)).map(t => String(t).trim()).filter(Boolean))];
  if (!title || Array.from(title).length > 80) throw new Error('标题需要 1–80 个字符');
  if (!description || description.length > 2000) throw new Error('简介需要 1–2000 个字符');
  if (!tags.length || tags.length > 10 || tags.some(t => Array.from(t).length > 20)) throw new Error('请填写 1–10 个标签，每个不超过 20 字');
  return { title, description, tags };
}

// Runs only inside the official creator page. It fills text, never clicks save/publish.
function fillCreatorFields(draft) {
  if (location.origin !== 'https://member.bilibili.com') return { title: false, description: false, tags: false };
  const state = window.__agentToolboxPublish || (window.__agentToolboxPublish = { id: draft.id, done: {} });
  if (state.id !== draft.id) return { title: false, description: false, tags: false };
  const controls = [...document.querySelectorAll('input:not([type=file]):not([type=hidden]),textarea,[contenteditable=true]')].filter(el => el.getClientRects().length);
  const hint = el => [el.getAttribute('placeholder'), el.getAttribute('data-placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' ');
  function put(el, value) {
    if (el.isContentEditable) el.textContent = value;
    else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const title = controls.find(el => /标题/.test(hint(el)));
  if (title && !state.done.title) { put(title, draft.title); state.done.title = true; }
  const desc = controls.find(el => /简介|描述/.test(hint(el))) || controls.find(el => el.isContentEditable && /ql-editor|rich-text/.test(el.className));
  if (desc && !state.done.description) { put(desc, draft.description); state.done.description = true; }
  const tags = controls.find(el => /标签/.test(hint(el)));
  if (tags && !state.done.tags) {
    for (const tag of draft.tags) {
      put(tags, tag);
      tags.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      tags.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    state.done.tags = true;
  }
  return { ...state.done };
}

class BilibiliPublishService {
  constructor({ outputDir, BrowserWindow, session, partition = 'persist:bilibili-study', emit = () => {} }) {
    this.outputDir = outputDir; this.BrowserWindow = BrowserWindow; this.session = session;
    this.partition = partition; this.emit = emit; this.drafts = new Map(); this.active = null;
  }
  _video(file) {
    const root = fs.realpathSync(this.outputDir), resolved = fs.realpathSync(String(file || ''));
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !rel || path.extname(resolved).toLowerCase() !== '.mp4' || !fs.statSync(resolved).isFile()) throw new Error('只能投稿论文讲解历史中的 MP4 文件');
    return resolved;
  }
  prepare(file) {
    const video = this._video(file), stat = fs.statSync(video);
    const id = crypto.createHash('sha256').update(`${video}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 24);
    let timeline = {};
    try { timeline = JSON.parse(fs.readFileSync(video.replace(/\.mp4$/i, '.timeline.json'), 'utf8')); } catch {}
    let paper = {};
    for (const f of fs.readdirSync(this.outputDir).filter(f => f.endsWith('-script.json'))) {
      try { const script = JSON.parse(fs.readFileSync(path.join(this.outputDir, f), 'utf8')); if (script.title === timeline.title) { paper = script.paper || {}; break; } } catch {}
    }
    const title = Array.from(`【AI论文解读】${timeline.title || paper.title || path.basename(video, '.mp4')}`).slice(0, 80).join('');
    const source = paper.id ? `https://arxiv.org/abs/${paper.id}` : '';
    const description = [
      timeline.title || '论文云组会式讲解', paper.title ? `原论文：${paper.title}` : '', source ? `论文链接：${source}` : '',
      '本视频使用 AI 辅助整理教学脚本，采用系统 TTS 合成配音。涉及原论文图表与结论时，请以原文为准。',
      ...(timeline.slides || []).slice(0, 14).map((s, i) => `${i + 1}. ${s.title}`),
    ].filter(Boolean).join('\n').slice(0, 2000);
    const topic = `${paper.title || ''} ${timeline.title || ''}`;
    const tags = ['人工智能', '论文解读'];
    for (const [pattern, tag] of [[/agent|智能体/i, '智能体'], [/multi.agent|多智能体/i, '多智能体'], [/inject|注入/i, '提示注入'], [/privacy|隐私/i, '隐私保护'], [/security|attack|defen|安全|攻击|防御/i, 'AI安全'], [/transformer|attention/i, 'Transformer']]) if (pattern.test(topic)) tags.push(tag);
    const draft = { id, file: video, size: stat.size, title, description, tags };
    this.drafts.set(id, draft);
    return { ok: true, draft };
  }
  _event(active, state, text, extra = {}) {
    if (active.closed) return;
    this.emit({ id: active.draft.id, state, text, ...extra });
  }
  async open(input = {}) {
    if (input.consent !== true) return { ok: false, error: '请先确认将所选视频、标题、简介和标签上传至哔哩哔哩' };
    const old = this.drafts.get(String(input.id));
    if (!old) return { ok: false, error: '投稿预览已失效，请重新点击投稿按钮' };
    const draft = { ...old, ...cleanDraft(input), file: this._video(old.file) };
    if (this.active && !this.active.closed) {
      this.active.win.show(); this.active.win.focus();
      return { ok: false, error: '已有投稿窗口，请先完成或关闭它，避免重复上传' };
    }
    const dir = path.join(this.outputDir, 'publish'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, draft.id + '.json'), JSON.stringify({ ...draft, reviewedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    const win = new this.BrowserWindow({ title: '哔哩哔哩官方投稿 · 发布前请确认', width: 1240, height: 860,
      autoHideMenuBar: true, webPreferences: { partition: this.partition, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const active = { win, draft, closed: false, fileSelected: false, filling: false, attempts: 0, timer: null };
    this.active = active;
    win.on('closed', () => {
      active.closed = true; clearInterval(active.timer);
      if (this.active === active) this.active = null;
      this.emit({ id: draft.id, state: 'closed', text: '投稿窗口已关闭；工具箱不会自动点击发布' });
    });
    const wc = win.webContents;
    wc.on('will-navigate', (event, url) => { if (!officialUrl(url)) event.preventDefault(); });
    wc.setWindowOpenHandler(({ url }) => {
      if (!officialUrl(url)) return { action: 'deny' };
      wc.loadURL(url); return { action: 'deny' };
    });
    wc.on('dom-ready', () => this._assist(active));
    active.timer = setInterval(() => this._assist(active), 3000); active.timer.unref?.();
    await win.loadURL(UPLOAD_URL);
    this._event(active, 'opened', '已打开B站官方投稿页。首次使用请扫码登录；视频上传后，请检查分区、封面、AI声明并手动确认发布。');
    return { ok: true, id: draft.id };
  }
  async _selectVideo(active) {
    const wc = active.win.webContents, debug = wc.debugger;
    let attached = false;
    try {
      if (debug.isAttached()) return false;
      debug.attach('1.3'); attached = true;
      const { root } = await debug.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const docs = [root];
      function walk(node) {
        if (node.contentDocument && uploadOrigin(node.contentDocument.documentURL)) docs.push(node.contentDocument);
        for (const child of node.children || []) walk(child);
        if (node.contentDocument) walk(node.contentDocument);
      }
      walk(root);
      for (const doc of docs) {
        const { nodeIds } = await debug.sendCommand('DOM.querySelectorAll', { nodeId: doc.nodeId, selector: 'input[type="file"]' });
        for (const nodeId of nodeIds.slice(0, 20)) {
          const { attributes } = await debug.sendCommand('DOM.getAttributes', { nodeId });
          const attrs = {}; for (let i = 0; i < attributes.length; i += 2) attrs[attributes[i]] = attributes[i + 1];
          if (!/video|\.mp4|\.mov/i.test(attrs.accept || '')) continue;
          await debug.sendCommand('DOM.setFileInputFiles', { nodeId, files: [this._video(active.draft.file)] });
          return true;
        }
      }
      return false;
    } finally { if (attached) try { debug.detach(); } catch {} }
  }
  async _assist(active) {
    if (active.closed || active.filling || active.win.isDestroyed()) return;
    if (++active.attempts > 200) { clearInterval(active.timer); this._event(active, 'manual', '自动辅助已暂停，可在官方页面继续手动操作；发布按钮始终由你确认。'); return; }
    const wc = active.win.webContents;
    if (!uploadOrigin(wc.getURL())) return;
    active.filling = true;
    try {
      const cookies = await this.session.fromPartition(this.partition).cookies.get({ url: UPLOAD_URL, name: 'SESSDATA' });
      if (!cookies.length) {
        if (!active.loginNotified) { active.loginNotified = true; this._event(active, 'login-required', '请在B站官方窗口扫码登录，登录后自动继续选择视频。'); }
        return;
      }
      if (!active.fileSelected) active.fileSelected = await this._selectVideo(active);
      if (!active.fileSelected) return;
      const data = JSON.stringify({ id: active.draft.id, title: active.draft.title, description: active.draft.description, tags: active.draft.tags });
      const script = `(${fillCreatorFields.toString()})(${data})`;
      const frames = wc.mainFrame?.framesInSubtree || [wc.mainFrame].filter(Boolean);
      const fields = {};
      for (const frame of frames) if (uploadOrigin(frame.url)) Object.assign(fields, await frame.executeJavaScript(script));
      if (!active.selectionNotified) { active.selectionNotified = true; this._event(active, 'selected', '已把视频交给B站上传组件。请等待官方页面上传完成；工具箱不会自动保存或发布。'); }
      if (fields.title && fields.description) {
        clearInterval(active.timer);
        this._event(active, 'prefilled', '标题和简介已预填。请在官方页面核对上传结果、标签、封面、分区和AI声明，最后由你点击发布。', { fields });
      }
    } catch {
      // The official page may remount the upload form. Try again without submitting anything.
      if (active.attempts === 20) this._event(active, 'manual', '暂未识别到官方表单。可在B站页面手动选择文件，标题与简介仍保存在工具箱的投稿预览中。');
    } finally { active.filling = false; }
  }
}

module.exports = { BilibiliPublishService, UPLOAD_URL, officialUrl, uploadOrigin, cleanDraft, fillCreatorFields };
