'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importIntoContainer, listContainer, organize, seedContainer } = require('../src/main/container-storage');

test('已有容器工具只补缺失的 uv 项目元数据，不覆盖用户文件', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-container-seed-'));
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-seed-'));
  fs.mkdirSync(path.join(seed, 'tool'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'tool', 'pyproject.toml'), '[project]\nname = "tool"\n');
  fs.mkdirSync(path.join(userData, 'container', 'tool'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'container', 'tool', 'main.py'), 'print(1)');
  try {
    const result = seedContainer(() => userData, seed);
    assert.deepEqual(result.copied, []);
    assert.equal(fs.existsSync(path.join(userData, 'container', 'tool', 'pyproject.toml')), true);
    assert.equal(fs.readFileSync(path.join(userData, 'container', 'tool', 'main.py'), 'utf8'), 'print(1)');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(seed, { recursive: true, force: true });
  }
});

test('容器一键整理会在隔离目录内移动文件', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-container-'));
  const container = path.join(userData, 'container');
  fs.mkdirSync(container, { recursive: true });
  fs.writeFileSync(path.join(container, 'paper.pdf'), 'pdf');
  fs.writeFileSync(path.join(container, 'figure.png'), 'png');
  try {
    const result = await organize(() => userData);
    assert.equal(result.ok, true);
    assert.equal(result.moved, 2);
    assert.equal(fs.existsSync(path.join(container, '文档', 'paper.pdf')), true);
    assert.equal(fs.existsSync(path.join(container, '图片', 'figure.png')), true);
    assert.equal((await listContainer(() => userData)).items.length, 2);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('容器拒绝越界路径', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-container-safe-'));
  try {
    const result = await listContainer(() => userData, '../');
    assert.equal(result.ok, false);
    assert.match(result.error, /容器以外/);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('容器可以复制外部文件夹并跳过依赖目录', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-container-import-'));
  const source = path.join(userData, 'source');
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lesson.py'), 'print(1)');
  fs.writeFileSync(path.join(source, 'node_modules', 'ignored.js'), 'ignored');
  try {
    const result = await importIntoContainer(() => userData, [source]);
    assert.equal(result.ok, true);
    assert.equal(result.importedFolders, 1);
    assert.equal(result.importedFiles, 1);
    const imported = path.join(userData, 'container', 'source', 'lesson.py');
    assert.equal(fs.existsSync(imported), true);
    assert.equal(fs.existsSync(path.join(userData, 'container', 'source', 'node_modules')), false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('同一个外部来源重复拖入时只复制一次', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-container-dedupe-'));
  const source = path.join(userData, 'lesson');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'main.py'), 'print(1)');
  try {
    const first = await importIntoContainer(() => userData, [source]);
    const second = await importIntoContainer(() => userData, [source]);
    assert.equal(first.importedFolders, 1);
    assert.equal(second.importedFolders, 0);
    assert.equal(second.skipped, 1);
    assert.deepEqual(fs.readdirSync(path.join(userData, 'container')).filter((name) => name.startsWith('lesson')), ['lesson']);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
