'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKIN = [230, 160, 130];

function emptyFrame(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function paintDisc(frame, cx, cy, radius, color = SKIN) {
  const { data, width, height } = frame;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (Math.hypot(x - cx, y - cy) <= radius) {
      const offset = (y * width + x) * 4;
      data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
    }
  }
}

function paintFinger(frame, cx, cy, start, length, halfWidth, angleDeg) {
  const theta = angleDeg * Math.PI / 180;
  const dirX = Math.cos(theta); const dirY = Math.sin(theta);
  const perpX = -dirY; const perpY = dirX;
  const { data, width, height } = frame;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dx = x - cx; const dy = y - cy;
    const along = dx * dirX + dy * dirY;
    if (along < start || along > start + length) continue;
    if (Math.abs(dx * perpX + dy * perpY) > halfWidth) continue;
    const offset = (y * width + x) * 4;
    data[offset] = SKIN[0]; data[offset + 1] = SKIN[1]; data[offset + 2] = SKIN[2]; data[offset + 3] = 255;
  }
}

function openPalmFrame() {
  const frame = emptyFrame(160, 160);
  paintDisc(frame, 80, 80, 22);
  for (const angle of [90, 162, 234, 306, 18]) paintFinger(frame, 80, 80, 28, 45, 4, angle);
  return frame;
}

function fistFrame() {
  const frame = emptyFrame(160, 160);
  paintDisc(frame, 80, 80, 22);
  return frame;
}

function pointingFrame(angle = 90) {
  const frame = emptyFrame(160, 160);
  paintDisc(frame, 80, 80, 22);
  paintFinger(frame, 80, 80, 28, 45, 4, angle);
  return frame;
}

function scissorFrame() {
  const frame = emptyFrame(160, 160);
  paintDisc(frame, 80, 80, 22);
  for (const angle of [90, 150]) paintFinger(frame, 80, 80, 28, 45, 4, angle);
  return frame;
}

function toRgb(frame) {
  const { data, width, height } = frame;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return rgb;
}

test('isSkin 识别肤色并拒绝常见非肤色', async () => {
  const { isSkin } = await import('../src/renderer/tools/gesture/hand-cv.js');
  assert.equal(isSkin(230, 160, 130), true);
  assert.equal(isSkin(200, 140, 110), true);
  assert.equal(isSkin(255, 224, 189), true);
  assert.equal(isSkin(10, 200, 60), false, '绿色背景');
  assert.equal(isSkin(30, 40, 250), false, '蓝色背景');
  assert.equal(isSkin(0, 0, 0), false, '近黑');
  assert.equal(isSkin(0, 0, 0, { yMin: 0 }), false, 'RGB 规则仍拒绝纯黑');
  assert.equal(isSkin(0, 0, 0, { method: 'ycbcr', yMin: 0, cbMin: 0, cbMax: 300, crMin: 0, crMax: 300 }), true);
  assert.equal(isSkin(1), false, '缺通道返回 false');
});

test('createSkinMask 在合成帧里找出手部区域', async () => {
  const { createSkinMask } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const frame = emptyFrame(40, 30);
  paintDisc(frame, 18, 14, 6);
  const mask = createSkinMask(frame.data, 40, 30);
  assert.equal(mask.width, 40);
  assert.equal(mask.height, 30);
  assert.ok(mask.count > 100 && mask.count < 140, `圆盘像素数 ${mask.count} 应约等于 π*36`);
  assert.equal(mask.data.reduce((sum, value) => sum + value, 0), mask.count);
});

test('createSkinMask 兼容 RGB 三通道输入', async () => {
  const { createSkinMask } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const frame = emptyFrame(40, 30);
  paintDisc(frame, 18, 14, 6);
  const rgba = createSkinMask(frame.data, 40, 30);
  const rgb = createSkinMask(toRgb(frame), 40, 30);
  assert.equal(rgb.count, rgba.count);
});

