'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SystemBeauty, WindowsBeautyBridge, normalizeProfile, registerSystemBeautyIpc } = require('../src/main/system-beauty');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-beauty-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('toolbox-beauty-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return new SystemBeauty({ root, platform: 'win32', decodeImage: async b => b, ...options });
}
function image(service, name = 'photo.png', contents = 'a') {
  const file = path.join(service.root, name); fs.writeFileSync(file, contents); return file;
}

test('list is side-effect free and never touches the parent Toolbox configuration', t => {
  const beauty = fixture(t);
  assert.equal(beauty.list().assets.length, 0);
  assert.equal(fs.existsSync(beauty.file), false);
  assert.throws(() => beauty.assetPath('../config'), /ID/);
});
test('imports are serialized, deduplicated by content and retain independent assets', async t => {
  const beauty = fixture(t);
  const one = image(beauty), two = image(beauty, 'two.jpg', 'b');
  await Promise.all([beauty.importImages([one]), beauty.importImages([two]), beauty.importImages([one])]);
  assert.equal(beauty.list().assets.length, 2);
  fs.unlinkSync(one);
  assert.ok(fs.existsSync(beauty.assetPath(beauty.list().assets[0].id)));
});
test('unsupported and malformed images do not enter the library', async t => {
  const beauty = fixture(t, { decodeImage: async () => { throw new Error('bad image'); } });
  const invalid = image(beauty), svg = image(beauty, 'active.svg', '<svg/>');
  const result = await beauty.importImages([invalid, svg]);
  assert.equal(result.imported.length, 0); assert.equal(result.errors.length, 2);
});
test('profile serialization strips arbitrary paths, CSS and invalid properties', async t => {
  const beauty = fixture(t);
  await beauty.saveProfile({ id: 'my-theme', name: '测试', opacity: 999, blur: -3, tint: 'url(file://secret)', effect: 'x', backgroundId: '../secret', secret: 'do not persist' });
  const saved = beauty.list().profiles[0];
  assert.equal(saved.opacity, 100); assert.equal(saved.blur, 0); assert.equal(saved.tint, '#1a2442'); assert.equal(saved.backgroundId, ''); assert.equal(saved.secret, undefined);
  await assert.rejects(beauty.saveProfile({ id: '../foo' }), /ID/);
  assert.throws(() => normalizeProfile(null), /ID/);
});
test('wallpaper baseline is backed up before API mutation and retained across multiple applies', async t => {
  let current, writes = [];
  const beauty = fixture(t, { native: { wallpaper: async () => current, setWallpaper: async file => {
    assert.ok(beauty.read().recovery, 'backup must predate OS write'); writes.push(file); current = file;
  } } });
  const original = image(beauty, 'original.jpg', 'original'); current = original;
  const result = await beauty.importImages([image(beauty, 'one.png', 'one'), image(beauty, 'two.png', 'two')]);
  await beauty.applyWallpaper(result.imported[0]); await beauty.applyWallpaper(result.imported[1]);
  assert.equal(beauty.read().recovery.original, original);
  fs.writeFileSync(original, 'changed externally');
  await beauty.restoreWallpaper();
  assert.equal(fs.readFileSync(writes.at(-1), 'utf8'), 'original');
  assert.equal(beauty.list().recovery, null);
});
test('failed OS application or restore retains a durable recovery record', async t => {
  const beauty = fixture(t, { native: { wallpaper: async () => '', setWallpaper: async () => { throw new Error('denied'); } } });
  const result = await beauty.importImages([image(beauty)]);
  await assert.rejects(beauty.applyWallpaper(result.imported[0]), /denied/);
  assert.ok(beauty.read().recovery);
  await assert.rejects(beauty.restoreWallpaper(), /denied/);
  assert.ok(beauty.read().recovery);
});
test('can restore originally empty wallpaper, and invalid asset never invokes native API', async t => {
  const calls = [];
  const beauty = fixture(t, { native: { wallpaper: async () => '', setWallpaper: async p => calls.push(p) } });
  await assert.rejects(beauty.applyWallpaper('x'), /ID/); assert.equal(calls.length, 0);
  const result = await beauty.importImages([image(beauty)]);
  await beauty.applyWallpaper(result.imported[0]); await beauty.restoreWallpaper();
  assert.equal(calls.at(-1), '');
});
test('native bridge encodes user paths strictly as data and works without an OS-visible asar script', async () => {
  const file = 'C:\\images\\$(private) `a`.png';
  const bridge = new WindowsBeautyBridge({ platform: 'win32', exec: async (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.equal(args.at(-2), '-EncodedCommand');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.ok(script.includes(Buffer.from(file, 'utf8').toString('base64'))); assert.ok(!script.includes(file));
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 20000);
    return { stdout: '{"applied":true}' };
  } });
  assert.equal((await bridge.setWallpaper(file)).applied, true);
});
test('IPC rejects remote pages before accessing filesystem or dialogs', async () => {
  const handlers = {};
  registerSystemBeautyIpc({ handle: (key, fn) => { handlers[key] = fn; } }, { getUserDataPath: () => os.tmpdir(), dialog: { showOpenDialog: () => { throw new Error('should not run'); } }, getWindow: () => null });
  const result = await handlers['systemBeauty:importImages']({ senderFrame: { url: 'https://example.com/index.html' } });
  assert.equal(result.ok, false); assert.match(result.error, /本地/);
});
