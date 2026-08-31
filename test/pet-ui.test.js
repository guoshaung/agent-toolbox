'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('详细拆解按钮紧邻结论、默认隐藏并使用明确文案', () => {
  const html = fs.readFileSync(path.join(root, 'src/pet/index.html'), 'utf8');
  const answerAt = html.indexOf('id="answer"');
  const toggleAt = html.indexOf('id="supplement-toggle"');
  const panelAt = html.indexOf('id="supplement"');
  assert.ok(answerAt >= 0 && toggleAt > answerAt && panelAt > toggleAt);
  assert.match(html, /id="supplement-toggle"[^>]*hidden>查看语法拆解与例子 ↓<\/button>/);
  assert.match(html, /id="font-minus"[^>]*aria-label="减小知识卡字号"/);
  assert.match(html, /id="font-plus"[^>]*aria-label="增大知识卡字号"/);
});

test('详细区有固定滚动高度，展开按钮有足够点击高度和可见对比', () => {
  const css = fs.readFileSync(path.join(root, 'src/pet/pet.css'), 'utf8');
  assert.match(css, /\.supplement-toggle\s*\{[^}]*min-height:\s*42px[^}]*border:\s*1px solid[^}]*background:/s);
  assert.match(css, /\.supplement\s*\{[^}]*max-height:\s*210px[^}]*overflow-y:\s*auto/s);
  assert.match(css, /data-font-level="compact"/);
  assert.match(css, /data-font-level="standard"/);
  assert.match(css, /data-font-level="comfortable"/);
});

test('字号有三级、默认舒适并在切换时调用持久化', async () => {
  const { FONT_LEVELS, createFontLevelState } = await import('../src/pet/font-level.mjs');
  const saved = [];
  const state = createFontLevelState(undefined, (level) => saved.push(level));
  assert.deepEqual(FONT_LEVELS, ['compact', 'standard', 'comfortable']);
  assert.equal(state.level, 'comfortable');
  assert.equal(state.decrease(), 'standard');
  assert.equal(state.decrease(), 'compact');
  assert.equal(state.increase(), 'standard');
  assert.deepEqual(saved, ['standard', 'compact', 'standard']);
  state.set('comfortable', { persist: false });
  assert.equal(saved.length, 3);
});
