'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DrawingSync } = require('../src/main/drawing-sync');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drawing-test-'));
  const identity = { id: 'existing-toolbox-id', code: '1379', name: 'Test' };
  fs.writeFileSync(path.join(root, 'localsend.json'), JSON.stringify(identity));
  fs.writeFileSync(path.join(root, 'config.json'), 'font-and-key-sentinel');
  const service = new DrawingSync({ userDataDir: root, port: 0 });
  t.after(async () => { await service.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, service, identity };
}
function stroke(id = 'stroke1', client = 'ipad') { return { id: 'operation-' + id, client, kind: 'put', value: { type: 'stroke', id, page: 'first', tool: 'pen', color: '#123456', width: 3, x: 0, y: 0, points: [[10, 20, .1], [30, 40, 1]] } }; }
function request(service, route, options = {}) {
  const info = service.status(), p = new URLSearchParams(info.desktopUrl.split('#')[1]);
  return fetch(info.desktopUrl.split('/#')[0] + route, { ...options, headers: { Authorization: 'Bearer ' + p.get('token'), 'X-Toolbox-Id': p.get('id'), ...options.headers } });
}
test('reuses existing ID, deduplicates across restart and never changes main config', async t => {
  const { root, service, identity } = fixture(t); await service.start();
  assert.deepEqual(service.status().identity, identity);
  assert.equal((await request(service, '/api/op', { method: 'POST', body: JSON.stringify(stroke()) })).status, 200);
  assert.equal((await (await request(service, '/api/op', { method: 'POST', body: JSON.stringify(stroke()) })).json()).duplicate, true);
  const restored = new DrawingSync({ userDataDir: root, port: 0 });
  assert.equal(restored.commit(stroke()).duplicate, true);
  assert.deepEqual(restored.state.objects.stroke1.points, [[10, 20, .1], [30, 40, 1]]);
  assert.equal(fs.readFileSync(path.join(root, 'config.json'), 'utf8'), 'font-and-key-sentinel');
});
test('two peers retain independent strokes, removal and replay remain ordered', t => {
  const { service } = fixture(t);
  for (const value of [null, 123, undefined, {}, '__proto__']) { const op = stroke(); op.id = value; assert.throws(() => service.commit(op)); }
  service.commit(stroke('from-ipad')); service.commit(stroke('from-desktop', 'desktop'));
  assert.equal(Object.keys(service.state.objects).length, 2);
  service.commit({ id: 'erase-1', client: 'desktop', kind: 'remove', target: 'from-ipad' });
  assert.deepEqual(Object.keys(service.state.objects), ['from-desktop']);
  assert.equal(service.commit(stroke('from-ipad')).duplicate, true);
  assert.equal(service.state.seq, 3);
});
test('pressure brush settings and opaque PencilKit data survive persistence without changing old strokes', t => {
  const { root, service } = fixture(t), original = stroke(); service.commit(original);
  const op = stroke('native-ink');
  op.value.style = { engine: 'ribbon-v1', smoothing: .35, sensitivity: .8 };
  op.value.ink = { format: 'pencilkit-v1', data: Buffer.from('opaque native drawing').toString('base64') };
  service.commit(op);
  const reopened = new DrawingSync({ userDataDir: root, port: 0 });
  assert.deepEqual(reopened.state.objects['native-ink'].style, op.value.style);
  assert.deepEqual(reopened.state.objects['native-ink'].ink, op.value.ink);
  assert.equal(reopened.state.objects.stroke1.style, undefined);
  for (const override of [{ style: { ...op.value.style, sensitivity: 20 } }, { ink: { format: 'pencilkit-v1', data: '../not-base64!' } }]) {
    const bad = stroke('bad-' + Math.random().toString(16).slice(2)); Object.assign(bad.value, override); assert.throws(() => service.commit(bad));
  }
});
test('invalid operations, excessive coordinates, prototype keys and disk failure do not acknowledge or change state', t => {
  const { service } = fixture(t);
  for (const change of [{ points: [[0, 0, 3]] }, { x: Infinity }, { id: '__proto__' }, { page: 'missing' }, { asset: '../../config.json', type: 'image' }]) {
    const op = stroke(); Object.assign(op.value, change); assert.throws(() => service.commit(op)); assert.equal(service.state.seq, 0);
  }
  const original = service.file; service.file = path.join(service.root, 'blocked', 'notebook.json'); fs.mkdirSync(service.root, { recursive: true }); fs.writeFileSync(path.join(service.root, 'blocked'), 'file');
  assert.throws(() => service.commit(stroke())); assert.equal(service.state.seq, 0); service.file = original;
});
test('unauthorized, wrong device, cross-origin, host rebinding and remote control routes rejected; rotation disconnects old pairing', async t => {
  const { service } = fixture(t); await service.start();
  const info = service.status(), base = info.desktopUrl.split('/#')[0];
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await request(service, '/api/state', { headers: { 'X-Toolbox-Id': 'another-device' } })).status, 401);
  assert.equal((await request(service, '/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const rebound = await new Promise((resolve, reject) => { const req = require('node:http').get(base + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(rebound, 403);
  assert.equal((await request(service, '/api/command', { method: 'POST', body: '{}' })).status, 404);
  const old = new URLSearchParams(info.desktopUrl.split('#')[1]); await service.rotate();
  assert.equal((await request(service, '/api/state', { headers: { Authorization: 'Bearer ' + old.get('token') } })).status, 401);
});
test('normalized image upload reaches second peer; invalid bytes and path traversal cannot read data', async t => {
  const { service } = fixture(t); await service.start();
  const sharp = require('sharp'); const bytes = await sharp({ create: { width: 80, height: 40, channels: 4, background: '#457c99' } }).png().toBuffer();
  const image = await (await request(service, '/api/image', { method: 'POST', body: bytes })).json(); assert.equal(image.width, 80);
  service.commit({ id: 'add-image', client: 'desktop', kind: 'put', value: { id: 'image-1', page: 'first', type: 'image', asset: image.asset, x: 10, y: 10, w: 80, h: 40 } });
  const state = await (await request(service, '/api/state')).json(); assert.equal(state.objects['image-1'].asset, image.asset);
  const png = await request(service, '/api/image/' + image.asset); assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await request(service, '/api/image', { method: 'POST', body: 'invalid' })).status, 400);
  assert.equal((await request(service, '/api/image/config.json')).status, 404);
});
test('SSE provides reconnect snapshot, live preview then durable operation; stop closes streams', async t => {
  const { service } = fixture(t); await service.start();
  const stream = await request(service, '/api/events'), reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: snapshot/);
  await request(service, '/api/live', { method: 'POST', body: JSON.stringify({ client: 'ipad', value: stroke().value }) });
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: live/);
  service.commit(stroke()); assert.match(new TextDecoder().decode((await reader.read()).value), /event: operation/);
  await reader.cancel(); await service.stop(); assert.equal(service.status().enabled, false);
});
