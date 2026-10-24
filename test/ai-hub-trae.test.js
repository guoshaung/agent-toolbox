'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TraeIDE, parseQuota, parseModels, convertStream } = require('../src/main/ai-hub-trae');
const { AiHub } = require('../src/main/ai-hub');
const quota = () => ({ is_dollar_usage_billing: true, user_entitlement_pack_list: [{ entitlement_base_info: { ent_status: 0, start_time: 1, end_time: 4000000000, quota: { basic_usage_limit: 1, bonus_usage_limit: 0 } }, usage: { basic_usage_amount: 0.01284, bonus_usage_amount: 0 } }] });
const event = (type, data) => `event:${type}\r\ndata:${JSON.stringify(data)}\r\n\r\n`;
const transcript = () => event('metadata', { model: '' }) + event('output', { response: '你', reasoning_content: '' }) + event('output', { response: '好' }) + event('token_usage', { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 }) + event('done', { finish_reason: 'stop' });
function response(text) { const bytes = Buffer.from(text); return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.subarray(i, i + 7)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }); }
test('TRAE quota keeps dollars separate from credits and rejects unknown or inactive packs', () => {
  const result = parseQuota(quota()); assert.equal(result.unit, 'USD 额度'); assert.equal(result.remaining, 0.98716);
  for (const change of [p => delete p.usage.basic_usage_amount, p => p.entitlement_base_info.ent_status = 3, p => p.entitlement_base_info.end_time = 1]) {
    const data = quota(); change(data.user_entitlement_pack_list[0]); assert.throws(() => parseQuota(data));
  }
  assert.throws(() => parseQuota({ user_entitlement_pack_list: [] }));
  const data = quota(); data.user_entitlement_pack_list[0].usage.basic_usage_amount = 1; assert.equal(parseQuota(data).remaining, 0);
  delete data.is_dollar_usage_billing; assert.throws(() => parseQuota(data));
});
test('TRAE catalog excludes user custom keys, hidden models and internal completion helpers', () => {
  assert.deepEqual(parseModels({ config_info_list: [{ config_name: 'deepseek-v3.2' }, { config_name: 'fast_apply' }, { config_name: 'custom_model_gpt-6' }, { config_name: 'private', is_invisible_to_user: true }] }), ['deepseek-v3.2']);
});
test('TRAE translates split Unicode SSE, done and usage without treating HTTP 200 errors as success', async () => {
  const chunks = []; for await (const c of convertStream(response(transcript()).body, 'test')) chunks.push(c);
  assert.equal(chunks.map(c => c.choices?.[0]?.delta?.content || '').join(''), '你好');
  assert.equal(chunks.at(-1), '[DONE]'); assert.equal(chunks.at(-2).usage.total_tokens, 11);
  for (const text of [event('error', { code: 2001, message: 'no config' }), event('output', { response: 'partial' }), event('output', { tool_calls: [{ id: 'call' }] })]) {
    await assert.rejects(async () => { for await (const c of convertStream(response(text).body, 'test')) void c; });
  }
});
test('TRAE normal and streaming chat use the IDE schema and reject unsupported options before sending', async () => {
  let calls = 0;
  const adapter = new TraeIDE({ fetchImpl: async (url, init) => { calls++; assert.equal(new URL(url).host, 'coresg-normal.trae.ai'); assert.equal(init.headers['x-ide-version-code'], '20260212'); assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).config_name, 'deepseek-v3.2'); return response(transcript()); } });
  const input = { model: 'deepseek-v3.2', messages: [{ role: 'user', content: '你好' }] };
  const result = await (await adapter.chat({ region: 'SG', token: 'fixture' }, input)).json(); assert.equal(result.choices[0].message.content, '你好');
  assert.equal(result.usage.total_tokens, 11);
  assert.match(await (await adapter.chat({ region: 'SG', token: 'fixture' }, { ...input, stream: true })).text(), /\[DONE\]/);
  await assert.rejects(() => adapter.chat({}, { ...input, tools: [{}] }), /文本/); assert.equal(calls, 2);
});
test('TRAE imports only a binding, leaves IDE credentials unchanged, and refuses account switches', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-trae-'));
  const storageFile = path.join(directory, 'storage.json');
  const local = { 'iCubeAuthInfo://icube.cloudide': JSON.stringify({ token: 'private-fixture-token', refreshToken: 'never-import-me', userId: 'test-user', userRegion: { region: 'SG' }, expiredAt: '2090-01-01' }) };
  fs.writeFileSync(storageFile, JSON.stringify(local)); const before = fs.readFileSync(storageFile, 'utf8');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  const hub = new AiHub({ directory: path.join(directory, 'hub'), safeStorage, traeStorageFile: storageFile, fetchImpl: async url => url.includes('ent_usage') ? Response.json(quota()) : url.includes('get_detail_param') ? Response.json({ config_info_list: [{ config_name: 'deepseek-v3.2' }] }) : response(transcript()) });
  t.after(async () => { await hub.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const status = await hub.connectTrae(), c = status.channels[0]; assert.equal(c.enabled, false); assert.equal(c.model, 'deepseek-v3.2'); assert.equal(c.quota.unit, 'USD 额度');
  assert.equal(JSON.stringify(status).includes('private-fixture'), false); assert.equal(fs.readFileSync(hub.file, 'utf8').includes('private-fixture'), false);
  assert.equal(fs.readFileSync(storageFile, 'utf8'), before);
  hub.save({ ...c, enabled: true }); assert.equal(hub.status().channels[0].ready, true); assert.equal(hub.status().channels[0].quota.remaining, 0.98716);
  await hub.start(0); const res = await fetch(hub.status().baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${hub.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.id, messages: [{ role: 'user', content: 'hello' }] }) });
  assert.equal(res.status, 200); assert.equal((await res.json()).choices[0].message.content, '你好');
  const switched = JSON.parse(local['iCubeAuthInfo://icube.cloudide']); switched.userId = 'other'; local['iCubeAuthInfo://icube.cloudide'] = JSON.stringify(switched); fs.writeFileSync(storageFile, JSON.stringify(local));
  assert.equal(hub.status().channels[0].ready, false); await assert.rejects(() => hub.refreshQuota(c.id), /切换账号/);
});
test('TRAE HTTP throttling remains visible to the shared gateway without adapter retries', async () => {
  let calls = 0;
  const adapter = new TraeIDE({ fetchImpl: async () => { calls++; return new Response('limited', { status: 429, headers: { 'retry-after': '42' } }); } });
  const r = await adapter.chat({ region: 'SG', token: 'fixture' }, { model: 'deepseek-v3.2', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '42'); assert.equal(calls, 1); await r.body.cancel();
});
