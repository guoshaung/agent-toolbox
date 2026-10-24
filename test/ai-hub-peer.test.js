'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require('js-yaml');
const net = require('node:net');
const { AiHubPeer, normalizePeerUrl, suggestPeerPort, mergeProviderPatch } = require('../src/main/ai-hub-peer');

const pluginSource = path.join(__dirname, '../assets/dsh-quota-hub-text');
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: value => Buffer.from(`encrypted:${value}`),
  decryptString: value => value.toString().replace(/^encrypted:/, ''),
};

test('peer URL accepts loopback Chat Completions and refuses a Responses endpoint', () => {
  assert.equal(normalizePeerUrl('http://127.0.0.1:18878/v1/'), 'http://127.0.0.1:18878/v1');
  assert.throws(() => normalizePeerUrl('http://127.0.0.1:18878/v1/responses'), /Responses/);
  assert.throws(() => normalizePeerUrl('http://example.test/v1'), /HTTPS/);
});

test('peer port suggestion skips a port already used by another tunnel', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const occupied = server.address().port;
  assert.ok(await suggestPeerPort(occupied, occupied + 3) > occupied);
});

test('peer checks models, encrypts only the new key, and sends a short text request', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-peer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const peer = new AiHubPeer({ directory: root, dshHome: path.join(root, '.dsh'), safeStorage: storage, portProbe: async () => true, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'auto', owned_by: 'toolbox' }, { id: 'channel-1', owned_by: 'WorkBuddy' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'x-toolbox-channel': 'channel-1' } });
  } });
  const connected = await peer.connect({ baseUrl: 'http://127.0.0.1:18878/v1', apiKey: 'secret-test-key' });
  assert.equal(connected.hasKey, true);
  assert.equal(connected.models.length, 2);
  assert.ok(!fs.readFileSync(peer.file, 'utf8').includes('secret-test-key'));
  const tried = await peer.test();
  assert.equal(tried.reply, 'OK');
  assert.equal(tried.channelSelected, true);
  assert.equal(await peer.verifyDshBridge(), true);
  assert.equal(JSON.parse(calls[1].options.body).model, 'auto');
  assert.equal(JSON.parse(calls[1].options.body).messages.length, 1);
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true });
  fs.writeFileSync(path.join(root, '.dsh/toolbox-quota-hub-last-route.json'), JSON.stringify({ at: '2026-10-24T07:00:00.000Z', channelId: 'channel-1', model: 'hy4-preview', modelSource: 'upstream' }));
  assert.deepEqual(peer.lastRoute(), { at: '2026-10-24T07:00:00.000Z', channel: 'WorkBuddy', model: 'hy4-preview', modelSource: 'upstream' });
});

