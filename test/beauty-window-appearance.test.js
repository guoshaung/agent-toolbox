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

function setupMany(t) {
  const { service, native } = setup(t);
  const targets = Array.from({ length: 3 }, (_, i) => ({ ...TARGET, hwnd: String(10001 + i), title: `Fixture ${i + 1}` }));
  const states = targets.map(() => ({ values: { 20: 0, 33: 1, 38: 0 }, marker: 0, restored: 0, closed: false }));
  const checked = (target, marker) => {
    const index = targets.findIndex(item => item.hwnd === target.hwnd); assert.ok(index >= 0); assert.deepEqual(target, targets[index]);
    const state = states[index]; if (state.closed) throw new Error('window closed');
    if (marker !== undefined && state.marker !== marker) throw new Error('marker mismatch');
    return state;
  };
  Object.assign(native, {
    enumerate: async () => clone(targets),
    capture: async (target, keys, marker) => { const state = checked(target, marker); return { marker: state.marker, values: Object.fromEntries(keys.map(key => [key, state.values[key]])) }; },
    apply: async (target, values, marker, bind) => { const state = checked(target, bind ? undefined : marker); assert.ok(service.read().records.some(item => item.target.hwnd === target.hwnd)); if (bind) { assert.equal(state.marker, 0); state.marker = marker; } Object.assign(state.values, values); },
    restore: async (target, values, marker) => { const state = checked(target, marker); Object.assign(state.values, values); state.restored++; },
    clearMarker: async (target, marker) => { const state = checked(target); assert.equal(service.read().records.find(item => item.target.hwnd === target.hwnd).phase, 'restored'); if (state.marker) checked(target, marker); state.marker = 0; },
    alive: async target => !states[targets.findIndex(item => item.hwnd === target.hwnd)].closed,
  });
  return { service, native, targets, states, refresh: async () => { await service.refresh(); return service.list().candidates.map(item => item.id); } };
}

test('restore all is read-only when empty and restores each window original values and marker', async t => {
  const { service, states, refresh } = setupMany(t);
  const empty = await service.restoreAll();
  assert.deepEqual(empty.restoreSummary, { attempted: 0, restored: [], failed: [], remaining: 0 });
  assert.equal(fs.existsSync(service.file), false);
  const ids = await refresh();
  await service.apply(ids[0], { dark: 'on', corners: 'round' }); await service.apply(ids[1], { material: 'mica' });
  const result = await service.restoreAll();
  assert.equal(result.restoreSummary.attempted, 2); assert.equal(result.restoreSummary.restored.length, 2);
  assert.deepEqual(result.restoreSummary.failed, []); assert.equal(result.records.length, 0);
  for (const state of states) { assert.deepEqual(state.values, { 20: 0, 33: 1, 38: 0 }); assert.equal(state.marker, 0); }
  assert.equal(states[2].restored, 0);
});

test('bulk recovery preserves failed marker/closed records, continues others, and can retry', async t => {
  const { service, states, refresh } = setupMany(t), ids = await refresh();
  for (const id of ids) await service.apply(id, { material: 'acrylic' });
  const marker = states[0].marker; states[0].marker++; states[1].closed = true;
  const result = await service.restoreAll();
  assert.equal(result.restoreSummary.restored.length, 1); assert.equal(result.restoreSummary.failed.length, 2);
  assert.match(result.restoreSummary.failed[0].error, /marker/); assert.match(result.restoreSummary.failed[1].error, /closed/);
  assert.equal(result.restoreSummary.remaining, 2); assert.equal(states[0].restored, 0); assert.equal(states[1].restored, 0);
  assert.equal(states[2].marker, 0); states[0].marker = marker;
  const retry = await service.restoreAll(); assert.equal(retry.restoreSummary.restored.length, 1); assert.equal(retry.restoreSummary.failed.length, 1);
  assert.equal(retry.records.length, 1); assert.equal(states[0].marker, 0);
  await service.forgetClosed(retry.records[0].id); assert.equal(service.list().records.length, 0);
});

test('bulk recovery and simultaneous new application serialize without restoring the new record', async t => {
  const { service, native, states, refresh } = setupMany(t), ids = await refresh();
  await service.apply(ids[0], { dark: 'on' }); await service.apply(ids[1], { corners: 'round' });
  const restore = native.restore; let started, release;
  const entered = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  native.restore = async (...args) => { started(); await gate; return restore(...args); };
  const restoring = service.restoreAll(); await entered;
  const later = service.apply(ids[2], { material: 'mica' });
  assert.equal(states[2].marker, 0); release();
  const result = await restoring; await later;
  assert.equal(result.restoreSummary.attempted, 2); assert.equal(result.restoreSummary.remaining, 0);
  assert.equal(service.list().records.length, 1); assert.equal(states[2].values[38], 2); assert.equal(states[2].restored, 0);
  await service.restoreAll(); assert.equal(states[2].marker, 0);
});

test('bulk recovery keeps disk-failed baseline and still restores independent windows', async t => {
  const { service, states, refresh } = setupMany(t), ids = await refresh();
  await service.apply(ids[0], { dark: 'on' }); await service.apply(ids[1], { material: 'mica' });
  const write = service.write.bind(service); let fail = true;
  service.write = data => { if (fail) { fail = false; throw new Error('disk full'); } write(data); };
  const result = await service.restoreAll();
  assert.equal(result.restoreSummary.restored.length, 1); assert.match(result.restoreSummary.failed[0].error, /disk full/);
  assert.equal(service.read().records.length, 1); assert.equal(service.read().records[0].values[20], 0);
  assert.notEqual(states[0].marker, 0); assert.equal(states[1].marker, 0);
  const retry = await service.restoreAll(); assert.equal(retry.restoreSummary.failed.length, 0); assert.equal(states[0].marker, 0);
});

test('bulk recovery isolates malformed values and refuses duplicate IDs before any affected write', async t => {
  const { service, states, refresh } = setupMany(t), ids = await refresh();
  for (const id of ids) await service.apply(id, { dark: 'on' });
  const data = service.read(); data.records[0].id = data.records[1].id; data.records[2].values[35] = 123; data.records.push(null); service.write(data);
  const result = await service.restoreAll();
  assert.equal(result.restoreSummary.failed.length, 4); assert.equal(result.restoreSummary.restored.length, 0);
  assert.equal(service.read().records.length, 4); assert.ok(states.every(state => state.restored === 0));
  states[0].closed = true; await assert.rejects(service.forgetClosed(data.records[0].id), /ID 重复/);
  assert.equal(service.read().records.length, 4);
});

test('applying a new change refuses duplicate backup IDs before losing another window record', async t => {
  const { service, states, refresh } = setupMany(t), ids = await refresh();
  await service.apply(ids[0], { dark: 'on' }); await service.apply(ids[1], { corners: 'round' });
  const data = service.read(); data.records[1].id = data.records[0].id; service.write(data);
  const before = service.read();
  await assert.rejects(service.apply(ids[0], { material: 'mica' }), /ID 重复/);
  assert.deepEqual(service.read(), before); assert.equal(states[0].values[38], 0);
});

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
  await assert.rejects(service.restoreAll(), /unsupported/);
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
