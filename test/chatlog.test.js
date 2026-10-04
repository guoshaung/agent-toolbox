'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'chat-analyze', 'chatlog.js'), 'utf8').replace(/export (function|const)/g, '$1');
const m = new Function(`${src}; return { parseChatLog, speakersOf, isGroup, guessMe, extractJson, alignMessages, newMessages, msgKey, messagePrompt, personaPrompt, groupPrompt };`)();

test('聊天记录：解析微信导出的「昵称 时间戳」格式', () => {
  const log = '小明 2026-01-02 12:00:00\n在吗\n\n我 2026-01-02 12:01:00\n在的\n刚看到';
  const msgs = m.parseChatLog(log);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].speaker, '小明'); assert.equal(msgs[0].text, '在吗');
  assert.equal(msgs[1].speaker, '我'); assert.match(msgs[1].text, /在的[\s\S]*刚看到/);
});

test('聊天记录：解析 OCR 的「昵称:内容」，过滤系统行', () => {
  const msgs = m.parseChatLog('小红：晚上一起吃饭吗\n我: 好呀\n[图片]\n对方撤回了一条消息');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].speaker, '小红'); assert.equal(msgs[1].text, '好呀');
});

test('聊天记录：单聊 / 群聊判断、找我', () => {
  const one = m.parseChatLog('a: 1\nb: 2\na: 3');
  assert.equal(m.isGroup(one), false);
  const grp = m.parseChatLog('a: 1\nb: 2\nc: 3');
  assert.equal(m.isGroup(grp), true);
  assert.equal(m.guessMe(one, 'b'), 'b');
  assert.equal(m.guessMe(m.parseChatLog('我: 1\nx: 2')), '我');
});

test('聊天记录：从模型回复里抠 JSON（裹 ``` / 有废话 / 嵌套）', () => {
  assert.deepEqual(m.extractJson('好的：```json\n[{"i":1,"emotion":"开心"}]\n```', []), [{ i: 1, emotion: '开心' }]);
  assert.deepEqual(m.extractJson('结果 {"a":{"b":1},"c":"}"} 完', {}), { a: { b: 1 }, c: '}' });
  assert.deepEqual(m.extractJson('没有 json', 'FB'), 'FB');
});

test('聊天记录：逐条结果按编号对齐、增量去重', () => {
  const msgs = [{ speaker: 'a', text: '1' }, { speaker: 'b', text: '2' }];
  const aligned = m.alignMessages(msgs, [{ i: 2, emotion: '累', intent: '抱怨' }]);
  assert.equal(aligned[0].emotion, ''); assert.equal(aligned[1].emotion, '累');
  const fresh = m.newMessages([{ speaker: 'a', text: '1' }, { speaker: 'a', text: '9' }], [m.msgKey({ speaker: 'a', text: '1' })]);
  assert.deepEqual(fresh.map((x) => x.text), ['9']);
});

test('聊天记录：提示词包含类别关键词和消息', () => {
  const msgs = m.parseChatLog('小明: 今晚去看电影吗\n我: 好');
  assert.match(m.messagePrompt(msgs, { me: '我' }), /情绪[\s\S]*意图[\s\S]*今晚去看电影/);
  assert.match(m.personaPrompt(msgs, '小明', { me: '我' }), /六维[\s\S]*MBTI[\s\S]*好感度/);
  assert.match(m.groupPrompt(msgs), /氛围[\s\S]*话题/);
});
