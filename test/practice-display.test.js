'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main', 'practice-runner.js'), 'utf8');

// pythonHarness 没导出，从源码里抠出来跑一遍（真调 python3）
const harness = new Function(`${src.slice(src.indexOf('function pythonHarness'), src.indexOf('let vizInstance'))}; return pythonHarness;`)();

test('实践敲码：最后一行表达式像 Jupyter 一样显示，graphviz 图变成 dot 标记', () => {
  let py = '';
  try { py = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim(); } catch { /* 没有 python 就跳过 */ }
  if (!py) return;
  const out = execFileSync(py, ['-'], { input: harness('x = 2', 'y = x * 21\ny'), encoding: 'utf8' });
  assert.match(out, /^42\s*$/m);
  const cls = 'class Digraph:\n    def __init__(self): self.source = "digraph { a -> b }"\n';
  const out2 = execFileSync(py, ['-'], { input: harness('', `${cls}d = Digraph()\nd`), encoding: 'utf8' });
  assert.match(out2, /<<toolbox-display:dot:[A-Za-z0-9+/=]+>>/);
  const out3 = execFileSync(py, ['-'], { input: harness('', 'a = 1\nb = 2'), encoding: 'utf8' });
  assert.equal(out3.trim(), '', '赋值结尾不显示任何东西');
  const out4 = execFileSync(py, ['-'], { input: harness('', 'print("hi")\nNone'), encoding: 'utf8' });
  assert.equal(out4.trim(), 'hi');
});
