'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PhoneAgent, PhoneOutbox, parseAction, buildStepPrompt, compactNodes, describeNodes, mimeFor, safeName, uniquePath } = require('../src/main/phone-agent');

const nodes = [
  { i: 0, cls: 'TextView', t: '微信', c: false },
  { i: 1, cls: 'EditText', t: '', d: '搜索', e: true, c: true },
  { i: 2, cls: 'Button', t: '发送', c: true },
];

test('parseAction：只认白名单里的动作，编号必须在屏幕上', () => {
  assert.equal(parseAction('{"action":"tap","index":2}', 3).action.index, 2);
  assert.equal(parseAction('{"action":"tap","index":9}', 3).ok, false, '编号越界');
  assert.equal(parseAction('{"action":"format_disk"}', 3).ok, false, '不认识的动作');
  assert.equal(parseAction('{"action":"swipe","dir":"diagonal"}', 3).ok, false, '方向不对');
  assert.equal(parseAction('{"action":"open"}', 3).ok, false, 'open 少应用名');
  assert.equal(parseAction('我觉得应该点发送', 3).ok, false, '不是 JSON');
});

test('parseAction：剥掉 ```json 和前后废话；type 的文字会截到 500', () => {
  const r = parseAction('好的：```json\n{"action":"type","index":1,"text":"' + 'x'.repeat(900) + '"}\n```', 3);
  assert.equal(r.ok, true);
  assert.equal(r.action.text.length, 500);
});

test('提示词里带上目标、历史和每个控件的编号/标记', () => {
  const prompt = buildStepPrompt({ goal: '给张三发你好', nodes: compactNodes(nodes), history: ['点 [1]'], app: '微信' });
  assert.match(prompt, /给张三发你好/);
  assert.match(prompt, /\[1\] EditText \(搜索\) ce/, '输入框标 c 和 e');
  assert.match(prompt, /\[2\] Button "发送" c/);
  assert.match(prompt, /1\. 点 \[1\]/, '历史带编号');
  assert.match(prompt, /【当前应用】微信/);
});

test('屏幕上什么都没读到时提示词会说明，而不是空着', () => {
  assert.match(describeNodes([]), /没有读到任何控件/);
});

test('compactNodes：截长文字、最多 160 个、坏数据不炸', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ i, t: 'a'.repeat(200) }));
  const out = compactNodes([...many, null, 'junk']);
  assert.equal(out.length, 160);
  assert.equal(out[0].t.length, 80);
});

test('step：模型回的动作原样带回，并记到日志里', async () => {
  const events = [];
  const agent = new PhoneAgent({ ask: async () => ({ ok: true, text: '{"action":"tap","index":2}' }), onEvent: (e) => events.push(e) });
  const r = await agent.step({ goal: '发出去', nodes, history: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.action, { action: 'tap', index: 2 });
  assert.equal(r.target, '发送');
  assert.equal(events[0].type, 'step');
});

test('step：同一个动作连做三次就刹车，改成问用户，不再花钱问模型', async () => {
  let asked = 0;
  const agent = new PhoneAgent({ ask: async () => { asked += 1; return { ok: true, text: '{"action":"tap","index":2}' }; } });
  const same = { action: { action: 'tap', index: 2 }, text: '点 [2]' };
  const r = await agent.step({ goal: '发出去', nodes, history: [same, same, same] });
  assert.equal(r.action.action, 'ask');
  assert.equal(asked, 0);
});

test('step：目标为空 / 模型挂了 / 模型胡说，都给能看懂的错', async () => {
  const dead = new PhoneAgent({ ask: async () => ({ ok: false, error: '没网' }) });
  assert.equal((await dead.step({ goal: '', nodes })).ok, false);
  assert.match((await dead.step({ goal: 'x', nodes })).error, /没网/);
  const silly = new PhoneAgent({ ask: async () => ({ ok: true, text: '{"action":"fly"}' }) });
  assert.match((await silly.step({ goal: 'x', nodes })).error, /不认识的动作/);
});

// ---------- 传文件 ----------

test('文件名只留安全的部分：去路径、去控制字符，空了给默认名', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('报告:v2?.pdf'), '报告_v2_.pdf');
  assert.match(safeName(''), /^文件-\d+$/);
  assert.match(safeName('..'), /^文件-\d+$/);
});

test('同名文件不覆盖，编号往后排', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  fs.writeFileSync(path.join(dir, 'a.pdf'), '1');
  fs.writeFileSync(path.join(dir, 'a (2).pdf'), '2');
  assert.equal(path.basename(uniquePath(dir, 'a.pdf')), 'a (3).pdf');
  assert.equal(path.basename(uniquePath(dir, 'b.pdf')), 'b.pdf');
});

test('mime 按后缀猜，猜不到给 octet-stream', () => {
  assert.equal(mimeFor('x.PNG'), 'image/png');
  assert.equal(mimeFor('x.unknownext'), 'application/octet-stream');
});

test('出件箱：放进去、列出来（不暴露本机路径）、取走后删掉；文件夹和不存在的都拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  const file = path.join(dir, '论文.pdf');
  fs.writeFileSync(file, 'pdf');
  const box = new PhoneOutbox({ inboxDir: dir });
  const added = box.add(file);
  assert.equal(added.ok, true);
  assert.equal(added.item.name, '论文.pdf');
  assert.equal('path' in box.list()[0], false, '给手机看的列表里不带电脑路径');
  assert.equal(box.get(added.item.id).path, file, '自己取的时候有路径');
  assert.equal(box.add(dir).ok, false);
  assert.equal(box.add(path.join(dir, 'nope')).ok, false);
  assert.equal(box.remove(added.item.id), true);
  assert.equal(box.list().length, 0);
});

test('出件箱：同一个文件放两次只留一份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  const file = path.join(dir, 'a.txt'); fs.writeFileSync(file, 'a');
  const box = new PhoneOutbox({ inboxDir: dir });
  box.add(file); box.add(file);
  assert.equal(box.list().length, 1);
});

test('手机推上来的文件流式落盘，同名不覆盖，路径穿越被拦', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  const box = new PhoneOutbox({ inboxDir: dir });
  const { Readable } = require('node:stream');
  const saved = await box.receive(Readable.from([Buffer.from('hello')]), { name: '../../逃跑.txt', size: 5 });
  assert.equal(path.dirname(saved.path), dir, '不能写到收件目录外面');
  assert.equal(saved.name, '逃跑.txt');
  assert.equal(fs.readFileSync(saved.path, 'utf8'), 'hello');
  const again = await box.receive(Readable.from([Buffer.from('x')]), { name: '逃跑.txt' });
  assert.equal(again.name, '逃跑 (2).txt');
  await assert.rejects(box.receive(Readable.from([]), { name: 'big', size: 600 * 1024 * 1024 }), /512MB/);
});
