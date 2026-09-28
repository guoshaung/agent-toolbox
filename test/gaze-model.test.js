'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { poseFromMatrix, featuresFrom, fitRidge, predict, residual, OneEuro, Attention, IDX } = require('../src/main/gaze-model');

function fakeLandmarks({ irisDx = 0, irisDy = 0 } = {}) {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i, x, y) => { pts[i] = { x, y, z: 0 }; };
  set(IDX.leftOuter, 0.30, 0.45); set(IDX.leftInner, 0.42, 0.45); set(IDX.leftUp, 0.36, 0.43); set(IDX.leftDown, 0.36, 0.47); set(IDX.leftIris, 0.36 + irisDx, 0.45 + irisDy);
  set(IDX.rightInner, 0.58, 0.45); set(IDX.rightOuter, 0.70, 0.45); set(IDX.rightUp, 0.64, 0.43); set(IDX.rightDown, 0.64, 0.47); set(IDX.rightIris, 0.64 + irisDx, 0.45 + irisDy);
  set(IDX.noseTip, 0.5, 0.55);
  return pts;
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1];

test('视线：姿态矩阵 → 欧拉角，特征向量长度固定', () => {
  const pose = poseFromMatrix(identity);
  assert.ok(pose.ok); assert.ok(Math.abs(pose.yaw) < 1e-9); assert.ok(Math.abs(pose.pitch) < 1e-9); assert.equal(pose.tz, -50);
  const f = featuresFrom(fakeLandmarks(), identity);
  assert.equal(f.vec.length, 17); assert.equal(f.vec[0], 1);
  assert.ok(f.eyeOpen > 0);
  assert.equal(featuresFrom([], identity), null);
});

test('视线：岭回归能把虹膜偏移学成屏幕坐标', () => {
  const samples = [];
  for (let gx = 0; gx <= 1; gx += 0.25) for (let gy = 0; gy <= 1; gy += 0.25) {
    for (let k = 0; k < 3; k += 1) {
      const f = featuresFrom(fakeLandmarks({ irisDx: (gx - 0.5) * 0.06 + (k - 1) * 0.001, irisDy: (gy - 0.5) * 0.03 }), identity);
      samples.push({ x: f.vec, y: [gx, gy] });
    }
  }
  const W = fitRidge(samples, 0.5);
  assert.ok(W && W.W && W.mu && W.sigma);
  const probe = featuresFrom(fakeLandmarks({ irisDx: 0.015, irisDy: -0.0075 }), identity);
  const [px, py] = predict(W, probe.vec);
  assert.ok(Math.abs(px - 0.75) < 0.08, `px=${px}`);
  assert.ok(Math.abs(py - 0.25) < 0.08, `py=${py}`);
  assert.ok(residual(W, samples) < 0.05);
  // 边缘也够得到：看最右边时预测不该缩回中间
  const edge = featuresFrom(fakeLandmarks({ irisDx: 0.03, irisDy: 0 }), identity);
  assert.ok(predict(W, edge.vec)[0] > 0.92, `edge=${predict(W, edge.vec)[0]}`);
  // 旧存档的裸 W 也还能用
  assert.ok(Array.isArray(predict(W.W, probe.vec)));
  assert.equal(fitRidge(samples.slice(0, 3)), null, '样本太少不拟合');
});

test('视线：一欧元滤波静止时收敛、跳变时跟上', () => {
  const f = new OneEuro({ minCutoff: 1, beta: 0.05 });
  let v = 0;
  for (let i = 0; i < 30; i += 1) v = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33);
  assert.ok(Math.abs(v - 0.5) < 0.01);
  for (let i = 30; i < 60; i += 1) v = f.filter(0.9, i * 33);
  assert.ok(Math.abs(v - 0.9) < 0.03, `v=${v}`);
});

test('视线：注意力状态机', () => {
  const a = new Attention({ awaySec: 3, distractSec: 6, phoneSec: 3, tiredSec: 4 });
  const look = (t) => a.update({ t, present: true, gaze: [0.5, 0.5], yaw: 0, pitch: 0, eyeOpen: 0.3 });
  for (let t = 0; t < 2000; t += 100) look(t);
  assert.equal(a.state, 'looking');
  for (let t = 2000; t < 9000; t += 100) a.update({ t, present: true, gaze: [1.5, 0.5], yaw: 0, pitch: 0, eyeOpen: 0.3 });
  assert.equal(a.state, 'distracted');
  look(9100); assert.equal(a.state, 'looking');
  for (let t = 9200; t < 13000; t += 100) a.update({ t, present: true, gaze: [0.5, 1.0], yaw: 0, pitch: -30, eyeOpen: 0.3 });
  assert.equal(a.state, 'phone');
  for (let t = 13000; t < 17000; t += 100) a.update({ t, present: false });
  assert.equal(a.state, 'away');
  for (let t = 17000; t < 18000; t += 100) look(t);
  for (let t = 18000; t < 23000; t += 100) a.update({ t, present: true, gaze: [0.5, 0.5], yaw: 0, pitch: 0, eyeOpen: 0.12 });
  assert.equal(a.state, 'tired');
});
