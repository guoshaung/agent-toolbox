'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VaultService } = require('../src/main/vault');
const P = require('../src/main/vault-portable');

const encFake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => String(b).replace(/^enc:/, '') };
function fakeStore() { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => { if (v === undefined) m.delete(k); else m.set(k, v); } }; }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-portable-')); }
function makeVault(dir) { return new VaultService({ file: path.join(dir, 'vault.json'), safeStorage: encFake, clipboard: { writeText() {}, readText: () => '' }, store: fakeStore() }); }

test('便携包：同一口令能解开，错口令解不开，中文口令 NFC/NFD 视为相同', () => {
  const pack = P.encryptPayload({ hello: '世界', n: 1 }, '芝麻开门');
  assert.equal(pack.magic, 'agent-toolbox-vault');
  assert.deepEqual(P.decryptPayload(pack, '芝麻开门'), { hello: '世界', n: 1 });
  assert.deepEqual(P.decryptPayload(pack, '芝麻开门'.normalize('NFD')), { hello: '世界', n: 1 });
  assert.throws(() => P.decryptPayload(pack, '芝麻开门2'), /口令不对/);
  assert.throws(() => P.decryptPayload({ ...pack, magic: 'x' }, '芝麻开门'), /不是密码本/);
  assert.throws(() => P.encryptPayload({}, ''), /口令不能为空/);
  // 密文里不该有明文
  assert.ok(!JSON.stringify(pack).includes('世界'));
});

test('便携包：篡改密文会被 GCM 拦下', () => {
  const pack = P.encryptPayload({ a: 1 }, 'pw');
  const bad = { ...pack, data: Buffer.from('zzzz').toString('base64') };
  assert.throws(() => P.decryptPayload(bad, 'pw'), /口令不对，或者文件被改过/);
});

test('.env 解析：export 前缀、引号、行尾注释、空值', () => {
  const vars = P.parseEnv([
    '# 注释', '', 'export DB_HOST=db.example.com', 'DB_PASSWORD="p@ss#word"', "TOKEN='abc def'",
    'PLAIN=value # 行尾注释', 'EMPTY=', 'not a var line', 'URL=https://x/y?a=1#frag',
  ].join('\n'));
  assert.deepEqual(vars, [
    { name: 'DB_HOST', value: 'db.example.com' }, { name: 'DB_PASSWORD', value: 'p@ss#word' }, { name: 'TOKEN', value: 'abc def' },
    { name: 'PLAIN', value: 'value' }, { name: 'EMPTY', value: '' }, { name: 'URL', value: 'https://x/y?a=1#frag' },
  ]);
});

test('.env → 条目：整文件一条备注 + 每个密钥变量一条 API Key', () => {
  const text = 'DB_HOST=h\nDB_PASSWORD=secret1\nSTORAGE_SECRET_KEY=sk2\nFEISHU_WEBHOOK_URL=https://w\nPORT=80\nEMPTY_KEY=\n';
  const entries = P.envToEntries(text, { source: 'agentworld/.env', tags: ['suite'] });
  assert.equal(entries[0].kind, 'note'); assert.equal(entries[0].title, 'agentworld/.env'); assert.equal(entries[0].notes, text);
  assert.deepEqual(entries[0].tags, ['env', 'suite']);
  assert.deepEqual(entries.slice(1).map((e) => [e.title, e.key, e.username, e.kind]), [
    ['DB_PASSWORD', 'secret1', 'agentworld/.env', 'apikey'],
    ['STORAGE_SECRET_KEY', 'sk2', 'agentworld/.env', 'apikey'],
    ['FEISHU_WEBHOOK_URL', 'https://w', 'agentworld/.env', 'apikey'],
  ]);
  assert.ok(P.isSecretName('OPENAI_API_KEY') && P.isSecretName('BRIDGE_TOKEN') && !P.isSecretName('DB_HOST') && !P.isSecretName('GATEWAY_PORT'));
});

test('导出加密备份再导入另一台电脑的密码本：条目原样回来，重复的跳过', () => {
  const a = makeVault(tmpDir());
  a.save({ title: 'github', username: 'me', password: 'p1', tags: ['dev'] });
  a.save({ key: 'sk-abcdefghijklmnopqrstuvwxyz1234', url: 'https://api.openai.com' });
  const file = path.join(tmpDir(), 'backup.enc.json');
  const r = P.packVault(a, '口令', file);
  assert.equal(r.ok, true); assert.equal(r.count, 2);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('p1'));
  const b = makeVault(tmpDir());
  const imp = P.unpackToVault(b, '口令', file);
  assert.deepEqual([imp.imported, imp.skipped, imp.total], [2, 0, 2]);
  const got = b.list().entries.find((e) => e.title === 'github');
  assert.equal(b.reveal(got.id).entry.password, 'p1');
  const again = P.unpackToVault(b, '口令', file);
  assert.deepEqual([again.imported, again.skipped], [0, 2]);
  assert.match(P.unpackToVault(b, '错的', file).error, /口令不对/);
});

test('导出要先解锁：设了 PIN 且锁着时拒绝', () => {
  const v = makeVault(tmpDir());
  v.save({ title: 'x', password: 'y' });
  v.setPin('123456'); v.lock();
  const r = P.packVault(v, 'pw', path.join(tmpDir(), 'b.json'));
  assert.equal(r.ok, false); assert.equal(r.code, 'locked');
});

test('.env 文件导入密码本 + 命令行 pack/list 不经过 App', () => {
  const dir = tmpDir();
  const envA = path.join(dir, 'agentworld', '.env'); fs.mkdirSync(path.dirname(envA)); fs.writeFileSync(envA, 'DB_PASSWORD=a1\nDB_HOST=h\n');
  const envB = path.join(dir, 'agent_channels', '.env'); fs.mkdirSync(path.dirname(envB)); fs.writeFileSync(envB, 'S3_SECRET_ACCESS_KEY=b2\n');
  const v = makeVault(tmpDir());
  const r = P.importEnvToVault(v, envA, { tags: ['suite'] });
  assert.deepEqual([r.imported, r.skipped], [2, 0]);
  assert.equal(v.list().entries.filter((e) => e.kind === 'apikey').length, 1);

  const out = path.join(dir, 'pack.enc.json');
  process.env.VAULT_PASSPHRASE = '口令';
  try {
    const msg = P.cli(['pack', '--out', out, '--env', envA, '--env', envB, '--tag', 'suite']);
    assert.match(msg, /打包 2 个文件、4 条/);
    const listed = P.cli(['list', '--in', out]);
    assert.match(listed, /note\s+agentworld\/\.env/); assert.match(listed, /apikey\s+S3_SECRET_ACCESS_KEY/);
    assert.ok(!listed.includes('b2'), '列表不能打出密文');
  } finally { delete process.env.VAULT_PASSPHRASE; }
  assert.throws(() => P.cli(['pack']), /VAULT_PASSPHRASE/);
});
