'use strict';

/**
 * Zotero 联动。
 *
 * 读：直接读 Zotero 的 sqlite（先拷一份再开，Zotero 开着也不冲突），拿条目 / 分类 / 附件 / 批注。
 *     不依赖 Zotero 的本地 API 开关，Zotero 关着也能读。
 * 写：走 Zotero 桌面端的连接器接口（127.0.0.1:23119，浏览器插件用的那套）：
 *     saveItems 建条目，saveAttachment 把 PDF 字节推过去，和插件存 PDF 一个原理。
 *     这条路不需要 API key，也不碰云端。
 *
 * 表结构按 Zotero 7 / 10（schema 同一代）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const HOME = os.homedir();
const CONNECTOR = 'http://127.0.0.1:23119';
const CONNECTOR_HEADERS = { 'Content-Type': 'application/json', 'X-Zotero-Connector-API-Version': '3', 'X-Zotero-Version': '7.0.0' };

// ---------- 纯函数（有测试） ----------

/** Zotero 的 date 字段各种写法：'2024-05-01 2024-05-01'、'May 2023'、'2019' */
function yearOf(date) {
  const m = String(date || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

/** creators → 工具箱文献库的 authors [{family, given}] */
function creatorsToAuthors(creators) {
  return (creators || []).map((c) => ({ family: String(c.lastName || '').trim(), given: String(c.firstName || '').trim() })).filter((a) => a.family || a.given);
}

/** itemAttachments.path：'storage:foo.pdf' 在 dataDir/storage/<key>/foo.pdf；'attachments:x' 是链接目录；绝对路径原样 */
function resolveAttachmentPath(dataDir, key, storedPath, baseAttachmentDir = '') {
  const p = String(storedPath || '');
  if (!p) return '';
  if (p.startsWith('storage:')) return path.join(dataDir, 'storage', key, p.slice('storage:'.length));
  if (p.startsWith('attachments:')) return baseAttachmentDir ? path.join(baseAttachmentDir, p.slice('attachments:'.length)) : '';
  return p;
}

/** Zotero 批注颜色（十六进制）→ 工具箱高亮的五个色名 */
function colorName(hex) {
  const h = String(hex || '').toLowerCase();
  if (/^#ff(d4|e0|f0)/.test(h) || h === '#ffd400') return 'yellow';
  if (h.startsWith('#5f') || h.startsWith('#a2') || h.startsWith('#8e') || h === '#5fb236') return 'green';
  if (h.startsWith('#2e') || h.startsWith('#2ea8e5') || h.startsWith('#3')) return 'blue';
  if (h.startsWith('#ff6') || h.startsWith('#f1') || h.startsWith('#e5')) return 'red';
  if (h.startsWith('#a2') || h.startsWith('#8') || h.startsWith('#9')) return 'purple';
  return 'yellow';
}

/** Zotero 批注 → 「文献」页的高亮条目（research.litHighlights.<file>） */
function annotationToHighlight(ann, file) {
  return {
    id: `zot-${ann.key}`,
    paper_id: file,
    paragraph_id: 'p_text',
    page: ann.pageLabel ? Number.parseInt(ann.pageLabel, 10) || ann.pageLabel : null,
    original_text: '',
    translated_text: '',
    selected_text: String(ann.text || ann.comment || '').trim(),
    anchor_side: 'original',
    highlight_type: ann.type === 2 ? 'question' : 'important',
    color: colorName(ann.color),
    note: ann.type === 1 ? String(ann.comment || '') : '',
    created_at: ann.dateAdded ? new Date(ann.dateAdded.replace(' ', 'T') + 'Z').toISOString() : new Date().toISOString(),
    source: 'zotero',
  };
}

/** 文献库条目 → 连接器 saveItems 的 item */
function toConnectorItem(meta, pdfUrl) {
  const url = String(meta.url || '');
  const isArxiv = /arxiv\.org/i.test(url) || /arxiv/i.test(meta.journal || '');
  const item = {
    itemType: isArxiv ? 'preprint' : 'journalArticle',
    title: String(meta.title || '').trim() || '未命名',
    creators: (meta.authors || []).map((a) => ({ creatorType: 'author', firstName: a.given || '', lastName: a.family || '' })).filter((c) => c.lastName || c.firstName),
    date: String(meta.year || ''),
    tags: (meta.tags || []).map((t) => ({ tag: String(t) })),
    attachments: pdfUrl ? [{ title: 'Full Text PDF', url: pdfUrl, mimeType: 'application/pdf', snapshot: false }] : [],
  };
  if (meta.doi) item.DOI = String(meta.doi);
  if (url) item.url = url;
  if (meta.journal) item[isArxiv ? 'repository' : 'publicationTitle'] = String(meta.journal);
  if (meta.volume) item.volume = String(meta.volume);
  if (meta.issue) item.issue = String(meta.issue);
  if (meta.pages) item.pages = String(meta.pages);
  if (meta.abstract) item.abstractNote = String(meta.abstract);
  if (meta.note) item.extra = `工具箱笔记: ${String(meta.note).slice(0, 500)}`;
  return item;
}

function sanitizeName(text) {
  return String(text || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'paper';
}

// ---------- 主进程侧 ----------

function findZoteroApp() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Zotero.app', path.join(HOME, 'Applications', 'Zotero.app')]
    : process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Zotero', 'zotero.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Zotero', 'zotero.exe')]
      : ['/usr/bin/zotero', '/opt/zotero/zotero', path.join(HOME, 'Zotero_linux-x86_64', 'zotero')];
  return candidates.find((c) => c && fs.existsSync(c)) || '';
}

/** 数据目录：prefs.js 里的 extensions.zotero.dataDir，没配就是 ~/Zotero */
function findDataDir() {
  const profileRoots = process.platform === 'darwin'
    ? [path.join(HOME, 'Library', 'Application Support', 'Zotero', 'Profiles')]
    : process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'Zotero', 'Zotero', 'Profiles')]
      : [path.join(HOME, '.zotero', 'zotero')];
  for (const root of profileRoots) {
    let profiles = [];
    try { profiles = fs.readdirSync(root); } catch { continue; }
    for (const prof of profiles) {
      const prefs = path.join(root, prof, 'prefs.js');
      try {
        const m = fs.readFileSync(prefs, 'utf8').match(/user_pref\("extensions\.zotero\.dataDir",\s*"([^"]+)"\)/);
        if (m) { const dir = m[1].replace(/\\\\/g, '\\'); if (fs.existsSync(dir)) return dir; }
      } catch { /* 没有 prefs 就看默认位置 */ }
    }
  }
  const def = path.join(HOME, 'Zotero');
  return fs.existsSync(def) ? def : '';
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${CONNECTOR}/connector/ping`, { timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function connectorPost(route, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(`${CONNECTOR}${route}`, { method: 'POST', headers: { ...CONNECTOR_HEADERS, 'Content-Length': Buffer.byteLength(data) }, timeout: 60000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* 有的接口返回空 */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '连接器超时' }); });
    req.end(data);
  });
}

function connectorUpload(route, body, headers) {
  return new Promise((resolve) => {
    const req = http.request(`${CONNECTOR}${route}`, { method: 'POST', headers: { ...CONNECTOR_HEADERS, ...headers, 'Content-Length': body.length }, timeout: 120000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '上传超时' }); });
    req.end(body);
  });
}

function sqliteBin() {
  const candidates = process.platform === 'win32' ? ['sqlite3.exe', 'sqlite3'] : ['/usr/bin/sqlite3', '/opt/homebrew/bin/sqlite3', '/usr/local/bin/sqlite3', 'sqlite3'];
  for (const c of candidates) {
    if (c.includes(path.sep) ? fs.existsSync(c) : true) {
      try { execFileSync(c, ['-version'], { stdio: 'ignore', timeout: 2000 }); return c; } catch { /* 下一个 */ }
    }
  }
  return '';
}

class ZoteroService {
  constructor({ litDir, tmpDir }) {
    this.litDir = litDir;
    this.tmpDir = tmpDir;
    this.cache = null;         // { at, snapshot }
  }

  async detect() {
    const app = findZoteroApp();
    const dataDir = findDataDir();
    const db = dataDir ? path.join(dataDir, 'zotero.sqlite') : '';
    const running = await ping();
    return {
      installed: Boolean(app), app, dataDir, hasDb: Boolean(db && fs.existsSync(db)), running,
      sqlite: Boolean(sqliteBin()),
      hint: !app ? '没找到 Zotero，先去 zotero.org 装一个'
        : !dataDir ? 'Zotero 装了但还没打开过：打开一次，它会建好数据目录'
          : !running ? 'Zotero 没在运行：读是可以的，往 Zotero 里放论文要先把它打开'
            : '已连上',
    };
  }

  /** 拷一份库文件再读，避开 Zotero 的锁 */
  async snapshot(force = false) {
    if (!force && this.cache && Date.now() - this.cache.at < 20000) return this.cache.snapshot;
    const dataDir = findDataDir();
    const db = dataDir ? path.join(dataDir, 'zotero.sqlite') : '';
    if (!db || !fs.existsSync(db)) return { ok: false, error: 'Zotero 还没有数据库（打开一次 Zotero 就有了）' };
    const bin = sqliteBin();
    if (!bin) return { ok: false, error: '本机没有 sqlite3 命令，读不了 Zotero 的库' };
    fs.mkdirSync(this.tmpDir(), { recursive: true });
    const copy = path.join(this.tmpDir(), 'zotero-snapshot.sqlite');
    // 主库 + wal（没 checkpoint 的最近改动在里面）一起拷；-shm 是活库的共享锁，拷过来只会让读端报 locked
    for (const suffix of ['-shm', '-wal', '-journal']) { try { fs.rmSync(copy + suffix, { force: true }); } catch { /* 没有就算 */ } }
    fs.copyFileSync(db, copy);
    for (const suffix of ['-wal', '-journal']) { const extra = db + suffix; if (fs.existsSync(extra)) { try { fs.copyFileSync(extra, copy + suffix); } catch { /* 可选 */ } } }
    // 串行跑：几个 sqlite3 进程同时开一份 WAL 库会互相锁
    const q = (sql) => new Promise((resolve, reject) => {
      execFile(bin, ['-json', copy, sql], { maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, out) => {
        if (err) return reject(err);
        resolve(out.trim() ? JSON.parse(out) : []);
      });
    });
    const sequential = async (fns) => { const out = []; for (const fn of fns) out.push(await fn()); return out; };
    try {
      const [items, fields, creators, tags, collections, collectionItems, attachments, annotations] = await sequential([
        () => q("SELECT i.itemID, i.key, it.typeName, i.dateAdded, i.dateModified FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID WHERE it.typeName NOT IN ('attachment','note','annotation') AND i.itemID NOT IN (SELECT itemID FROM deletedItems)"),
        () => q('SELECT d.itemID, f.fieldName, v.value FROM itemData d JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID'),
        () => q('SELECT ic.itemID, c.firstName, c.lastName, ic.orderIndex FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex'),
        () => q('SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID'),
        () => q('SELECT collectionID, collectionName, parentCollectionID, key FROM collections'),
        () => q('SELECT collectionID, itemID FROM collectionItems'),
        () => q("SELECT a.itemID, a.parentItemID, a.contentType, a.path, i.key FROM itemAttachments a JOIN items i ON i.itemID = a.itemID WHERE a.itemID NOT IN (SELECT itemID FROM deletedItems)"),
        () => q("SELECT an.parentItemID, an.type, an.text, an.comment, an.color, an.pageLabel, an.sortIndex, i.key, i.dateAdded FROM itemAnnotations an JOIN items i ON i.itemID = an.itemID WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY an.parentItemID, an.sortIndex").catch(() => []),
      ]);
      const fieldMap = new Map();
      for (const f of fields) { if (!fieldMap.has(f.itemID)) fieldMap.set(f.itemID, {}); fieldMap.get(f.itemID)[f.fieldName] = f.value; }
      const group = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
      const creatorMap = group(creators, 'itemID'); const tagMap = group(tags, 'itemID'); const collMap = group(collectionItems, 'itemID');
      const attMap = group(attachments, 'parentItemID'); const annMap = group(annotations, 'parentItemID');
      const collById = new Map(collections.map((c) => [c.collectionID, c]));
      const collPath = (id) => { const out = []; let cur = collById.get(id); let guard = 0; while (cur && guard++ < 20) { out.unshift(cur.collectionName); cur = cur.parentCollectionID ? collById.get(cur.parentCollectionID) : null; } return out.join(' / '); };
      const list = items.map((it) => {
        const f = fieldMap.get(it.itemID) || {};
        const atts = (attMap.get(it.itemID) || []).map((a) => ({ itemID: a.itemID, key: a.key, contentType: a.contentType, path: resolveAttachmentPath(dataDir, a.key, a.path), annotations: (annMap.get(a.itemID) || []) }));
        const pdf = atts.find((a) => a.contentType === 'application/pdf' && a.path && fs.existsSync(a.path)) || null;
        return {
          itemID: it.itemID, key: it.key, type: it.typeName, dateAdded: it.dateAdded, dateModified: it.dateModified,
          title: f.title || '', doi: f.DOI || '', year: yearOf(f.date), date: f.date || '', journal: f.publicationTitle || f.repository || f.conferenceName || '', url: f.url || '', abstract: f.abstractNote || '',
          volume: f.volume || '', issue: f.issue || '', pages: f.pages || '',
          authors: creatorsToAuthors(creatorMap.get(it.itemID)),
          tags: (tagMap.get(it.itemID) || []).map((t) => t.name),
          collections: (collMap.get(it.itemID) || []).map((c) => c.collectionID),
          collectionNames: (collMap.get(it.itemID) || []).map((c) => collPath(c.collectionID)),
          pdf: pdf ? { key: pdf.key, itemID: pdf.itemID, path: pdf.path, size: (() => { try { return fs.statSync(pdf.path).size; } catch { return 0; } })(), annotationCount: pdf.annotations.length } : null,
          attachmentCount: atts.length,
        };
      }).sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)));
      const counts = new Map();
      for (const it of list) for (const c of it.collections) counts.set(c, (counts.get(c) || 0) + 1);
      const snapshot = {
        ok: true, dataDir, readAt: Date.now(),
        collections: collections.map((c) => ({ id: c.collectionID, key: c.key, name: c.collectionName, parent: c.parentCollectionID || null, path: collPath(c.collectionID), count: counts.get(c.collectionID) || 0 })).sort((a, b) => a.path.localeCompare(b.path, 'zh')),
        items: list,
        annotationsByAttachment: Object.fromEntries([...annMap].map(([k, v]) => [k, v])),
      };
      this.cache = { at: Date.now(), snapshot };
      return snapshot;
    } catch (err) {
      return { ok: false, error: `读 Zotero 库失败：${err.message}` };
    }
  }

  /** 把 Zotero 条目的 PDF 拷进文献库，返回可直接合并进 research.litMeta 的记录 */
  async importItems(keys, options = {}) {
    const snap = await this.snapshot();
    if (!snap.ok) return snap;
    const wanted = new Set(keys || []);
    const dir = this.litDir();
    const imported = []; const skipped = [];
    for (const it of snap.items) {
      if (!wanted.has(it.key)) continue;
      if (!it.pdf) { skipped.push({ key: it.key, title: it.title, reason: '没有 PDF 附件' }); continue; }
      const existing = options.existingByKey?.[it.key];
      let file = existing && fs.existsSync(path.join(dir, existing)) ? existing : '';
      if (!file) {
        const base = `${sanitizeName(it.title || it.key)}.pdf`;
        let dest = path.join(dir, base); let n = 1;
        while (fs.existsSync(dest)) dest = path.join(dir, `${sanitizeName(it.title || it.key)}-${n++}.pdf`);
        try { fs.copyFileSync(it.pdf.path, dest); } catch (err) { skipped.push({ key: it.key, title: it.title, reason: `拷不动：${err.message}` }); continue; }
        file = path.basename(dest);
      }
      const attAnns = snap.annotationsByAttachment[String(it.pdf.itemID)] || [];
      imported.push({
        file, key: it.key, existed: Boolean(existing),
        meta: {
          title: it.title, authors: it.authors, year: it.year, journal: it.journal, doi: it.doi, url: it.url, abstract: it.abstract,
          volume: it.volume, issue: it.issue, pages: it.pages, tags: it.tags,
          zotero: { key: it.key, itemID: it.itemID, attachmentKey: it.pdf.key, collections: it.collectionNames, syncedAt: Date.now() },
        },
        collectionNames: it.collectionNames,
        highlights: options.withAnnotations === false ? [] : attAnns.map((a) => annotationToHighlight(a, file)),
      });
    }
    return { ok: true, imported, skipped };
  }

  // ---- 往 Zotero 里放 ----

  async selectedCollection() {
    const r = await connectorPost('/connector/getSelectedCollection', {});
    return r.status === 200 && r.json ? { name: r.json.name, id: r.json.id, libraryID: r.json.libraryID, editable: r.json.libraryEditable !== false } : null;
  }

  /**
   * entries: [{ file, meta }]；target: 'C<collectionID>' 或 'L1'（我的文库根）
   * 流程和浏览器插件一样：saveItems 建条目（每个条目带一个我们起的 id），
   * 再用 saveAttachment 把 PDF 字节推过去，X-Metadata 里的 parentItemID 就是那个 id；
   * 最后 updateSession 把整批挪到目标分类。
   */
  async sendToZotero(entries, { target = '' } = {}) {
    if (!(await ping())) return { ok: false, error: 'Zotero 没在运行，先打开它' };
    const dir = this.litDir();
    const sessionID = crypto.randomBytes(8).toString('hex');
    const items = []; const pdfs = []; const missing = [];
    (entries || []).forEach((e, i) => {
      const full = path.join(dir, path.basename(String(e.file || '')));
      const id = String(i + 1);
      const hasPdf = fs.existsSync(full) && /\.pdf$/i.test(full);
      if (!hasPdf) missing.push(e.file);
      const item = toConnectorItem({ title: e.meta?.title || path.basename(full, path.extname(full)), ...e.meta }, hasPdf ? `file://${encodeURI(full)}` : '');
      item.id = id;
      if (hasPdf) { item.attachments[0].id = `${id}-pdf`; pdfs.push({ parentId: id, id: `${id}-pdf`, file: full, url: item.attachments[0].url }); }
      items.push(item);
    });
    if (!items.length) return { ok: false, error: '没有可放的条目' };
    const save = await connectorPost('/connector/saveItems', { sessionID, uri: 'http://127.0.0.1/', items });
    if (save.status !== 200 && save.status !== 201) return { ok: false, error: `Zotero 没收：${save.error || save.status} ${String(save.text || '').slice(0, 160)}` };
    let attached = 0; const attachErrors = [];
    for (const p of pdfs) {
      const r = await connectorUpload('/connector/saveAttachment', fs.readFileSync(p.file), {
        'Content-Type': 'application/pdf',
        'X-Metadata': JSON.stringify({ sessionID, id: p.id, parentItemID: p.parentId, title: 'Full Text PDF', url: p.url, mimeType: 'application/pdf' }),
      });
      if (r.status === 200 || r.status === 201) attached += 1; else attachErrors.push(`${path.basename(p.file)}: ${r.error || r.status}`);
    }
    if (target) await connectorPost('/connector/updateSession', { sessionID, target, tags: '' });
    this.cache = null;
    return { ok: true, count: items.length, attached, attachErrors, missingPdf: missing, sessionID };
  }

  /** 发完过一会儿，按标题 / DOI 在库里找回 key，把本地条目和 Zotero 条目挂上 */
  async matchBack(entries) {
    const snap = await this.snapshot(true);
    if (!snap.ok) return { ok: false, error: snap.error };
    const out = {};
    for (const e of entries || []) {
      const doi = String(e.meta?.doi || '').toLowerCase();
      const title = String(e.meta?.title || '').trim().toLowerCase();
      const hit = snap.items.find((it) => (doi && it.doi.toLowerCase() === doi) || (title && it.title.trim().toLowerCase() === title));
      if (hit) out[e.file] = { key: hit.key, itemID: hit.itemID, attachmentKey: hit.pdf?.key || '', collections: hit.collectionNames, syncedAt: Date.now() };
    }
    return { ok: true, matched: out };
  }
}

module.exports = { ZoteroService, yearOf, creatorsToAuthors, resolveAttachmentPath, colorName, annotationToHighlight, toConnectorItem, sanitizeName, findDataDir, findZoteroApp };
