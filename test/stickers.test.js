'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StickersService, extOf, IMG_EXT } = require('../src/main/stickers');

function mkStore() {
  return { data: {}, get(k, d) { return k in this.data ? this.data[k] : d; }, set(k, v) { if (v === undefined) delete this.data[k]; else this.data[k] = v; } };
}
// 假的 safeStorage：base64 当「加密」，够测往返
const fakeSafe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString('utf8').replace(/^enc:/, '') };

function mkSvc(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stk-'));
  const svc = new StickersService({
    store: mkStore(), safeStorage: fakeSafe, clipboard: {}, shell: {}, dialog: {},
    userDataDir: dir, getWindow: () => null, execFileAsync: async () => ({ stdout: '' }), ...extra,
  });
  return { svc, dir };
}

test('表情：extOf / IMG_EXT', () => {
  assert.equal(extOf('a/b/C.GIF'), 'gif');
  assert.equal(extOf('x.png?q=1'), 'png');
  assert.ok(IMG_EXT.has('webp'));
  assert.ok(!IMG_EXT.has('exe'));
});

test('表情：分类过滤 / 更新 / 删除', () => {
  const { svc } = mkSvc();
  svc.writeIndex({ version: 1, items: [
    { id: '1', file: '1.gif', ext: 'gif', category: '摸鱼', tags: ['狗头'], addedAt: 2 },
    { id: '2', file: '2.png', ext: 'png', category: '未分类', tags: [], addedAt: 1 },
  ] });
  // 真实文件占位，删除时能 unlink
  fs.writeFileSync(path.join(svc.media, '1.gif'), 'x');
  fs.writeFileSync(path.join(svc.media, '2.png'), 'y');

  const all = svc.list({});
  assert.equal(all.total, 2);
  assert.equal(all.categories['摸鱼'], 1);
  assert.equal(all.items[0].id, '1'); // addedAt 倒序
  assert.ok(all.items[0].url.startsWith('file://'));

  assert.equal(svc.list({ category: '摸鱼' }).items.length, 1);
  assert.equal(svc.list({ q: '狗头' }).items.length, 1);

  const up = svc.update('2', { category: '可爱', tags: ['猫', '猫'] });
  assert.ok(up.ok);
  assert.equal(svc.list({ category: '可爱' }).items.length, 1);

  const rm = svc.remove('1');
  assert.ok(rm.ok);
  assert.equal(svc.list({}).total, 1);
  assert.ok(!fs.existsSync(path.join(svc.media, '1.gif')));
  assert.ok(!svc.remove('1').ok); // 再删不存在
});

test('表情：Tenor Key safeStorage 往返 + 状态', () => {
  const { svc } = mkSvc();
  assert.equal(svc.keyStatus().hasKey, false);
  assert.ok(svc.saveKey('AIzaTEST').ok);
  assert.equal(svc.keyStatus().hasKey, true);
  assert.equal(svc.readKey(), 'AIzaTEST');
  assert.ok(svc.saveKey('').ok);
  assert.equal(svc.keyStatus().hasKey, false);
});

test('表情：没 Key 时搜索直接返回 no-key，不发网络请求', async () => {
  const { svc } = mkSvc();
  assert.deepEqual(await svc.search({ q: '狗头' }), { ok: false, error: 'no-key' });
  assert.deepEqual(await svc.categories(), { ok: false, error: 'no-key' });
});

test('表情：setRemote 只收 GitHub 地址', () => {
  const { svc } = mkSvc();
  assert.ok(!svc.setRemote('http://evil.example/x').ok);
  assert.ok(svc.setRemote('git@github.com:me/emotes.git').ok);
  assert.ok(svc.setRemote('https://github.com/me/emotes.git').ok);
  assert.ok(svc.setRemote('').ok); // 允许清空
});

test('表情：没配 remote 时 sync 返回 no-remote', async () => {
  const { svc } = mkSvc();
  assert.deepEqual(await svc.sync(), { ok: false, error: 'no-remote' });
});

test('表情：qrMatrix 生成方阵，空文本报错', () => {
  const { svc } = mkSvc();
  assert.deepEqual(svc.qrMatrix('  '), { ok: false, error: 'no-text' });
  const m = svc.qrMatrix('https://example.com');
  assert.ok(m.ok);
  assert.ok(m.size >= 21);
  assert.equal(m.data.length, m.size * m.size);
  assert.ok(m.data.every((v) => v === 0 || v === 1));
});

test('表情：dataUrl 读成 base64，文件不存在报错', () => {
  const { svc } = mkSvc();
  svc.writeIndex({ version: 1, items: [{ id: 'x', file: 'x.png', ext: 'png', addedAt: 1 }] });
  fs.writeFileSync(path.join(svc.media, 'x.png'), Buffer.from([1, 2, 3, 4]));
  const d = svc.dataUrl('x');
  assert.ok(d.ok);
  assert.match(d.dataUrl, /^data:image\/png;base64,/);
  assert.ok(!svc.dataUrl('nope').ok);
});

test('表情：saveComposed 把 data URL 落库', async () => {
  const { svc } = mkSvc();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const r = await svc.saveComposed({ dataUrl: png, title: '测试', category: '玩法' });
  assert.ok(r.ok, r.error);
  assert.equal(r.item.category, '玩法');
  assert.equal(svc.list({ category: '玩法' }).items.length, 1);
  assert.ok(!(await svc.saveComposed({ dataUrl: 'nope' })).ok);
});

test('表情：imageStatus 跟随 getImageConfig', () => {
  const { svc } = mkSvc();
  assert.equal(svc.imageStatus().hasKey, false); // 没注入 getImageConfig
  const { svc: svc2 } = mkSvc({ getImageConfig: () => ({ apiKey: 'sk-x', baseUrl: 'https://x/v1', model: 'm' }) });
  assert.equal(svc2.imageStatus().hasKey, true);
  assert.equal(svc2.imageStatus().model, 'm');
});

test('表情：fuse 没图 / 没 Key 时提前返回', async () => {
  const { svc } = mkSvc({ getImageConfig: () => ({ apiKey: '' }) });
  assert.equal((await svc.fuse({})).error, '先选至少一张图');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  assert.deepEqual(await svc.fuse({ dataUrls: [png] }), { ok: false, error: 'no-key' });
});

test('表情：normalize 把 Tenor 结果拍平，丢掉没预览图的', () => {
  const { svc } = mkSvc();
  const out = svc.normalize([
    { id: 'a', content_description: '狗头', media_formats: { tinygif: { url: 'https://media.tenor.com/a-tiny.gif', dims: [100, 80] }, gif: { url: 'https://media.tenor.com/a.gif' } } },
    { id: 'b', media_formats: {} }, // 没预览，丢
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].preview, 'https://media.tenor.com/a-tiny.gif');
  assert.equal(out[0].full, 'https://media.tenor.com/a.gif');
  assert.equal(out[0].w, 100);
});
