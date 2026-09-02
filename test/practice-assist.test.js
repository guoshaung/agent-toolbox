'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('Practice assistant explains Python imports locally', async () => {
  const module = await import('../src/renderer/tools/study/practice-assist.js');
  const note = module.explainPracticeLine('requests', 'import requests');
  assert.equal(note.kind, 'import');
  assert.match(note.explanation, /requests\.函数名/);
  assert.equal(note.url, 'https://requests.readthedocs.io/en/latest/');
});

test('Practice assistant distinguishes from-import syntax', async () => {
  const module = await import('../src/renderer/tools/study/practice-assist.js');
  const note = module.explainPracticeLine('python', 'from collections import Counter');
  assert.equal(note.kind, 'from-import');
  assert.match(note.syntax, /from 模块名 import/);
  assert.match(note.explanation, /Counter/);
});

test('Practice assistant covers shell and SQL lines', async () => {
  const module = await import('../src/renderer/tools/study/practice-assist.js');
  assert.equal(module.explainPracticeLine('linux', 'grep -n "error" app.log').kind, 'shell');
  assert.equal(module.explainPracticeLine('sql', 'SELECT name FROM students').kind, 'sql');
});

test('Practice assistant parses AI JSON and keeps prompt context', async () => {
  const module = await import('../src/renderer/tools/study/practice-assist.js');
  const result = module.normalizePracticeAiResult('{"title":"请求函数","syntax":"函数调用","what":"发起请求","why":"读取远程数据","next":"检查状态码","docQuery":"requests get"}', 'response = requests.get(url)');
  assert.equal(result.title, '请求函数');
  assert.equal(result.next, '检查状态码');
  assert.match(module.buildPracticeExplainPrompt({ trackName: 'Requests', line: 'import requests', context: 'response = requests.get(url)' }), /nearby-code/);
});
