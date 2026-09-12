'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('视频工具：智能尺寸与缩放的纯数值逻辑', async () => {
  const m = await import('../src/renderer/tools/video/zoom-math.js');
  const {
    ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, clamp, zoomStep,
    wheelDeltaPixels, wheelZoomFactor, applyZoom,
    smartBaseWidth, playerWidth, playerHeight, formatPercent,
  } = m;

  // 夹取与步进
  assert.equal(clamp(3, 0.5, 2), 2);
  assert.equal(clamp(0.1, 0.5, 2), 0.5);
  assert.equal(clamp(1, 0.5, 2), 1);
  assert.equal(zoomStep(1, 1), 1.15);
  assert.equal(zoomStep(1, -1), 1 - ZOOM_STEP);
  assert.equal(zoomStep(ZOOM_MAX, 1), ZOOM_MAX);   // 放大到上限不再越界
  assert.equal(zoomStep(ZOOM_MIN, -1), ZOOM_MIN);  // 缩小到下限不再越界

  // 滚轮 deltaMode 统一成像素
  assert.equal(wheelDeltaPixels(3, 1), 99);
  assert.equal(wheelDeltaPixels(2, 2), 1600);
  assert.equal(wheelDeltaPixels(-12, 0), -12);

  // 方向上滚放大、下滚缩小、0 不变
  assert.ok(wheelZoomFactor(-100, 0) > 1, '上滚应放大');
  assert.ok(wheelZoomFactor(100, 0) < 1, '下滚应缩小');
  assert.ok(Math.abs(wheelZoomFactor(0, 0) - 1) < 1e-9, '零增量不缩放');
  assert.ok(wheelZoomFactor(99, 1) < 1, '以行计量的增量同样缩小');

  // 应用系数后夹取
  assert.equal(Math.abs(applyZoom(1, 0.9) - 0.9) < 1e-9, true);
  assert.equal(applyZoom(ZOOM_MAX, 1.5), ZOOM_MAX);
  assert.equal(applyZoom(ZOOM_MIN, 0.5), ZOOM_MIN);

  // 智能尺寸：以 92% 窗口宽为基准
  assert.equal(smartBaseWidth(1000), 920);
  assert.equal(playerWidth({ naturalWidth: 672, viewportWidth: 1000, scale: 1, smart: true }), 920);

  // 关闭智能尺寸：以原始宽度为基准乘缩放
  assert.equal(playerWidth({ naturalWidth: 672, viewportWidth: 1000, scale: 1, smart: false }), 672);
  assert.equal(playerWidth({ naturalWidth: 672, viewportWidth: 1000, scale: 1.5, smart: false }), 1008);

  // 下限保护：原始 672×50% = 336 > 220，不受最小宽度影响；故意给极小自然宽测下限
  assert.equal(playerWidth({ naturalWidth: 200, viewportWidth: 1000, scale: 1, smart: false, minWidth: 220 }), 220);

  // 上限保护：智能尺寸下再放大不能超过视口 1.5 倍和自然宽上限
  const cap = playerWidth({ naturalWidth: 672, viewportWidth: 1000, scale: 2, smart: true });
  assert.ok(cap <= 1000 * 1.5, `智能尺寸放大不应超过视口 1.5 倍，实际 ${cap}`);

  // 16:9 高度推算
  assert.equal(playerHeight(1008, 672, 378), 567);
  assert.equal(playerHeight(1920, 0, 0), 1080); // 未知比例按 16:9

  // 百分比文案
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(1.155), '116%');
  assert.equal(formatPercent(0.5), '50%');
});