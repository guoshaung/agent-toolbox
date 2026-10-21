'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { WindowAppearance, WindowAppearanceBridge, windowPlan, windowValues, windowIdentity } = require('../src/main/beauty-window-appearance');
const TARGET = { hwnd: '12345', pid: 456, started: '638912345678900000', className: 'FixtureClass', processName: 'fixture', title: 'Fixture window' };
const clone = input => JSON.parse(JSON.stringify(input));

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-window-test-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('toolbox-window-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const state = { values: { 20: 0, 33: 0, 38: 0 }, marker: 0, writes: [], closed: false, failApply: false, denyBind: false };
  const check = (target, marker) => { assert.deepEqual(target, TARGET); if (state.closed) throw new Error('window identity changed'); if (marker !== undefined && state.marker !== marker) throw new Error('window marker mismatch'); };
  const native = {
    enumerate: async () => [clone(TARGET)],
    capture: async (target, keys, marker) => { check(target, marker); return { values: Object.fromEntries(keys.map(key => [key, state.values[key]])), marker: state.marker }; },
    apply: async (target, values, marker, bind) => {
      assert.ok(fs.existsSync(service.file)); assert.ok(service.read().records.length);
      check(target); if (state.denyBind) throw new Error('permission denied');
      if (bind) { assert.equal(state.marker, 0); state.marker = marker; } else check(target, marker);
      for (const [key, value] of Object.entries(values)) { state.values[key] = value; state.writes.push({ key, value }); if (state.failApply) throw new Error('partial apply failure'); }
    },
    restore: async (target, values, marker) => { check(target, marker); state.writes.push({ restore: true }); Object.assign(state.values, values); },
    clearMarker: async (target, marker) => { check(target); assert.equal(service.read().records[0].phase, 'restored'); if (state.marker) check(target, marker); state.marker = 0; },
    alive: async () => !state.closed,
  };
  const service = new WindowAppearance({ root, native, platform: 'win32', release: '10.0.26200' });
  const refresh = async () => { await service.refresh(); return service.list().candidates[0].id; };
  return { service, native, state, refresh };
}

test('window appearance plans whitelist readable reversible attributes only', () => {
  assert.deepEqual(windowPlan({}), {});
  assert.deepEqual(windowPlan({ dark: 'on', corners: 'small', material: 'mica', captionColor: '#123456' }), { 20: 1, 33: 3, 38: 2 });
  for (const input of [{ dark: 'yes' }, { corners: 'constructor' }, { material: 'url(...)' }, null, []]) assert.throws(() => windowPlan(input));
  for (const values of [{ 34: 123 }, { 33: 4 }, { 20: -1 }, { 38: NaN }, {}]) assert.throws(() => windowValues(values));
  for (const change of [{ hwnd: '1;calc' }, { hwnd: 123 }, { pid: -1 }, { started: 'abc' }, { hwnd: '9223372036854775808' }]) assert.throws(() => windowIdentity({ ...TARGET, ...change }));
});

test('refresh is read-only, exposes opaque candidate IDs and preserves selection IDs', async t => {
  const { service, refresh } = setup(t);
  assert.equal(fs.existsSync(service.file), false);
  const id = await refresh(); assert.equal(await refresh(), id);
  const candidate = service.list().candidates[0];
  assert.equal(candidate.hwnd, undefined); assert.equal(candidate.pid, undefined);
  assert.equal(candidate.title, TARGET.title); assert.equal(fs.existsSync(service.file), false);
});

test('window backups precede mutation and preserve initial values when adding fields later', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  await service.apply(id, { corners: 'round' });
  const marker = state.marker;
  await service.apply(id, { corners: 'small', material: 'acrylic' });
  assert.equal(state.marker, marker);
  assert.deepEqual(service.read().records[0].values, { 33: 0, 38: 0 });
  assert.equal(state.values[20], 0);
  await service.restore(service.list().records[0].id);
  assert.deepEqual(state.values, { 20: 0, 33: 0, 38: 0 }); assert.equal(state.marker, 0); assert.equal(service.list().records.length, 0);
});

test('partial application stays recoverable and unknown or empty targets do not write', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  await assert.rejects(service.apply('raw-hwnd', { material: 'mica' }), /选择/);
  await assert.rejects(service.apply(id, {}), /请选择/); assert.equal(state.writes.length, 0);
  state.failApply = true;
  await assert.rejects(service.apply(id, { corners: 'round', material: 'mica' }), /partial/);
  assert.equal(service.list().records[0].phase, 'pending');
  await assert.rejects(service.apply(id, { corners: 'small' }), /先恢复/);
  await service.restore(service.list().records[0].id);
  assert.deepEqual(state.values, { 20: 0, 33: 0, 38: 0 }); assert.equal(state.marker, 0);
});

