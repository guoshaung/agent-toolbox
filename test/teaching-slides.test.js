'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateStoryboard, generateTeachingSlides, SLIDE_COUNT } = require('../src/main/teaching-slides');

test('teaching slides：生成五页完整 storyboard', () => {
  const slides = generateStoryboard('Transformer Encoder');
  assert.equal(slides.length, SLIDE_COUNT);
  assert.deepEqual(slides.map((s) => s.id), ['overview', 'background', 'mechanism', 'process', 'summary']);
  for (const slide of slides) {
    assert.ok(slide.title);
    assert.ok(Array.isArray(slide.bullets) && slide.bullets.length >= 3);
    assert.match(slide.imagePrompt, /Transformer Encoder/);
    assert.match(slide.imagePrompt, /16:9/);
  }
});

test('teaching slides：空主题有安全默认值', () => {
  const slides = generateStoryboard('');
  assert.equal(slides.length, 5);
  assert.ok(slides.every((s) => s.topic === '本主题'));
});

test('teaching slides：五张图片并发生成，单张失败不影响其他结果', async () => {
  const calls = [];
  const imageClient = {
    generateImages: async (prompts, options) => {
      calls.push({ prompts, options });
      return prompts.map((_, i) => i === 2
        ? { ok: false, error: 'simulated failure', meta: {} }
        : { ok: true, meta: { filePath: `slide-${i}.png`, elapsedMs: 10 + i, usage: { total_tokens: 10 } } });
    },
  };
  const result = await generateTeachingSlides('Attention', { outputDir: 'tmp', imageClient, concurrency: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompts.length, 5);
  assert.equal(calls[0].options.concurrency, 2);
  assert.equal(calls[0].options.size, '1536x864');
  assert.equal(result.ok, false);
  assert.equal(result.succeeded, 4);
  assert.equal(result.slides[2].imageOk, false);
  assert.equal(result.slides[0].filePath, 'slide-0.png');
});

test('teaching slides：缺少依赖时返回明确错误', async () => {
  assert.match((await generateTeachingSlides('x', { outputDir: 'tmp' })).error, /imageClient/);
  assert.match((await generateTeachingSlides('x', { imageClient: {} })).error, /outputDir/);
});