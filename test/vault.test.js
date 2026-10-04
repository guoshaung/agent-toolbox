'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VaultService, parseDump, autoTitle, guessKind, generatePassword, strength, hashPin, pinMatches } = require('../src/main/vault');

function fakeStore() { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => { if (v === undefined) m.delete(k); else m.set(k, v); } }; }
const encFake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => String(b).replace(/^enc:/, '') };

test('密码本：整段粘贴自动拆字段', () => {
  const p = parseDump('网址 https://example.com/login\n账号: me@x.com\n密码：Abc12345!\n备注一行');
  assert.equal(p.url, 'https://example.com/login');
  assert.equal(p.username, 'me@x.com');
  assert.equal(p.password, 'Abc12345!');
  assert.equal(p.notes, '备注一行');
  assert.equal(p.kind, 'account');
  assert.equal(p.title, 'example.com');
});

test('密码本：裸 key、裸邮箱、账号密码一行', () => {
  const k = parseDump('sk-abcdefghijklmnopqrstuvwxyz1234');
  assert.equal(k.key, 'sk-abcdefghijklmnopqrstuvwxyz1234');
  assert.equal(k.kind, 'apikey');
  assert.match(k.title, /^sk-… key$/);
  const two = parseDump('someone@mail.com Passw0rd!!');
  assert.equal(two.username, 'someone@mail.com');
  assert.equal(two.password, 'Passw0rd!!');
  const bare = parseDump('me@mail.com');
  assert.equal(bare.username, 'me@mail.com');
  assert.equal(bare.title, 'me@mail.com');
});

test('密码本：起名和类型推断', () => {
  assert.equal(autoTitle({ url: 'www.bilibili.com/x' }), 'bilibili.com');
  assert.equal(autoTitle({ username: 'tom' }), 'tom');
  assert.equal(autoTitle({}), '未命名');
  assert.equal(guessKind({ key: 'x' }), 'apikey');
  assert.equal(guessKind({ url: 'a.com' }), 'url');
  assert.equal(guessKind({ notes: 'n' }), 'note');
});

test('密码本：生成的密码够长够杂，强度判断', () => {
  const pw = generatePassword({ length: 20 });
  assert.equal(pw.length, 20);
  assert.ok(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw));
  assert.equal(strength('123456').label, '弱');
  assert.equal(strength(pw).label, '强');
});

test('密码本：存 / 列 / 显示 / 复制 / 编辑保留旧密文 / 删除，明文不进列表', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => String(b).replace(/^enc:/, '') };
  let clip = ''; const marked = [];
  const svc = new VaultService({ file: path.join(dir, 'vault.json'), safeStorage: fake, clipboard: { writeText: (t) => { clip = t; }, readText: () => clip }, markClipboardSecret: (v) => marked.push(v) });
  const saved = svc.save({ url: 'https://a.com', username: 'u', password: 'p@ss', key: '', notes: '' });
  assert.ok(saved.ok);
  const raw = fs.readFileSync(path.join(dir, 'vault.json'), 'utf8');
  assert.ok(!raw.includes('p@ss'), '密码不能明文落盘');
  const list = svc.list();
  assert.equal(list.entries.length, 1);
  assert.equal(list.entries[0].title, 'a.com');
  assert.equal(list.entries[0].has.password, true);
  assert.ok(!('password' in list.entries[0]));
  const rv = svc.reveal(saved.id);
  assert.equal(rv.entry.password, 'p@ss');
  const c = svc.copy(saved.id, 'password');
  assert.ok(c.ok); assert.equal(clip, 'p@ss'); assert.deepEqual(marked, ['p@ss']); assert.equal(c.cleared, 40);
  clearTimeout(svc.clearTimer);
  // 编辑：密文字段传 undefined = 不改
  svc.save({ id: saved.id, title: '改名', url: 'https://a.com', username: 'u', password: undefined, key: undefined, notes: undefined });
  assert.equal(svc.reveal(saved.id).entry.password, 'p@ss');
  assert.equal(svc.list().entries[0].title, '改名');
  svc.remove(saved.id);
  assert.equal(svc.list().entries.length, 0);
  assert.equal(svc.save({}).ok, false);
  const noEnc = new VaultService({ file: path.join(dir, 'v2.json'), safeStorage: { isEncryptionAvailable: () => false }, clipboard: {} });
  assert.equal(noEnc.save({ password: 'x' }).ok, false, '没有安全存储绝不明文保存');
});

test('保险箱 PIN：哈希加盐、定长比较', () => {
  const rec = hashPin('123456');
  assert.ok(rec.hash && rec.salt);
  assert.notEqual(rec.hash, '123456', 'PIN 不能明文存');
  assert.ok(pinMatches('123456', rec));
  assert.ok(!pinMatches('123457', rec));
  assert.ok(!pinMatches('123456', null));
  assert.notEqual(hashPin('123456').salt, hashPin('123456').salt, '每次盐不同');
});

test('保险箱 PIN：没设常开，设了要解锁，锁上后看不了内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-pin-'));
  const store = fakeStore();
  const svc = new VaultService({ file: path.join(dir, 'v.json'), safeStorage: encFake, clipboard: {}, store });
  const saved = svc.save({ key: 'sk-abcdefghijklmnopqrstuvwxyz1234' });
  // 没设 PIN：常开
  assert.equal(svc.pinStatus().hasPin, false);
  assert.equal(svc.pinStatus().unlocked, true);
  assert.ok(svc.reveal(saved.id).ok);
  // 设 PIN 后自动解锁
  assert.equal(svc.setPin('12').ok, false, '短了不行');
  assert.ok(svc.setPin('246810').ok);
  assert.equal(svc.pinStatus().hasPin, true);
  assert.ok(svc.reveal(saved.id).ok, '刚设完是解锁的');
  // 锁上后看不了
  svc.lock();
  assert.equal(svc.reveal(saved.id).code, 'locked');
  assert.equal(svc.keyOf(saved.id).code, 'locked');
  assert.equal(svc.copy(saved.id, 'key').code, 'locked');
  // 错的解不开，对的能
  assert.equal(svc.unlock('000000').ok, false);
  assert.ok(svc.unlock('246810').ok);
  assert.ok(svc.reveal(saved.id).ok);
  // keyOf 交出明文给主进程填 AI 配置
  assert.equal(svc.keyOf(saved.id).key, 'sk-abcdefghijklmnopqrstuvwxyz1234');
});

test('保险箱 PIN：连错 5 次进入冷却', () => {
  const store = fakeStore();
  const svc = new VaultService({ file: path.join(os.tmpdir(), 'nope.json'), safeStorage: encFake, clipboard: {}, store });
  svc.setPin('111111'); svc.lock();
  for (let i = 0; i < 5; i += 1) svc.unlock('000000');
  const r = svc.unlock('111111');
  assert.equal(r.code, 'cooldown', '冷却期内正确密码也先挡住');
  assert.ok(store.get('vault.lockedUntil') > Date.now());
});
