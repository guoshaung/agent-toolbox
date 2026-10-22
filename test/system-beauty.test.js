'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SystemBeauty, WindowsBeautyBridge, normalizeProfile, registerSystemBeautyIpc } = require('../src/main/system-beauty');
const { makeNativeRecipe } = require('../src/main/beauty-recipes');
const { PRESETS, makeBackgroundSvg } = require('../src/main/beauty-backgrounds');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==', 'base64');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-beauty-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('toolbox-beauty-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return new SystemBeauty({ root, platform: 'win32', decodeImage: async b => b,
    thumbnailImage: async () => ({ buffer: PNG, width: 1, height: 1 }), ...options });
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

test('incomplete wallpaper recovery records never clear the desktop or discard recovery state', async t => {
  const calls = [], beauty = fixture(t, { native: { setWallpaper: async file => calls.push(file) } });
  for (const recovery of [
    { original: 'C:/images/original.jpg', copy: '' },
    { original: 'C:/images/original.jpg' },
    { copy: '' },
    { original: null, copy: '' },
    { original: '', copy: 'unexpected-backup' },
  ]) {
    beauty.write({ ...beauty.read(), recovery });
    await assert.rejects(beauty.restoreWallpaper(), /壁纸备份.*无效/);
    assert.deepEqual(beauty.read().recovery, recovery);
  }
  assert.equal(calls.length, 0);
});

test('unrecognized current wallpaper response prevents application before backup or OS writes', async t => {
  const calls = [], beauty = fixture(t, { native: { wallpaper: async () => undefined, setWallpaper: async file => calls.push(file) } });
  const imported = await beauty.importImages([image(beauty)]);
  await assert.rejects(beauty.applyWallpaper(imported.imported[0]), /无法识别/);
  assert.equal(beauty.read().recovery, null); assert.equal(calls.length, 0);
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
  const merge = await handlers['systemBeauty:exportMergedRecipe']({ senderFrame: { url: 'https://example.com/index.html' } });
  assert.equal(merge.ok, false); assert.match(merge.error, /本地/);
  for (const method of ['scanImageFolder', 'cancelImageFolder', 'importImageFolder', 'imageFolderProgress', 'stopImageFolderImport']) {
    const result = await handlers[`systemBeauty:${method}`]({ senderFrame: { url: 'https://example.com/index.html' } }, 'arbitrary-path');
    assert.equal(result.ok, false); assert.match(result.error, /本地/);
  }
});

test('Explorer folder IPC resolves the userData junction without changing settings or material storage', async t => {
  const beauty = fixture(t), actual = path.join(beauty.root, 'actual-data'), alias = path.join(beauty.root, 'user-data-link');
  fs.mkdirSync(actual); fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const config = Buffer.from('{"font":"custom","key":"fixture-only"}'); fs.writeFileSync(path.join(actual, 'config.json'), config);
  const handlers = {}, opened = []; let shellError = '';
  registerSystemBeautyIpc({ handle: (name, fn) => { handlers[name] = fn; } }, {
    getUserDataPath: () => alias, shell: { openPath: async folder => { opened.push(folder); return shellError; } },
  });
  const event = { senderFrame: { url: require('node:url').pathToFileURL(path.join(__dirname, '../src/renderer/index.html')).href } };
  const testFolder = await handlers['systemBeauty:openExplorerThemeTest'](event);
  assert.equal(testFolder.ok, true, testFolder.error);
  const materialsFolder = await handlers['systemBeauty:openFolder'](event);
  assert.equal(materialsFolder.ok, true, materialsFolder.error);
  assert.deepEqual(opened, [fs.realpathSync(path.join(actual, 'system-beauty/theme-test')), fs.realpathSync(path.join(actual, 'system-beauty'))]);
  assert.deepEqual(fs.readFileSync(path.join(actual, 'config.json')), config);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(actual, 'system-beauty/library.json')), false);
  shellError = 'folder open failed';
  const result = await handlers['systemBeauty:openExplorerThemeTest'](event);
  assert.equal(result.ok, false); assert.equal(result.error, shellError);
});

