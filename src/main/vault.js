'use strict';

/**
 * 密码本。
 *
 * 明文只在主进程里出现一瞬：存的时候用 safeStorage（系统钥匙串派生的密钥）加密成一段密文写进
 * userData/vault.json，读列表时只给标题 / 网址 / 账号这些能搜的字段，密码和 key 要么点「显示」
 * 才解一次，要么直接「复制」——复制的值不经过渲染层，40 秒后剪贴板还没被别的东西覆盖就清掉。
 * 这个文件不在「导出设置」的范围里，备份靠系统备份。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET_FIELDS = ['password', 'key', 'notes'];
const PLAIN_FIELDS = ['title', 'url', 'username', 'kind', 'tags'];
const KINDS = { account: '账号', apikey: 'API Key', url: '网址', note: '备注', other: '其他' };
const CLEAR_AFTER_MS = 40 * 1000;

// ---------- 纯函数（有测试） ----------

const KEY_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{16,})/, /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/, /\b(AKIA[0-9A-Z]{16})/,
  /\b(xox[abp]-[A-Za-z0-9-]{10,})/, /\b(AIza[0-9A-Za-z_-]{30,})/, /\b(sk-ant-[A-Za-z0-9_-]{20,})/, /\b(glpat-[A-Za-z0-9_-]{16,})/,
  /\b(hf_[A-Za-z0-9]{20,})/, /\b(ya29\.[A-Za-z0-9_-]{20,})/, /\b([A-Fa-f0-9]{32,64})\b/, /\b([A-Za-z0-9_-]{40,})\b/,
];

function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** 不填名字也行：网址的域名 > 账号 > key 的前缀 > 类型 */
function autoTitle(entry) {
  const title = String(entry.title || '').trim();
  if (title) return title;
  const host = hostOf(entry.url || '');
  if (host) return host;
  if (entry.username) return String(entry.username).trim();
  if (entry.key) { const k = String(entry.key); const m = k.match(/^([A-Za-z]+[-_])/); return m ? `${m[1]}… key` : `${k.slice(0, 4)}… key`; }
  return KINDS[entry.kind] || '未命名';
}

function guessKind(entry) {
  if (entry.kind && KINDS[entry.kind]) return entry.kind;
  if (entry.key && !entry.password) return 'apikey';
  if (entry.username || entry.password) return 'account';
  if (entry.url) return 'url';
  if (entry.notes) return 'note';
  return 'other';
}

/**
 * 整段粘贴自动拆：邮箱 / 网址 / 「密码: xxx」/ 像 key 的长串，剩下的进备注。
 * 尽量拆，拆不准的放备注里也不丢。
 */
function parseDump(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const out = { title: '', url: '', username: '', password: '', key: '', notes: '', tags: [] };
  const rest = [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const labeled = (line, labels) => {
    // 「密码: x」「密码：x」「密码=x」「密码 x」都算
    const m = line.match(new RegExp(`^(?:${labels})(?:\\s*[:：=]\\s*|\\s+)(.+)$`, 'i'));
    return m ? m[1].trim() : '';
  };
  for (const line of lines) {
    let v;
    if ((v = labeled(line, '密码|password|passwd|pwd|pass|口令')) && !out.password) { out.password = v; continue; }
    if ((v = labeled(line, '账号|帐号|用户名|用户|user(?:name)?|login|email|邮箱|手机|phone|account')) && !out.username) { out.username = v; continue; }
    if ((v = labeled(line, '网址|网站|url|site|link|地址|host')) && !out.url) { out.url = v; continue; }
    if ((v = labeled(line, 'key|api[ _-]?key|token|secret|密钥|令牌')) && !out.key) { out.key = v; continue; }
    if ((v = labeled(line, '名称|名字|title|name|备注名')) && !out.title) { out.title = v; continue; }
    if (!out.url && /^(https?:\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$))/i.test(line) && !/\s/.test(line)) { out.url = line; continue; }
    if (!out.username && /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(line)) { out.username = line; continue; }
    const keyHit = KEY_PATTERNS.map((re) => line.match(re)?.[1]).find(Boolean);
    if (keyHit && !out.key && line.length < 400) {
      out.key = keyHit;
      const remainder = line.replace(keyHit, '').replace(/^[\s:：=-]+|[\s:：=-]+$/g, '');
      if (remainder) rest.push(remainder);
      continue;
    }
    rest.push(line);
  }
  // 「账号 密码」同一行、没有标签：两个词，第一个像邮箱或用户名
  if (!out.username && !out.password && rest.length === 1) {
    const parts = rest[0].split(/\s+/);
    if (parts.length === 2 && /[@\w.]{3,}/.test(parts[0]) && parts[1].length >= 6) { out.username = parts[0]; out.password = parts[1]; rest.length = 0; }
  }
  out.notes = rest.join('\n');
  out.kind = guessKind(out);
  out.title = autoTitle(out);
  return out;
}

function generatePassword({ length = 20, symbols = true } = {}) {
  const lower = 'abcdefghijkmnopqrstuvwxyz'; const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const digits = '23456789'; const sym = '!@#$%^&*-_=+?';
  const pool = lower + upper + digits + (symbols ? sym : '');
  const n = Math.max(8, Math.min(64, Number(length) || 20));
  const bytes = crypto.randomBytes(n * 2);
  let out = '';
  for (let i = 0; out.length < n; i += 1) out += pool[bytes[i] % pool.length];
  // 至少各来一个，不然「随机」出一串纯小写也说得过去但很多网站不收
  const must = [lower, upper, digits, ...(symbols ? [sym] : [])];
  const chars = out.split('');
  must.forEach((set, i) => { if (![...set].some((c) => chars.includes(c))) chars[i] = set[crypto.randomInt(set.length)]; });
  return chars.join('');
}

