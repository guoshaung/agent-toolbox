'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextGhost, alignCursor } = require('../src/renderer/tools/study/ghost.js');

const REF = [
  'runs = load_runs()',
  '',
  'for run in runs:',
  '    print(run["model"])',
].join('\n');

test('空白起手：提示第一整行', () => {
  assert.deepEqual(nextGhost('', REF), { text: 'runs = load_runs()', kind: 'line' });
});

test('写了一半：只提示这一行剩下的部分', () => {
  assert.deepEqual(nextGhost('runs = load', REF), { text: '_runs()', kind: 'rest' });
});

test('敲完一行换行：提示下一非空行', () => {
  assert.deepEqual(nextGhost('runs = load_runs()\n', REF), { text: 'for run in runs:', kind: 'line' });
});

test('缩进行：提示里带上缩进，不用自己数空格', () => {
  const typed = 'runs = load_runs()\nfor run in runs:\n';
  assert.deepEqual(nextGhost(typed, REF), { text: '    print(run["model"])', kind: 'line' });
});

test('缩进敲少了也能接上', () => {
  const typed = 'runs = load_runs()\nfor run in runs:\n  print';
  assert.deepEqual(nextGhost(typed, REF), { text: '(run["model"])', kind: 'rest' });
});

test('写岔了就闭嘴，不硬拉回答案', () => {
  assert.deepEqual(nextGhost('total = 0\n', REF), { text: '', kind: '' });
});

test('写完了不再提示', () => {
  const typed = 'runs = load_runs()\nfor run in runs:\n    print(run["model"])\n';
  assert.deepEqual(nextGhost(typed, REF), { text: '', kind: '' });
});

test('自己多敲的空行不影响对位', () => {
  const typed = 'runs = load_runs()\n\n\n';
  assert.deepEqual(nextGhost(typed, REF), { text: 'for run in runs:', kind: 'line' });
});

test('没有标准答案时不提示', () => {
  assert.deepEqual(nextGhost('abc', ''), { text: '', kind: '' });
  assert.deepEqual(nextGhost('abc', '\n\n  \n'), { text: '', kind: '' });
});

test('alignCursor 跳过答案里的空行', () => {
  assert.equal(alignCursor(['runs = load_runs()'], REF.split('\n')), 2);
  assert.equal(alignCursor(['nope'], REF.split('\n')), -1);
});
