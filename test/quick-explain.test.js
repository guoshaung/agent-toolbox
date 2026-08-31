'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuickExplainMessages, normalizeFourLines, parseQuickExplainResponse,
} = require('../src/main/quick-explain');

test('快速解释提示词限制在当前层且固定四行', () => {
  const messages = buildQuickExplainMessages({ code: 'const x = foo()', language: 'JavaScript' });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /严格形成四行/);
  assert.match(messages[0].content, /这一行在做什么/);
  assert.match(messages[0].content, /关键写法/);
  assert.doesNotMatch(messages[0].content, /知识缺口仅一个概念/);
  assert.match(messages[0].content, /supplement/);
  assert.match(messages[0].content, /不要猜项目/);
  assert.match(messages[1].content, /停留在当前层/);
  assert.doesNotMatch(messages[1].content, /用户已明确点击/);
});

test('一次结构化回复解析为严格四行顶部和固定补充小节', () => {
  const parsed = parseQuickExplainResponse(JSON.stringify({
    quick: {
      这一行在做什么: '过滤有效条目',
      关键写法: '箭头函数作为 filter 回调',
      为什么要这样写: '把筛选规则直接交给数组',
      你现在只要记住: '回调返回 true 就保留',
    },
    supplement: {
      语法拆解: '箭头函数接收一个参数并返回布尔值。',
      真正的知识点: '关键是函数可以作为值传递，比记住 filter API 更通用。',
      最小例子: 'const xs = [1, 2]\nconst ys = xs.filter(x => x > 1)',
      当前调用关系: 'filter 来自数组，返回新数组，下一跳是回调函数。',
    },
  }));
  assert.equal(parsed.quick.split('\n').length, 4);
  assert.equal(parsed.quick.split('\n')[0], '这一行在做什么：过滤有效条目');
  assert.equal(parsed.quick.split('\n')[1], '关键写法：箭头函数作为 filter 回调');
  assert.equal(parsed.quick.split('\n')[3], '你现在只要记住：回调返回 true 就保留');
  assert.match(parsed.supplement.knowledge, /比记住 filter API 更通用/);
  assert.match(parsed.supplement.relation, /下一跳/);
});

test('补充缺节时使用安全默认且不破坏顶部四行', () => {
  const parsed = parseQuickExplainResponse('```json\n{"quick":{"作用":"调用函数","知识缺口":"闭包（中）","为什么这样写":"延迟读取变量","下一步":"观察变量值"},"supplement":{"语法拆解":"函数调用"}}\n```');
  assert.equal(parsed.quick.split('\n').length, 4);
  assert.equal(parsed.quick.split('\n')[0], '这一行在做什么：调用函数');
  assert.equal(parsed.quick.split('\n')[1], '关键写法：闭包');
  assert.equal(parsed.supplement.syntax, '函数调用');
  assert.equal(parsed.supplement.relation, '需点击向上一层追溯。');
  assert.match(parsed.supplement.example, /暂不提供/);
});

test('最小例子最多保留八行', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
  const parsed = parseQuickExplainResponse(JSON.stringify({ quick: {}, supplement: { 最小例子: lines } }));
  assert.equal(parsed.quick.split('\n').length, 4);
  assert.equal(parsed.supplement.example.split('\n').length, 8);
});

test('补充区状态默认折叠并可显式切换', async () => {
  const { createSupplementState } = await import('../src/pet/supplement-state.mjs');
  const state = createSupplementState();
  assert.equal(state.expanded, false);
  assert.equal(state.toggle(), true);
  assert.equal(state.set(false), false);
});

test('只有明确追溯时才允许解释上一层', () => {
  const messages = buildQuickExplainMessages({ code: 'foo()', trace: true });
  assert.match(messages[1].content, /用户已明确点击/);
  assert.match(messages[1].content, /没有上层定义或调用处/);
});

test('旧四行字段兼容映射到新的自然讲解顺序', () => {
  const output = normalizeFourLines(`当然可以：\n- 作用：发起调用\n- 知识缺口：闭包；Promise\n- 为什么这样写：延迟执行\n- 下一步：查看 foo 定义\n多余解释`);
  const lines = output.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '这一行在做什么：发起调用');
  assert.equal(lines[1], '关键写法：闭包；Promise');
  assert.equal(lines[2], '为什么要这样写：延迟执行');
  assert.equal(lines[3], '你现在只要记住：查看 foo 定义');
});
