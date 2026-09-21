'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Monologue, TEMPLATES, parseJson, toCards, buildPrompt } = require('../src/main/monologue');
const { toMessages, latestIncoming } = require('../src/main/chat-read');

test('模型裹了 ```json 或者前后多说了几个字，都要能剥出来', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('好的，结果是：{"a":2} 以上'), { a: 2 });
  assert.equal(parseJson('完全不是 JSON'), null);
});

test('概率归一到 100，并按高低排序', () => {
  const cards = toCards(TEMPLATES.chat, {
    headline: '她在试探',
    answers: [{ key: 'literal', options: [{ label: '是字面意思', p: 20 }, { label: '话里有话', p: 77 }] }],
    risk: 8,
    advice: '先给行动',
  });
  const opts = cards.cards[0].options;
  assert.equal(opts.reduce((s, o) => s + o.p, 0), 100, '加起来要正好 100');
  assert.equal(opts[0].label, '话里有话', '概率高的排前面');
  assert.equal(cards.risk, 8);
});

test('risk 超出 0-10 会被夹住；模板不要 risk 时给 null', () => {
  const over = toCards(TEMPLATES.chat, { answers: [{ key: 'literal', options: [{ label: 'x', p: 1 }] }], risk: 99 });
  assert.equal(over.risk, 10);
  const none = toCards(TEMPLATES.demand, { answers: [{ key: 'clear', options: [{ label: '清楚', p: 1 }] }], risk: 5 });
  assert.equal(none.risk, null, '需求澄清模板不显示危险等级');
});

test('模型少答了某道题就跳过那题，不会整个崩掉', () => {
  const cards = toCards(TEMPLATES.chat, { answers: [{ key: 'need', options: [{ label: '行动', p: 90 }] }] });
  assert.equal(cards.cards.length, 1);
  assert.equal(cards.cards[0].q, TEMPLATES.chat.questions.find((q) => q.key === 'need').q);
});

test('提示词里每道题的 key 和选项都带上了', () => {
  const prompt = buildPrompt(TEMPLATES.chat, '你今天是不是又忘了', '对方：在吗');
  assert.match(prompt, /key=intent/);
  assert.match(prompt, /想确认你在不在乎/);
  assert.match(prompt, /对方：在吗/, '上下文要带进去');
});

test('analyze：空的、过长的都挡掉，正常的走通', async () => {
  const mono = new Monologue({
    ask: async () => ({ ok: true, text: '{"headline":"在试探","answers":[{"key":"literal","options":[{"label":"话里有话","p":100}]}],"risk":6,"advice":"别解释"}' }),
    store: { get: (k, d) => d, set: () => {} },
  });
  assert.equal((await mono.analyze('')).ok, false);
  assert.match((await mono.analyze('x'.repeat(2000))).error, /太长/);
  const ok = await mono.analyze('你今天是不是又忘了');
  assert.equal(ok.ok, true);
  assert.equal(ok.headline, '在试探');
  assert.equal(ok.advice, '别解释');
});

test('模型返回不是 JSON 时给出能看懂的错，而不是抛异常', async () => {
  const mono = new Monologue({ ask: async () => ({ ok: true, text: '我觉得她在生气' }), store: { get: (k, d) => d, set: () => {} } });
  const r = await mono.analyze('在吗');
  assert.equal(r.ok, false);
  assert.match(r.error, /不是预期格式/);
});

// ---------- 聊天窗口解析 ----------
// x/y 都是归一化的；对方的气泡贴聊天区左沿，我的贴右沿
const line = (t, x, w, y) => ({ t, x, w, y, h: 0.02 });

test('左边的会话列表要被切掉，不能当成对方说的话', () => {
  const lines = [
    line('张三  16:30', 0.05, 0.18, 0.3),     // 侧栏里的会话列表项
    line('在吗', 0.32, 0.06, 0.5),            // 聊天区里对方说的
  ];
  const msgs = toMessages(lines, { chatLeft: 0.3 });
  assert.equal(msgs.length, 1, '侧栏那条要被滤掉');
  assert.equal(msgs[0].text, '在吗');
});

test('按贴哪边分左右，长消息也不会判错', () => {
  const lines = [
    // 对方的长回复：左沿贴着 0.3，右边拖得很长 —— 按中点判会错判成「我」
    line('帮你把这篇文章的要点梳理一下，第一点是', 0.31, 0.55, 0.4),
    line('好的', 0.88, 0.08, 0.5),            // 我的短消息，贴右
  ];
  const msgs = toMessages(lines, { chatLeft: 0.3 });
  assert.equal(msgs[0].side, 'them', '长回复贴左沿，是对方说的');
  assert.equal(msgs[1].side, 'me');
});

test('右边还有面板时，chatRight 往左收能把它排除掉', () => {
  const lines = [
    line('在吗', 0.32, 0.06, 0.5),
    line('右侧面板的内容', 0.75, 0.2, 0.5),
  ];
  assert.equal(toMessages(lines, { chatLeft: 0.3, chatRight: 0.7 }).length, 1);
  assert.equal(toMessages(lines, { chatLeft: 0.3, chatRight: 1 }).length, 2);
});

test('一条消息被 OCR 拆成几行会合回去，顶部和底部的干扰会去掉', () => {
  const lines = [
    line('微信标题栏', 0.5, 0.1, 0.02),            // 顶部，滤掉
    line('这句话很长所以被拆', 0.31, 0.4, 0.40),
    line('成了两行', 0.31, 0.2, 0.415),
    line('输入框里的草稿', 0.35, 0.2, 0.95),        // 底部，滤掉
  ];
  const msgs = toMessages(lines, { chatLeft: 0.3 });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, '这句话很长所以被拆成了两行');
});

test('latestIncoming 取最下面那条对方的', () => {
  const msgs = [
    { side: 'them', text: '早' }, { side: 'me', text: '嗯' }, { side: 'them', text: '在吗' }, { side: 'me', text: '在' },
  ];
  assert.equal(latestIncoming(msgs).text, '在吗');
  assert.equal(latestIncoming([{ side: 'me', text: '只有我' }]), null);
});
