'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createModelLibrary } = require('../src/avatar/model-library');

async function fixture(t, fetcher) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-library-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const content = Buffer.from('glTF-test-model');
  const models = [{ id: 'example', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), url: 'https://example.test/model' }];
  let calls = 0;
  const library = createModelLibrary({ directory, models, fetcher: async (...args) => {
    calls++;
    return fetcher ? fetcher(...args) : { ok: true, arrayBuffer: async () => content };
  } });
  return { directory, content, library, calls: () => calls };
}

test('模型下载校验后可离线复用，同时点击只下载一次', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.library.list())[0].ready, false);
  const [a, b] = await Promise.all([f.library.ensure('example'), f.library.ensure('example')]);
  assert.equal(a, b); assert.equal(f.calls(), 1);
  assert.deepEqual(await fs.readFile(a), f.content);
  assert.equal((await f.library.list())[0].ready, true);
  await f.library.ensure('example'); assert.equal(f.calls(), 1);
  await fs.writeFile(a, Buffer.alloc(f.content.length));
  await f.library.ensure('example'); assert.equal(f.calls(), 2, '同尺寸损坏文件也重新下载');
});

test('下载失败或摘要不符不会留下可用模型，可重试', async (t) => {
  const f = await fixture(t, async () => ({ ok: true, arrayBuffer: async () => Buffer.from('glTF-wrong-file') }));
  await assert.rejects(f.library.ensure('example'), /校验失败/);
  await assert.rejects(f.library.ensure('example'), /校验失败/);
  assert.equal(f.calls(), 2);
  assert.equal((await f.library.list())[0].ready, false);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('只接受目录中已列出的模型，不允许任意 URL 或路径', async (t) => {
  const f = await fixture(t);
  for (const id of ['../other', 'https://example.com/file', null]) await assert.rejects(f.library.ensure(id), /未知/);
  assert.equal(f.calls(), 0);
});

test('皮套目录提供七套不同模型、固定版本来源、校验值及本地缩略图', async () => {
  const models = require('../src/avatar/model-catalog.json');
  assert.equal(models.length, 7);
  assert.equal(new Set(models.map((m) => m.sha256)).size, 7);
  for (const m of models) {
    assert.equal(m.license, 'CC0');
    assert.match(m.url, /^https:\/\/api.github.com\/repos\/madjin\/vrm-samples\/contents\/vroid\/beta\/[^?]+\?ref=[a-f0-9]{40}$/);
    assert.match(m.sha256, /^[a-f0-9]{64}$/);
    assert.match(m.thumbnail, /^[a-z-]+\.png$/);
    assert.ok((await fs.stat(path.join(__dirname, '../assets/avatar-model-thumbnails', m.thumbnail))).size > 0);
  }
});
