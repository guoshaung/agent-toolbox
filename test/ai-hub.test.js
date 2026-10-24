'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { AiHub, endpoint } = require('../src/main/ai-hub');

const encryptionKey = crypto.randomBytes(32);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString(text) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); const data = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); },
  decryptString(data) { const c = crypto.createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12)); c.setAuthTag(data.subarray(12, 28)); return Buffer.concat([c.update(data.subarray(28)), c.final()]).toString(); },
};
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-ai-hub-'));
  const hub = new AiHub({ directory, safeStorage: storage, ...options });
  t.after(async () => { await hub.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return hub;
}
async function upstream(t, fn) {
  const server = http.createServer(fn);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
function add(hub, baseUrl, extra = {}) {
  const before = new Set(hub.state.channels.map(c => c.id));
  hub.save({ name: 'test channel', baseUrl, model: 'upstream-model', apiKey: 'secret-upstream-key', priority: 50, enabled: true, ...extra });
  return hub.state.channels.find(c => !before.has(c.id));
}
async function request(hub, body = {}, options = {}) {
  return fetch(hub.status().baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${hub.token}`, 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }], ...body }), ...options });
}
const response = (res, usage = { prompt_tokens: 12, completion_tokens: 8 }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage })); };

test('encrypted independent state preserves the original config and hides all keys from status', async t => {
  const hub = await fixture(t);
  const original = path.join(path.dirname(hub.file), 'config.json'); fs.writeFileSync(original, '{"font":"custom","key":"unchanged"}');
  const c = add(hub, 'https://example.com/v1');
  await hub.start(0);
  assert.ok(!JSON.stringify(hub.status()).includes('secret-upstream-key'));
  assert.ok(!JSON.stringify(hub.status()).includes(hub.token));
  assert.ok(!fs.readFileSync(hub.file, 'utf8').includes('secret-upstream-key'));
  const reloaded = new AiHub({ directory: path.dirname(hub.file), safeStorage: storage });
  assert.equal(reloaded.resolved(reloaded.state.channels[0]).key, 'secret-upstream-key');
  reloaded.save({ ...reloaded.status().channels[0], name: 'renamed', apiKey: '' });
  assert.equal(reloaded.resolved(reloaded.state.channels[0]).key, 'secret-upstream-key');
  assert.equal(fs.readFileSync(original, 'utf8'), '{"font":"custom","key":"unchanged"}');
  assert.equal(c.id, reloaded.state.channels[0].id);
});
test('corrupt state and insecure secret store fail closed', async t => {
  const hub = await fixture(t, { safeStorage: { isEncryptionAvailable: () => false } });
  assert.throws(() => add(hub, 'https://example.com'), /安全存储/);
  fs.writeFileSync(hub.file, '{broken');
  assert.throws(() => new AiHub({ directory: path.dirname(hub.file), safeStorage: storage }), /保留原文件/);
  assert.equal(fs.readFileSync(hub.file, 'utf8'), '{broken');
});
test('loopback listener requires token; browser origins and foreign Hosts are rejected', async t => {
  const hub = await fixture(t); await Promise.all([hub.start(0), hub.start(0)]);
  assert.equal(hub.server.address().address, '127.0.0.1');
  assert.equal((await fetch(hub.status().baseUrl + '/models')).status, 401);
  assert.equal((await fetch(hub.status().baseUrl + '/models', { headers: { Authorization: `Bearer ${hub.token}`, Origin: 'https://untrusted.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(hub.status().baseUrl + '/models', { headers: { Authorization: `Bearer ${hub.token}`, Host: 'attacker.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const old = hub.token; hub.rotate();
  assert.equal((await fetch(hub.status().baseUrl + '/models', { headers: { Authorization: `Bearer ${old}` } })).status, 401);
});
test('priority failover uses a different key/model and records usage without prompt storage', async t => {
  let called = 0;
  const first = await upstream(t, (_req, res) => { res.writeHead(429, { 'Retry-After': '10' }); res.end(); });
  const second = await upstream(t, async (req, res) => {
    called++; let body = ''; for await (const b of req) body += b;
    assert.equal(JSON.parse(body).model, 'second-model'); assert.equal(req.headers.authorization, 'Bearer second-key'); response(res);
  });
  const hub = await fixture(t); const a = add(hub, first, { priority: 1 });
  add(hub, second, { priority: 2, model: 'second-model', apiKey: 'second-key' }); await hub.start(0);
  const result = await request(hub); assert.equal(result.status, 200); assert.equal((await result.json()).model, 'auto');
  assert.equal(called, 1); assert.ok(hub.cooldowns.get(a.id) > Date.now());
  assert.equal(hub.status().channels[1].stats.inputTokens, 12);
  assert.equal(hub.status().channels[0].stats.failures, 1);
  assert.ok(!fs.readFileSync(hub.file, 'utf8').includes('PRIVATE_PROMPT'));
  const fixed = await request(hub, { model: a.id }); assert.equal(fixed.status, 429); assert.equal(called, 1);
});
test('no hidden fallback for ambiguous connection failure or authentication rejection', async t => {
  let calls = 0;
  const fail = await upstream(t, (_req, res) => { res.writeHead(401); res.end('sensitive upstream diagnostic'); });
  const good = await upstream(t, (_req, res) => { calls++; response(res); });
  const hub = await fixture(t); add(hub, fail, { priority: 1 }); add(hub, good, { priority: 2 }); await hub.start(0);
  const r = await request(hub); assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('sensitive')); assert.equal(calls, 0);
  hub.fetch = async () => { throw Error('private diagnostic'); };
  const network = await request(hub); assert.equal(network.status, 502); assert.ok(!(await network.text()).includes('private')); assert.equal(calls, 0);
});
test('SSE relays split Unicode/usage and counts one completed generation', async t => {
  const base = await upstream(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const data = Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n');
    res.write(data.subarray(0, 48)); setTimeout(() => res.end(data.subarray(48)), 10);
  });
  const hub = await fixture(t); add(hub, base); await hub.start(0);
  const r = await request(hub, { stream: true }); assert.match(await r.text(), /你好/);
  assert.equal(hub.status().channels[0].stats.completed, 1); assert.equal(hub.status().channels[0].stats.outputTokens, 2);
});
test('truncated streams count as failure and never switch providers after output', async t => {
  let fallback = 0;
  const base = await upstream(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); });
  const other = await upstream(t, (_req, res) => { fallback++; response(res); });
  const hub = await fixture(t); add(hub, base, { priority: 1 }); add(hub, other, { priority: 2 }); await hub.start(0);
  try { const r = await request(hub, { stream: true }); await r.text(); } catch { /* expected stream disconnect */ }
  assert.equal(hub.status().channels[0].stats.failures, 1); assert.equal(hub.status().channels[0].stats.completed, 0); assert.equal(fallback, 0);
});
test('manual quota is a snapshot, API refresh validates fields and preserves old value on failure', async t => {
  let valid = true;
  const base = await upstream(t, (req, res) => { assert.equal(req.headers.authorization, 'Bearer secret-upstream-key'); res.end(JSON.stringify(valid ? { data: { remaining: 123 } } : { data: {} })); });
  const hub = await fixture(t); const c = add(hub, base, { quotaPath: '/quota', remainingPath: 'data.remaining', quotaUnit: 'credits' });
  hub.manualQuota({ id: c.id, remaining: 0, unit: '次' }); assert.equal(hub.status().channels[0].quota.source, 'manual');
  await hub.refreshQuota(c.id); assert.equal(hub.status().channels[0].quota.remaining, 123); assert.equal(hub.status().channels[0].quota.source, 'api');
  valid = false; await assert.rejects(hub.refreshQuota(c.id), /余额字段/); assert.equal(hub.status().channels[0].quota.remaining, 123);
  assert.throws(() => hub.manualQuota({ id: c.id, remaining: null, unit: '次' }), /非负/);
  assert.throws(() => hub.save({ ...hub.status().channels[0], quotaPath: '//example.org/leak' }), /额度路径/);
});
test('redirect responses never forward credentials to a second endpoint', async t => {
  let leaked = false;
  const target = await upstream(t, (_req, res) => { leaked = true; response(res); });
  const base = await upstream(t, (_req, res) => { res.writeHead(307, { Location: target + '/chat/completions' }); res.end(); });
  const hub = await fixture(t); add(hub, base); await hub.start(0);
  const r = await request(hub); assert.equal(r.status, 502); assert.equal(leaked, false);
});
test('read-only reference resolves current API at request time without copying its key', async t => {
  let config = { baseUrl: 'https://example.com/v1', model: 'old-model', key: 'ORIGINAL_KEY' };
  const hub = await fixture(t, { currentApi: () => config });
  hub.save({ name: 'original', source: 'current', enabled: true });
  config = { ...config, model: 'new-model' };
  assert.equal(hub.status().channels[0].model, 'new-model'); assert.ok(!fs.readFileSync(hub.file, 'utf8').includes('ORIGINAL_KEY'));
});
test('rejects invalid requests and stops slow upstream work on service stop', async t => {
  const base = await upstream(t, () => {});
  const hub = await fixture(t); add(hub, base); await hub.start(0);
  assert.equal((await request(hub, { messages: [], stream: 'true' })).status, 400);
  const pending = request(hub).catch(() => null); await new Promise(resolve => setTimeout(resolve, 50));
  await hub.stop(); await pending; assert.equal(hub.status().running, false);
});
test('endpoint normalization preserves version paths and rejects embedded credentials', () => {
  assert.equal(endpoint('https://example.com/api/v3/'), 'https://example.com/api/v3');
  assert.equal(endpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1');
  assert.throws(() => endpoint('http://remote.example/v1'), /HTTPS/);
  assert.throws(() => endpoint('https://user:pass@example.com/v1'), /账号/);
});
