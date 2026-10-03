'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AppControls } = require('../src/main/app-controls');

class Window extends EventEmitter {
  constructor() { super(); this.webContents = new EventEmitter(); this.hidden = 0; this.destroyed = false; }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  loadURL() {}
  isDestroyed() { return this.destroyed; }
  hide() { this.hidden++; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}
function fixture() {
  const writes = [], values = new Map();
  const c = new AppControls({ platform: 'win32', BrowserWindow: Window, store: { get: (k, d) => values.has(k) ? values.get(k) : d, set: (k,v) => values.set(k,v) } });
  c.altTabProcess = { stdin: { writable: true, write: s => writes.push(s) }, kill() {} };
  c.altTabHookState = 'running';
  return { c, writes, values };
}
test('click uses selected window handle and finishes exactly once when commit arrives late', () => {
  const { c, writes } = fixture();
  const w = c.ensureAltTabOverlay();
  c.altTabItems = [{ handle: '111' }, { handle: '222' }];
  w.webContents.emit('page-title-updated', { preventDefault() {} }, 'toolbox:hover:1:1');
  w.webContents.emit('page-title-updated', { preventDefault() {} }, 'toolbox:activate:222:2');
  c.handleAltTabOutput('COMMIT\n');
  assert.deepEqual(writes.filter(s => s.startsWith('ACTIVATE')), ['ACTIVATE\t222\n']);
  assert.ok(writes.includes('RESET\n'));
  assert.equal(c.altTabItems.length, 0);
  c.dispose();
});
test('cancel hides overlay and resets native state without activating a window', () => {
  const { c, writes } = fixture(); const w = c.ensureAltTabOverlay();
  c.altTabItems = [{ handle: '111' }]; c.commitAltTab(true);
  assert.deepEqual(writes, ['RESET\n']); assert.equal(w.hidden, 1); c.dispose();
});
test('same-application cycle reuses running helper and waits for one native result', async () => {
  const { c, writes } = fixture(), results = []; c.onResult = r => results.push(r);
  c.run = () => assert.fail('must not start a per-key probe');
  assert.deepEqual(await c.cycleWindows(), { ok: true, pending: true });
  c.handleAltTabOutput('CYCL'); c.handleAltTabOutput('ED\t1\t222\n');
  assert.deepEqual(writes, ['CYCLE\n']); assert.deepEqual(results, [{ ok: true, action: 'cycle' }]); c.dispose();
});
test('Alt Tab switch persists independently from the close/cycle switch', () => {
  const { c, values } = fixture(); c.setAltTabEnabled(true);
  assert.equal(values.get('appControls.altTabEnabled'), true); assert.equal(c.enabled(), false);
  c.startAltTabHook = () => true;
  const registered = []; const state = c.register({ unregister() {}, register(k) { registered.push(k); return true; } });
  assert.equal(state.altTabRegistered, true); assert.equal(state.registered, true); assert.deepEqual(registered, []); c.dispose();
});
test('dispose stops helper and releases overlay and pending timeout', () => {
  const { c, writes } = fixture(), w = c.ensureAltTabOverlay(); c.altTabFailsafeTimer = setTimeout(() => assert.fail('disposed timer'), 1000);
  c.altTabItems = [{ handle: '111' }]; c.dispose();
  assert.ok(writes.includes('STOP\n')); assert.equal(w.destroyed, true); assert.equal(c.altTabFailsafeTimer, null); assert.equal(c.altTabProcess, null);
});
