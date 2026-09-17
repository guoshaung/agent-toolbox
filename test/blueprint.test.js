'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeBlueprint } = require('../src/renderer/tools/study/blueprint.js');

test('Python：数出类、方法、函数', () => {
  const code = [
    'from collections import defaultdict',
    'from abc import ABC, abstractmethod',
    'import math',
    '',
    'class ShapeFactory(ABC):',
    '    def create(self, kind):',
    '        pass',
    '    def register(self, kind, cls):',
    '        pass',
    '',
    'class Circle:',
    '    def __init__(self, r):',
    '        self.r = r',
    '    def area(self):',
    '        return math.pi * self.r ** 2',
    '',
    'def main():',
    '    print(math.sqrt(4))',
  ].join('\n');

  const bp = analyzeBlueprint(code, 'python');
  assert.equal(bp.counts.objects, 2);
  assert.deepEqual(bp.objects.map((o) => o.name), ['ShapeFactory', 'Circle']);
  assert.deepEqual(bp.objects[0].methods, ['create', 'register']);
  assert.deepEqual(bp.objects[1].methods, ['__init__', 'area']);
  assert.equal(bp.counts.methods, 4);
  assert.deepEqual(bp.functions, ['main'], '顶层 def 算函数，不算方法');
});

test('Python：认出库和真正用到的函数', () => {
  const code = [
    'from collections import defaultdict',
    'from statistics import mean, stdev',
    'import math',
    'groups = defaultdict(list)',
    'print(mean([1, 2]), math.sqrt(9), math.floor(1.5))',
  ].join('\n');

  const bp = analyzeBlueprint(code, 'python');
  const byName = Object.fromEntries(bp.libraries.map((l) => [l.name, l]));
  assert.deepEqual(byName.collections.functions, ['defaultdict']);
  assert.deepEqual(byName.statistics.functions.sort(), ['mean', 'stdev']);
  // import math 之后靠调用点补出用到的函数
  assert.deepEqual(byName.math.functions.sort(), ['floor', 'sqrt']);
  assert.ok(byName.collections.note, '标准库要带一句人话说明');
});

test('认出设计模式，认不出就不猜', () => {
  const withPattern = analyzeBlueprint('class WidgetFactory:\n    def create(self):\n        pass', 'python');
  assert.equal(withPattern.patterns.length, 1);
  assert.match(withPattern.patterns[0].text, /工厂/);

  const plain = analyzeBlueprint('class Runs:\n    def go(self):\n        pass', 'python');
  assert.deepEqual(plain.patterns, [], '普通名字不该硬套模式');
});

test('JavaScript：类体里的方法要数对，不能把外面的函数算进去', () => {
  const code = [
    "import { readFile } from 'node:fs/promises';",
    "const path = require('node:path');",
    'class Store extends Base {',
    '  constructor(dir) { this.dir = dir; }',
    '  async load(name) { return readFile(name); }',
    '}',
    'function helper() { return 1; }',
  ].join('\n');

  const bp = analyzeBlueprint(code, 'javascript');
  assert.equal(bp.counts.objects, 1);
  assert.equal(bp.objects[0].name, 'Store');
  assert.equal(bp.objects[0].base, 'Base');
  assert.deepEqual(bp.objects[0].methods, ['constructor', 'load']);
  assert.deepEqual(bp.functions, ['helper'], 'class 外面的 function 不算方法');
  const names = bp.libraries.map((l) => l.name).sort();
  assert.deepEqual(names, ['node:fs/promises', 'node:path']);
});

test('跑一遍真实题库：不能崩，也不能全是 0', () => {
  const { PRACTICE_PROJECTS } = require('../src/renderer/tools/study/data/projects.js');
  assert.ok(PRACTICE_PROJECTS.length > 0);
  let withObjects = 0;
  let withLibraries = 0;
  for (const project of PRACTICE_PROJECTS) {
    const code = (project.cells || []).map((cell) => cell.code).join('\n\n');
    const bp = analyzeBlueprint(code, 'python');
    assert.ok(bp.counts.lines > 0, `${project.id} 应该有代码`);
    if (bp.counts.objects) withObjects += 1;
    if (bp.counts.libraries) withLibraries += 1;
  }
  assert.ok(withLibraries > 0, '真实题库里至少该有题目用到库');
  console.log(`  题库 ${PRACTICE_PROJECTS.length} 道：${withObjects} 道有类，${withLibraries} 道有库引用`);
});
