import test from 'node:test';
import assert from 'node:assert/strict';
import { fingers, numberOf, isFist, detectSnap, resetSnap } from '../src/gesture/hand-rules.mjs';

/**
 * 造一只手：手腕在 (0.5, 0.9)，手掌朝上，手指往上伸。
 * ext = 每根手指的伸展程度 0..1（0 = 完全握起，1 = 伸直）；thumbOut = 拇指是否张开。
 */
function hand({ index = 1, middle = 1, ring = 1, pinky = 1, thumbOut = false, indexHook = false, pinch3 = false } = {}) {
  const wrist = { x: 0.5, y: 0.9 };
  const palm = 0.2;
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }));
  lm[0] = wrist;
  const mcpX = { 5: 0.44, 9: 0.5, 13: 0.56, 17: 0.62 };
  for (const [mcp, x] of Object.entries(mcpX)) lm[mcp] = { x, y: wrist.y - palm };
  const finger = (mcp, ext) => {
    const base = lm[mcp];
    // 伸直：关节一路往上；握起：指尖折回到掌心附近
    const len = palm * 0.9;
    lm[mcp + 1] = { x: base.x, y: base.y - len * 0.35 };
    lm[mcp + 2] = { x: base.x, y: base.y - len * (0.35 + 0.3 * ext) };
    lm[mcp + 3] = ext > 0.5 ? { x: base.x, y: base.y - len } : { x: base.x, y: base.y - len * 0.2 };
  };
  finger(5, index); finger(9, middle); finger(13, ring); finger(17, pinky);
  if (indexHook) { lm[6] = { x: 0.44, y: wrist.y - palm - 0.09 }; lm[7] = { x: 0.44, y: wrist.y - palm - 0.11 }; lm[8] = { x: 0.44, y: wrist.y - palm - 0.06 }; }
  // 拇指：张开时甩到左边远处，收起时贴着食指根
  lm[1] = { x: 0.42, y: wrist.y - 0.04 };
  lm[2] = { x: 0.38, y: wrist.y - 0.09 };
  lm[3] = thumbOut ? { x: 0.3, y: wrist.y - 0.14 } : { x: 0.41, y: wrist.y - 0.13 };
  lm[4] = thumbOut ? { x: 0.22, y: wrist.y - 0.18 } : { x: 0.43, y: wrist.y - 0.16 };
  if (pinch3) { lm[4] = { x: 0.47, y: wrist.y - palm - 0.16 }; lm[8] = { x: 0.46, y: wrist.y - palm - 0.17 }; lm[12] = { x: 0.49, y: wrist.y - palm - 0.17 }; }
  return lm;
}

test('单手数字 1–6、8 按中国手势判', () => {
  const cases = [
    [1, { index: 1, middle: 0, ring: 0, pinky: 0 }],
    [2, { index: 1, middle: 1, ring: 0, pinky: 0 }],
    [3, { index: 1, middle: 1, ring: 1, pinky: 0 }],
    [4, { index: 1, middle: 1, ring: 1, pinky: 1 }],
    [5, { index: 1, middle: 1, ring: 1, pinky: 1, thumbOut: true }],
    [6, { index: 0, middle: 0, ring: 0, pinky: 1, thumbOut: true }],
    [8, { index: 1, middle: 0, ring: 0, pinky: 0, thumbOut: true }],
  ];
  for (const [expected, shape] of cases) assert.equal(numberOf(fingers(hand(shape))), expected, `应判成 ${expected}`);
});

test('7 是三指捏，9 是勾食指，握拳不是数字', () => {
  assert.equal(numberOf(fingers(hand({ index: 0, middle: 0, ring: 0, pinky: 0, pinch3: true }))), 7);
  assert.equal(numberOf(fingers(hand({ index: 0, middle: 0, ring: 0, pinky: 0, indexHook: true }))), 9);
  const fist = fingers(hand({ index: 0, middle: 0, ring: 0, pinky: 0 }));
  assert.equal(numberOf(fist), 0);
  assert.ok(isFist(fist));
});

test('响指：拇指中指先捏住再瞬间弹开', () => {
  resetSnap();
  const closed = hand({ index: 0, middle: 0, ring: 0, pinky: 0 });
  closed[4] = { x: 0.5, y: 0.7 }; closed[12] = { x: 0.51, y: 0.71 };            // 捏住
  assert.equal(detectSnap(closed, fingers(closed), 1000), false);
  const open = hand({ index: 0, middle: 1, ring: 0, pinky: 0, thumbOut: true }); // 中指弹出去、拇指甩开
  assert.equal(detectSnap(open, fingers(open), 1200), true);
  assert.equal(detectSnap(open, fingers(open), 1300), false, '1.2 秒内不重复触发');
});
