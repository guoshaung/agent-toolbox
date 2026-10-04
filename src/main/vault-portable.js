'use strict';

/**
 * [portable-vault] 密码本的「带得走」的那一半。
 *
 * vault.json 里的密文是 safeStorage 用这台电脑的系统钥匙串加密的，换一台机器打不开。
 * 这里提供一个只认「口令」的便携格式：scrypt 从口令派生密钥，AES-256-GCM 加密整包条目，
 * 落成一个 JSON 文件（agent-toolbox-vault.enc.json）。带到另一台电脑上，在密码本里「导入加密备份」
 * 输同一个口令就回来了。口令不存任何地方，忘了就真没了。
 *
 * 同一个格式也能不经过 App、直接从 .env 文件打包（命令行 pack），方便把一堆环境变量装进去带走。
 *
 * 纯 node，不依赖 electron，可测。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAGIC = 'agent-toolbox-vault';
const VERSION = 1;
// N=2^17 → 128 MiB 内存、约 0.3～0.6 秒；口令是给人记的，慢一点才挡得住暴力猜
const KDF = { N: 1 << 17, r: 8, p: 1, keylen: 32 };
const SECRET_NAME = /key|secret|token|password|passwd|webhook|credential|auth/i;
const PLAIN_FIELDS = ['title', 'url', 'username', 'kind', 'tags'];
const SECRET_FIELDS = ['password', 'key', 'notes'];

// ---------- 加解密（纯函数） ----------

function normalizePassphrase(p) {
  // 中文口令在 macOS 输入法下可能是 NFD，统一成 NFC，不然同一串字换台机器就对不上
  const s = String(p == null ? '' : p).normalize('NFC');
  if (!s) throw new Error('口令不能为空');
  return Buffer.from(s, 'utf8');
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(normalizePassphrase(passphrase), salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 512 * 1024 * 1024 });
}

/** 任意可 JSON 的对象 → 便携密文包（也是个 JSON 对象） */
function encryptPayload(payload, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    magic: MAGIC, version: VERSION, createdAt: new Date().toISOString(),
    kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptPayload(pack, passphrase) {
  if (!pack || pack.magic !== MAGIC) throw new Error('这不是密码本的加密备份文件');
  if (pack.version !== VERSION) throw new Error(`备份版本 ${pack.version} 不认识，升级一下工具箱`);
  const salt = Buffer.from(pack.kdf.salt, 'base64');
  const key = crypto.scryptSync(normalizePassphrase(passphrase), salt, pack.kdf.keylen || KDF.keylen, { N: pack.kdf.N, r: pack.kdf.r, p: pack.kdf.p, maxmem: 512 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv(pack.cipher, key, Buffer.from(pack.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(pack.tag, 'base64'));
  let plain;
  try { plain = Buffer.concat([decipher.update(Buffer.from(pack.data, 'base64')), decipher.final()]); } catch { throw new Error('口令不对，或者文件被改过'); }
  return JSON.parse(plain.toString('utf8'));
}

function writePack(file, pack) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pack, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readPack(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// ---------- .env 解析（纯函数） ----------

/** 一段 .env 文本 → [{ name, value }]。支持 export 前缀、单双引号、行尾 # 注释；不做变量展开。 */
function parseEnv(text) {
  const out = [];
  for (const rawLine of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    else { const hash = value.search(/\s#/); if (hash >= 0) value = value.slice(0, hash); value = value.trim(); }
    out.push({ name: m[1], value });
  }
  return out;
}

function isSecretName(name) { return SECRET_NAME.test(String(name || '')); }

/**
 * .env 文本 → 密码本条目：一条「备注」装整个文件（原样，回来直接粘回 .env），
 * 每个看起来是密钥的变量再单独一条「API Key」（标题 = 变量名，账号 = 来源文件），搜得到、能单独复制。
 */
function envToEntries(text, { source = '.env', tags = [] } = {}) {
  const vars = parseEnv(text);
  const base = String(source || '.env');
  const tagList = [...new Set(['env', ...tags.map((t) => String(t).trim()).filter(Boolean)])];
  const entries = [{
    title: base, url: '', username: '', kind: 'note', tags: tagList,
    password: '', key: '', notes: String(text || ''),
  }];
  for (const v of vars) {
    if (!isSecretName(v.name) || !v.value) continue;
    entries.push({ title: v.name, url: '', username: base, kind: 'apikey', tags: tagList, password: '', key: v.value, notes: '' });
  }
  return entries;
}

function pickEntry(e) {
  const out = {};
  for (const f of PLAIN_FIELDS) out[f] = f === 'tags' ? (Array.isArray(e.tags) ? e.tags : []) : String(e[f] || '');
  for (const f of SECRET_FIELDS) out[f] = String(e[f] || '');
  return out;
}

function sameEntry(a, b) { return a.title === b.title && a.username === b.username && a.kind === b.kind; }

// ---------- 和 VaultService 打交道 ----------

/** 把密码本里所有条目解出来，用口令打成便携包写到 file。要求已解锁。 */
function packVault(vault, passphrase, file) {
  const gate = vault._gate?.(); if (gate) return gate;
  if (!vault.available()) return { ok: false, error: '系统安全存储不可用' };
  let pass;
  try { pass = passphrase; normalizePassphrase(pass); } catch (e) { return { ok: false, error: e.message }; }
  const entries = vault._read().entries.map((e) => pickEntry({ ...e, ...vault._decrypt(e.secret) }));
  writePack(file, encryptPayload({ exportedAt: new Date().toISOString(), entries }, pass));
  return { ok: true, file, count: entries.length };
}

/** 读便携包，条目逐条存进密码本（标题+账号+类型都相同的跳过）。 */
function unpackToVault(vault, passphrase, file) {
  if (!vault.available()) return { ok: false, error: '系统安全存储不可用' };
  let payload;
  try { payload = decryptPayload(readPack(file), passphrase); } catch (e) { return { ok: false, error: e.message }; }
  return mergeEntries(vault, payload.entries || []);
}

function mergeEntries(vault, entries) {
  const existing = vault._read().entries.map((e) => ({ title: e.title, username: e.username, kind: e.kind }));
  let imported = 0, skipped = 0;
  for (const raw of entries) {
    const e = pickEntry(raw);
    if (existing.some((x) => sameEntry(x, e))) { skipped += 1; continue; }
    const r = vault.save(e);
    if (r && r.ok) { imported += 1; existing.push({ title: e.title, username: e.username, kind: e.kind }); } else skipped += 1;
  }
  return { ok: true, imported, skipped, total: entries.length };
}

/** 一个 .env 文件 → 密码本。 */
function importEnvToVault(vault, file, { tags = [] } = {}) {
  if (!vault.available()) return { ok: false, error: '系统安全存储不可用' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { ok: false, error: `读不了 ${file}：${e.message}` }; }
  const r = mergeEntries(vault, envToEntries(text, { source: path.basename(path.dirname(file)) + '/' + path.basename(file), tags }));
  return { ...r, file };
}

/** 不经过 App：若干 .env 文件直接打成便携包。 */
function packEnvFiles(passphrase, outFile, envFiles, { tags = [] } = {}) {
  const entries = [];
  for (const f of envFiles) {
    const text = fs.readFileSync(f, 'utf8');
    entries.push(...envToEntries(text, { source: path.basename(path.dirname(f)) + '/' + path.basename(f), tags }));
  }
  writePack(outFile, encryptPayload({ exportedAt: new Date().toISOString(), entries }, passphrase));
  return { ok: true, file: outFile, count: entries.length, files: envFiles.length };
}

// ---------- 命令行 ----------
//   VAULT_PASSPHRASE=… node src/main/vault-portable.js pack  --out FILE --env a/.env [--env b/.env] [--tag TAG]
//   VAULT_PASSPHRASE=… node src/main/vault-portable.js list  --in FILE        （只打标题，不打密文）
// 口令只从环境变量读，不进命令行参数（ps 看得到）。

function cli(argv) {
  const args = { env: [], tag: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env' || a === '--tag') args[a.slice(2)].push(argv[++i]);
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._ = a;
  }
  const pass = process.env.VAULT_PASSPHRASE;
  if (!pass) throw new Error('把口令放在环境变量 VAULT_PASSPHRASE 里再跑');
  if (args._ === 'pack') {
    if (!args.out || !args.env.length) throw new Error('用法：pack --out FILE --env a/.env [--env b/.env] [--tag TAG]');
    const r = packEnvFiles(pass, args.out, args.env, { tags: args.tag });
    return `打包 ${r.files} 个文件、${r.count} 条 → ${r.file}`;
  }
  if (args._ === 'list') {
    if (!args.in) throw new Error('用法：list --in FILE');
    const payload = decryptPayload(readPack(args.in), pass);
    return payload.entries.map((e) => `${(e.kind || '').padEnd(7)} ${e.title}${e.username ? `  (${e.username})` : ''}`).join('\n');
  }
  throw new Error('子命令只有 pack / list');
}

if (require.main === module) {
  try { process.stdout.write(`${cli(process.argv.slice(2))}\n`); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
}

module.exports = {
  MAGIC, VERSION, KDF, encryptPayload, decryptPayload, parseEnv, isSecretName, envToEntries,
  packVault, unpackToVault, importEnvToVault, packEnvFiles, mergeEntries, normalizePassphrase, cli,
};
