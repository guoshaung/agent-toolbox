'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translateFast, splitFastChunks } = require('../src/main/translate');

test('fast translator chooses Chinese or English and keeps requests short', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const form = new URLSearchParams(init.body);
    calls.push({ to: form.get('to'), text: form.get('q') });
    return { ok: true, json: async () => ({ errorCode: '0', translation: [`translated:${form.get('q')}`] }) };
  };
  const english = await translateFast('Hello there', { fetchImpl });
  const chinese = await translateFast('你好，世界', { fetchImpl });
  assert.equal(english.to, 'zh-CHS');
  assert.equal(chinese.to, 'en');
  assert.deepEqual(calls.map(call => call.to), ['zh-CHS', 'en']);
  assert.match(english.translation, /translated:Hello there/);
  assert.ok(Number.isInteger(english.elapsedMs));

  const chunks = splitFastChunks('This is a technical sentence. '.repeat(100));
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(chunk => chunk.length <= 450 && chunk.length > 0));
});

test('fast translator limits parallel calls and rejects unsupported input', async () => {
  let active = 0, maximum = 0;
  const result = await translateFast('A short sentence. '.repeat(100), { to: 'en', fetchImpl: async (_url, init) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { ok: true, json: async () => ({ errorCode: '0', translation: [new URLSearchParams(init.body).get('q')] }) };
  } });
  assert.equal(result.ok, true);
  assert.ok(maximum <= 2);
  assert.equal((await translateFast('x'.repeat(20001))).ok, false);
  assert.equal((await translateFast('Hello', { to: 'invalid' })).ok, false);
});