test('DSH installation retains existing providers, credentials, bundles and default model', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-peer-dsh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dshHome = path.join(root, '.dsh'), profile = path.join(dshHome, 'profiles/web');
  fs.mkdirSync(profile, { recursive: true });
  const packageJson = { dependencies: { 'old-plugin': '1.0.0', 'toolbox-quota-hub-text': 'link:local' }, dsh: { profile: { bundles: ['old-plugin'] } } };
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify(packageJson));
  fs.mkdirSync(path.join(profile, 'node_modules', 'toolbox-quota-hub-text'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'node_modules', 'toolbox-quota-hub-text', 'package.json'), '{"name":"toolbox-quota-hub-text"}');
  const patch = '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers:\n      old-provider:\n        api: openai-completions\n        baseURL: https://old.example/v1\n- id: agent-default-model\n  config:\n    provider: old-provider\n    model: old-model\n';
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), patch);
  fs.writeFileSync(path.join(dshHome, '.credentials.yaml'), 'version: 1\nrefs:\n  OLD_KEY: "keep-me"\nrecords: {}\n');
  const peer = new AiHubPeer({ directory: path.join(root, 'app'), dshHome, safeStorage: storage, portProbe: async () => true, fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'auto' }] }), { status: 200 }) });
  await peer.connect({ baseUrl: 'http://127.0.0.1:18878/v1', apiKey: 'new-key' });
  const result = peer.installDsh({ pluginSource, dshCommand: '' });
  assert.equal(result.installed, true);
  assert.equal(result.restartNeeded, true);
  const updatedPatch = fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8');
  assert.match(updatedPatch, /old-provider:/);
  assert.match(updatedPatch, /provider: old-provider/);
  assert.match(updatedPatch, /toolbox-quota-hub:/);
  assert.match(updatedPatch, /baseURL: http:\/\/127\.0\.0\.1:18879\/v1/);
  const creds = yaml.load(fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8'));
  assert.equal(creds.refs.OLD_KEY, 'keep-me');
  assert.equal(creds.refs.TOOLBOX_QUOTA_HUB_API_KEY, 'new-key');
  const installed = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'));
  assert.deepEqual(installed.dsh.profile.bundles, ['old-plugin', 'toolbox-quota-hub-text']);
  assert.equal(installed.dependencies['old-plugin'], '1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dshHome, 'toolbox-quota-hub-text.json'), 'utf8')).baseUrl, 'http://127.0.0.1:18878/v1');
  peer.installDsh({ pluginSource, dshCommand: '' });
  assert.equal((fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8').match(/      toolbox-quota-hub:/g) || []).length, 1);
});

test('provider patch replaces only the hub block on repeated setup', () => {
  const base = '- id: llm-pi-ai\n  config:\n    providers:\n      old:\n        api: openai-completions\n- id: other\n';
  const once = mergeProviderPatch(base);
  const twice = mergeProviderPatch(once);
  assert.equal((twice.match(/      toolbox-quota-hub:/g) || []).length, 1);
  assert.match(twice, /      old:/);
  assert.match(twice, /- id: other/);
});

test('bundled DSH bridge preserves text turns while removing tool prelude', async () => {
  const { normalizeTextRequest, targetUrl, createModelObserver } = await import(pathToFileURL(path.join(pluginSource, 'index.js')).href);
  assert.equal(targetUrl('http://127.0.0.1:18878/v1', '/v1/chat/completions').href, 'http://127.0.0.1:18878/v1/chat/completions');
  assert.equal(targetUrl('https://example.test/api/v3', '/v1/models').href, 'https://example.test/api/v3/models');
  assert.throws(() => targetUrl('http://example.test/v1', '/v1/models'), /invalid upstream/);
  const first = { model: 'auto', stream: true, tools: [{ name: 'do-not-send' }], messages: [
    { role: 'system', content: 'system prelude' }, { role: 'user', content: 'first prompt' },
    { role: 'user', content: 'short prelude' }, { role: 'user', content: 'x'.repeat(64000) },
  ] };
  assert.deepEqual(normalizeTextRequest(first), { model: 'auto', stream: true, max_tokens: 4096, messages: [{ role: 'user', content: 'first prompt' }] });
  const second = { ...first, messages: [...first.messages,
    { role: 'assistant', content: 'first answer' }, { role: 'tool', content: 'private tool output' },
    { role: 'user', content: 'next prompt' }, { role: 'user', content: 'short prelude' }, { role: 'user', content: 'x'.repeat(64000) },
  ] };
  assert.deepEqual(normalizeTextRequest(second).messages, [
    { role: 'user', content: 'first prompt' }, { role: 'assistant', content: 'first answer' }, { role: 'user', content: 'next prompt' },
  ]);
  assert.deepEqual(normalizeTextRequest({ model: 'auto', messages: [
    { role: 'user', content: 'My code is 4321.' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'do not forward' }, { type: 'text', text: 'I will remember.' }], tool_calls: [{ id: 'hidden' }] },
    { role: 'user', content: 'What is my code?' },
  ] }).messages, [
    { role: 'user', content: 'My code is 4321.' }, { role: 'assistant', content: 'I will remember.' }, { role: 'user', content: 'What is my code?' },
  ]);
  assert.throws(() => normalizeTextRequest({ model: 'auto', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }), /图片或文件/);
  const observed = createModelObserver('text/event-stream');
  observed.push(Buffer.from('data: {"model":"hy4-'));
  observed.push(Buffer.from('preview","choices":[]}\n\ndata: [DONE]\n\n'));
  assert.deepEqual(observed.result(), { model: 'hy4-preview', complete: true });
});
