'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function matrixForYXZ(pitch, yaw, roll, scale = 1) {
  const cx = Math.cos(pitch), sx = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cz = Math.cos(roll), sz = Math.sin(roll);
  return {
    rows: 4,
    columns: 4,
    data: [
      (cy * cz + sx * sy * sz) * scale, (cx * sz) * scale, (cy * sx * sz - cz * sy) * scale, 0,
      (cz * sx * sy - cy * sz) * scale, (cx * cz) * scale, (cy * cz * sx + sy * sz) * scale, 0,
      (cx * sy) * scale, (-sx) * scale, (cx * cy) * scale, 0,
      0, 0, 0, 1,
    ],
  };
}

test('head transform is decomposed as a right-handed YXZ rotation', async () => {
  const { headRotationFromMatrix } = await import('../src/avatar/capture.mjs');
  const expected = { pitch: 0.3, yaw: -0.45, roll: 0.2 };
  const actual = headRotationFromMatrix(matrixForYXZ(expected.pitch, expected.yaw, expected.roll, 2.5));
  for (const axis of ['pitch', 'yaw', 'roll']) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-12, `${axis} differs`);
  }
});

test('invalid face transforms are rejected instead of emitting non-finite angles', async () => {
  const { headRotationFromMatrix } = await import('../src/avatar/capture.mjs');
  assert.equal(headRotationFromMatrix({ rows: 4, columns: 4, data: Array(16).fill(0) }), null);
  assert.equal(headRotationFromMatrix({ rows: 3, columns: 3, data: Array(9).fill(1) }), null);
  const invalid = matrixForYXZ(0, 0, 0);
  invalid.data[2] = NaN;
  assert.equal(headRotationFromMatrix(invalid), null);
});

test('smoothing factor is validated at the capture boundary', async () => {
  const { createAvatarCapture } = await import('../src/avatar/capture.mjs');
  for (const value of [0, -0.1, 1.1, NaN, Infinity]) {
    assert.throws(() => createAvatarCapture({ smoothingFactor: value }), /smoothingFactor/);
  }
  assert.doesNotThrow(() => createAvatarCapture({ smoothingFactor: 1 }));
});

test('camera permission failure resolves and emits a contract-safe undetected frame', async () => {
  const { createAvatarCapture } = await import('../src/avatar/capture.mjs');
  const originalNavigator = globalThis.navigator;
  const originalConsoleError = console.error;
  const frames = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('permission denied')) } },
  });
  console.error = () => {};

  try {
    const capture = createAvatarCapture();
    capture.subscribe((frame) => frames.push(frame));
    await assert.doesNotReject(capture.start());
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].blendshapes, {});
    assert.deepEqual(frames[0].headRotation, { pitch: 0, yaw: 0, roll: 0 });
    assert.equal(frames[0].detected, false);
    assert.equal(Number.isFinite(frames[0].timestampMs), true);
    assert.equal(Object.hasOwn(frames[0], 'confidence'), false);
  } finally {
    console.error = originalConsoleError;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});
