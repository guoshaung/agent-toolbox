import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck, normalizeSlide, normalizeBlock, stepCount, DECK_SYSTEM } from '../src/renderer/deck/model.js';

test('AI 给什么都不该崩：缺字段、乱类型、超长都能收拾干净', () => {
  const deck = normalizeDeck({ slides: [{ layout: '乱写的', title: 'x'.repeat(500), blocks: [{ type: '不存在' }] }] });
  assert.equal(deck.slides[0].layout, 'bullets', '不认识的 layout 退回 bullets');
  assert.equal(deck.slides[0].title.length, 90, '标题截断');
  assert.equal(deck.slides[0].blocks[0].type, 'text', '不认识的块退回 text');
  assert.equal(normalizeDeck({}).slides.length, 1, '一页都没有也要给一页');
  assert.equal(normalizeDeck({ theme: 'hotpink' }).theme, 'violet');
});

test('动画名只认白名单，乱填的退回 fade', () => {
  assert.equal(normalizeBlock({ type: 'text', anim: 'slide-left' }).anim, 'slide-left');
  assert.equal(normalizeBlock({ type: 'text', anim: 'backflip' }).anim, 'fade');
  assert.equal(normalizeBlock({ type: 'text' }, 0).step, 1, 'step 省略时按顺序');
  assert.equal(normalizeBlock({ type: 'text', step: 0 }).step, 0, '显式 0 = 跟标题一起出现');
});

test('图片只收 data: 和 file:，远程地址一律丢掉', () => {
  assert.equal(normalizeBlock({ type: 'image', src: 'https://example.com/a.png' }).src, '');
  assert.equal(normalizeBlock({ type: 'image', src: 'data:image/png;base64,AAAA' }).src, 'data:image/png;base64,AAAA');
  assert.equal(normalizeBlock({ type: 'image', src: 'file:///tmp/a.png' }).src, 'file:///tmp/a.png');
});

test('stepCount：逐条出现的要点每条各占一步', () => {
  const slide = normalizeSlide({ blocks: [{ type: 'bullets', step: 1, stagger: true, items: ['a', 'b', 'c'] }] });
  assert.equal(stepCount(slide), 3);
  const together = normalizeSlide({ blocks: [{ type: 'bullets', step: 1, stagger: false, items: ['a', 'b', 'c'] }] });
  assert.equal(stepCount(together), 1, '整体出现只占一步');
  assert.equal(stepCount(normalizeSlide({ blocks: [{ type: 'text', step: 0 }] })), 0, '只有 step 0 的页面不用点');
});

test('给 AI 的 schema 里，每种 layout 和块类型都有说明', () => {
  for (const layout of ['cover', 'bullets', 'flow', 'compare', 'stats', 'quote', 'image', 'closing']) {
    assert.ok(DECK_SYSTEM.includes(layout), `schema 里少了 layout ${layout}`);
  }
  for (const type of ['bullets', 'flow', 'compare', 'stats', 'quote', 'code', 'text']) {
    assert.ok(DECK_SYSTEM.includes(`"type":"${type}"`), `schema 里少了块 ${type}`);
  }
});

test('步骤自动重排：AI 标重的 step 会被拉开，每一步只发生一件事', async () => {
  const { normalizeSlide, stepCount, blockSpan } = await import('../src/renderer/deck/model.js');
  const slide = normalizeSlide({ blocks: [
    { type: 'compare', step: 1, columns: [{ head: 'A' }, { head: 'B' }] },   // 占 2 步
    { type: 'bullets', step: 2, stagger: true, items: ['x', 'y'] },          // AI 标了 2，会和第二栏撞
    { type: 'quote', step: 2, text: '结论' },
  ] });
  assert.deepEqual(slide.blocks.map((b) => b.step), [1, 3, 5], '按占用步数顺延');
  assert.equal(stepCount(slide), 5);
  assert.equal(blockSpan(slide.blocks[0]), 2);
});

test('step 0 的块不参与重排，永远跟标题一起出现', async () => {
  const { normalizeSlide, stepCount } = await import('../src/renderer/deck/model.js');
  const slide = normalizeSlide({ blocks: [
    { type: 'text', step: 0, text: '背景说明' },
    { type: 'bullets', step: 9, stagger: true, items: ['a', 'b'] },
  ] });
  assert.deepEqual(slide.blocks.map((b) => b.step), [0, 1]);
  assert.equal(stepCount(slide), 2);
});
