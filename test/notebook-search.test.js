'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importLocalFiles, loadLocalNotebook, saveLocalNotebook, searchProject } = require('../src/main/notebook');

test('项目搜索返回文件、行号和列号并跳过依赖目录', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-search-'));
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'main.py'), 'def load_data():\n    return "ok"\n', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'load_data\n', 'utf8');
  try {
    const result = await searchProject({ root, query: 'load_data' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.results.map((item) => [item.relPath, item.line, item.column]), [['main.py', 1, 5]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('记事本内容默认保存到本地并能复制导入学习文件', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-notebook-local-'));
  const source = path.join(userData, 'lesson.py');
  fs.writeFileSync(source, 'print("lesson")\n', 'utf8');
  try {
    const saved = await saveLocalNotebook(() => userData, { currentId: 's1', snippets: [{ id: 's1', code: 'print(1)' }] });
    assert.equal(saved.ok, true);
    const loaded = await loadLocalNotebook(() => userData);
    assert.equal(loaded.currentId, 's1');
    assert.equal(loaded.snippets[0].code, 'print(1)');
    const imported = await importLocalFiles(() => userData, [source]);
    assert.equal(imported.imported, 1);
    assert.equal(fs.readFileSync(imported.items[0].path, 'utf8'), 'print("lesson")\n');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
