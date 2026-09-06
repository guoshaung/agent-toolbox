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
