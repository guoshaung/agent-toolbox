'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listFeatures, validFeatureId } = require('../src/main/feature-catalog');
const { writeText } = require('../src/main/text-export');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-foundation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const add = (id, meta = { id, category: '学习', group: '训练', title: '示例功能', description: '有输入和输出的训练' }) => {
    const folder = path.join(dir, id); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(folder, 'index.js'), 'export default {};');
    return folder;
  };
  return { dir, add };
}
test('only bounded feature IDs can become import paths', () => {
  for (const id of ['L001', 'L060', 'T100', 'E040']) assert.equal(validFeatureId(id), true);
  for (const id of ['../L001', 'L000', 'L061', 'T101', 'E041', 'l001', null, {}, 'L001/../T001']) assert.equal(validFeatureId(id), false);
});
test('discovery isolates broken manifests and never lists absent implementations', (t) => {
  const { dir, add } = fixture(t);
  add('L001'); add('L002', { id: 'L002', category: '工具', group: '训练', title: '错分类', description: '描述' });
  const missing = add('L003'); fs.unlinkSync(path.join(missing, 'index.js'));
  const invalid = add('L004'); fs.writeFileSync(path.join(invalid, 'meta.json'), '{bad');
  add('L061'); fs.mkdirSync(path.join(dir, 'shared'));
  const result = listFeatures(dir);
  assert.deepEqual(result.features.map((row) => row.id), ['L001']);
  assert.deepEqual(result.errors.map((row) => row.id), ['L002', 'L003', 'L004']);
});
test('catalog does not follow directory links out of its shipped root', (t) => {
  const { dir } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-external-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'index.js'), 'export default {};');
  fs.writeFileSync(path.join(outside, 'meta.json'), JSON.stringify({ id: 'L001', category: '学习', group: '训练', title: '外部', description: '不加载' }));
  fs.symlinkSync(outside, path.join(dir, 'L001'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = listFeatures(dir);
  assert.equal(result.features.length, 0); assert.equal(result.errors.length, 1);
});
test('missing catalog is a legitimate empty installation', (t) => {
  const { dir } = fixture(t);
  assert.deepEqual(listFeatures(path.join(dir, 'missing')), { features: [], errors: [] });
});
test('copy-only save creates UTF-8 output and refuses subsequent overwrites', (t) => {
  const { dir } = fixture(t); const file = path.join(dir, 'result.csv');
  const created = writeText(file, '姓名,值\n张三,1', true);
  assert.equal(created.ok, true); assert.equal(created.size, Buffer.byteLength('姓名,值\n张三,1'));
  const refused = writeText(file, '替换数据', true);
  assert.equal(refused.ok, false); assert.match(refused.error, /新文件名/);
  assert.equal(fs.readFileSync(file, 'utf8'), '姓名,值\n张三,1');
  assert.equal(writeText(file, '旧工具选择覆盖', false).ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '旧工具选择覆盖');
});
test('catalog filtering combines module, category, words and favorites', async () => {
  const { validateCatalog, filterFeatures, recentFeatures } = await import('../src/renderer/tools/feature-lab/catalog.mjs');
  const rows = validateCatalog([
    { id: 'L002', category: '学习', group: '主动学习', title: '步骤解封', description: '例题训练' },
    { id: 'T002', category: '工具', group: '数据', title: 'CSV清洗', description: '本地副本导出' },
  ]);
  assert.deepEqual(filterFeatures(rows, { query: 'csv 副本', favorites: ['T002'] }).map((row) => row.id), ['T002']);
  assert.equal(filterFeatures(rows, { category: '学习', group: '数据' }).length, 0);
  assert.deepEqual(recentFeatures(['T002', 'L002', 'T002'], 'L002'), ['L002', 'T002']);
  assert.throws(() => validateCatalog([{ ...rows[0], id: '../attack' }]));
  assert.throws(() => validateCatalog([rows[0], rows[0]]));
});
