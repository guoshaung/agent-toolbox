'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TEXT_LENGTH,
  pythonCandidates,
  sidecarEnvironment,
  validateTranslationPayload,
} = require('../src/main/argos-service');

test('Argos payload validation limits input and language pairs', () => {
  assert.equal(validateTranslationPayload({ text: '', sourceLanguage: 'en', targetLanguage: 'zh' }).code, 'invalid-input');
  assert.equal(validateTranslationPayload({ text: 'x'.repeat(MAX_TEXT_LENGTH + 1), sourceLanguage: 'en', targetLanguage: 'zh' }).code, 'input-too-large');
  assert.equal(validateTranslationPayload({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'fr' }).code, 'unsupported-language');
  assert.deepEqual(validateTranslationPayload({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh' }), {
    ok: true, text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh',
  });
});

test('Argos sidecar receives a minimal environment without API secrets', () => {
  const env = sidecarEnvironment({
    PATH: '/bin', HOME: '/home/researcher', LANG: 'en_US.UTF-8',
    OPENAI_API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', GITHUB_TOKEN: 'secret',
  });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/home/researcher');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

test('Argos Python discovery is platform-aware', () => {
  assert.deepEqual(pythonCandidates('win32')[0], { command: 'py', args: [] });
  assert.deepEqual(pythonCandidates('darwin')[0], { command: 'python3', args: [] });
});
