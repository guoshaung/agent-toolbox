'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('数字人讲稿按标点与长度拆成适合朗读的字幕句', async () => {
  const { speechSegments } = await import('../src/renderer/tools/digital-human/logic.js');
  const segments = speechSegments('第一句。第二句很长，包含一个需要停顿的说明，以及更多内容。');
  assert.deepEqual(segments.slice(0, 2), ['第一句。', '第二句很长，包含一个需要停顿的说明，以及更多内容。']);
  assert.ok(speechSegments('abcdefghijklmnopqrstuvwxyz', 10).every((item) => item.length <= 10));
});

test('数字人可以从 PPT 页面的标题、要点和讲稿生成连续讲解', async () => {
  const { avatarById, AVATARS, deckToSpeech, personaById } = await import('../src/renderer/tools/digital-human/logic.js');
  const text = deckToSpeech({ slides: [{ title: '方法', subtitle: '输入到输出', bullets: ['先清洗数据', '再验证结果'], notes: '最后提醒限制。' }] });
  assert.match(text.join(' '), /方法/);
  assert.match(text.join(' '), /清洗数据/);
  assert.equal(personaById('missing').id, 'researcher');
  assert.equal(AVATARS.length, 4);
  assert.equal(avatarById('robot').shortLabel, 'ROBOT');
  assert.equal(avatarById('missing').id, 'crystal');
});
