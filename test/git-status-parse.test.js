'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GitDesk, pathFromPorcelain } = require('../src/main/git-desk');

const UNIT = String.fromCharCode(31);   // git log 里用它分隔字段
const TAB = String.fromCharCode(9);     // 重命名行里分隔新旧路径

test('porcelain v2 取文件名：普通改动不能把对象哈希带进来', () => {
  const line = '1 .M N... 100644 100644 100644 7d9e04e60b41 7d9e04e60b41 src/main/main.js';
  assert.equal(pathFromPorcelain(line, line.split(' ')), 'src/main/main.js');
});

test('porcelain v2 取文件名：路径里有空格也要完整', () => {
  const line = '1 M. N... 100644 100644 100644 aaa bbb docs/my notes/读我 文件.md';
  assert.equal(pathFromPorcelain(line, line.split(' ')), 'docs/my notes/读我 文件.md');
});

test('porcelain v2 取文件名：重命名取新名字，不要后面的旧名字', () => {
  const line = `2 R. N... 100644 100644 100644 aaa bbb R100 新名字.js${TAB}old name.js`;
  assert.equal(pathFromPorcelain(line, line.split(' ')), '新名字.js');
});

test('status 把已暂存 / 未暂存 / 新文件 / 冲突分开，提交也解析出来', async () => {
  const porcelain = [
    '# branch.head main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 7d9e04e 7d9e04e package.json',
    '1 M. N... 100644 100644 100644 aaa bbb src/a b.js',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
    '? docs/new.md',
  ].join('\n');
  const desk = new GitDesk({
    store: { get: () => [], set: () => {} },
    execFile: async (file, args) => {
      if (args[0] === 'status') return { stdout: porcelain, stderr: '' };
      if (args[0] === 'log') return { stdout: ['abc123', 'Ann', '2 小时前', '修好了登录'].join(UNIT), stderr: '' };
      if (args[0] === 'symbolic-ref') return { stdout: 'origin/main', stderr: '' };
      return { stdout: '', stderr: '' };
    },
  });
  const st = await desk.status('/repo');
  assert.equal(st.branch, 'main');
  assert.deepEqual([st.ahead, st.behind], [2, 1]);
  assert.deepEqual(st.changed, ['package.json'], '未暂存的改动');
  assert.deepEqual(st.staged, ['src/a b.js'], '已暂存的，文件名带空格也要对');
  assert.deepEqual(st.conflicts, ['conflict.txt']);
  assert.deepEqual(st.untracked, ['docs/new.md']);
  assert.deepEqual(st.commits[0], { hash: 'abc123', author: 'Ann', date: '2 小时前', subject: '修好了登录' });
});
