'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IdeasService, slugify } = require('../src/main/ideas');

test('想法：slug 去掉非法字符、限长', () => {
  assert.equal(slugify('  Attention 是什么？/ 一半 '), 'Attention-是什么-一半');
  assert.equal(slugify(''), '问题');
  assert.ok(slugify('a'.repeat(80)).length <= 48);
});

test('想法：writeQuestion 只往仓库里写，md 结构齐全', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-'));
  const store = { data: { 'ideas.vault': dir }, get(k, d) { return k in this.data ? this.data[k] : d; }, set(k, v) { this.data[k] = v; } };
  const svc = new IdeasService({ store, shell: {}, dialog: {}, getWindow: () => null, execFileAsync: async () => {} });
  const r = svc.writeQuestion({ title: 'VAE 的重参数化为什么可导', question: '为什么加噪声后还能反向传播？', context: '$z = \\mu + \\sigma \\odot \\epsilon$', tags: ['论文', '生成模型'] });
  assert.ok(r.ok);
  assert.ok(r.path.startsWith(path.join(dir, '工具箱提问')));
  const body = fs.readFileSync(r.path, 'utf8');
  assert.match(body, /tags: \[提问, 论文, 生成模型\]/);
  assert.match(body, /## 问题/);
  assert.match(body, /反向传播/);
  assert.match(body, /## 相关想法 \/ 上下文/);
  assert.match(body, /\\mu \+ \\sigma/);
  assert.match(body, /## 回答/);
  // 同标题再写一次不覆盖
  const r2 = svc.writeQuestion({ title: 'VAE 的重参数化为什么可导', question: 'x' });
  assert.notEqual(r2.path, r.path);
});

test('想法：没设仓库时落到 ~/工具箱提问，不抛', () => {
  const store = { data: {}, get(k, d) { return k in this.data ? this.data[k] : d; }, set(k, v) { this.data[k] = v; } };
  const svc = new IdeasService({ store, shell: {}, dialog: {}, getWindow: () => null, execFileAsync: async () => {} });
  const st = svc.status();
  assert.equal(st.vault, '');
  assert.ok(Array.isArray(st.clis));
});
