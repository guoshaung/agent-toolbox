'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), sharp = require('sharp');
const { PreparedBeautyPackages } = require('../src/main/beauty-prepared-packages');
const { decodeIcon } = require('../src/main/beauty-icons');
const { SystemBeauty } = require('../src/main/system-beauty');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beauty-package-')); fs.mkdirSync(path.join(root, 'incoming'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
async function png(color = '#1299cf80') { return sharp({ create: { width: 2, height: 2, channels: 4, background: color } }).png().toBuffer(); }
function image(root, bytes) { const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.png'; fs.writeFileSync(path.join(root, 'incoming', name), bytes); return name; }
function plan(root, packages) { fs.writeFileSync(path.join(root, 'incoming', 'manifest.json'), JSON.stringify({ format: 'toolbox-prepared-beauty', version: 1, packages })); }
function pkg(id, images) { return { id, title: id, source: 'https://winmoes.com/workshop/packages/' + id, images }; }
function ico(payload, w = 2, h = 2, bits = 32) { const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = w; header[7] = h; header.writeUInt16LE(1, 10); header.writeUInt16LE(bits, 12); header.writeUInt32LE(payload.length, 14); header.writeUInt32LE(22, 18); return Buffer.concat([header, payload]); }
test('ICO embedded PNG preserves pixels and rejects invalid ranges without changing input', async () => {
  const source = ico(await png()), copy = Buffer.from(source);
  assert.deepEqual(await sharp(await decodeIcon(source)).raw().toBuffer(), await sharp(await png()).raw().toBuffer());
  assert.deepEqual(source, copy);
  const bad = Buffer.from(source); bad.writeUInt32LE(0xffffffff, 18); await assert.rejects(decodeIcon(bad), /范围/);
  await assert.rejects(decodeIcon(Buffer.from('<svg/>')), /格式/);
  await assert.rejects(decodeIcon(ico(await png(), 3, 3)), /尺寸/);
});
test('ICO DIB honors bottom-up rows and AND transparency when legacy alpha is empty', async () => {
  const dib = Buffer.alloc(64); dib.writeUInt32LE(40); dib.writeInt32LE(2, 4); dib.writeInt32LE(4, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  // Bottom row blue/white; top row red/green. Legacy alpha is all zero.
  Buffer.from([255,0,0,0,255,255,255,0,0,0,255,0,0,255,0,0]).copy(dib, 40); dib[60] = 0x80;
  const raw = await sharp(await decodeIcon(ico(dib))).raw().toBuffer();
  assert.deepEqual([...raw], [255,0,0,0,0,255,0,255,0,0,255,255,255,255,255,255]);
});
test('ICO indexed-color DIB supports 4-bit palettes', async () => {
  const dib = Buffer.alloc(64); dib.writeUInt32LE(40); dib.writeInt32LE(2, 4); dib.writeInt32LE(4, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(4, 14); dib.writeUInt32LE(2, 32);
  Buffer.from([0,0,255,0,0,255,0,0]).copy(dib, 40); dib[48] = 0x01; dib[52] = 0x10;
  assert.deepEqual([...await sharp(await decodeIcon(ico(dib, 2, 2, 4))).raw().toBuffer()], [0,255,0,255,255,0,0,255,255,0,0,255,0,255,0,255]);
});
test('prepared manifests reject traversal, unexpected origins, duplicate packages and corrupt content', async t => {
  const root = fixture(t), reader = new PreparedBeautyPackages(root), file = image(root, await png());
  plan(root, [pkg('a', [{ file, role: 'character' }])]); assert.equal(reader.plan().length, 1); reader.image(file);
  assert.throws(() => reader.image('../config.json'), /路径/);
  plan(root, [pkg('a', [{ file: '../outside.png', role: 'character' }])]); assert.throws(() => reader.plan(), /路径/);
  plan(root, [pkg('a', []), pkg('a', [])]); assert.throws(() => reader.plan(), /重复/);
  plan(root, [{ ...pkg('a', []), source: 'https://evil.test' }]); assert.throws(() => reader.plan(), /记录/);
  fs.writeFileSync(path.join(root, 'incoming', file), await png('#ff0000')); assert.throws(() => reader.image(file), /校验/);
});
test('prepared package import groups deduplicated materials, preserves user selection and keeps successful assets on retry failure', async t => {
  const root = fixture(t), character = image(root, await png()), background = image(root, await png('#224488')), icon = image(root, await png('#ff8800'));
  const images = [{ file: character, role: 'character', name: '人物' }, { file: background, role: 'wallpaper', name: '底图' }, { file: icon, role: 'icon', name: '图标' }, { file: background, role: 'preview' }];
  plan(root, [pkg('a', images), pkg('b', images)]);
  const beauty = new SystemBeauty({ root, platform: 'test' });
  await beauty.saveProfile({ id: 'existing', name: '原有搭配', characterId: '', preset: 'aurora' });
  const result = await beauty.importPreparedPackages(); assert.equal(result.added, 3); assert.equal(result.packages.length, 2); assert.deepEqual(result.errors, []);
  assert.equal(result.activeProfileId, 'existing'); assert.equal(result.assets[0].sources.length, 2);
  const native = result.profiles.find(p => p.id === 'source-a'); assert.ok(native.backgroundId); assert.ok(native.characterId); assert.notEqual(native.backgroundId, native.characterId);
  await beauty.saveProfile({ ...native, name: '我改过的名字' });
  await beauty.importPreparedPackages(); assert.equal(beauty.list().profiles.find(p => p.id === 'source-a').name, '我改过的名字');
  const originalCount = beauty.list().packages[0].assetIds.length;
  fs.writeFileSync(path.join(root, 'incoming', character), 'broken');
  const retry = await beauty.importPreparedPackages(); assert.equal(retry.errors.length, 2); assert.equal(retry.packages[0].assetIds.length, originalCount); assert.equal(retry.packages[0].failedCount, 1);
  await assert.rejects(beauty.deleteAsset(native.characterId), /使用|预设/);
  assert.equal(fs.existsSync(path.join(root, 'config.json')), false);
});
test('portable theme roundtrip includes independent background and character layers', async t => {
  const root = fixture(t), beauty = new SystemBeauty({ root, platform: 'test' });
  const data = beauty.read(), character = await beauty.storeAsset(await png(), { name: '人物', kind: 'character' }, data), background = await beauty.storeAsset(await png('#123456'), { name: '底图' }, data); beauty.write(data);
  const text = beauty.exportBundle({ id: 'dual', name: '组合', preset: 'aurora', backgroundId: background.id, characterId: character.id });
  const other = new SystemBeauty({ root: fixture(t), platform: 'test' }), result = await other.importBundle(text), profile = result.profiles[0];
  assert.equal(result.assets.length, 2); assert.ok(profile.backgroundId); assert.ok(profile.characterId); assert.notEqual(profile.backgroundId, profile.characterId);
  const malformed = JSON.parse(text); malformed.character.base64 = Buffer.from('<svg/>').toString('base64');
  await assert.rejects(other.importBundle(JSON.stringify(malformed)), /PNG/); assert.equal(other.list().profiles.length, 1);
});
