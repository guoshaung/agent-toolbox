const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), sharp = require('sharp');
const { SystemBeauty } = require('../src/main/system-beauty');
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beauty-session-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const original = path.join(root, 'original.png'); fs.writeFileSync(original, await sharp({ create: { width: 8, height: 6, channels: 4, background: '#778899' } }).png().toBuffer());
  const before = { AppsUseLightTheme: { exists: true, kind: 'DWord', value: 1 }, SystemUsesLightTheme: { exists: false }, EnableTransparency: { exists: true, kind: 'DWord', value: 0 } };
  const state = { wallpaper: original, settings: structuredClone(before), enabled: false, registered: true, calls: [], failWallpaper: false, failEngine: false };
  const native = { wallpaper: async () => state.wallpaper, setWallpaper: async file => { state.calls.push('wallpaper'); if (state.failWallpaper) throw Error('wallpaper failed'); state.wallpaper = file; }, personalization: async () => structuredClone(state.settings), setPersonalization: async values => { state.calls.push('colors'); Object.assign(state.settings, structuredClone(values)); return {}; } };
  const explorerEngine = { status: async () => ({ registered: state.registered, enabled: state.enabled, ready: true }), apply: async bytes => { state.calls.push('engine'); assert.equal((await sharp(bytes).metadata()).format, 'png'); if (state.failEngine) throw Error('engine failed'); state.enabled = true; return explorerEngine.status(); }, disable: async () => { state.calls.push('disable'); state.enabled = false; return explorerEngine.status(); } };
  const beauty = new SystemBeauty({ root, native, explorerEngine, platform: 'win32' });
  const data = beauty.read(), figure = await beauty.storeAsset(await sharp({ create: { width: 6, height: 7, channels: 4, background: '#ff000080' } }).png().toBuffer(), { name: '人物', kind: 'character' }, data); beauty.write(data);
  const profile = { id: 'theme-a', name: '主题甲', tint: '#112233', preset: 'aurora', characterId: figure.id };
  const payload = { profile, options: { wallpaper: true, colors: true, explorer: true } };
  return { root, beauty, state, original, before, payload };
}
test('switching multiple computer themes preserves the first baseline and restores native state', async t => {
  const { root, beauty, state, original, before, payload } = await fixture(t);
  const config = Buffer.from('{"font":"keep","key":"dummy-preserve"}'); fs.writeFileSync(path.join(root, 'config.json'), config);
  await beauty.applySystemTheme(payload); const first = beauty.read().recovery;
  await beauty.applySystemTheme({ ...payload, profile: { ...payload.profile, id: 'theme-b', name: '主题乙', tint: '#eeeeee' } });
  assert.equal(beauty.read().recovery.id, first.id); assert.equal(state.enabled, true); assert.equal(state.settings.AppsUseLightTheme.value, 1);
  const restored = await beauty.restoreSystemTheme(); assert.deepEqual(restored.restoreErrors, []); assert.equal(state.enabled, false); assert.deepEqual(state.settings, before);
  assert.deepEqual(fs.readFileSync(state.wallpaper), fs.readFileSync(original)); assert.equal(beauty.read().recovery, null); assert.equal(beauty.read().themeSession, null);
  assert.deepEqual(fs.readFileSync(path.join(root, 'config.json')), config);
});
test('missing native registration rejects a theme before any Windows mutation', async t => {
  const { beauty, state, payload } = await fixture(t); state.registered = false;
  const before = beauty.read(); await assert.rejects(beauty.applySystemTheme(payload), /启用资源管理器组件/);
  assert.deepEqual(state.calls, []); assert.deepEqual(beauty.read(), before);
});
test('partially failed theme application retains backups and can be restored', async t => {
  const { beauty, state, before, payload } = await fixture(t); state.failEngine = true;
  await assert.rejects(beauty.applySystemTheme(payload), /engine failed/);
  assert.equal(beauty.read().themeSession.phase, 'failed'); assert.ok(beauty.read().recovery); assert.ok(beauty.read().personalizationRecovery);
  state.failWallpaper = true; const result = await beauty.restoreSystemTheme();
  assert.equal(result.restoreErrors.length, 1); assert.ok(beauty.read().recovery); assert.equal(beauty.read().personalizationRecovery, null); assert.deepEqual(state.settings, before);
  state.failWallpaper = false; await beauty.restoreSystemTheme(); assert.equal(beauty.read().themeSession, null);
});
test('whole-theme apply and recovery share one queue', async t => {
  const { beauty, state, payload } = await fixture(t);
  await Promise.all([beauty.applySystemTheme(payload), beauty.restoreSystemTheme()]);
  assert.equal(state.enabled, false); assert.equal(beauty.read().themeSession, null); assert.equal(beauty.read().recovery, null);
});
test('invalid component choices and missing layer reject before native writes', async t => {
  const { beauty, state, payload } = await fixture(t);
  await assert.rejects(beauty.applySystemTheme({ ...payload, options: { wallpaper: false, colors: false, explorer: false, unrelated: true } }), /请选择/);
  await assert.rejects(beauty.applySystemTheme({ ...payload, profile: { ...payload.profile, backgroundId: 'f'.repeat(64) } }), /素材缺失/); assert.deepEqual(state.calls, []);
});

test('a loader failure stops the complete theme before wallpaper, color or session writes', async t => {
  const { beauty, state, payload } = await fixture(t);
  const initial = beauty.read();
  beauty.explorerEngine.ensureLoaded = async () => { throw Error('loader unavailable'); };
  await assert.rejects(beauty.applySystemTheme(payload), /loader unavailable/);
  assert.deepEqual(state.calls, []); assert.deepEqual(beauty.read(), initial);
});
test('one theme coordinates window materials, icons, animated cursors, shell colors and taskbar recovery',async t=>{
 const {beauty,state,payload}=await fixture(t),calls=[];
 beauty.themeWindows={stop:()=>calls.push('stop-follow'),list:()=>({records:[]}),apply:async()=>{calls.push('windows');return {applied:[{title:'Window'}],skipped:[]};},watch:()=>calls.push('follow'),restore:async()=>{calls.push('restore-windows');return {failed:[]};}};
 beauty.shellAssets={prepare:async()=>{calls.push('prepare-shell');return {plan:{}};},native:{run:async()=>calls.push('validate-shell')},apply:async()=>{calls.push('shell');return {icons:6,cursors:15};},restore:async()=>calls.push('restore-shell'),list:()=>({})};
 beauty.taskbarStyle={prepare:async()=>calls.push('prepare-taskbar'),apply:async()=>{calls.push('taskbar');return {running:true};},restore:async()=>calls.push('restore-taskbar'),list:()=>({})};
 await beauty.applySystemTheme({...payload,options:{...payload.options,windows:true,icons:true,cursors:true,shellColors:true,taskbar:true}});
 assert.deepEqual(calls.slice(0,4),['stop-follow','prepare-shell','validate-shell','prepare-taskbar']);assert.ok(calls.includes('windows')&&calls.includes('follow')&&calls.includes('shell')&&calls.includes('taskbar'));assert.equal(beauty.read().themeSession.profile.name,payload.profile.name);
 const restored=await beauty.restoreSystemTheme();assert.deepEqual(restored.restoreErrors,[]);for(const part of ['restore-windows','restore-shell','restore-taskbar'])assert.ok(calls.includes(part));
 assert.equal(state.enabled,false);
});