test('INI merge IPC supports cancel at each dialog and never overwrites the source', async t => {
  const beauty = fixture(t), source = path.join(beauty.root, 'original.ini'), target = path.join(beauty.root, 'new.ini');
  const original = Buffer.from('[config]\neffectType=0\nfont=custom\n'); fs.writeFileSync(source, original);
  const handlers = {}; let cancelOpen = true, cancelSave = false, savePath = target, saves = 0;
  registerSystemBeautyIpc({ handle: (key, fn) => { handlers[key] = fn; } }, {
    getUserDataPath: () => beauty.root, getWindow: () => null,
    dialog: { showOpenDialog: async () => ({ canceled: cancelOpen, filePaths: [source] }), showSaveDialog: async () => { saves++; return { canceled: cancelSave, filePath: savePath }; } },
  });
  const event = { senderFrame: { url: require('node:url').pathToFileURL(path.join(__dirname, '../src/renderer/index.html')).href } };
  const invoke = () => handlers['systemBeauty:exportMergedRecipe'](event, { engine: 'dwm', profile: { id: 'merge', effect: 'mica' } });
  assert.deepEqual((await invoke()).data, { canceled: true }); assert.equal(saves, 0);
  cancelOpen = false; cancelSave = true;
  assert.deepEqual((await invoke()).data, { canceled: true }); assert.equal(fs.existsSync(target), false);
  cancelSave = false; savePath = source;
  assert.equal((await invoke()).ok, false); assert.deepEqual(fs.readFileSync(source), original);
  savePath = target; const result = await invoke(); assert.equal(result.ok, true);
  assert.equal(result.data.encoding, 'utf8'); assert.match(fs.readFileSync(target, 'utf8'), /font=custom/);
  assert.deepEqual(fs.readFileSync(source), original);
});

