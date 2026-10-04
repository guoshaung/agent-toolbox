/**
 * 从 CC Switch（~/.cc-switch/cc-switch.db）把各家 API 配置搬进密码本。
 *
 * 只在主进程跑。读库走系统自带的 sqlite3 命令行（和 zotero.js 一个路子），先把 db 连 wal 一起拷一份再读，
 * CC Switch 开着也不冲突。密钥明文只在这里过一下手，随手交给 VaultService.save() 用 safeStorage 加密，
 * 不回渲染层。mapProvider() 是纯函数，单独拆出来好测：每种 app_type 的 settings_config 长得都不一样——
 *   claude / claude-desktop：{ env: { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL } }
 *   codex：{ auth: { OPENAI_API_KEY | tokens(OAuth) }, config: "<toml，里面有 base_url / model>" }
 *   gemini：{ env: { GEMINI_API_KEY … } }
 *   hermes：{ api_key, base_url }      openclaw：{ apiKey, baseUrl, models: [{id}] }
 * 认不出的类型就在 JSON 里递归找长得像 key / base_url 的字段。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function defaultDbPath() { return path.join(os.homedir(), '.cc-switch', 'cc-switch.db'); }

function sqliteBin() {
  const candidates = process.platform === 'win32'
    ? ['sqlite3.exe', 'sqlite3']
    : ['/usr/bin/sqlite3', '/opt/homebrew/bin/sqlite3', '/usr/local/bin/sqlite3', 'sqlite3'];
  for (const c of candidates) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; continue; }
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch { /* 没有这个命令 */ }
  }
  return '';
}

/** TOML 里取第一处 `key = "value"`（codex 的 config 是一段 toml 文本） */
function parseToml(text, key) {
  const m = String(text || '').match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m ? m[1] : '';
}

/** 在嵌套对象里找第一个「键名符合 pred 的字符串值」 */
function firstString(obj, pred, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return '';
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim() && pred(k)) return v.trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const got = firstString(v, pred, depth + 1); if (got) return got; }
  }
  return '';
}

/** 一条 providers 行 → 密码本条目；存不了的返回 { skip: 原因 } */
function mapProvider(row = {}) {
  const app = String(row.app_type || '').trim();
  const name = String(row.name || '').trim() || String(row.id || '未命名');
  let cfg = {};
  try { cfg = JSON.parse(row.settings_config || '{}') || {}; } catch { cfg = {}; }

  let key = '', url = '', model = '';
  if (app === 'claude' || app === 'claude-desktop') {
    const env = cfg.env || {};
    key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
    url = env.ANTHROPIC_BASE_URL || '';
    model = env.ANTHROPIC_MODEL || cfg.model || '';
  } else if (app === 'codex') {
    key = (cfg.auth && cfg.auth.OPENAI_API_KEY) || '';
    url = parseToml(cfg.config, 'base_url');
    model = parseToml(cfg.config, 'model');
    if (!key && cfg.auth && cfg.auth.tokens) return { skip: 'OAuth 登录（ChatGPT 账号），没有可存的 key' };
  } else if (app === 'gemini') {
    const env = cfg.env || {};
    key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
    url = env.GOOGLE_GEMINI_BASE_URL || '';
    model = env.GEMINI_MODEL || '';
  } else {
    key = cfg.api_key || cfg.apiKey || cfg.key || '';
    url = cfg.base_url || cfg.baseUrl || '';
    model = typeof cfg.model === 'string' ? cfg.model : '';
  }
  if (!key) key = firstString(cfg, (k) => /key|token/i.test(k) && !/id_token|refresh|access|_id$/i.test(k));
  if (!url) url = firstString(cfg, (k) => /base.?url|endpoint/i.test(k));
  key = String(key || '').trim();
  if (!key) return { skip: '没找到 API key' };

  const models = Array.isArray(cfg.models) ? cfg.models.map((m) => (m && (m.id || m.name)) || '').filter(Boolean).slice(0, 10) : [];
  const notes = [
    `来自 CC Switch · ${app}`,
    model ? `模型：${model}` : '',
    models.length ? `模型列表：${models.join(', ')}` : '',
    row.website_url ? `官网：${row.website_url}` : '',
    row.notes ? `备注：${row.notes}` : '',
  ].filter(Boolean).join('\n');
  const tags = ['cc-switch', app].concat(Number(row.is_current) ? ['current'] : []).filter(Boolean);
  return { entry: { title: `${name}（${app || '未知'}）`, url: String(url || '').trim(), username: '', tags, key, password: '', notes } };
}

/** 读 providers 表。拷一份（连 wal / shm）再开，避免和正在跑的 CC Switch 抢锁。 */
function readProviders(dbPath = defaultDbPath()) {
  if (!fs.existsSync(dbPath)) return { ok: false, error: `没找到 CC Switch 的数据库：${dbPath}` };
  const bin = sqliteBin();
  if (!bin) return { ok: false, error: '系统里没有 sqlite3 命令行，读不了 CC Switch 的库' };
  const tmp = path.join(os.tmpdir(), `cc-switch-${process.pid}-${Date.now()}.db`);
  try {
    fs.copyFileSync(dbPath, tmp);
    for (const suf of ['-wal', '-shm']) if (fs.existsSync(dbPath + suf)) fs.copyFileSync(dbPath + suf, tmp + suf);
    const sql = 'SELECT id, app_type, name, website_url, notes, settings_config, is_current FROM providers ORDER BY app_type, sort_index';
    const out = execFileSync(bin, ['-json', tmp, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, rows: out.trim() ? JSON.parse(out) : [] };
  } catch (err) {
    return { ok: false, error: `读 CC Switch 数据库失败：${err.message}` };
  } finally {
    for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + suf); } catch { /* 没有就算了 */ } }
  }
}

/** 整体导入：同名条目跳过（不覆盖），返回导入 / 跳过明细 */
function importCcSwitch(vault, { dbPath } = {}) {
  const read = readProviders(dbPath || defaultDbPath());
  if (!read.ok) return read;
  const existing = new Set(((vault.list() || {}).entries || []).map((e) => e.title));
  let imported = 0;
  const skipped = [];
  for (const row of read.rows) {
    const m = mapProvider(row);
    if (m.skip) { skipped.push({ name: row.name, app: row.app_type, reason: m.skip }); continue; }
    if (existing.has(m.entry.title)) { skipped.push({ name: row.name, app: row.app_type, reason: '密码本里已有同名条目' }); continue; }
    const r = vault.save(m.entry);
    if (r && r.ok) { imported += 1; existing.add(m.entry.title); }
    else skipped.push({ name: row.name, app: row.app_type, reason: (r && r.error) || '保存失败' });
  }
  return { ok: true, imported, skipped, total: read.rows.length };
}

module.exports = { defaultDbPath, sqliteBin, parseToml, firstString, mapProvider, readProviders, importCcSwitch };
