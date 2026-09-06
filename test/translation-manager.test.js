'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('TranslationManager caches by paper, paragraph, language and provider version', async () => {
  const { TranslationManager, hash } = await import('../src/renderer/tools/research/translation-manager.js');
  const saved = new Map();
  const config = { get: (key, fallback) => saved.get(key) ?? fallback, set: (key, value) => saved.set(key, value) };
  const manager = new TranslationManager({ config, paperId: 'paper-a' });
  global.window = { toolbox: { translation: { argos: async () => ({ ok: true, translation: '你好' }) } } };
  const first = await manager.translateParagraph('Hello', { paragraphId: 'p_001' });
  const second = await manager.translateParagraph('Hello', { paragraphId: 'p_001' });
  assert.equal(first.provider, 'argos');
  assert.equal(second.cached, true);
  assert.notEqual(hash('paper-a'), hash('paper-b'));
});

test('TranslationManager does not call an LLM when local providers are unavailable', async () => {
  const { TranslationManager } = await import('../src/renderer/tools/research/translation-manager.js');
  const manager = new TranslationManager({ config: { get: () => ({}), set: () => {} }, paperId: 'paper-b' });
  global.window = { toolbox: { translation: { argos: async () => ({ ok: false }) } } };
  const result = await manager.translateSelection('A paragraph', { paragraphId: 'p_002' });
  assert.equal(result.ok, false);
  assert.match(result.error, /本地翻译不可用/);
});

test('TranslationManager protects scientific identifiers and restores them after local translation', async () => {
  const { TranslationManager } = await import('../src/renderer/tools/research/translation-manager.js');
  let received = '';
  global.window = { toolbox: { translation: { argos: async ({ text }) => {
    received = text;
    return { ok: true, translation: `译文 ${text}` };
  } } } };
  const manager = new TranslationManager({ config: { get: () => ({}), set: () => {} }, paperId: 'paper-c' });
  const source = 'We evaluate RSI agents on MASEval [12] with P(x|y). See Figure 2 and https://example.test.';
  const result = await manager.translateParagraph(source, { paragraphId: 'p_003' });
  assert.doesNotMatch(received, /RSI|MASEval|\[12\]|P\(x\|y\)|Figure 2|https:\/\/example\.test/);
  assert.match(result.translation, /RSI/);
  assert.match(result.translation, /MASEval \[12\]/);
  assert.match(result.translation, /P\(x\|y\)/);
  assert.match(result.translation, /Figure 2/);
  assert.match(result.translation, /https:\/\/example\.test/);
});

test('TranslationManager exposes model installation only as an explicit action', async () => {
  const { TranslationManager } = await import('../src/renderer/tools/research/translation-manager.js');
  let installs = 0;
  global.window = { toolbox: { translation: {
    argos: async () => ({ ok: false, code: 'models-missing', error: 'missing', canInstall: true }),
    installArgosModels: async () => { installs += 1; return { ok: true }; },
  } } };
  const manager = new TranslationManager({ config: { get: () => ({}), set: () => {} }, paperId: 'paper-d' });
  const result = await manager.translateParagraph('Hello', { paragraphId: 'p_004' });
  assert.equal(result.canInstall, true);
  assert.equal(installs, 0);
  assert.equal((await manager.installArgosModels()).ok, true);
  assert.equal(installs, 1);
});
