'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main', 'practice-runner.js'), 'utf8');

// pythonHarness 没导出，从源码里抠出来跑一遍（真调 python3）
const harness = new Function(`${src.slice(src.indexOf('function pythonHarness'), src.indexOf('let vizInstance'))}; return pythonHarness;`)();
function pythonBin() {
  for (const cand of ['python3', 'python']) { const r = spawnSync(cand, ['-c', 'print(1)'], { encoding: 'utf8' }); if (!r.error && r.status === 0 && r.stdout.trim() === '1') return cand; }
  return '';
}
const marker = (stdout, idx) => { const m = String(stdout).match(new RegExp(`<<toolbox-prelude-error:${idx}:([A-Za-z0-9+/=]*)>>`)); return m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; };

test('实践敲码：上面的格子各自容错——第 7 格炸了只记一条，第 8 格和当前格照跑', () => {
  const py = pythonBin();
  if (!py) return;   // 没有能跑的 python 就跳过
  const prelude = [{ index: 6, code: 'a = 1\nb = a / 0\n' }, { index: 7, code: 'c = 3' }];
  const r = spawnSync(py, ['-'], { input: harness(prelude, 'print(a, c)'), encoding: 'utf8' });
  assert.equal(r.status, 0, '上面格子的错不能让整次运行失败');
  assert.match(r.stdout, /^1 3\s*$/m, 'a 在第 7 格炸之前已定义，c 来自第 8 格：两个都拿得到');
  const tb = marker(r.stdout, 6);
  assert.match(tb, /File "<prelude-6>", line 2/, '标记里的 traceback 带着是哪一格、第几行');
  assert.match(tb, /ZeroDivisionError/);
  assert.equal(marker(r.stdout, 7), '', '第 8 格没出错，不该有标记');
});

test('实践敲码：当前格自己的错给本格行号，和上面格子无关；老的整段 prelude 也兼容', () => {
  const py = pythonBin();
  if (!py) return;
  // 当前格第 1 行 ImportError（用户原话那种写法），上面第 7 格同时是坏的：报的必须是当前格的 <cell> 第 1 行
  const r1 = spawnSync(py, ['-'], { input: harness([{ index: 6, code: '1 / 0' }], 'from numpy import np_definitely_not_a_name\nprint(1)'), encoding: 'utf8' });
  assert.notEqual(r1.status, 0);
  assert.match(r1.stderr, /File "<cell>", line 1/);
  assert.doesNotMatch(r1.stderr, /<prelude/, '上面格子的错已经被容错，不该出现在最终 traceback 里');
  assert.match(marker(r1.stdout, 6), /ZeroDivisionError/);
  // 当前格语法错：ast.parse 带了文件名
  const r2 = spawnSync(py, ['-'], { input: harness([], 'def f(:\n    pass'), encoding: 'utf8' });
  assert.match(r2.stderr, /File "<cell>", line 1/);
  // 老接口：整段字符串 prelude，也按一格容错
  const r3 = spawnSync(py, ['-'], { input: harness('a = 1\nb = 2\nc = a / 0\n', 'print(a)'), encoding: 'utf8' });
  assert.equal(r3.status, 0);
  assert.match(r3.stdout, /^1\s*$/m);
  assert.match(marker(r3.stdout, 0), /File "<prelude-0>", line 3/);
  // 正常路径不受影响：最后一行表达式照样显示
  const r4 = spawnSync(py, ['-'], { input: harness('x = 2', 'x * 21'), encoding: 'utf8' });
  assert.match(r4.stdout, /^42\s*$/m);
});

test('实践敲码：诊断分得清 <cell> / <prelude-N> / 老的 <prelude> / <string>', async () => {
  const { diagnoseRunError, runStatusLabel } = await import('../src/renderer/tools/study/practice-errors.js');
  const tb = (file, line) => `Traceback (most recent call last):\n  File "${file}", line ${line}, in <module>\nZeroDivisionError: division by zero\n`;
  const byCell = diagnoseRunError('python', { ok: false, exitCode: 1, stderr: tb('<prelude-6>', 2) }, 'print(1)');
  assert.equal(byCell.inPrelude, true);
  assert.equal(byCell.preludeCell, 6);
  assert.equal(byCell.preludeLine, 2);
  assert.equal(byCell.line, null, '上面格子的行号不能当成本格的行号');

  const legacy = diagnoseRunError('python', { ok: false, exitCode: 1, stderr: tb('<prelude>', 96) }, 'print(1)');
  assert.equal(legacy.inPrelude, true);
  assert.equal(legacy.preludeCell, null);
  assert.equal(legacy.preludeLine, 96);
  assert.match(legacy.summary, /上面的单元格/);
  assert.match(runStatusLabel({ ok: false, exitCode: 1 }, legacy), /上面的单元格/);

  const inCell = diagnoseRunError('python', { ok: false, exitCode: 1, stderr: tb('<cell>', 2) }, 'x = 1\ny = x / 0');
  assert.equal(inCell.inPrelude, false);
  assert.equal(inCell.line, 2);
  assert.equal(inCell.lineText, 'y = x / 0');
  assert.match(runStatusLabel({ ok: false, exitCode: 1 }, inCell), /第 2 行/);

  const old = diagnoseRunError('python', { ok: false, exitCode: 1, stderr: tb('<string>', 5) }, '');
  assert.equal(old.line, 5);
  assert.equal(old.inPrelude, false);

  assert.match(runStatusLabel({ ok: false, exitCode: 1 }, { ...legacy, where: '上面第 7 格 第 2 行' }), /上面第 7 格 第 2 行/);
});
