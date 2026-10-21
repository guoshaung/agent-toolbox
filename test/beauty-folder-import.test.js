'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BeautyFolderImport, FOLDER_LIMITS } = require('../src/main/beauty-folder-import');
const { SystemBeauty } = require('../src/main/system-beauty');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==', 'base64');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-folder-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('toolbox-folder-')); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const write = (name, data = PNG) => { const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
  return { root, source, write };
}

test('folder scan is read-only, includes nested images and exposes bounded relative samples only', async t => {
  const { root, source, write } = fixture(t);
  write('one.PNG'); write('nested/two.webp'); write('notes.md', 'private dummy');
  const before = fs.readdirSync(root), importer = new BeautyFolderImport(), result = await importer.scan(source);
  assert.equal(result.count, 2); assert.equal(result.bytes, PNG.length * 2); assert.equal(result.skipped.unsupported, 1);
  assert.deepEqual([...result.samples].sort(), ['nested' + path.sep + 'two.webp', 'one.PNG']);
  assert.ok(!JSON.stringify(result).includes(root)); assert.deepEqual(fs.readdirSync(root), before);
  assert.deepEqual(fs.readFileSync(path.join(source, 'one.PNG')), PNG);
});

test('scan enforces image size, total bytes, file/entry/directory/depth bounds', async t => {
  const { source, write } = fixture(t);
  for (const name of ['a.png','b.png','c.png']) write(name);
  write('deep/one/two/three/four.png'); write('large.png', Buffer.alloc(100));
  const scan = limits => new BeautyFolderImport({ limits: { ...FOLDER_LIMITS, ...limits } }).scan(source);
  const files = await scan({ files: 2 }); assert.equal(files.count, 2); assert.ok(files.reached.includes('files'));
  const bytes = await scan({ bytes: PNG.length, imageBytes: 80 }); assert.equal(bytes.count, 1); assert.ok(bytes.reached.includes('bytes')); assert.equal(bytes.skipped.oversized, 1);
  const depth = await scan({ depth: 0 }); assert.equal(depth.skipped.depth, 1);
  const directories = await scan({ directories: 1 }); assert.ok(directories.reached.includes('directories'));
  const entries = await scan({ entries: 1 }); assert.ok(entries.reached.includes('entries')); assert.ok(entries.count <= 1);
});

test('directory junctions and symbolic links are skipped and cannot be selected as roots', async t => {
  const { root, source, write } = fixture(t); write('inside.png');
  const external = path.join(root, 'outside'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'outside.png'), PNG);
  const junction = path.join(source, 'linked'); fs.symlinkSync(external, junction, process.platform === 'win32' ? 'junction' : 'dir');
  const importer = new BeautyFolderImport(), result = await importer.scan(source);
  assert.equal(result.count, 1); assert.equal(result.skipped.links, 1);
  await assert.rejects(importer.scan(junction), /链接|联接/);
});

test('changed file and replaced parent junction are refused after preview before content reaches store', async t => {
  const { root, source, write } = fixture(t), file = write('nested/photo.png');
  const importer = new BeautyFolderImport(), preview = await importer.scan(source);
  fs.writeFileSync(file, 'changed-size'); let stored = 0;
  const changed = await importer.consume(preview.id, () => stored++);
  assert.equal(changed.errors.length, 1); assert.match(changed.errors[0].error, /变化/); assert.equal(stored, 0);
  fs.writeFileSync(file, PNG); const next = await importer.scan(source);
  fs.renameSync(path.join(source, 'nested'), path.join(root, 'original-nested'));
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'photo.png'), PNG);
  fs.symlinkSync(outside, path.join(source, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await importer.consume(next.id, () => stored++);
  assert.equal(linked.errors.length, 1); assert.match(linked.errors[0].error, /链接/); assert.equal(stored, 0);
});

test('cancel, expiry, new scan, unknown ID and replay cannot import files', async t => {
  const { source, write } = fixture(t); write('image.png'); let now = 0, calls = 0;
  const importer = new BeautyFolderImport({ now: () => now }); const store = async () => { calls++; return 'asset'; };
  let preview = await importer.scan(source); importer.cancel(preview.id); await assert.rejects(importer.consume(preview.id, store), /失效/);
  preview = await importer.scan(source); now += 16 * 60 * 1000; await assert.rejects(importer.consume(preview.id, store), /失效/);
  preview = await importer.scan(source); await importer.scan(source); await assert.rejects(importer.consume(preview.id, store), /失效/);
  await assert.rejects(importer.consume('../source', store), /失效/); assert.equal(calls, 0);
  preview = await importer.scan(source); const result = await importer.consume(preview.id, store); assert.equal(result.imported.length, 1);
  await assert.rejects(importer.consume(preview.id, store), /失效/); assert.equal(calls, 1);
});

test('folder import validates real images, deduplicates and preserves original files and main config', async t => {
  const valid = await require('sharp')({ create: { width: 16, height: 16, channels: 4, background: '#1268ab' } }).png().toBuffer();
  const { root, source, write } = fixture(t); const one = write('one.png', valid), two = write('nested/two.png', valid); write('broken.png', '<svg/>');
  const config = path.join(root, 'config.json'); fs.writeFileSync(config, '{"font":"dummy font","key":"dummy-only"}'); const before = fs.readFileSync(config);
  const beauty = new SystemBeauty({ root: path.join(root, 'library') });
  const preview = await beauty.folderImport.scan(source); assert.equal(fs.existsSync(beauty.file), false);
  const result = await beauty.importFolder(preview.id);
  assert.equal(result.attempted, 3); assert.equal(result.added, 1); assert.equal(result.imported.length, 2); assert.equal(result.errors.length, 1);
  assert.equal(result.assets.length, 1); assert.deepEqual(fs.readFileSync(one), valid); assert.deepEqual(fs.readFileSync(two), valid); assert.deepEqual(fs.readFileSync(config), before);
});

test('folder import persists successful files and isolates disk failure from added counts', async t => {
  const { root, source, write } = fixture(t); write('a.png', 'first'); write('b.png', 'second');
  const beauty = new SystemBeauty({ root: path.join(root, 'library'), decodeImage: async buffer => buffer, thumbnailImage: async () => ({ buffer: PNG, width: 1, height: 1 }) });
  const writeLibrary = beauty.write.bind(beauty); let fail = true;
  beauty.write = data => { if (fail) { fail = false; throw new Error('disk failure'); } writeLibrary(data); };
  const preview = await beauty.folderImport.scan(source), result = await beauty.importFolder(preview.id);
  assert.equal(result.added, 1); assert.equal(result.imported.length, 1); assert.equal(result.errors.length, 1);
  assert.equal(beauty.read().assets.length, 1); assert.match(result.errors[0].error, /disk failure/);
});