test('portable bundle round trip carries background bytes but no local paths, keys or recovery state', async t => {
  const source = fixture(t), target = fixture(t);
  const result = await source.importImages([image(source, 'photo.png', PNG)]);
  await source.saveProfile({ id: 'theme-one', name: '图片主题', backgroundId: result.imported[0], tint: '#123456', opacity: 50 });
  const exported = source.exportBundle(source.list().profiles[0]);
  assert.ok(!exported.includes(source.root)); assert.ok(!exported.includes('recovery'));
  const imported = await target.importBundle(exported);
  assert.notEqual(imported.importedProfileId, 'theme-one');
  assert.equal(imported.profiles[0].tint, '#123456');
  assert.equal(fs.readFileSync(target.assetPath(imported.profiles[0].backgroundId)).equals(PNG), true);
  await target.importBundle(exported);
  assert.equal(target.list().assets.length, 1); assert.equal(target.list().profiles.length, 2);
});
test('invalid bundle versions, SVG payloads, noncanonical base64 and external path fields cannot mutate storage', async t => {
  const beauty = fixture(t);
  const valid = { format: 'agent-toolbox-beauty', version: 1, theme: { id: 'old', name: 'test' } };
  await assert.rejects(beauty.importBundle('{'), /JSON/);
  await assert.rejects(beauty.importBundle(JSON.stringify({ ...valid, version: 200 })), /版本/);
  await assert.rejects(beauty.importBundle(JSON.stringify({ ...valid, background: { mime: 'image/png', base64: Buffer.from('<svg/>').toString('base64') } })), /PNG/);
  await assert.rejects(beauty.importBundle(JSON.stringify({ ...valid, background: { mime: 'image/png', base64: 'a=aa' } })), /编码/);
  assert.equal(fs.existsSync(beauty.file), false);
  await beauty.importBundle(JSON.stringify({ ...valid, theme: { ...valid.theme, backgroundId: 'C:/private.png', font: 'malicious', apiKey: 'secret' }, recovery: { original: 'private' } }));
  const saved = beauty.list().profiles[0];
  assert.equal(saved.backgroundId, ''); assert.equal(saved.apiKey, undefined); assert.equal(saved.font, undefined); assert.equal(beauty.read().recovery, null);
});
test('real image decoder rejects SVG disguised as PNG before rasterization', async t => {
  const beauty = fixture(t, { decodeImage: undefined });
  const result = await beauty.importImages([image(beauty, 'not-a-png.png', '<svg xmlns="http://www.w3.org/2000/svg"/>')]);
  assert.equal(result.imported.length, 0); assert.match(result.errors[0].error, /真实/);
});
test('remembered theme survives reopening and deletion moves selection to an existing theme', async t => {
  const beauty = fixture(t);
  await beauty.saveProfile({ id: 'one' }); await beauty.saveProfile({ id: 'two' }); await beauty.selectProfile('one');
  const reopened = new SystemBeauty({ root: beauty.root });
  assert.equal(reopened.list().activeProfileId, 'one');
  await beauty.deleteProfile('one'); assert.equal(reopened.list().activeProfileId, 'two');
  await assert.rejects(beauty.selectProfile('missing'), /不存在/);
});
test('asset removal refuses theme and wallpaper references, then removes unused file only', async t => {
  const beauty = fixture(t, { native: { wallpaper: async () => '', setWallpaper: async () => {} } });
  const result = await beauty.importImages([image(beauty)]), id = result.imported[0];
  await beauty.saveProfile({ id: 'one', backgroundId: id });
  await assert.rejects(beauty.deleteAsset(id), /主题/);
  await beauty.deleteProfile('one'); await beauty.applyWallpaper(id);
  await assert.rejects(beauty.deleteAsset(id), /壁纸/);
  await beauty.restoreWallpaper(); await beauty.deleteAsset(id);
  assert.equal(beauty.list().assets.length, 0); assert.equal(fs.existsSync(beauty.assetPath(id)), false);
});
test('native recipes use documented effect enums and Windows COLORREF channel ordering', () => {
  const profile = normalizeProfile({ id: 'theme', effect: 'acrylic', tint: '#123456', opacity: 50, blur: 30 });
  const recipe = makeNativeRecipe('dwm', profile);
  assert.match(recipe.text, /effectType=2\r\n/);
  assert.match(recipe.text, new RegExp(`activeBlendColor=${0x80563412}\\r\\n`));
  assert.match(recipe.text, /blurMethod=0/); assert.match(recipe.text, /applyglobal=false/);
  const explorer = makeNativeRecipe('explorer', profile);
  assert.match(explorer.text, /effect=1/); assert.match(explorer.text, /r=18\r\ng=52\r\nb=86\r\na=128/);
  assert.throws(() => makeNativeRecipe('explorer', { ...profile, effect: 'solid' }), /不支持纯色/);
  assert.throws(() => makeNativeRecipe('unknown', profile), /不支持/);
});

test('Windows INI API reads exported Unicode recipes with exact effect and color values', { skip: process.platform !== 'win32' }, t => {
  const beauty = fixture(t), file = path.join(beauty.root, 'native.ini');
  const recipe = makeNativeRecipe('dwm', normalizeProfile({ id: 'theme', effect: 'mica', tint: '#123456', opacity: 50 }));
  fs.writeFileSync(file, Buffer.concat([Buffer.from([255, 254]), Buffer.from(recipe.text, 'utf16le')]));
  const script = `$ProgressPreference='SilentlyContinue'; Add-Type @'\nusing System;using System.Text;using System.Runtime.InteropServices;public class IniRead {[DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern int GetPrivateProfileString(string section,string key,string fallback,StringBuilder result,int size,string file);}\n'@\n$f=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}'));$a=[Text.StringBuilder]::new(100);$b=[Text.StringBuilder]::new(100);[void][IniRead]::GetPrivateProfileString('config','effectType','missing',$a,100,$f);[void][IniRead]::GetPrivateProfileString('config','activeBlendColor','missing',$b,100,$f);@{effect=$a.ToString();color=$b.ToString()}|ConvertTo-Json -Compress`;
  const raw = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  const actual = JSON.parse(raw); assert.equal(actual.effect, '3'); assert.equal(Number(actual.color), 0x80563412);
});

