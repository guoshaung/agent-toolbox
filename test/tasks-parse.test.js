'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'tasks', 'parse.js'), 'utf8').replace(/export (const|function)/g, '$1');
const m = new Function(`${src}; return { BUCKETS, parseLine, splitDump, normalizeTitle, pickFocus, streakOf, findDuplicates, staleTasks, parseAiTasks };`)();

test('任务：一句话抠出时间 / 轻重 / 标签', () => {
  const a = m.parseLine('- 今天紧急改论文 #科研');
  assert.equal(a.bucket, 'today'); assert.equal(a.priority, 'urgent'); assert.equal(a.tag, '科研'); assert.match(a.title, /改论文/); assert.match(a.due, /^\d{4}-\d{2}-\d{2}$/);
  const b = m.parseLine('有空看看 micrograd');
  assert.equal(b.bucket, 'later'); assert.equal(b.priority, 'normal');
  const c = m.parseLine('明天交报告');
  assert.equal(c.bucket, 'week'); assert.ok(c.due);
  assert.equal(m.parseLine('   '), null);
});

test('任务：整段倒出来按行 / 分号拆，去重', () => {
  const list = m.splitDump('改论文第三章；买牛奶\n买牛奶\n1. 回邮件！问导师开会时间。以后学一下 Rust');
  const titles = list.map((t) => t.title);
  assert.ok(titles.includes('改论文第三章'));
  assert.equal(titles.filter((t) => t === '买牛奶').length, 1);
  assert.ok(titles.some((t) => t.startsWith('回邮件')));
  assert.ok(titles.some((t) => t.includes('Rust')));
  assert.equal(list.find((t) => t.title.includes('Rust')).bucket, 'later');
});

test('任务：现在做哪个、连续天数、重复、放太久', () => {
  const now = Date.now();
  const tasks = [
    { id: 1, title: 'a', done: false, bucket: 'today', priority: 'normal', createdAt: now },
    { id: 2, title: 'b', done: false, bucket: 'today', priority: 'urgent', createdAt: now },
    { id: 3, title: 'A!', done: false, bucket: 'week', priority: 'normal', createdAt: now - 20 * 86400000 },
    { id: 4, title: 'c', done: true, completedAt: now - 86400000, createdAt: now },
    { id: 5, title: 'd', done: true, completedAt: now - 2 * 86400000, createdAt: now },
  ];
  assert.equal(m.pickFocus(tasks).id, 2);
  assert.equal(m.streakOf(tasks, now), 2);
  assert.equal(m.findDuplicates(tasks).length, 1);
  assert.deepEqual(m.staleTasks(tasks, { now }).map((t) => t.id), [3]);
});

test('任务：模型返回的 JSON 裹着话也能抠出来', () => {
  const list = m.parseAiTasks('好的，拆成这些：\n```json\n[{"title":"写摘要","bucket":"today","priority":"high","tag":"论文"},{"title":"x","bucket":"nope"}]\n```');
  assert.equal(list.length, 1);
  assert.equal(list[0].bucket, 'today'); assert.equal(list[0].tag, '论文');
  assert.deepEqual(m.parseAiTasks('没有'), []);
});
