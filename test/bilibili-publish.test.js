'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { BilibiliPublishService, UPLOAD_URL, officialUrl, cleanDraft, fillCreatorFields } = require('../src/main/bilibili-publish');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-publish-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputDir = path.join(dir, 'paper-talk'); fs.mkdirSync(outputDir);
  const file = path.join(outputDir, 'lesson.mp4'); fs.writeFileSync(file, 'test-only-video');
  fs.writeFileSync(file.replace('.mp4', '.timeline.json'), JSON.stringify({ title: 'AgentDojo 云组会', slides: [{ title: '方法与实验' }] }));
  fs.writeFileSync(path.join(outputDir, '2406.13352-script.json'), JSON.stringify({ title: 'AgentDojo 云组会', paper: { id: '2406.13352', title: 'AgentDojo' } }));
  const calls = [], events = [];
  let loggedIn = false;
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); calls.push(['window', options]);
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        getURL: () => UPLOAD_URL,
        setWindowOpenHandler: fn => { this.popup = fn; },
        mainFrame: { framesInSubtree: [{ url: UPLOAD_URL, executeJavaScript: async script => {
          calls.push(['fill', script]); return { title: true, description: true };
        } }] },
        debugger: {
          isAttached: () => false, attach: () => {}, detach: () => {},
          sendCommand: async (method, params) => {
            calls.push([method, params]);
            if (method === 'DOM.getDocument') return { root: { nodeId: 1, children: [] } };
            if (method === 'DOM.querySelectorAll') return { nodeIds: [2, 3] };
            if (method === 'DOM.getAttributes') return { attributes: ['accept', params.nodeId === 2 ? 'image/png' : 'video/mp4'] };
            return {};
          },
        },
      });
    }
    async loadURL(url) { calls.push(['url', url]); }
    isDestroyed() { return false; }
    show() {}
    focus() {}
  }
  const svc = new BilibiliPublishService({ outputDir, BrowserWindow: FakeWindow,
    session: { fromPartition: () => ({ cookies: { get: async () => loggedIn ? [{ name: 'SESSDATA', value: 'test-session' }] : [] } }) },
    emit: e => events.push(e),
  });
  t.after(() => { if (svc.active) svc.active.win.emit('closed'); });
  return { dir, file, svc, calls, events, login: () => { loggedIn = true; } };
}

test('投稿预览只读取自己的成片并附上来源与 AI 配音说明', t => {
  const f = fixture(t); const r = f.svc.prepare(f.file);
  assert.match(r.draft.title, /AgentDojo/);
  assert.match(r.draft.description, /https:\/\/arxiv.org\/abs\/2406.13352/);
  assert.match(r.draft.description, /TTS/);
  assert.equal(f.calls.length, 0);
  const other = path.join(f.dir, 'other.mp4'); fs.writeFileSync(other, 'private');
  assert.throws(() => f.svc.prepare(other), /只能投稿/);
});

test('未勾选具体上传确认时，不开窗口、不上传文件', async t => {
  const f = fixture(t); const { draft } = f.svc.prepare(f.file);
  const result = await f.svc.open(draft);
  assert.equal(result.ok, false); assert.equal(f.calls.length, 0);
});

test('未登录等待官方登录，登录后仅选择视频 input，不碰封面 input', async t => {
  const f = fixture(t); const { draft } = f.svc.prepare(f.file);
  assert.equal((await f.svc.open({ ...draft, consent: true })).ok, true);
  await f.svc._assist(f.svc.active);
  assert.ok(f.events.some(e => e.state === 'login-required'));
  assert.equal(f.calls.filter(c => c[0] === 'DOM.setFileInputFiles').length, 0);
  f.login(); await f.svc._assist(f.svc.active);
  const selected = f.calls.find(c => c[0] === 'DOM.setFileInputFiles');
  assert.deepEqual(selected[1], { nodeId: 3, files: [fs.realpathSync(f.file)] });
  assert.ok(f.events.some(e => e.state === 'prefilled'));
  assert.equal((await f.svc.open({ ...draft, consent: true })).ok, false);
});

test('导航和文案校验拒绝伪造官方域名与无效字段', () => {
  assert.equal(officialUrl(UPLOAD_URL), true);
  assert.equal(officialUrl('https://member.bilibili.com.evil.test/'), false);
  assert.equal(officialUrl('javascript:alert(1)'), false);
  assert.throws(() => cleanDraft({ title: 'x'.repeat(81), description: 'text', tags: ['AI'] }), /标题/);
  assert.deepEqual(cleanDraft({ title: '标题', description: '简介', tags: 'AI，论文,AI' }).tags, ['AI', '论文']);
});

test('填表脚本只写文本，不执行发布操作，且不覆盖用户后续编辑', () => {
  class Input { constructor(placeholder) { this.hint = placeholder; this._value = ''; this.tagName = 'INPUT'; } get value() { return this._value; } set value(v) { this._value = v; } getAttribute(k) { return k === 'placeholder' ? this.hint : null; } getClientRects() { return [1]; } dispatchEvent() {} }
  class Textarea extends Input { constructor() { super('填写视频简介'); this.tagName = 'TEXTAREA'; } get value() { return this._value; } set value(v) { this._value = v; } }
  const title = new Input('请输入标题'), desc = new Textarea();
  const sandbox = { location: { origin: 'https://member.bilibili.com' }, window: {},
    document: { querySelectorAll: () => [title, desc] }, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    Event: class {}, KeyboardEvent: class {},
  };
  const draft = { id: 'one', title: '论文讲解', description: '原文与AI配音', tags: ['AI'] };
  const code = `(${fillCreatorFields.toString()})(${JSON.stringify(draft)})`;
  vm.runInNewContext(code, sandbox);
  assert.equal(title.value, draft.title); assert.equal(desc.value, draft.description);
  title.value = '用户改的标题'; vm.runInNewContext(code, sandbox);
  assert.equal(title.value, '用户改的标题');
});
