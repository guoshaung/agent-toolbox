'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { BeautyCatalog, fetchImage, imageUrl } = require('../src/main/beauty-catalog');
const { SystemBeauty } = require('../src/main/system-beauty');
const catalog = require('../src/main/beauty-catalog.json');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beauty-catalog-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
const png = () => sharp({ create: { width: 36, height: 48, channels: 4, background: '#e090a080' } }).png().toBuffer();
test('catalog has every current category with attributed public images and protected-package links', () => {
  assert.equal(catalog.entries.length, 62);
  assert.equal(new Set(catalog.entries.map(x => x.id)).size, 62);
  assert.deepEqual(Object.fromEntries([...new Set(catalog.entries.map(x => x.category))].map(category => [category, catalog.entries.filter(x => x.category === category).length])), {
    '预设包': 16, '美化包': 16, '文件夹背景': 11, '鼠标指针&图标': 19,
  });
  assert.equal(catalog.entries.reduce((n, x) => n + x.materials.length, 0), 8);
  for (const item of catalog.entries) {
    assert.ok(item.author); assert.match(item.url, /^https:\/\/winmoes.com\/article\/t\d+$/);
    imageUrl(item.cover); for (const image of item.materials) imageUrl(image.url);
    for (const pkg of item.packages) { assert.equal(item.packageStatus, 'login'); assert.match(pkg.url, /^https:\/\/winmoes.com\/workshop\/packages\/[a-z0-9]+$/); }
  }
});
test('downloads reject arbitrary hosts, redirects and oversized bodies, without credentials', async () => {
  for (const url of ['http://dl.winmoes.com/uploads/a.png', 'https://evil.test/a.png', 'https://dl.winmoes.com.evil.test/uploads/a.png', 'https://user:pass@dl.winmoes.com/uploads/a.png', 'https://dl.winmoes.com/uploads/a.png?token=secret', 'file:///etc/passwd']) assert.throws(() => imageUrl(url));
  const url = 'https://dl.winmoes.com/uploads/a.png';
  await assert.rejects(fetchImage(url, async (_url, options) => { assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined); return new Response('', { status: 403 }); }), /403/);
  await assert.rejects(fetchImage(url, async () => new Response('', { headers: { 'content-length': String(26 * 1024 * 1024) } })), /25 MB/);
  await assert.rejects(fetchImage(url, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(26 * 1024 * 1024)); c.close(); } }))), /25 MB/);
});
test('cover failures are per item, malformed images are rejected and successful covers work offline', async t => {
  const bytes = await png(), entries = catalog.entries.slice(0, 3); let calls = 0;
  const service = new BeautyCatalog({ root: temporary(t), data: { ...catalog, entries }, fetcher: async () => { calls++; return new Response(calls === 2 ? 'not an image' : bytes); } });
  const [a, b] = await Promise.all([service.cacheCovers(), service.cacheCovers()]);
  assert.equal(a, b); assert.equal(calls, 3); assert.equal(a.prepared, 2); assert.equal(a.errors.length, 1);
  assert.equal(service.list().entries.filter(x => x.coverUrl).length, 2);
  await service.cacheCovers(); assert.equal(calls, 4); assert.equal(service.list().entries.filter(x => x.coverUrl).length, 3);
  assert.throws(() => service.entry('../../config'));
  await assert.rejects(service.material(entries[0].id, -1), /公开原图/);
});
test('public characters import with provenance, retain successful items on errors, deduplicate and roundtrip as characters', async t => {
  const beauty = new SystemBeauty({ root: temporary(t), platform: 'test' }), bytes = await png();
  beauty.catalog = new BeautyCatalog({ root: path.join(beauty.root, 'catalog'), data: { ...catalog, entries: [catalog.entries.find(x => x.id === 't13224')] }, fetcher: async url => new Response(url.includes('e64482') ? 'bad' : bytes) });
  const result = await beauty.importCatalogMaterials('all');
  assert.equal(result.added, 1); assert.equal(result.imported.length, 5); assert.equal(result.errors.length, 1);
  const asset = result.assets[0]; assert.equal(asset.kind, 'character'); assert.equal(asset.source.articleId, 't13224');
  const again = await beauty.importCatalogMaterials('all'); assert.equal(again.added, 0);
  const bundle = beauty.exportBundle({ id: 'character-test', name: '人物', preset: 'aurora', backgroundId: asset.id });
  const other = new SystemBeauty({ root: temporary(t), platform: 'test' });
  const imported = await other.importBundle(bundle); assert.equal(imported.assets[0].kind, 'character'); assert.equal(imported.assets[0].source.articleId, 't13224');
  await assert.rejects(beauty.importCatalogMaterials('unknown'), /不存在/);
});
test('character wallpapers are composed without touching originals or invoking native operations', async t => {
  let writes = 0;
  const beauty = new SystemBeauty({ root: temporary(t), platform: 'win32', native: { setWallpaper: async () => { writes++; } } });
  const data = beauty.read(), original = await png();
  const asset = await beauty.storeAsset(original, { name: 'test', kind: 'character' }, data); beauty.write(data);
  const result = await beauty.composeCharacterWallpaper({ id: asset.id, preset: 'aurora', size: 'fhd' });
  const output = fs.readFileSync(beauty.assetPath(result.generatedAssetId)), meta = await sharp(output).metadata();
  assert.equal(meta.width, 1920); assert.equal(meta.height, 1080); assert.equal(writes, 0);
  assert.deepEqual(fs.readFileSync(beauty.assetPath(asset.id)), original);
  const pixel = await sharp(output).extract({ left: 1780, top: 1000, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const { svg } = require('../src/main/beauty-backgrounds').makeBackgroundSvg('aurora');
  const plain = await sharp(Buffer.from(svg)).extract({ left: 1780, top: 1000, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.notDeepEqual(pixel, plain, 'character is actually composited at the right-hand edge');
  await assert.rejects(beauty.composeCharacterWallpaper({ id: asset.id, preset: 'bad', size: 'fhd' }), /不存在/);
});
