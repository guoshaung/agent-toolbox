'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('科研画板所有内置形状都输出有限坐标的 SVG', async () => {
  const { SHAPES, PIE_COLORS, shapeMarkup } = await import('../src/renderer/tools/research/figureshapes.js');
  for (const type of Object.keys(SHAPES)) {
    const markup = shapeMarkup({
      type,
      width: 180,
      height: 100,
      radius: 12,
      strokeWidth: 3,
      fill: '#dce8ff',
      stroke: '#3d6fe8',
      slices: 6,
      sliceColors: PIE_COLORS,
    });
    assert.match(markup, /^</, `${type} 应输出 SVG 节点`);
    assert.equal(/NaN|Infinity|undefined/.test(markup), false, `${type} 不应包含非法数值`);
  }
});

test('科研画板线条和箭头 marker 在无效尺寸输入下仍可导出', async () => {
  const { LINES, arrowDefs, lineMarkup } = await import('../src/renderer/tools/research/figureshapes.js');
  for (const type of Object.keys(LINES)) {
    const markup = lineMarkup({ type, width: 'bad', height: NaN, strokeWidth: 0, stroke: '#14213d' }, `line-${type}`);
    assert.equal(/NaN|Infinity|undefined/.test(markup), false, `${type} 线条不应包含非法数值`);
  }
  for (const style of ['fine', 'standard', 'bold', 'unknown']) {
    const defs = arrowDefs('#14213d', `arrow-${style}`, style);
    assert.match(defs, /<marker/);
    assert.equal(/NaN|Infinity|undefined/.test(defs), false);
  }
});

test('科研画板网格和点阵背景始终包含可复用的 pattern 定义', async () => {
  const { backgroundDefs } = await import('../src/renderer/tools/research/figureshapes.js');
  assert.match(backgroundDefs('grid'), /id="fbBg"/);
  assert.match(backgroundDefs('grid'), /<path/);
  assert.match(backgroundDefs('dots'), /id="fbBg"/);
  assert.match(backgroundDefs('dots'), /<circle/);
  assert.equal(backgroundDefs('transparent'), '');
});
