'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tidy = require('../src/main/tidy');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-'));
const touch = (p, content = '') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

test('classifyDir：有 package.json 就是项目；全是图就是图片堆；空的就是空', () => {
  const d = tmp();
  touch(path.join(d, 'proj', 'package.json'), '{}');
  assert.equal(tidy.classifyDir(path.join(d, 'proj')).kind, 'project');
  for (const n of ['a.png', 'b.jpg', 'c.HEIC']) touch(path.join(d, 'pics', n));
  assert.equal(tidy.classifyDir(path.join(d, 'pics')).kind, 'images');
  fs.mkdirSync(path.join(d, 'nothing'));
  assert.equal(tidy.classifyDir(path.join(d, 'nothing')).kind, 'empty');
  touch(path.join(d, 'loose', 'x.py')); touch(path.join(d, 'loose', 'y.py')); touch(path.join(d, 'loose', 'readme.txt'));
  assert.equal(tidy.classifyDir(path.join(d, 'loose')).kind, 'project', '一半以上是代码文件也算项目');
});

test('classifyFile 与 looksCareless', () => {
  assert.equal(tidy.classifyFile('论文.pdf'), 'doc');
  assert.equal(tidy.classifyFile('Setup.DMG'), 'installer');
  assert.equal(tidy.classifyFile('a.tar.gz'), 'archive');
  assert.equal(tidy.classifyFile('whatever'), 'other');
  assert.equal(tidy.looksCareless('44564577'), true);
  assert.equal(tidy.looksCareless('未命名文件夹 3'), true);
  assert.equal(tidy.looksCareless('test2'), true);
  assert.equal(tidy.looksCareless('agent-toolbox'), false);
});

test('suggest：每类都有去处，空文件夹建议删，认不出的标 unsure', () => {
  const items = [
    { name: 'p', isDir: true, kind: 'project', markers: ['package.json'] },
    { name: 'x.pdf', isDir: false, kind: 'doc' },
    { name: 'e', isDir: true, kind: 'empty' },
    { name: 'm', isDir: true, kind: 'mixed', sample: ['a', 'b'] },
  ];
  const out = tidy.suggest(items, { codeDir: '/tmp/code' });
  assert.equal(out[0].to, '/tmp/code');
  assert.ok(out[1].to.endsWith(path.join('收纳', '文档')), out[1].to);   // Windows 是反斜杠
  assert.equal(out[2].action, 'delete');
  assert.equal(out[3].action, 'unsure');
});

test('refine：模型的回答只在白名单里生效，答坏了保持 unsure', async () => {
  const items = tidy.suggest([{ name: 'm', isDir: true, kind: 'mixed', sample: ['a'] }, { name: 'n', isDir: true, kind: 'mixed' }], {});
  const ask = async () => ({ ok: true, text: '```json\n[{"i":1,"to":"docs","reason":"都是文档"},{"i":2,"to":"/etc","reason":"x"}]\n```' });
  const out = await tidy.refine(items, ask, {});
  assert.equal(out[0].action, 'move'); assert.ok(out[0].to.endsWith('文档')); assert.match(out[0].reason, /^AI：/);
  assert.equal(out[1].action, 'unsure', '不在白名单里的去处不接受');
  const broken = await tidy.refine(tidy.suggest([{ name: 'm', isDir: true, kind: 'mixed' }], {}), async () => ({ ok: true, text: '我不知道' }), {});
  assert.equal(broken[0].action, 'unsure');
});

test('apply：只允许搬三处顶层的东西；目的地必须在主目录里', async () => {
  const ud = tmp();
  const r = await tidy.apply(ud, [{ path: '/etc/hosts', to: path.join(tidy.HOME, '收纳'), action: 'move' }]);
  assert.equal(r.ok, false); assert.match(r.errors[0], /不在允许范围/);
  const r2 = await tidy.apply(ud, [{ path: path.join(tidy.HOME, 'Desktop', '不存在的东西-xyz'), to: path.join(tidy.HOME, '收纳'), action: 'move' }]);
  assert.match(r2.errors[0], /已经不在了/);
});

test('undo：没有记录时给出能看懂的提示', () => {
  const r = tidy.undo(tmp());
  assert.equal(r.ok, false); assert.match(r.error, /没有可以撤销/);
});

test('projectFacts：认出清单、README、入口，目录树跳过 node_modules', () => {
  const d = tmp();
  touch(path.join(d, 'package.json'), '{"name":"demo","scripts":{"start":"node index.js"}}');
  touch(path.join(d, 'README.md'), '# demo\n\n一个演示');
  touch(path.join(d, 'index.js'), '');
  touch(path.join(d, 'node_modules', 'x', 'index.js'), '');
  touch(path.join(d, 'src', 'a.js'), '');
  const f = tidy.projectFacts(d);
  assert.equal(f.ok, true);
  assert.deepEqual(f.markers, ['package.json']);
  assert.ok(f.entries.includes('index.js') && f.entries.includes('src'));
  assert.match(f.manifest, /"start"/);
  assert.match(f.readme, /一个演示/);
  assert.doesNotMatch(f.tree, /node_modules/);
  assert.equal(tidy.projectFacts(path.join(d, 'index.js')).ok, false, '文件不是项目');
});

test('overview：把事实喂给模型，回 markdown', async () => {
  const d = tmp(); touch(path.join(d, 'go.mod'), 'module demo');
  const r = await tidy.overview(d, async (msgs) => { assert.match(msgs[1].content, /go\.mod/); return { ok: true, text: '## 这是什么\n一个 Go 项目' }; });
  assert.equal(r.ok, true); assert.match(r.markdown, /Go 项目/); assert.deepEqual(r.facts.markers, ['go.mod']);
});

test('装着好几个代码仓库的文件夹算「项目集」，建议原地不动；recent 不往仓库里钻', () => {
  const d = tmp();
  touch(path.join(d, 'ws', 'a', 'package.json'), '{}'); touch(path.join(d, 'ws', 'b', 'go.mod'), '');
  assert.equal(tidy.classifyDir(path.join(d, 'ws')).kind, 'workspace');
  const out = tidy.suggest([{ name: 'ws', isDir: true, kind: 'workspace', repos: 2 }], {});
  assert.equal(out[0].action, 'keep');
});
