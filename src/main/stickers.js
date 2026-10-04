'use strict';

/**
 * 表情包管理：本地库 + Tenor 在线搜索 + 压缩 + 私有仓库同步。
 *
 * 数据都在 userData/stickers/ 下：media/ 放图，index.json 放元数据（分类 / 标签 / 来源）。
 * Tenor 的 API Key 用 safeStorage 加密存在 config 里，明文不回渲染层，也不进网络日志。
 * 「同步到 GitHub」是显式动作：只往用户自己填的**私有**仓库推，绝不碰工具箱这个公开源码仓库。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const IMG_EXT = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'apng']);
const TENOR_BASE = 'https://tenor.googleapis.com/v2';

function extOf(p) { return String(p || '').split(/[?#]/)[0].split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** 拉一段 JSON（Tenor 用），只允许 https + 固定域名 */
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('只允许 https'));
    const req = https.get(url, { timeout: 12000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

/** 下载一个 https 资源到内存 Buffer（带大小上限，防止拖垮） */
function download(url, { maxBytes = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('只允许 https'));
    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), { maxBytes }));
      }
      if (res.statusCode && res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('文件太大')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

function which(bin) {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local', 'bin')];
  for (const d of dirs) { const p = path.join(d, bin); try { if (fs.existsSync(p)) return p; } catch { /* ignore */ } }
  return '';
}

class StickersService {
  constructor({ store, safeStorage, clipboard, shell, dialog, userDataDir, getWindow, execFileAsync, getImageConfig }) {
    Object.assign(this, { store, safeStorage, clipboard, shell, dialog, getWindow, execFileAsync, getImageConfig });
    this.base = path.join(userDataDir, 'stickers');
    this.media = path.join(this.base, 'media');
    this.indexFile = path.join(this.base, 'index.json');
    fs.mkdirSync(this.media, { recursive: true });
  }

  // ---- 索引读写 ----
  readIndex() {
    try { const j = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); if (Array.isArray(j.items)) return j; } catch { /* 首次没有 */ }
    return { version: 1, items: [] };
  }

  writeIndex(idx) {
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(idx, null, 2), 'utf8');
    fs.renameSync(tmp, this.indexFile);
  }

  /** 给渲染层用的条目：附上 file:// 地址 */
  toView(it) {
    return { ...it, url: `file://${path.join(this.media, it.file)}` };
  }

  list({ category = '', tag = '', q = '' } = {}) {
    const idx = this.readIndex();
    let items = idx.items.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (category && category !== '全部') items = items.filter((it) => (it.category || '未分类') === category);
    if (tag) items = items.filter((it) => (it.tags || []).includes(tag));
    if (q) { const s = q.toLowerCase(); items = items.filter((it) => `${it.title || ''} ${(it.tags || []).join(' ')} ${it.category || ''}`.toLowerCase().includes(s)); }
    const cats = {};
    for (const it of idx.items) { const c = it.category || '未分类'; cats[c] = (cats[c] || 0) + 1; }
    return { items: items.map((it) => this.toView(it)), total: idx.items.length, categories: cats };
  }

  // ---- 压缩 + 落库 ----
  /** 把一个 Buffer 压缩后写进 media/，返回落库条目 */
  async ingestBuffer(buf, { ext, title = '', category = '未分类', tags = [], source = 'import', sourceUrl = '' }) {
    ext = IMG_EXT.has(ext) ? ext : 'png';
    const id = crypto.randomUUID();
    let outExt = ext;
    let outBuf = buf;
    try {
      if (ext === 'gif') { outBuf = await this.compressGif(buf); }
      else { const r = this.compressStatic(buf, ext); outBuf = r.buf; outExt = r.ext; }
    } catch { outBuf = buf; }  // 压不动就存原图
    const file = `${id}.${outExt}`;
    fs.writeFileSync(path.join(this.media, file), outBuf);
    const dims = this.dims(path.join(this.media, file));
    const entry = {
      id, file, ext: outExt, title: String(title || '').slice(0, 120),
      category: String(category || '未分类').slice(0, 40) || '未分类',
      tags: (tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12),
      source, sourceUrl: String(sourceUrl || '').slice(0, 400),
      w: dims.width, h: dims.height, size: outBuf.length, addedAt: Date.now(),
    };
    const idx = this.readIndex();
    idx.items.push(entry);
    this.writeIndex(idx);
    return this.toView(entry);
  }

  dims(file) {
    try { const { nativeImage } = require('electron'); const img = nativeImage.createFromPath(file); const s = img.getSize(); return { width: s.width, height: s.height }; } catch { return { width: 0, height: 0 }; }
  }

  /** 静图：太大就缩到 512、重编码。带透明的存 png，否则存 jpeg 省体积 */
  compressStatic(buf, ext) {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { buf, ext };
    const s = img.getSize();
    const max = 512;
    if (s.width > max || s.height > max) {
      const scale = max / Math.max(s.width, s.height);
      img = img.resize({ width: Math.round(s.width * scale), height: Math.round(s.height * scale), quality: 'good' });
    }
    if (ext === 'png' || ext === 'webp' || ext === 'apng') { const out = img.toPNG(); return out.length && out.length < buf.length ? { buf: out, ext: 'png' } : { buf, ext }; }
    const out = img.toJPEG(82);
    return out.length && out.length < buf.length ? { buf: out, ext: 'jpg' } : { buf, ext };
  }

  /** GIF：有 gifsicle 就用它有损压缩，没有就原样存（Tenor 下来的本就是压过的 tinygif/gif） */
  async compressGif(buf) {
    const bin = which('gifsicle');
    if (!bin) return buf;
    const tmpIn = path.join(os.tmpdir(), `atb-${crypto.randomUUID()}.gif`);
    const tmpOut = `${tmpIn}.out.gif`;
    fs.writeFileSync(tmpIn, buf);
    try {
      await this.execFileAsync(bin, ['-O3', '--lossy=80', '--colors', '160', '-o', tmpOut, tmpIn], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
      const out = fs.readFileSync(tmpOut);
      return out.length && out.length < buf.length ? out : buf;
    } finally { try { fs.unlinkSync(tmpIn); } catch { /* ignore */ } try { fs.unlinkSync(tmpOut); } catch { /* ignore */ } }
  }

  // ---- 导入 ----
  async importDialog() {
    const win = this.getWindow?.();
    const r = await this.dialog.showOpenDialog(win || undefined, {
      title: '选表情包（可多选，支持 GIF / PNG / JPG / WebP）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片 / 表情包', extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp', 'apng'] }],
    });
    if (r.canceled || !r.filePaths?.length) return { ok: false, canceled: true };
    return this.importPaths(r.filePaths);
  }

  async importPaths(paths, meta = {}) {
    const out = [];
    for (const p of paths || []) {
      try {
        const ext = extOf(p);
        if (!IMG_EXT.has(ext)) continue;
        const buf = fs.readFileSync(p);
        if (!buf.length || buf.length > 40 * 1024 * 1024) continue;
        out.push(await this.ingestBuffer(buf, { ext, title: path.basename(p, `.${ext}`), source: 'import', ...meta }));
      } catch { /* 单个失败跳过 */ }
    }
    return { ok: true, added: out.length, items: out };
  }

  update(id, patch = {}) {
    const idx = this.readIndex();
    const it = idx.items.find((x) => x.id === id);
    if (!it) return { ok: false, error: '找不到这个表情' };
    if (typeof patch.category === 'string') it.category = patch.category.slice(0, 40) || '未分类';
    if (typeof patch.title === 'string') it.title = patch.title.slice(0, 120);
    if (Array.isArray(patch.tags)) it.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
    this.writeIndex(idx);
    return { ok: true, item: this.toView(it) };
  }

  remove(id) {
    const idx = this.readIndex();
    const i = idx.items.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, error: '找不到这个表情' };
    const [it] = idx.items.splice(i, 1);
    this.writeIndex(idx);
    try { fs.unlinkSync(path.join(this.media, it.file)); } catch { /* 文件早没了也无所谓 */ }
    return { ok: true };
  }

  filePath(id) { const it = this.readIndex().items.find((x) => x.id === id); return it ? path.join(this.media, it.file) : ''; }

  /** 按 id 读成 data URL —— 渲染层「玩法」要读像素合成，file:// 画布会被污染，data: 不会 */
  dataUrl(id) {
    const p = this.filePath(id);
    if (!p || !fs.existsSync(p)) return { ok: false, error: '文件不在了' };
    try {
      const b = fs.readFileSync(p);
      if (b.length > 25 * 1024 * 1024) return { ok: false, error: '图太大' };
      const ex = extOf(p); const mime = ex === 'jpg' ? 'image/jpeg' : `image/${ex}`;
      return { ok: true, dataUrl: `data:${mime};base64,${b.toString('base64')}` };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  reveal(id) { const p = this.filePath(id); if (p && fs.existsSync(p)) { this.shell.showItemInFolder(p); return { ok: true }; } return { ok: false }; }

  /** 复制：mac 把「文件」放进剪贴板（粘进微信能带动图），其它平台退回位图 */
  async copy(id) {
    const p = this.filePath(id);
    if (!p || !fs.existsSync(p)) return { ok: false, error: '文件不在了' };
    if (process.platform === 'darwin') {
      try {
        await this.execFileAsync('/usr/bin/osascript', ['-e', `set the clipboard to (POSIX file ${JSON.stringify(p)})`], { timeout: 6000 });
        return { ok: true, as: 'file' };
      } catch { /* 退回位图 */ }
    }
    try { const { nativeImage } = require('electron'); this.clipboard.writeImage(nativeImage.createFromPath(p)); return { ok: true, as: 'image' }; } catch (e) { return { ok: false, error: e.message }; }
  }

  openFolder() { this.shell.openPath(this.media); return { ok: true }; }

  /** 「玩法」合成出来的图（data URL）存回本地库 */
  async saveComposed({ dataUrl, title = '玩法', category = '玩法', tags = [] }) {
    const m = String(dataUrl || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { ok: false, error: '图片数据无效' };
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 40 * 1024 * 1024) return { ok: false, error: '图片为空或太大' };
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const item = await this.ingestBuffer(buf, { ext, title, category, tags, source: 'compose' });
    return { ok: true, item };
  }

  // ---- AI 融合（复用已配好的生图模型，走 /images/edits 多图编辑） ----
  imageStatus() { const cfg = this.getImageConfig ? this.getImageConfig() : {}; return { hasKey: Boolean(cfg.apiKey), model: cfg.model || 'gpt-image-2.5-flare' }; }

  /** 把一张图规整成 PNG 首帧（gif/webp 动图 → 静态 PNG），保证生图网关能吃 */
  toPng(buf) {
    try { const { nativeImage } = require('electron'); const img = nativeImage.createFromBuffer(buf); if (!img.isEmpty()) { const out = img.toPNG(); if (out && out.length) return out; } } catch { /* 退回原图 */ }
    return buf;
  }

  /** 融合：把选中的表情包 + prompt 交给生图模型，产出一张新表情存回库 */
  async fuse({ ids = [], dataUrls = [], prompt = '', size = '1024x1024' }) {
    const refs = [];
    for (const id of ids) { const p = this.filePath(id); if (p && fs.existsSync(p)) { const b = fs.readFileSync(p); refs.push({ buffer: this.toPng(b), mime: 'image/png', name: `${path.basename(p, path.extname(p))}.png` }); } }
    for (const du of dataUrls) { const m = String(du).match(/^data:image\/[\w+]+;base64,(.+)$/); if (m) refs.push({ buffer: this.toPng(Buffer.from(m[1], 'base64')), mime: 'image/png', name: 'ref.png' }); }
    if (!refs.length) return { ok: false, error: '先选至少一张图' };
    if (refs.length > 4) refs.length = 4;
    const cfg = this.getImageConfig ? this.getImageConfig() : {};
    if (!cfg.apiKey) return { ok: false, error: 'no-key' };
    try {
      const { OpenAIImageClient } = require('./openai-image');
      const client = new OpenAIImageClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
      const full = String(prompt || '').trim() || '把这些表情包自然地融合成一张全新的表情包：保留每个角色最有辨识度的特征，风格统一、线条干净、白底或透明底，突出情绪。';
      const r = await client.editImage(full, refs, { model: cfg.model || undefined, size });
      if (!r.ok) return r;
      const item = await this.ingestBuffer(Buffer.from(r.base64, 'base64'), { ext: 'png', title: '融合', category: '融合', tags: ['融合'], source: 'fuse' });
      return { ok: true, item, meta: r.meta };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /** 生成二维码模块矩阵（渲染层拿去和图片合成）。行主序 0/1，1=深色 */
  qrMatrix(text) {
    const t = String(text || '').slice(0, 1000);
    if (!t.trim()) return { ok: false, error: 'no-text' };
    try {
      const qr = require('qrcode').create(t, { errorCorrectionLevel: 'H' });
      return { ok: true, size: qr.modules.size, data: Array.from(qr.modules.data).map((v) => (v ? 1 : 0)) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---- Tenor Key（safeStorage 加密） ----
  keyPath() { return 'stickers.tenor.keyEncrypted'; }
  readKey() {
    const enc = this.store.get(this.keyPath(), '');
    if (!enc || !this.safeStorage.isEncryptionAvailable()) return '';
    try { return this.safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
  }
  saveKey(value) {
    const key = String(value || '').trim();
    if (!key) { this.store.set(this.keyPath(), undefined); return { ok: true, hasKey: false }; }
    if (!this.safeStorage.isEncryptionAvailable()) return { ok: false, error: '系统安全存储不可用，未保存。' };
    this.store.set(this.keyPath(), this.safeStorage.encryptString(key).toString('base64'));
    return { ok: true, hasKey: true };
  }
  keyStatus() { return { hasKey: Boolean(this.readKey()), secure: this.safeStorage.isEncryptionAvailable() }; }

  // ---- Tenor 在线搜索 ----
  normalize(results) {
    return (results || []).map((r) => {
      const f = r.media_formats || {};
      const pick = (k) => (f[k] && f[k].url) || '';
      const preview = pick('tinygif') || pick('nanogif') || pick('gif');
      const full = pick('gif') || pick('mediumgif') || pick('tinygif');
      const dims = (f.tinygif && f.tinygif.dims) || (f.gif && f.gif.dims) || [0, 0];
      return { id: r.id, desc: r.content_description || r.title || '', preview, full, mp4: pick('mp4'), w: dims[0], h: dims[1] };
    }).filter((x) => x.preview);
  }

  async search({ q = '', pos = '', limit = 24 } = {}) {
    const key = this.readKey();
    if (!key) return { ok: false, error: 'no-key' };
    const url = new URL(q ? `${TENOR_BASE}/search` : `${TENOR_BASE}/featured`);
    url.searchParams.set('key', key);
    url.searchParams.set('client_key', 'agent-toolbox');
    if (q) url.searchParams.set('q', q);
    url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))));
    url.searchParams.set('media_filter', 'tinygif,gif,mp4,nanogif');
    url.searchParams.set('contentfilter', 'medium');
    if (pos) url.searchParams.set('pos', pos);
    try {
      const j = await getJSON(url.toString());
      return { ok: true, results: this.normalize(j.results), next: j.next || '' };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async categories() {
    const key = this.readKey();
    if (!key) return { ok: false, error: 'no-key' };
    const url = `${TENOR_BASE}/categories?key=${encodeURIComponent(key)}&client_key=agent-toolbox&type=trending`;
    try { const j = await getJSON(url); return { ok: true, tags: (j.tags || []).map((t) => ({ name: t.searchterm || t.name, image: t.image })) }; } catch (e) { return { ok: false, error: e.message }; }
  }

  /** 把搜索结果存进本地库（下最合适的一档，尽量小） */
  async saveFromUrl({ url, title = '', category = '未分类', tags = [], preferSmall = true }) {
    const target = String(url || '');
    if (!/^https:\/\//.test(target)) return { ok: false, error: '地址不对' };
    try {
      const buf = await download(target);
      const ext = extOf(new URL(target).pathname) || 'gif';
      const item = await this.ingestBuffer(buf, { ext: IMG_EXT.has(ext) ? ext : 'gif', title, category, tags, source: 'tenor', sourceUrl: target });
      void preferSmall;
      return { ok: true, item };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---- 同步到私有 GitHub 仓库 ----
  git(args, opts = {}) { return this.execFileAsync('git', ['-C', this.base, ...args], { timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...opts }); }

  async syncStatus() {
    const remote = this.store.get('stickers.sync.remote', '') || '';
    let isRepo = false; let ahead = false;
    try { await this.git(['rev-parse', '--is-inside-work-tree']); isRepo = true; } catch { isRepo = false; }
    if (isRepo) { try { const { stdout } = await this.git(['status', '--porcelain']); ahead = Boolean(String(stdout || '').trim()); } catch { /* ignore */ } }
    const lastAt = this.store.get('stickers.sync.lastAt', 0) || 0;
    return { remote, isRepo, dirty: ahead, lastAt, hasGit: Boolean(which('git') || true) };
  }

  setRemote(url) {
    const u = String(url || '').trim();
    // 只收 https / git@ 的 GitHub 私有仓库地址，别的不碰
    if (u && !/^(https:\/\/|git@).+/.test(u)) return { ok: false, error: '请填写一个 GitHub 仓库地址（https 或 git@）' };
    this.store.set('stickers.sync.remote', u);
    return { ok: true, remote: u };
  }

  async sync(message = '') {
    const remote = this.store.get('stickers.sync.remote', '') || '';
    if (!remote) return { ok: false, error: 'no-remote' };
    try {
      try { await this.git(['rev-parse', '--is-inside-work-tree']); }
      catch {
        await this.git(['init']);
        await this.git(['checkout', '-B', 'main']);
        fs.writeFileSync(path.join(this.base, '.gitignore'), '*.tmp\n');
        fs.writeFileSync(path.join(this.base, 'README.md'), '# 表情包库\n\n工具箱自动同步，私有仓库。\n');
      }
      // 保证 remote origin 指向用户填的地址
      try { await this.git(['remote', 'set-url', 'origin', remote]); }
      catch { await this.git(['remote', 'add', 'origin', remote]); }
      await this.git(['add', '-A']);
      const msg = message || `sync ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
      try { await this.git(['commit', '-m', msg]); } catch { /* 没有改动 */ }
      await this.git(['push', '-u', 'origin', 'HEAD:main'], { timeout: 120000 });
      this.store.set('stickers.sync.lastAt', Date.now());
      return { ok: true, at: Date.now() };
    } catch (e) {
      const msg = String(e.stderr || e.message || e);
      if (/Authentication|could not read|Permission denied|403|remote:/i.test(msg)) return { ok: false, error: `推送被拒：${msg.slice(0, 300)}。确认你对这个私有仓库有权限，并已配好 git 凭据（gh auth login 或 SSH key）。` };
      return { ok: false, error: msg.slice(0, 300) };
    }
  }
}

module.exports = { StickersService, extOf, IMG_EXT };
