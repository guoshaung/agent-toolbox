const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { ExplorerBeautyEngine } = require('../src/main/beauty-explorer-engine');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beauty-engine-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const bundle = path.join(root, 'bundle'); fs.mkdirSync(bundle); const bytes = Buffer.from('MZ-owned-native-test');
  fs.writeFileSync(path.join(bundle, 'ToolboxBeautyExplorer.dll'), bytes); fs.writeFileSync(path.join(bundle, 'build.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(bytes).digest('hex') })); fs.writeFileSync(path.join(bundle, 'THIRD-PARTY-NOTICES.txt'), 'test');
  const state = { machine: false, user: false, foreign: false, operations: [], live: [] };
  const engine = new ExplorerBeautyEngine({ root: path.join(root, 'engine'), platform: 'win32', bundled: bundle });
  engine.run = async (op, elevated) => { state.operations.push([op, !!elevated]); if (op === 'status') return { machineRegistered: state.machine, userRegistered: state.user, foreignMachine: state.foreign, live: state.live }; if (op === 'install-machine') state.machine = true; if (op === 'register-user') state.user = true; if (op === 'remove-machine') state.machine = false; if (op === 'remove-user') state.user = false; return { live: state.live }; };
  return { engine, state, bundle };
}
test('component registration is explicit, staged disabled, and removal does not delete material files', async t => {
  const { engine, state } = fixture(t); assert.equal((await engine.status()).registered, false); assert.equal(state.machine, false);
  assert.equal((await engine.install()).registered, true); assert.ok(state.operations.some(([op,elevated]) => op === 'install-machine' && elevated));
  assert.match(fs.readFileSync(path.join(engine.location(),'config.ini')).toString('utf16le'), /enabled=0/);
  const image = Buffer.from('test-artwork'); const result = await engine.apply(image); assert.equal(result.pendingWindow, true);
  const png = path.join(engine.location(), crypto.createHash('sha256').update(image).digest('hex') + '.png'); assert.ok(fs.existsSync(png));
  await engine.uninstall(); assert.equal(state.machine, false); assert.equal(state.user, false); assert.ok(fs.existsSync(png));
});
test('foreign registration and altered native bytes refuse installation', async t => {
  const { engine, state, bundle } = fixture(t); state.foreign = true;
  await assert.rejects(engine.install(), /其他安装/); assert.equal(state.machine, false);
  state.foreign = false; fs.writeFileSync(path.join(bundle,'ToolboxBeautyExplorer.dll'),'MZ-changed'); await assert.rejects(engine.install(), /校验失败/); assert.equal(state.machine, false);
});
test('native reload failures are not reported as successful application', async t => {
  const { engine, state } = fixture(t); await engine.install(); state.live = [{ responded: false, result: 0 }];
  await assert.rejects(engine.apply(Buffer.from('png')), /没有完成重绘/); await assert.rejects(engine.disable(), /未响应撤销/);
});
test('live status requires a real protocol reply, active frame and painted pixels', async t => {
  const { engine, state } = fixture(t); await engine.install(); state.live = [{ responded: true, result: 0x4b001 }];
  assert.equal((await engine.status()).painted, false); state.live = [{ responded: true, result: 0x7b001 }]; assert.equal((await engine.status()).painted, true);
});
test('pre-existing shared machine loader is preserved when removing the current user registration', async t => {
  const { engine, state } = fixture(t); state.machine = true;
  await engine.install(); await engine.uninstall();
  assert.equal(state.machine, true); assert.equal(state.user, false); assert.ok(!state.operations.some(([op]) => op === 'remove-machine'));
});
test('app updates retain control of the installed native version until explicit removal', async t => {
  const { engine, bundle } = fixture(t); await engine.install(); const previous = engine.dll();
  const bytes = Buffer.from('MZ-another-build'); fs.writeFileSync(path.join(bundle,'ToolboxBeautyExplorer.dll'),bytes); fs.writeFileSync(path.join(bundle,'build.json'),JSON.stringify({sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
  assert.equal(engine.dll(), previous); assert.equal((await engine.status()).registered,true); await engine.disable();
});
test('elevated requests are fixed operations and stay within the Windows command-line limit', async t => {
  const { engine } = fixture(t); let args;
  const native = new ExplorerBeautyEngine({ root: engine.root, platform: 'win32', bundled: engine.bundled, exec: async (_exe,a) => { args=a; return { stdout:'{"authorized":true}' }; } });
  await native.run('install-machine',true);
  assert.ok(args.join(' ').length < 30000); const launcher=Buffer.from(args.at(-1),'base64').toString('utf16le'); assert.match(launcher, /RunAs/); assert.ok(!launcher.includes(engine.root));
  await assert.rejects(native.run('status',true), /不能请求管理员/);
});

test('Explorer restart requires registration and reports the actual post-restart load state', async t => {
  const { engine, state } = fixture(t);
  await assert.rejects(engine.restart(), /先启用/);
  assert.ok(!state.operations.some(([op]) => op === 'restart'));
  await engine.install();
  const run = engine.run;
  engine.run = async (...args) => args[0] === 'restart' ? { restarted: true } : run(...args);
  const result = await engine.restart();
  assert.equal(result.restartResult.restarted, true);
  assert.equal(result.ready, false);
  assert.equal(result.painted, false);
});

test('an installed DLL reached through a junction keeps its version and migrates only the owned user path', async t => {
  const { engine, state } = fixture(t); await engine.install();
  const physical = fs.realpathSync(engine.dll()), alias = path.join(path.dirname(engine.root), 'alias');
  fs.symlinkSync(engine.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const record = JSON.parse(fs.readFileSync(engine.receiptPath));
  record.dll = path.join(alias, path.basename(path.dirname(physical)), 'ToolboxBeautyExplorer.dll');
  fs.writeFileSync(engine.receiptPath, JSON.stringify(record));
  let registeredPath = record.dll;
  const run = engine.run;
  engine.run = async (...args) => {
    if (args[0] === 'register-user') registeredPath = engine.dll();
    const result = await run(...args);
    return args[0] === 'status' ? { ...result, userDllPath: registeredPath } : result;
  };
  const before = state.operations.length;
  assert.equal(engine.dll(), physical);
  assert.equal((await engine.install()).registered, true);
  assert.equal(registeredPath, physical);
  assert.equal(JSON.parse(fs.readFileSync(engine.receiptPath)).dll, physical);
  assert.ok(!state.operations.slice(before).some(([, elevated]) => elevated));
  await engine.uninstall(); assert.equal(state.machine, false);
});
