'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PaperTalkService } = require('../src/main/paper-talk-service');

function service(t, generateScript) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-api-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new PaperTalkService({ userDataDir: dir, generateScript,
    resolveClaude: () => { throw new Error('API mode must not invoke Claude'); } });
}

test('论文讲解使用注入的 API，解析并规范化脚本，无需 Claude 登录', async (t) => {
  const svc = service(t, async (prompt) => {
    assert.match(prompt, /Test paper/);
    return JSON.stringify({ title: '讲解', segments: [{ speaker: 'B', text: '方法介绍', slide: { title: '核心方法', subtitle: '三个步骤' } }] });
  });
  const result = await svc.writeScript({ title: 'Test paper' }, '');
  assert.deepEqual(result.segments, [{ speaker: 'B', text: '方法介绍', title: '核心方法', subtitle: '三个步骤' }]);
});

test('API 报错直接反馈，任务锁释放，且不回退到失效的 CLI', async (t) => {
  const svc = service(t, async () => { throw new Error('API 401'); });
  svc.fetchPaper = async () => ({ id: '2406.13352', title: 'Test paper' });
  assert.deepEqual(await svc.run({ input: '2406.13352' }), { ok: false, error: 'API 401' });
  assert.equal(svc._busy, false);
});

test('模型返回全空台词时，禁止进入合成', async (t) => {
  const svc = service(t, async () => '{"segments":[{"text":"  "}]}');
  await assert.rejects(svc.writeScript({}, ''), /没有有效台词/);
});
