'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeContainerWorkspace, ensureContainerWorkspace, dshWorkDir } = require('../src/main/dsh-service');

const existing = () => ({
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: ['s-old'] },
  tables: { workspaces: { 'ws-1': { path: path.join(os.homedir(), 'Documents', 'dsh'), title: 'dsh', sessionIds: ['s-1', 's-2'] } } },
});

test('DSH 工作区：把容器目录登记成新工作区，不动已有的那条和它的会话', () => {
  const dir = path.join(os.tmpdir(), 'atb-container', 'dsh');
  const { changed, store } = mergeContainerWorkspace(existing(), dir, { newId: () => 'ws-new' });
  assert.equal(changed, true);
  assert.deepEqual(store.global.workspaceIds, ['ws-1', 'ws-new']);
  assert.deepEqual(store.global.archivedSessionIds, ['s-old']);
  assert.equal(store.tables.workspaces['ws-new'].path, path.resolve(dir));
  assert.equal(store.tables.workspaces['ws-new'].title, '工具箱容器');
  assert.deepEqual(store.tables.workspaces['ws-new'].sessionIds, []);
  // DSH 的 zod schema 要求 createdAt / updatedAt 必填的 ISO 串，缺了整个存档都加载不出来
  assert.match(store.tables.workspaces['ws-new'].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.tables.workspaces['ws-new'].updatedAt, store.tables.workspaces['ws-new'].createdAt);
  assert.deepEqual(store.tables.workspaces['ws-1'].sessionIds, ['s-1', 's-2'], '原工作区的会话一个都不能丢');
});

test('DSH 工作区：同一路径已经登记过就原样返回（幂等，每次启动都调也不会越加越多）', () => {
  const dir = path.join(os.tmpdir(), 'atb-container', 'dsh');
  const once = mergeContainerWorkspace(existing(), dir, { newId: () => 'ws-new' }).store;
  const again = mergeContainerWorkspace(once, dir + path.sep, { newId: () => 'ws-dup' });
  assert.equal(again.changed, false);
  assert.deepEqual(again.store, once);
});

test('DSH 工作区：存档残缺（没有 tables / global）也能补出合法结构', () => {
  const { changed, store } = mergeContainerWorkspace({}, '/tmp/x', { newId: () => 'a' });
  assert.equal(changed, true);
  assert.deepEqual(store.unit, { name: 'workspace', version: 2 });
  assert.deepEqual(store.global.workspaceIds, ['a']);
  assert.equal(store.tables.workspaces.a.path, path.resolve('/tmp/x'));
});

test('DSH 工作区：ensureContainerWorkspace 原子写回存档，没有存档就不碰，重复调用不变', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshhome-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ud-'));
  assert.deepEqual(ensureContainerWorkspace(userData, home), { ok: false, reason: 'no-store' });
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  const file = path.join(home, 'storages', 'workspace.json');
  fs.writeFileSync(file, JSON.stringify(existing()));
  assert.deepEqual(ensureContainerWorkspace(userData, home), { ok: true, changed: true });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const added = Object.values(saved.tables.workspaces).find((w) => w.title === '工具箱容器');
  assert.equal(added.path, fs.realpathSync(dshWorkDir(userData)));   // macOS 的 /var 是 /private/var 的软链，记录存的是 realpath 规范形
  assert.equal(saved.global.workspaceIds.length, 2);
  assert.deepEqual(ensureContainerWorkspace(userData, home), { ok: true, changed: false });
  assert.equal(fs.readdirSync(path.join(home, 'storages')).filter((n) => n.includes('.tmp-')).length, 0, '临时文件要清掉');
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true });
});
