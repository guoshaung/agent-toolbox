'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('mock avatar frames follow the shared contract and vary smoothly', async () => {
  const { generateMockAvatarFrame } = await import('../src/avatar/mock-avatar-frame.mjs');
  const first = generateMockAvatarFrame(0);
  const next = generateMockAvatarFrame(100);

  assert.equal(first.detected, true);
  assert.equal(next.detected, true);
  assert.equal('detectionStatus' in first, false);
  assert.equal(first.timestampMs, 0);
  assert.equal(next.timestampMs, 100);
  assert.ok(first.blendshapes.jawOpen >= 0 && first.blendshapes.jawOpen <= 1);
  assert.ok(next.blendshapes.jawOpen >= 0 && next.blendshapes.jawOpen <= 1);
  assert.notEqual(next.blendshapes.jawOpen, first.blendshapes.jawOpen);
  assert.notEqual(next.headRotation.yaw, first.headRotation.yaw);
  assert.ok(Math.abs(next.headRotation.yaw - first.headRotation.yaw) < 0.1);
});

test('mock generator uses its injected monotonic clock', async () => {
  const { createMockAvatarFrameGenerator } = await import('../src/avatar/mock-avatar-frame.mjs');
  let timestampMs = 250;
  const nextFrame = createMockAvatarFrameGenerator(() => timestampMs);

  assert.equal(nextFrame().timestampMs, 250);
  timestampMs = 500;
  assert.equal(nextFrame().timestampMs, 500);
});

test('mock frames keep finite rotation and blendshape values within contract bounds', async () => {
  const { generateMockAvatarFrame } = await import('../src/avatar/mock-avatar-frame.mjs');
  const timestamps = Array.from({ length: 601 }, (_, index) => index * 100);
  timestamps.push(Number.MAX_SAFE_INTEGER, Number.MAX_VALUE);

  for (const timestampMs of timestamps) {
    const frame = generateMockAvatarFrame(timestampMs);
    assert.equal(frame.detected, true);
    for (const [axis, limit] of [['pitch', Math.PI / 2], ['yaw', Math.PI], ['roll', Math.PI]]) {
      const angle = frame.headRotation[axis];
      assert.ok(Number.isFinite(angle), `${axis} must be finite at ${timestampMs}`);
      assert.ok(angle >= -limit && angle <= limit, `${axis} is outside its range at ${timestampMs}`);
    }
    for (const weight of Object.values(frame.blendshapes)) {
      assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
    }
  }
});

test('a detected mock frame can omit unavailable confidence', async () => {
  const { generateMockAvatarFrame } = await import('../src/avatar/mock-avatar-frame.mjs');
  const frame = generateMockAvatarFrame(1000);

  assert.equal(frame.detected, true);
  assert.equal(Object.hasOwn(frame, 'confidence'), false);
});

test('mock generator rejects non-finite timestamps instead of emitting invalid rotations', async () => {
  const { generateMockAvatarFrame } = await import('../src/avatar/mock-avatar-frame.mjs');
  for (const timestampMs of [NaN, Infinity, -Infinity]) {
    assert.throws(() => generateMockAvatarFrame(timestampMs), /timestampMs must be a finite number/);
  }
});
