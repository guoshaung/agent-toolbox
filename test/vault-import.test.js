'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mapProvider, parseToml, readProviders, importCcSwitch, sqliteBin } = require('../src/main/vault-import');

// 全部是假 key，只看形状
const FAKE = 'sk-test-0000000000000000000000000000000000000000';

test('CC Switch 导入：claude 的 env 里拿 token / base url / 模型', () => {
  const r = mapProvider({ id: 'a', app_type: 'claude', name: '公司', is_current: 1, settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: FAKE, ANTHROPIC_BASE_URL: 'https://api.example.com/', ANTHROPIC_MODEL: 'claude-opus-4-8' } }) });
  assert.equal(r.skip, undefined);
  assert.equal(r.entry.title, '公司（claude）');
  assert.equal(r.entry.key, FAKE);
  assert.equal(r.entry.url, 'https://api.example.com/');
  assert.match(r.entry.notes, /模型：claude-opus-4-8/);
  assert.deepEqual(r.entry.tags, ['cc-switch', 'claude', 'current']);
});

test('CC Switch 导入：codex 的 key 在 auth 里，base_url / model 从 toml 文本里抠', () => {
  const toml = 'model = "gpt-5"\nmodel_provider = "x"\n\n[model_providers.x]\nname = "x"\nbase_url = "https://x.example.com/v1"\nwire_api = "responses"\n';
  assert.equal(parseToml(toml, 'base_url'), 'https://x.example.com/v1');
  assert.equal(parseToml(toml, 'model'), 'gpt-5');
  const r = mapProvider({ id: 'c', app_type: 'codex', name: 'school', settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: FAKE }, config: toml }) });
  assert.equal(r.entry.key, FAKE);
  assert.equal(r.entry.url, 'https://x.example.com/v1');
  assert.match(r.entry.notes, /模型：gpt-5/);
});

test('CC Switch 导入：codex OAuth 登录（只有 tokens 没 key）跳过，并说明原因', () => {
  const r = mapProvider({ id: 'o', app_type: 'codex', name: 'OpenAI Official', settings_config: JSON.stringify({ auth: { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: 'x', access_token: 'y', refresh_token: 'z' } }, config: '' }) });
  assert.match(r.skip, /OAuth/);
});

test('CC Switch 导入：hermes / openclaw 各自的字段名，模型列表进备注', () => {
  const h = mapProvider({ id: 'h', app_type: 'hermes', name: 'openrouter', settings_config: JSON.stringify({ name: 'openrouter', base_url: 'https://openrouter.ai/api/v1', api_key: FAKE }) });
  assert.equal(h.entry.key, FAKE); assert.equal(h.entry.url, 'https://openrouter.ai/api/v1');
  const o = mapProvider({ id: 'p', app_type: 'openclaw', name: 'ark', settings_config: JSON.stringify({ baseUrl: 'https://ark.example.com/v3', apiKey: FAKE, models: [{ id: 'm1' }, { id: 'm2' }] }) });
  assert.equal(o.entry.key, FAKE); assert.equal(o.entry.url, 'https://ark.example.com/v3');
  assert.match(o.entry.notes, /模型列表：m1, m2/);
});

test('CC Switch 导入：没 key 的（gemini 空 env）跳过；认不出的类型递归找 key', () => {
  assert.match(mapProvider({ app_type: 'gemini', name: 'g', settings_config: '{"env":{}}' }).skip, /没找到/);
  const r = mapProvider({ app_type: 'whatever', name: 'w', settings_config: JSON.stringify({ deep: { nested: { my_api_key: FAKE, endpoint: 'https://w.example.com' } } }) });
  assert.equal(r.entry.key, FAKE); assert.equal(r.entry.url, 'https://w.example.com');
});

test('CC Switch 导入：整体导入按标题去重，跳过明细带原因', () => {
  const saved = [];
  const vault = { list: () => ({ entries: [{ title: '公司（claude）' }] }), save: (e) => { saved.push(e); return { ok: true, id: 'x' }; } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsw-'));
  const db = path.join(dir, 'cc-switch.db');
  const bin = sqliteBin();
  if (!bin) { console.log('# 没有 sqlite3，跳过整体导入的集成测试'); return; }
  execFileSync(bin, [db, `CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, website_url TEXT, notes TEXT, sort_index INTEGER, is_current BOOLEAN);
    INSERT INTO providers VALUES ('1','claude','公司','${JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: FAKE, ANTHROPIC_BASE_URL: 'https://a.example.com' } }).replace(/'/g, "''")}',NULL,NULL,0,1);
    INSERT INTO providers VALUES ('2','hermes','openrouter','${JSON.stringify({ base_url: 'https://openrouter.ai/api/v1', api_key: FAKE })}',NULL,NULL,1,0);
    INSERT INTO providers VALUES ('3','gemini','g','{"env":{}}',NULL,NULL,2,0);`]);
  const read = readProviders(db);
  assert.equal(read.ok, true); assert.equal(read.rows.length, 3);
  const r = importCcSwitch(vault, { dbPath: db });
  assert.equal(r.ok, true);
  assert.equal(r.imported, 1);                       // openrouter
  assert.equal(saved[0].title, 'openrouter（hermes）');
  assert.deepEqual(r.skipped.map((s) => s.name), ['公司', 'g']);
  assert.match(r.skipped[0].reason, /同名/);
  assert.match(r.skipped[1].reason, /没找到/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CC Switch 导入：库文件不存在时给出明确错误', () => {
  const r = readProviders(path.join(os.tmpdir(), 'definitely-missing-' + Date.now() + '.db'));
  assert.equal(r.ok, false); assert.match(r.error, /没找到/);
});
