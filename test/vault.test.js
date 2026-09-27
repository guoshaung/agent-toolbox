'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VaultService, parseDump, autoTitle, guessKind, generatePassword, strength } = require('../src/main/vault');

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
