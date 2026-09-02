'use strict';
/**
 * Edge Cookie 桥：把 Edge 浏览器里已登录站点的 cookie 读到 Electron session 里。
 *
 * 目前支持 macOS（Chrome/Edge 的 v10 AES-128-CBC 加密）。
 * Windows 需要 DPAPI 解密，暂不做原生支持，但留了接口。
 *
 * 注意：这会读取另一个浏览器的私有数据，只在用户主动触发时执行，
 * 且 macOS 上第一次会弹 Keychain 授权框。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const { session } = require('electron');

const EDGE_PROFILES = {
  darwin: () => path.join(process.env.HOME, 'Library/Application Support/Microsoft Edge/Default'),
  win32: () => path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/User Data/Default'),
  linux: () => path.join(process.env.HOME, '.config/microsoft-edge/Default'),
};

const CHROME_PROFILES = {
  darwin: () => path.join(process.env.HOME, 'Library/Application Support/Google/Chrome/Default'),
  win32: () => path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data/Default'),
  linux: () => path.join(process.env.HOME, '.config/google-chrome/Default'),
};

function findCookieDb(preferEdge = true) {
  const candidates = preferEdge
    ? [EDGE_PROFILES, CHROME_PROFILES]
    : [CHROME_PROFILES, EDGE_PROFILES];
  for (const map of candidates) {
    const fn = map[process.platform];
    if (!fn) continue;
    const db = path.join(fn(), 'Cookies');
    if (fs.existsSync(db)) return db;
  }
  return null;
}

function getMacKey(service) {
  try {
    const out = execSync(
      'security find-generic-password -s "' + service + '" -w',
      { encoding: 'utf8', timeout: 5000 }
    );
    return out.trim();
  } catch {
    return null;
  }
}

function deriveKey(password) {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decryptV10(encrypted, key) {
  if (encrypted.length < 3 + 16) return null;
  const prefix = encrypted.slice(0, 3).toString('ascii');
  if (prefix !== 'v10') return null;
  const iv = Buffer.alloc(16, 0x20);
  const ciphertext = encrypted.slice(3 + 16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let plaintext = decipher.update(ciphertext);
  try {
    plaintext = Buffer.concat([plaintext, decipher.final()]);
  } catch {
    return null;
  }
  return plaintext.toString('utf8');
}

function decryptValue(hexStr, key) {
  if (!hexStr || hexStr.length === 0) return '';
  const encrypted = Buffer.from(hexStr, 'hex');
  if (encrypted.length === 0) return '';
  if (encrypted[0] === 0x76) {
    const prefix = encrypted.slice(0, 3).toString('ascii');
    if (prefix === 'v10') return decryptV10(encrypted, key);
    return null;
  }
  return encrypted.toString('utf8');
}

function getCookieColumns(dbPath) {
  const out = execSync('sqlite3 -json "' + dbPath + '" "PRAGMA table_info(cookies);"', { encoding: 'utf8', timeout: 5000 });
  if (!out.trim()) return new Set();
  const info = JSON.parse(out);
  return new Set(info.map((col) => col.name));
}

function queryCookies(dbPath, hostKey) {
  const columns = getCookieColumns(dbPath);
  const select = [
    'host_key', 'name', 'value', 'path', 'expires_utc',
    'is_secure', 'is_httponly', 'hex(encrypted_value) as encrypted_value',
    columns.has('same_site') ? 'same_site' : null,
    columns.has('is_same_party') ? 'is_same_party' : null,
    columns.has('source_scheme') ? 'source_scheme' : null,
  ].filter(Boolean).join(', ');
  const sql = 'SELECT ' + select + " FROM cookies WHERE host_key LIKE '%" + hostKey.replace(/'/g, "''") + "%' ORDER BY host_key, name;";
  const out = execSync('sqlite3 -json "' + dbPath + '" "' + sql + '"', { encoding: 'utf8', timeout: 10000 });
  if (!out.trim()) return [];
  return JSON.parse(out);
}

function edgeTimeToSeconds(utc) {
  if (!utc || utc === 0) return Math.floor(Date.now() / 1000) + 86400 * 30;
  return Math.floor((utc - 11644473600000000) / 1000000);
}

async function syncCookies(partition, hostFilter) {
  const dbPath = findCookieDb(true);
  if (!dbPath) return { ok: false, error: '没找到 Edge/Chrome 的 Cookie 数据库。' };

  let password = null;
  let serviceName = '';
  if (process.platform === 'darwin') {
    serviceName = 'Microsoft Edge Safe Storage';
    password = getMacKey(serviceName);
    if (!password) {
      serviceName = 'Chrome Safe Storage';
      password = getMacKey(serviceName);
    }
    if (!password) return { ok: false, error: '无法从 Keychain 读取 Edge/Chrome 的安全存储密码（可能拒绝授权）。' };
  } else {
    return { ok: false, error: '当前平台暂不支持自动读取 Edge cookie。' };
  }

  const key = deriveKey(password);
  const rows = queryCookies(dbPath, hostFilter);
  if (!rows.length) return { ok: true, count: 0 };

  const ses = session.fromPartition(partition);
  let count = 0;
  const writes = [];
  for (const row of rows) {
    const value = decryptValue(row.encrypted_value, key);
    if (value === null) continue;
    const host = String(row.host_key || '').replace(/^\./, '');
    if (!host) continue;
    const url = (row.is_secure ? 'https://' : 'http://') + host + row.path;
    writes.push(ses.cookies.set({
      url,
      name: row.name,
      value,
      domain: row.host_key,
      path: row.path,
      secure: !!row.is_secure,
      httpOnly: !!row.is_httponly,
      expirationDate: edgeTimeToSeconds(row.expires_utc),
      sameSite: ['unspecified', 'no_restriction', 'lax', 'strict'][row.same_site] || 'no_restriction',
    }).then(() => { count += 1; }).catch(() => {}));
  }
  await Promise.all(writes);
  return { ok: true, count, source: path.basename(dbPath), service: serviceName };
}

module.exports = { syncCookies, findCookieDb };
