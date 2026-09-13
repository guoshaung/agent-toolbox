'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBounds, isProtectedWindow, canApplyGesture } = require('../src/main/window-gesture');

const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 24, width: 1920, height: 1056 } };

test('computes fullscreen and work-area snap bounds', () => {
  assert.deepEqual(computeBounds('fullscreen', display), display.bounds);
  assert.deepEqual(computeBounds('snap-left', display), { x: 0, y: 24, width: 960, height: 1056 });
  assert.deepEqual(computeBounds('snap-right', display), { x: 960, y: 24, width: 960, height: 1056 });
});

test('applies inset and gap while rejecting invalid gestures', () => {
  assert.deepEqual(computeBounds('snap-left', display, { inset: 10, gap: 20 }), { x: 10, y: 34, width: 930, height: 1036 });
  assert.equal(computeBounds('diagonal', display), null);
  assert.equal(computeBounds('snap-left', { workArea: { x: 0, y: 0, width: 100, height: 100 } }, { minimumSize: 120 }), null);
});

test('protects the toolbox and current process windows', () => {
  assert.equal(isProtectedWindow({ name: 'Agent Toolbox' }), true);
  assert.equal(isProtectedWindow({ pid: 42 }, { currentPid: 42 }), true);
  assert.equal(isProtectedWindow({ name: 'Microsoft Edge', pid: 7 }, { currentPid: 42 }), false);
  assert.equal(canApplyGesture({ name: 'Microsoft Edge' }, { gesture: 'snap-right', display }), true);
  assert.equal(canApplyGesture({ name: 'Agent Toolbox' }, { gesture: 'snap-right', display }), false);
});
