'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('科研画板曲线：弯度受控且自由端沿连线方向平滑', async () => {
  const { curveControlPoints, wirePath, wireEndpointDelta } = await import('../src/renderer/tools/research/figurewires.js');
  const controls = curveControlPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 'auto', 'auto', 1000);
  assert.ok(controls.extension <= controls.distance * 0.85);
  assert.ok(controls.c1.x > 0 && controls.c2.x < 200);
  assert.match(wirePath({
    route: 'curve',
    curveBend: 60,
    from: { id: 'a', port: 'right' },
    to: { id: 'b', port: 'left' },
  }, new Map([
    ['a', { id: 'a', x: 0, y: 0, width: 80, height: 60 }],
    ['b', { id: 'b', x: 240, y: 100, width: 80, height: 60 }],
  ])), /^M/);
  const delta = wireEndpointDelta({ from: { id: 'a', port: 'right' }, to: { id: 'b', port: 'left' } }, new Map([
    ['a', { id: 'a', x: 0, y: 0, width: 80, height: 60 }],
    ['b', { id: 'b', x: 240, y: 100, width: 80, height: 60 }],
  ]));
  assert.equal(delta.x, 160);
  assert.equal(delta.y, 100);
  assert.equal(delta.distance, Math.hypot(160, 100));
});

test('科研画板箭头：单向只输出一个箭头头部，双向才输出两个', async () => {
  const { arrowDefs } = await import('../src/renderer/tools/research/figureshapes.js');
  const { wireMarkup } = await import('../src/renderer/tools/research/figurewires.js');
  const byId = new Map([
    ['a', { id: 'a', x: 0, y: 0, width: 80, height: 60 }],
    ['b', { id: 'b', x: 220, y: 0, width: 80, height: 60 }],
  ]);
  const oneWay = wireMarkup({
    id: 'one', route: 'straight', from: { id: 'a', port: 'right' }, to: { id: 'b', port: 'left' }, arrowEnd: true, arrowStart: false,
  }, byId, { markerId: 'oneArrow' });
  const twoWay = wireMarkup({
    id: 'two', route: 'straight', from: { id: 'a', port: 'right' }, to: { id: 'b', port: 'left' }, arrowEnd: true, arrowStart: true,
  }, byId, { markerId: 'twoArrow' });
  assert.equal((oneWay.match(/marker-end=/g) || []).length, 1);
  assert.equal((oneWay.match(/marker-start=/g) || []).length, 0);
  assert.equal((twoWay.match(/marker-end=/g) || []).length, 1);
  assert.equal((twoWay.match(/marker-start=/g) || []).length, 1);
  assert.match(arrowDefs('#123456', 'oneArrow'), /id="oneArrowStart"/);
});
