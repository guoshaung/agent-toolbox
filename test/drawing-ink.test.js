'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pressure, smooth, ribbon, InputGuard } = require('../src/drawing/ink');
const event = (type, id, width = 5) => ({ pointerType: type, pointerId: id, width, height: width });
test('Pencil takes priority; palm cannot pan, zoom or ink during and shortly after pen input', () => {
  const guard = new InputGuard();
  assert.equal(guard.begin(event('pen', 1), 100), 'pen');
  assert.equal(guard.begin(event('touch', 2, 60), 101), 'ignore');
  assert.equal(guard.begin(event('touch', 3), 102), 'ignore');
  guard.end(event('pen', 1), 200);
  assert.equal(guard.begin(event('touch', 4), 700), 'ignore');
  for (const n of [2, 3, 4]) guard.end(event('touch', n), 701);
  assert.equal(guard.begin(event('touch', 5), 900), 'navigation');
  assert.equal(guard.begin(event('touch', 6), 910), 'gesture');
});
test('third finger blocks gestures until contacts lift; pen cancels an existing touch gesture', () => {
  const guard = new InputGuard();
  guard.begin(event('touch', 1), 10); guard.begin(event('touch', 2), 20);
  assert.equal(guard.begin(event('touch', 3), 30), 'ignore'); assert.equal(guard.blocked.size, 3);
  for (let n = 1; n <= 3; n++) guard.end(event('touch', n), 40);
  assert.equal(guard.begin(event('touch', 4), 50), 'navigation');
  assert.equal(guard.begin(event('pen', 5), 60), 'pen'); assert.equal(guard.touches.size, 0); assert.ok(guard.blocked.has(4));
});
test('explicit finger drawing is supported without weakening active Pencil exclusion', () => {
  const guard = new InputGuard({ pencilOnly: false });
  assert.equal(guard.begin(event('touch', 1), 1), 'touch');
  guard.begin(event('pen', 2), 2); assert.equal(guard.begin(event('mouse', 3), 3), 'ignore');
  guard.reset(10); assert.equal(guard.pen, null); assert.equal(guard.touches.size, 0);
});
test('pressure response is finite, bounded, monotonic and adjustable', () => {
  for (const sensitivity of [.35, 1, 2.5]) { let previous = 0; for (let i = 0; i <= 100; i++) { const value = pressure(i / 100, sensitivity); assert.ok(value >= previous && value >= .18 && value <= 1); previous = value; } }
  assert.ok(pressure(.2, .5) > pressure(.2, 2)); assert.ok(Number.isFinite(pressure(NaN)));
});
test('smoothing preserves real endpoints, does not mutate raw pressure samples, and ribbon never creates NaNs', () => {
  const points = [[0, 0, .1], [2, 1, .2], [3, -1, .4], [5, 0, .9], [20, 2, 1]], original = structuredClone(points);
  const filtered = smooth(points, .7); assert.deepEqual(filtered[0], points[0]); assert.deepEqual(filtered.at(-1).slice(0, 2), points.at(-1).slice(0, 2)); assert.deepEqual(points, original);
  for (const p of [points, [[1, 1, .4]], [[0, 0, 0], [0, 0, 1]]]) { const result = ribbon(p, 4); assert.ok(result.outline.length > 0); assert.ok(result.outline.flat().every(Number.isFinite)); }
});