test('handRegion 计算质心与包围盒，空掩膜返回 null', async () => {
  const { createSkinMask, handRegion } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const frame = emptyFrame(30, 24);
  for (let y = 6; y <= 16; y += 1) for (let x = 4; x <= 14; x += 1) {
    const offset = (y * 30 + x) * 4;
    frame.data[offset] = SKIN[0]; frame.data[offset + 1] = SKIN[1]; frame.data[offset + 2] = SKIN[2]; frame.data[offset + 3] = 255;
  }
  const mask = createSkinMask(frame.data, 30, 24);
  const region = handRegion(mask.data, 30, 24);
  assert.ok(region);
  assert.ok(Math.abs(region.cx - 9) < 0.01);
  assert.ok(Math.abs(region.cy - 11) < 0.01);
  assert.deepEqual(region.bbox, { x: 4, y: 6, width: 11, height: 11 });
  assert.equal(region.solidity, 1);
  assert.equal(handRegion(new Uint8Array(30 * 24), 30, 24), null);
});

test('findFingertips 在张开手掌上找到 5 个指尖', async () => {
  const { createSkinMask, handRegion, findFingertips } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const frame = openPalmFrame();
  const mask = createSkinMask(frame.data, 160, 160);
  const region = handRegion(mask.data, 160, 160);
  const info = findFingertips(mask.data, 160, 160, region);
  assert.equal(info.points.length, 5, '张开手掌应有 5 个指尖');
  const angles = info.points.map((point) => point.angleDeg).sort((a, b) => a - b);
  const expected = [18, 90, 162, 234, 306];
  angles.forEach((angle, index) => {
    const expectedNormalized = expected[index] < 180 ? expected[index] : expected[index];
    assert.ok(Math.abs(angle - expectedNormalized) <= 6, `指尖角度 ${angle} 应接近 ${expectedNormalized}`);
  });
  const tipsAway = info.points.every((point) => point.distance > 60);
  assert.equal(tipsAway, true, '指尖点应落在手指末梢（远离质心）');
});

test('findFingertips 在拳头 / 未抬手时不产生指尖', async () => {
  const { createSkinMask, handRegion, findFingertips } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const frame = fistFrame();
  const mask = createSkinMask(frame.data, 160, 160);
  const region = handRegion(mask.data, 160, 160);
  const info = findFingertips(mask.data, 160, 160, region);
  assert.equal(info.points.length, 0, '仅手掌圆盘不应检测到手指');
  assert.ok(info.spreadRatio < 0.3, `拳头掌心外像素占比 ${info.spreadRatio} 应较小`);
});

test('classifyGesture 区分拳头 / 张手 / 指人 / 剪刀', async () => {
  const cv = await import('../src/renderer/tools/gesture/hand-cv.js');
  const classify = (frame) => {
    const mask = cv.createSkinMask(frame.data, 160, 160);
    const region = cv.handRegion(mask.data, 160, 160);
    const info = cv.findFingertips(mask.data, 160, 160, region);
    return cv.classifyGesture(region, info);
  };
  assert.equal(classify(fistFrame()).gesture, cv.GESTURES.FIST);
  assert.ok(classify(fistFrame()).confidence > 0.6);
  assert.equal(classify(openPalmFrame()).gesture, cv.GESTURES.OPEN);
  assert.equal(classify(openPalmFrame()).confidence, 1);
  assert.equal(classify(pointingFrame()).gesture, cv.GESTURES.POINTING);
  assert.equal(classify(scissorFrame()).gesture, cv.GESTURES.SCISSOR);
});

test('analyzeFrame 全流程：张开手掌识别、空画面报 none', async () => {
  const { analyzeFrame, GESTURES } = await import('../src/renderer/tools/gesture/hand-cv.js');
  const result = analyzeFrame(openPalmFrame());
  assert.equal(result.present, true);
  assert.equal(result.gesture, GESTURES.OPEN);
  assert.equal(result.fingertips.length, 5);
  assert.ok(result.region.count > 1000);

  const absent = analyzeFrame(emptyFrame(160, 160));
  assert.equal(absent.present, false);
  assert.equal(absent.gesture, GESTURES.NONE);
  assert.equal(absent.fingertips.length, 0);
});

test('纯模块不依赖 DOM 或 Electron', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'gesture', 'hand-cv.js'), 'utf8');
  const forbidden = [
    /window\./, /document\./, /documentElement/, /getElementById/, /querySelector/,
    /addEventListener/, /navigator\./, /localStorage/, /new Image/, /canvas/i,
    /require\(/, /from['"]electron['"]/, /webkitGetUserMedia/, /getUserMedia/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `不应包含 ${pattern}`);
  }
});