test('denied binding with unchanged attributes clears its pending backup without a native restore', async t => {
  const { service, state, refresh } = setup(t), id = await refresh(); state.denyBind = true;
  await assert.rejects(service.apply(id, { dark: 'on' }), /denied/);
  await service.restore(service.list().records[0].id);
  assert.equal(state.writes.length, 0); assert.equal(service.list().records.length, 0);
});

test('identity/marker changes refuse restoration, and only closed-window records can be discarded', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  await service.apply(id, { material: 'mica' }); const record = service.list().records[0];
  const count = state.writes.length; state.marker++;
  await assert.rejects(service.restore(record.id), /marker/); assert.equal(state.writes.length, count);
  await assert.rejects(service.forgetClosed(record.id), /仍在运行/);
  state.closed = true; await service.forgetClosed(record.id);
  assert.equal(service.list().records.length, 0); assert.equal(state.writes.length, count);
});

test('disk failure before the backup prevents binding or any DWM mutation', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  service.write = () => { throw new Error('disk full'); };
  await assert.rejects(service.apply(id, { corners: 'round' }), /disk full/);
  assert.equal(state.marker, 0); assert.equal(state.writes.length, 0);
});

test('restored phase survives a final disk failure and retries without rewriting DWM attributes', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  await service.apply(id, { dark: 'on' }); const record = service.list().records[0];
  const write = service.write.bind(service); let writes = 0;
  service.write = data => { writes++; if (writes === 2) throw new Error('final disk failure'); write(data); };
  await assert.rejects(service.restore(record.id), /final disk failure/);
  assert.equal(service.list().records[0].phase, 'restored'); assert.equal(state.marker, 0);
  const nativeWrites = state.writes.length; await service.restore(record.id);
  assert.equal(state.writes.length, nativeWrites); assert.equal(service.list().records.length, 0);
});

test('concurrent requests serialize and modified recovery attributes are rejected before native writes', async t => {
  const { service, state, refresh } = setup(t), id = await refresh();
  await Promise.all([service.apply(id, { corners: 'round' }), service.apply(id, { material: 'mica' })]);
  assert.deepEqual(service.read().records[0].values, { 33: 0, 38: 0 });
  const data = service.read(), count = state.writes.length; data.records[0].values[35] = 123; service.write(data);
  await assert.rejects(service.restore(data.records[0].id), /属性无效/); assert.equal(state.writes.length, count);
});

test('record count is bounded and unsupported versions cannot enumerate or apply', async t => {
  const { service, refresh } = setup(t), id = await refresh();
  service.write({ version: 1, records: Array.from({ length: 32 }, (_, index) => ({ id: crypto.randomUUID(), target: { ...TARGET, hwnd: String(index + 1) } })) });
  await assert.rejects(service.apply(id, { dark: 'on' }), /清理/);
  service.capability.supported = false; service.capability.reason = 'unsupported OS';
  await assert.rejects(service.refresh(), /unsupported/);
});

test('PowerShell transport keeps Unicode paths and JSON as data, cleans temporary scripts on success and failure', async () => {
  let scriptFile, calls = 0;
  const bridge = new WindowAppearanceBridge({ platform: 'win32', exec: async (exe, args, options) => {
    calls++; assert.equal(exe, 'powershell.exe'); assert.equal(options.windowsHide, true);
    scriptFile = args[args.indexOf('-File') + 1]; assert.equal(fs.existsSync(scriptFile), true);
    assert.equal(fs.readFileSync(scriptFile).subarray(0, 3).toString('hex'), 'efbbbf');
    const payload = JSON.parse(Buffer.from(args.at(-1), 'base64').toString('utf8'));
    assert.equal(payload.target.title, '私有 ` $(value)');
    return { stdout: '{"ok":true,"data":{"applied":true}}' };
  } });
  await bridge.apply({ ...TARGET, title: '私有 ` $(value)' }, { 33: 2 }, 123, true);
  assert.equal(fs.existsSync(scriptFile), false); assert.equal(fs.existsSync(path.dirname(scriptFile)), false);
  assert.throws(() => bridge.apply(TARGET, { 34: 1 }, 123, true));
  assert.throws(() => bridge.apply(TARGET, { 33: 2 }, 0, true)); assert.equal(calls, 1);
  bridge.exec = async (_exe, args) => { scriptFile = args[args.indexOf('-File') + 1]; throw new Error('timeout'); };
  await assert.rejects(bridge.restore(TARGET, { 33: 0 }, 123), /timeout/); assert.equal(fs.existsSync(scriptFile), false);
});
