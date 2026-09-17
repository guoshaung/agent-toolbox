'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSteps, currentStep, describeTask } = require('../src/renderer/tools/study/task.js');

const REF = [
  'from collections import Counter',
  '',
  'text = "a b a"',
  'words = text.split()',
  '',
  'for word, count in Counter(words).most_common():',
  '    print(word, count)',
].join('\n');

test('按空行切成步骤，每步记住行数和首行', () => {
  const steps = splitSteps(REF);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.lineCount), [1, 2, 2]);
  assert.equal(steps[0].head, 'from collections import Counter');
  assert.equal(steps[2].head, 'for word, count in Counter(words).most_common():');
});

test('空白起手停在第 0 步', () => {
  assert.equal(currentStep('', REF).step, 0);
});

test('敲完第一段进第 1 步', () => {
  assert.equal(currentStep('from collections import Counter\n', REF).step, 1);
});

test('敲到一半仍算在当前步里', () => {
  const typed = 'from collections import Counter\n\ntext = "a b a"\n';
  assert.equal(currentStep(typed, REF).step, 1, '第二段还没敲完，仍是第 1 步');
});

test('全部敲完返回步数本身', () => {
  assert.equal(currentStep(`${REF}\n`, REF).step, 3);
});

test('写岔了返回 -1，不假装还在跟', () => {
  assert.equal(currentStep('import os\n', REF).step, -1);
});

test('没有现成说明时给大实话，不编空话', () => {
  const text = describeTask({ title: '统计词频', level: '进阶', reference: REF });
  assert.match(text, /统计词频/);
  assert.match(text, /3 段/);
  assert.match(text, /5 行/);
  assert.match(text, /Tab/, '要告诉人怎么用');
  // 只有一段时不说「1 段」这种废话
  const single = describeTask({ level: '入门', reference: 'a = 1\nb = 2' });
  assert.doesNotMatch(single, /段/);
  assert.match(single, /2 行/);
  // 有现成的 purpose 就直接用
  assert.equal(describeTask({ purpose: '先看清数据形状', reference: REF }), '先看清数据形状');
  // 没代码也不能崩
  assert.match(describeTask({ reference: '' }), /随便写/);
});
