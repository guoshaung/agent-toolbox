'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('粘贴收藏保留原文，重新打开仍可安装，拒绝错误输入并保留其它配置', async () => {
  const nodes = [];
  function h(tag, props = {}, ...children) {
    const node = { tag, ...props, value: '', children: children.flat().filter(Boolean), style: {}, dataset: props.dataset || {},
      classList: { toggle() {} }, addEventListener() {}, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); }, replaceChildren(...items) { this.children = items; } };
    nodes.push(node);
    return node;
  }
  const state = { 'skills.view': 'favorites', font: 'my-font', selection: ['ask'] };
  const writes = [];
  const config = { get: (key, fallback) => state[key] ?? fallback, set: async (key, value) => { state[key] = value; } };
  const code = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/skills/index.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default', 'globalThis.component =');
  const context = { h, toast() {}, FAVORITES: [], TextEncoder,
    window: { confirm: () => true, toolbox: { skill: { targets: async () => [{ path: '/skills', label: 'test' }], write: async (data) => { writes.push(data); return { ok: true, path: '/skills/demo/SKILL.md' }; } } } } };
  vm.runInNewContext(code, context);
  const open = async () => { nodes.length = 0; context.component.create(h('main'), { config }); await Promise.resolve(); };
  await open();
  const source = nodes.find((node) => node.tag === 'textarea');
  const add = nodes.find((node) => node.children.includes('加入我喜欢的'));
  source.value = '   ';
  await add.onclick();
  assert.equal(state['skills.favorites'], undefined);
  const content = '---\nname: demo\ndescription: My workflow\nallowed-tools: Read\n---\n\n# Demo\nKeep this instruction.';
  source.value = '```md\n' + content + '\n```';
  await add.onclick();
  assert.equal(state['skills.favorites'][0].files['SKILL.md'], content);
  assert.equal(state.font, 'my-font');
  assert.deepEqual(state.selection, ['ask']);
  await open();
  await nodes.find((node) => node.children.includes('装到目录')).onclick();
  assert.equal(writes[0].content, content);
  assert.equal(writes[0].raw, true);
  assert.equal(writes[0].directory, '/skills');
  await nodes.find((node) => node.children.includes('移除收藏')).onclick();
  assert.equal(state['skills.favorites'].length, 0);
  assert.equal(writes.length, 1, '移除收藏不修改安装文件');
});

test('宽松粘贴支持中文提示词、缺失或不合规头部，并保留正文和合法原文', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/skills/index.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default', 'globalThis.component =');
  const context = { TextEncoder };
  vm.runInNewContext(code, context);
  const parse = context.favoriteFromPaste;
  const plain = '# 论文审阅\n逐步分析论文，列出证据和局限。';
  const favorite = parse(plain);
  assert.equal(favorite.title, '论文审阅');
  assert.match(favorite.name, /^skill-[a-f0-9]+$/);
  assert.ok(favorite.files['SKILL.md'].endsWith(plain));
  assert.equal(parse(plain).name, favorite.name);
  assert.equal(parse(plain, '中文名称').title, '中文名称');
  for (const text of ['---\nname: 中文名称\n---\n正文', '---\nname: demo\ndescription:\n---\n正文', 'name: demo\n请按这一步执行', '```md\n只有提示词\n```']) {
    const result = parse(text);
    assert.match(result.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(result.blurb);
    assert.match(result.files['SKILL.md'], /^---\nname: /);
  }
  const original = '---\nname: demo\ndescription: Original description\nallowed-tools: Read\n---\n\n# Demo\nDo this.';
  assert.equal(parse(original).files['SKILL.md'], original);
  assert.throws(() => parse(''), /先粘贴/);
  assert.throws(() => parse('a'.repeat(512 * 1024 + 1)), /512KB/);
});
