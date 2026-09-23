'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// palette.js 是 ESM 且 import 了带 DOM 的模块；这里只把两个纯函数抠出来测
function loadPure() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'core', 'palette.js'), 'utf8');
  const start = src.indexOf('export function scoreItem');
  const end = src.indexOf('export function createPalette');
  const body = src.slice(start, end).replace(/export function/g, 'function');
  return new Function(`${body}; return { scoreItem, rankItems, quickTaskFrom };`)();
}
const { scoreItem, rankItems, quickTaskFrom } = loadPure();

test('「+ 事情」变成一条添加任务的动作；别的输入不算', () => {
  assert.equal(quickTaskFrom('+ 买牛奶').title, '添加任务：买牛奶');
  assert.equal(quickTaskFrom('＋看完第三章').keywords[0], '看完第三章');
  assert.equal(quickTaskFrom('+   '), null);
  assert.equal(quickTaskFrom('皮肤'), null);
});

test('打分：全等 > 前缀 > 包含 > 拆字 > 说明', () => {
  const t = { id: 'gold', title: '皮肤：镀金黑金', hint: '黑檀底、24K 金边', keywords: ['皮肤', 'theme'] };
  assert.equal(scoreItem('皮肤：镀金黑金', t), 100);
  assert.equal(scoreItem('皮肤', t), 100, '关键词全等');
  assert.equal(scoreItem('皮', t), 80);
  assert.equal(scoreItem('镀金', t), 60);
  assert.equal(scoreItem('金黑', t), 60);
  assert.equal(scoreItem('皮金', t), 40, '拆字命中');
  assert.equal(scoreItem('24k', t), 25, '只在说明里');
  assert.equal(scoreItem('香蕉', t), 0);
  assert.equal(scoreItem('', t), 1, '空查询全部显示');
});

test('排序：分高的在前，最近用过的工具再往前提', () => {
  const items = [
    { id: 'docs', title: '文档', hint: '官方文档浏览器' },
    { id: 'notes', title: '笔记', hint: '写文档、记东西' },
    { id: 'ask', title: '快问', hint: '' },
  ];
  const r = rankItems('文档', items, { recentIds: ['notes'] });
  assert.deepEqual(r.map((x) => x.id), ['docs', 'notes'], '标题命中的在说明命中的前面；快问不出现');
  const r2 = rankItems('', items, { recentIds: ['ask', 'notes'] });
  assert.deepEqual(r2.map((x) => x.id), ['ask', 'notes', 'docs'], '空查询按最近使用排');
});