function strength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: '' };
  let score = 0;
  if (s.length >= 8) score += 1; if (s.length >= 12) score += 1; if (s.length >= 16) score += 1;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score += 1; if (/\d/.test(s)) score += 1; if (/[^A-Za-z0-9]/.test(s)) score += 1;
  if (/^(.)\1+$|^(?:1234|abcd|qwer|password|admin)/i.test(s)) score = Math.min(score, 1);
  return { score, label: score <= 2 ? '弱' : score <= 4 ? '一般' : '强' };
}

// ---------- 主进程服务 ----------

class VaultService {
  constructor({ file, safeStorage, clipboard, markClipboardSecret }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.clipboard = clipboard;
    this.markClipboardSecret = markClipboardSecret || (() => {});
    this.clearTimer = null;
  }

  available() { return Boolean(this.safeStorage?.isEncryptionAvailable?.()); }

  _read() {
    try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(data.entries) ? data : { entries: [] }; } catch { return { entries: [] }; }
  }

  _write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  _encrypt(obj) { return this.safeStorage.encryptString(JSON.stringify(obj)).toString('base64'); }
  _decrypt(blob) { try { return JSON.parse(this.safeStorage.decryptString(Buffer.from(String(blob || ''), 'base64'))); } catch { return {}; } }

  /** 列表：只有能搜的明文字段，外加「有没有密码 / key」的布尔 */
  list() {
    const { entries } = this._read();
    return {
      ok: true, available: this.available(),
      entries: entries.map((e) => ({ id: e.id, title: e.title, url: e.url, username: e.username, kind: e.kind, tags: e.tags || [], has: e.has || {}, createdAt: e.createdAt, updatedAt: e.updatedAt, lastUsedAt: e.lastUsedAt || 0 })),
    };
  }

  save(input = {}) {
    if (!this.available()) return { ok: false, error: '系统安全存储不可用，密码本没法加密保存。' };
    const data = this._read();
    const plain = {};
    for (const f of PLAIN_FIELDS) plain[f] = f === 'tags' ? (Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : []) : String(input[f] || '').trim();
    const secret = {};
    for (const f of SECRET_FIELDS) secret[f] = String(input[f] || '');
    if (!plain.title && !plain.url && !plain.username && !secret.password && !secret.key && !secret.notes) return { ok: false, error: '总得填点什么' };
    plain.kind = guessKind({ ...plain, ...secret });
    plain.title = autoTitle({ ...plain, ...secret });
    const now = Date.now();
    const existing = input.id ? data.entries.find((e) => e.id === input.id) : null;
    if (existing) {
      // 编辑时没动的密文字段传 undefined 进来就保留旧的
      const old = this._decrypt(existing.secret);
      for (const f of SECRET_FIELDS) if (input[f] === undefined) secret[f] = old[f] || '';
      Object.assign(existing, plain, { secret: this._encrypt(secret), has: { password: Boolean(secret.password), key: Boolean(secret.key), notes: Boolean(secret.notes) }, updatedAt: now });
    } else {
      data.entries.unshift({ id: `v_${now.toString(36)}_${crypto.randomBytes(3).toString('hex')}`, ...plain, secret: this._encrypt(secret), has: { password: Boolean(secret.password), key: Boolean(secret.key), notes: Boolean(secret.notes) }, createdAt: now, updatedAt: now, lastUsedAt: 0 });
    }
    this._write(data);
    return { ok: true, id: existing ? existing.id : data.entries[0].id };
  }

  remove(id) {
    const data = this._read();
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== id);
    if (data.entries.length !== before) this._write(data);
    return { ok: true };
  }

  /** 点「显示」才解密一次，整条给渲染层 */
  reveal(id) {
    if (!this.available()) return { ok: false, error: '系统安全存储不可用' };
    const e = this._read().entries.find((x) => x.id === id);
    if (!e) return { ok: false, error: '没有这条' };
    return { ok: true, entry: { id: e.id, title: e.title, url: e.url, username: e.username, kind: e.kind, tags: e.tags || [], ...this._decrypt(e.secret) } };
  }

  /** 复制某个字段：值不回渲染层。40 秒后剪贴板还是这个值就清掉。 */
  copy(id, field) {
    const data = this._read();
    const e = data.entries.find((x) => x.id === id);
    if (!e) return { ok: false, error: '没有这条' };
    let value = '';
    if (field === 'username' || field === 'url') value = e[field] || '';
    else if (SECRET_FIELDS.includes(field)) { if (!this.available()) return { ok: false, error: '系统安全存储不可用' }; value = this._decrypt(e.secret)[field] || ''; }
    else return { ok: false, error: '没有这个字段' };
    if (!value) return { ok: false, error: '这个字段是空的' };
    this.markClipboardSecret(value);
    this.clipboard.writeText(value);
    e.lastUsedAt = Date.now();
    this._write(data);
    clearTimeout(this.clearTimer);
    const isSecret = SECRET_FIELDS.includes(field);
    if (isSecret) this.clearTimer = setTimeout(() => { try { if (this.clipboard.readText() === value) this.clipboard.writeText(''); } catch { /* 剪贴板不可用就算了 */ } }, CLEAR_AFTER_MS);
    return { ok: true, cleared: isSecret ? CLEAR_AFTER_MS / 1000 : 0 };
  }

  count() { return this._read().entries.length; }
}

module.exports = { VaultService, parseDump, autoTitle, guessKind, generatePassword, strength, hostOf, KINDS, SECRET_FIELDS };
