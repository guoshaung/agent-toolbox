'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('ARKit mouth controls collapse to one dominant VRM vowel', async () => {
  const { collapseArkitBlendshapes } = await import('../src/avatar/vrm-expression-map.mjs');
  const open = collapseArkitBlendshapes({ jawOpen: 0.9, mouthFunnel: 0.05 });
  const roundedOpen = collapseArkitBlendshapes({ jawOpen: 0.8, mouthFunnel: 0.9 });
  const roundedClosed = collapseArkitBlendshapes({ jawOpen: 0.1, mouthPucker: 0.95 });

  assert.equal(open.aa > 0.7, true);
  assert.equal(roundedOpen.oh > 0.7, true);
  assert.equal(roundedClosed.ou > 0.8, true);
  for (const result of [open, roundedOpen, roundedClosed]) {
    assert.equal(['aa', 'ih', 'ou', 'ee', 'oh'].filter((name) => name in result).length, 1);
  }
});

test('lip closure suppresses the inferred vowel', async () => {
  const { collapseArkitBlendshapes } = await import('../src/avatar/vrm-expression-map.mjs');
  const open = collapseArkitBlendshapes({ jawOpen: 1 });
  const closed = collapseArkitBlendshapes({ jawOpen: 1, mouthClose: 1 });
  assert.equal(open.aa > closed.aa, true);
});

test('paired ARKit signals aggregate into VRM emotions and directional presets', async () => {
  const { collapseArkitBlendshapes } = await import('../src/avatar/vrm-expression-map.mjs');
  const result = collapseArkitBlendshapes({
    mouthSmileLeft: 1,
    mouthSmileRight: 0.8,
    browDownLeft: 0.8,
    browDownRight: 0.6,
    eyeBlinkLeft: 1,
    eyeLookOutLeft: 0.8,
    eyeLookInRight: 0.6,
  });

  assert.equal(result.happy, 0.9);
  assert.equal(result.angry > 0.4, true);
  assert.equal(result.blinkLeft, 1);
  assert.equal(result.lookLeft, 0.7);
  assert.equal(result.blinkRight, undefined);
});

test('all emitted VRM weights are finite and clamped', async () => {
  const { collapseArkitBlendshapes } = await import('../src/avatar/vrm-expression-map.mjs');
  const result = collapseArkitBlendshapes({
    jawOpen: 5,
    mouthSmileLeft: Infinity,
    mouthSmileRight: 3,
    eyeBlinkLeft: -2,
    browInnerUp: NaN,
    eyeWideLeft: 4,
    eyeWideRight: 4,
  });
  for (const weight of Object.values(result)) {
    assert.equal(Number.isFinite(weight) && weight > 0 && weight <= 1, true);
  }
});