test('built-in backgrounds render real FHD PNGs, generate small thumbnails and deduplicate without OS writes', async t => {
  let nativeCalls = 0;
  const beauty = fixture(t, { thumbnailImage: undefined, native: { setWallpaper: async () => nativeCalls++ } });
  const result = await beauty.generateBackground({ preset: 'aurora', size: 'fhd' });
  const asset = result.assets[0], sharp = require('sharp');
  const full = await sharp(fs.readFileSync(beauty.assetPath(asset.id))).metadata();
  const thumbnail = await sharp(fs.readFileSync(beauty.thumbnailPath(asset.id))).metadata();
  assert.equal(full.width, 1920); assert.equal(full.height, 1080); assert.equal(full.format, 'png');
  assert.ok(thumbnail.width <= 384 && thumbnail.height <= 216); assert.equal(thumbnail.format, 'webp');
  assert.equal(asset.kind, 'generated'); assert.equal(asset.width, 1920); assert.equal(nativeCalls, 0);
  assert.ok(asset.thumbnailUrl.endsWith('.webp'));
  await beauty.generateBackground({ preset: 'aurora', size: 'fhd' });
  assert.equal(beauty.list().assets.length, 1);
  const second = await beauty.generateBackground({ preset: 'forest', size: 'fhd' });
  assert.notEqual(second.generatedAssetId, result.generatedAssetId);
});
test('gradient render rejects arbitrary SVG, dimensions and unknown palettes before writing storage', async t => {
  const beauty = fixture(t);
  assert.equal(PRESETS.length, 12);
  assert.throws(() => makeBackgroundSvg('<script/>', 'fhd'), /不存在/);
  await assert.rejects(beauty.generateBackground({ preset: 'aurora', size: '90000x90000' }), /尺寸/);
  assert.equal(fs.existsSync(beauty.file), false);
});
test('legacy thumbnail backfill preserves original image bytes and saved theme references', async t => {
  const beauty = fixture(t);
  const result = await beauty.importImages([image(beauty, 'photo.png', PNG)]), id = result.imported[0];
  await beauty.saveProfile({ id: 'one', backgroundId: id });
  fs.unlinkSync(beauty.thumbnailPath(id));
  assert.equal(beauty.list().assets[0].thumbnailUrl, beauty.list().assets[0].url);
  const repaired = await beauty.prepareThumbnails();
  assert.equal(repaired.prepared, 1); assert.deepEqual(repaired.errors, []);
  assert.equal(fs.readFileSync(beauty.assetPath(id)).equals(PNG), true);
  assert.equal(repaired.profiles[0].backgroundId, id);
  await beauty.deleteProfile('one'); await beauty.deleteAsset(id);
  assert.equal(fs.existsSync(beauty.thumbnailPath(id)), false);
});

test('wallpaper can be applied and restored repeatedly when Windows points to our previous backup', async t => {
  let current;
  const beauty = fixture(t, { native: { wallpaper: async () => current, setWallpaper: async value => { current = value; } } });
  current = image(beauty, 'original.jpg', 'original');
  const imported = await beauty.importImages([image(beauty)]);
  await beauty.applyWallpaper(imported.imported[0]);
  const firstBackup = beauty.read().recovery.copy;
  await beauty.restoreWallpaper(); assert.equal(current, firstBackup);
  await beauty.applyWallpaper(imported.imported[0]);
  const secondBackup = beauty.read().recovery.copy;
  assert.notEqual(firstBackup, secondBackup);
  await beauty.restoreWallpaper();
  assert.equal(fs.readFileSync(current, 'utf8'), 'original');
});
