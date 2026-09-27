'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractDefinition, topImports, findDefinition } = require('../src/main/repo-defs');

test('仓库定义：抠 def / class / 多行赋值，装饰器跟着', () => {
  const src = `import math\n\n@cache\ndef draw_dot(root, fmt='svg'):\n    dot = 1\n    return dot\n\ndef other():\n    pass\n\nCONFIG = {\n  'a': 1,\n}\nx = 2\n`;
  assert.equal(extractDefinition(src, 'draw_dot'), `@cache\ndef draw_dot(root, fmt='svg'):\n    dot = 1\n    return dot`);
  assert.equal(extractDefinition(src, 'CONFIG'), `CONFIG = {\n  'a': 1,\n}`);
  assert.equal(extractDefinition(src, 'nope'), '');
  assert.equal(topImports(src), 'import math');
});

test('仓库定义：在 .py 和 .ipynb 里找', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-defs-'));
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'engine.py'), 'import math\n\nclass Value:\n    pass\n');
  fs.writeFileSync(path.join(dir, 'trace.ipynb'), JSON.stringify({ cells: [
    { cell_type: 'code', source: ['from graphviz import Digraph\n'] },
    { cell_type: 'code', source: ['def trace(root):\n', '    return root\n', '\n', 'def draw_dot(root):\n', '    return trace(root)\n'] },
  ] }));
  const v = findDefinition(dir, 'Value');
  assert.ok(v.ok); assert.equal(v.rel, 'pkg/engine.py'); assert.match(v.code, /^class Value:/);
  const d = findDefinition(dir, 'draw_dot');
  assert.ok(d.ok); assert.equal(d.rel, 'trace.ipynb'); assert.equal(d.kind, 'notebook');
  assert.match(d.code, /def trace/, '笔记本里整格带回，trace 和 draw_dot 都在');
  assert.equal(d.imports, 'from graphviz import Digraph');
  assert.equal(findDefinition(dir, 'missing').ok, false);
  assert.equal(findDefinition(dir, '../x').ok, false);
});
