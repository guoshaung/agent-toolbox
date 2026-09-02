'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('术语提示词严格锁定预置领域', async () => {
  const { buildTermSystemPrompt } = await import('../src/renderer/tools/terms/prompt.js');
  const prompt = buildTermSystemPrompt({ domainId: 'systems' });
  assert.match(prompt, /计算机系统/);
  assert.match(prompt, /操作系统、编译器、运行时/);
  assert.match(prompt, /超出当前领域/);
  assert.match(prompt, /searchQueries 和 related 也只能生成当前领域相关内容/);
});

test('术语提示词支持自定义领域并限制长度', async () => {
  const { buildTermSystemPrompt } = await import('../src/renderer/tools/terms/prompt.js');
  const prompt = buildTermSystemPrompt({ domainId: 'custom', customDomain: '强化学习 / 机器人控制' });
  assert.match(prompt, /强化学习 \/ 机器人控制/);
  assert.doesNotMatch(prompt, /未填写的自定义领域/);
});
