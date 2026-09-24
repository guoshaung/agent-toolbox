'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROJECTS, findWebUrl, slugify, topicMarkdown, agentLabYaml, AutoResearchService } = require('../src/main/autoresearch-service');

test('自动科研：五个项目的登记表完整', () => {
  assert.equal(PROJECTS.length, 5);
  const ids = new Set();
  for (const p of PROJECTS) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.ok(p.repo.startsWith('https://github.com/'));
    assert.ok(p.install && p.dirName && p.desc && p.tags.length);
    assert.ok(p.modes.length >= 1);
    for (const m of p.modes) {
      assert.ok(['job', 'web', 'manual'].includes(m.kind));
      if (m.kind !== 'manual') assert.ok(m.script, `${p.id}/${m.id} 没有脚本`);
      if (m.kind === 'web') assert.ok(m.url);
      if (typeof m.script === 'function') {
        const filled = Object.fromEntries((m.fields || []).map((f) => [f.key, f.default || 'x']));
        filled.slug = 'demo';
        assert.ok(m.script(filled).length > 10);
      }
    }
  }
});

test('自动科研：只认本机地址，0.0.0.0 换成 127.0.0.1', () => {
  assert.equal(findWebUrl('Running on local URL:  http://0.0.0.0:7039'), 'http://127.0.0.1:7039');
  assert.equal(findWebUrl('open http://127.0.0.1:20999/quest?x=1 now'), 'http://127.0.0.1:20999/quest?x=1');
  assert.equal(findWebUrl('see https://github.com/x'), '');
});

test('自动科研：主题文件和 yaml 改写', () => {
  assert.equal(slugify('Sparse Attention for Long Context!'), 'sparse_attention_for_long_context');
  assert.equal(slugify(''), 'topic');
  const md = topicMarkdown({ title: 'T', keywords: 'a, b', tldr: 'one', abstract: 'abs' });
  assert.ok(md.startsWith('# Title: T\n\n## Keywords\na, b\n\n## TL;DR\none\n\n## Abstract\nabs'));
  const yaml = agentLabYaml('copilot-mode: True\nresearch-topic: "old"\napi-key: "OPENAI-API-KEY-HERE"\nlanguage: "English"\n', { topic: '图神经网络 "推荐"', copilot: false });
  assert.match(yaml, /^research-topic: "图神经网络 \\"推荐\\""$/m);
  assert.match(yaml, /^language: "中文"$/m);
  assert.match(yaml, /^copilot-mode: False$/m);
  assert.match(yaml, /OPENAI-API-KEY-HERE/, 'key 那行不能动');
});

test('自动科研：参数里的 shell 字符会被拒', () => {
  const svc = new AutoResearchService({ getWindow: () => null, codeDir: () => '/nonexistent/dir' });
  const r = svc.run('ai-scientist', 'full', { ideas: 'x.json; rm -rf ~' });
  assert.equal(r.ok, false);
  assert.match(r.error, /不允许/);
  const r2 = svc.run('ai-scientist', 'idea', { title: '' });
  assert.equal(r2.ok, false);
});
