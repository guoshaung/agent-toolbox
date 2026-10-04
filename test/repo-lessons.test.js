'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'study', 'repo-lessons.js'), 'utf8').replace(/export function/g, 'function');
const mod = new Function(`${src}; return { langOf, trackForLang, orderFiles, readmeExamples, splitIntoChunks, lessonCells, exampleCells };`)();

test('仓库课：语言识别和文件排序', () => {
  assert.equal(mod.langOf('micrograd/engine.py'), 'python');
  assert.equal(mod.trackForLang('python'), 'python');
  assert.equal(mod.trackForLang('javascript'), '');
  const ordered = mod.orderFiles([
    { rel: 'test/test_engine.py', size: 1470 }, { rel: 'micrograd/nn.py', size: 1613 }, { rel: 'micrograd/engine.py', size: 2730 },
    { rel: 'micrograd/__init__.py', size: 0 }, { rel: 'setup.py', size: 717 }, { rel: 'README.md', size: 3000 }, { rel: 'puppy.jpg', size: 49269 },
  ]);
  assert.deepEqual(ordered.map((f) => f.rel), ['micrograd/nn.py', 'micrograd/engine.py', 'test/test_engine.py']);
});

test('仓库课：README 里的代码块当示例，装包命令不算', () => {
  const ex = mod.readmeExamples('# x\n\n```bash\npip install micrograd\n```\n\n```python\nfrom micrograd.engine import Value\na = Value(-4.0)\n```\n');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].lang, 'python');
  assert.match(ex[0].code, /Value\(-4\.0\)/);
});

test('仓库课：Python 按顶层 def / class 切块，装饰器跟着 def', () => {
  const code = `import math\n\nclass Value:\n    def __init__(self, data):\n        self.data = data\n\n    def __add__(self, other):\n        return Value(self.data + other.data)\n\n@dataclass\ndef helper():\n    return 1\n\nprint(helper())\n`;
  const chunks = mod.splitIntoChunks(code, 'python', { minLines: 1 });
  const titles = chunks.map((c) => c.title);
  assert.ok(titles.includes('类 Value'), titles.join('|'));
  assert.ok(titles.some((t) => t === '函数 helper'), titles.join('|'));
  assert.ok(chunks.find((c) => c.title === '函数 helper').code.startsWith('@dataclass'));
  assert.ok(chunks.every((c) => c.code.split('\n').length <= 40));
});

test('仓库课：一课的格子带标题和参考答案', () => {
  const cells = mod.lessonCells('micrograd/nn.py', 'import random\n\nclass Module:\n    pass\n', 'python');
  assert.ok(cells.length >= 1);
  assert.match(cells[0].title, /^nn\.py · /);
  assert.equal(cells[0].reference, cells[0].code);
  const ex = mod.exampleCells('```python\nprint(1)\n```\n```bash\npython -m pytest\n```', 'micrograd');
  assert.equal(ex.length, 1, 'bash 块不进 python 课');
  assert.equal(ex[0].title, 'README 示例 1');
});
