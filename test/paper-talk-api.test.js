'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PaperTalkService } = require('../src/main/paper-talk-service');
const { normalizePlan, normalizeNarration, extractPaperHtml } = require('../src/main/paper-talk-lesson');

function planRaw() {
  return { title: '讲解', slides: Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}`, title: `教学页${i + 1}`,
    objective: '理解完整问题', takeaway: '要点结论', source: 'Section 2', emphasis: i >= 2 ? 'core' : 'support',
    points: [{ heading: '核心概念', detail: '这是一段对概念的具体解释' }, { heading: '证据', detail: '用原论文证据支持该概念' }] })) };
}

function narration(plan) {
  return { segments: plan.slides.flatMap(s => ['A', 'B'].map(speaker => ({ speaker, text: '具体方法及其证据', slideId: s.id, focus: 0, caption: '本页重点' }))) };
}

function service(t, generateScript) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-api-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new PaperTalkService({ userDataDir: dir, generateScript,
    resolveClaude: () => { throw new Error('API mode must not invoke Claude'); } });
}

test('论文讲解使用注入的 API，解析并规范化脚本，无需 Claude 登录', async (t) => {
  const svc = service(t, async (prompt) => {
    assert.match(prompt, /Test paper/);
    return prompt.includes('此时不要写主播台词') ? JSON.stringify(planRaw()) : JSON.stringify(narration(planRaw()));
  });
  const result = await svc.writeScript({ title: 'Test paper' }, '');
  assert.equal(result.slides.length, 8);
  assert.equal(result.segments.length, 16);
  assert.equal(result.segments[0].slideId, result.segments[1].slideId);
  assert.equal(result.version, 2);
});

test('API 报错直接反馈，任务锁释放，且不回退到失效的 CLI', async (t) => {
  const svc = service(t, async () => { throw new Error('API 401'); });
  svc.fetchPaper = async () => ({ id: '2406.13352', title: 'Test paper' });
  assert.deepEqual(await svc.run({ input: '2406.13352' }), { ok: false, error: 'API 401' });
  assert.equal(svc._busy, false);
});

test('模型返回全空台词时，禁止进入合成', async (t) => {
  const svc = service(t, async () => '{"segments":[{"text":"  "}]}');
  await assert.rejects(svc.writeScript({}, '', normalizePlan(planRaw(), {})), /台词没有对应教学页/);
});

test('教学规划拒绝只有标题的页面', () => {
  const plan = planRaw(); plan.slides[3].points = [{ heading: '标题', detail: '' }];
  assert.throws(() => normalizePlan(plan, {}), /不能只有标题/);
});

test('台词必须覆盖每个主题页，至少两轮再换页', () => {
  const plan = normalizePlan(planRaw(), {});
  const raw = narration(plan); raw.segments.pop();
  assert.throws(() => normalizeNarration(raw, plan), /至少两轮对话/);
});

test('图表 URL 只允许原论文资源，正文保留实验末尾', () => {
  const html = '<article><h2>Results</h2><p>Full experiment findings.</p><figure id="f1"><object data="2406.13352v1/result.svg"></object><figcaption>Figure 1: Results</figcaption></figure><figure id="f2"><img src="http://127.0.0.1/secret"></figure></article>';
  const got = extractPaperHtml(html, 'https://arxiv.org/html/2406.13352');
  assert.match(got.body, /Full experiment findings/);
  assert.equal(got.figures.length, 1);
  assert.equal(got.figures[0].url, 'https://arxiv.org/html/2406.13352v1/result.svg');
});
