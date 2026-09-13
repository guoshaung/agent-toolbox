'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('主题：结构完整且每个主题都覆盖全部颜色变量', async () => {
  const { THEMES, COLOR_VARS } = await import('../src/renderer/core/themes.js');
  assert.ok(Array.isArray(THEMES) && THEMES.length >= 3, '至少应有 4 套主题');
  assert.ok(COLOR_VARS.length >= 20, '颜色变量列表应覆盖 base.css :root 全部色板');
  const ids = new Set();
  for (const theme of THEMES) {
    assert.ok(theme.id && !ids.has(theme.id), `主题 id 必须唯一：${theme.id}`);
    ids.add(theme.id);
    assert.ok(theme.name, '主题必须有中文名称');
    assert.ok(theme.desc, '主题必须有说明');
    assert.ok(Array.isArray(theme.swatches) && theme.swatches.length === 3, `主题 ${theme.id} 应有 3 个预览色块`);
    for (const name of COLOR_VARS) {
      assert.ok(theme.vars[name], `主题 ${theme.id} 缺少变量 ${name}`);
    }
    for (const value of Object.values(theme.vars)) {
      assert.ok(typeof value === 'string' && value.length > 0, `主题 ${theme.id} 的变量值必须非空`);
    }
  }
  assert.ok(ids.has('default'), '必须保留默认主题 default');
});

test('主题：主题 id 规范化解析', async () => {
  const { themeById } = await import('../src/renderer/core/themes.js');
  assert.equal(themeById('sakura').id, 'sakura');
  assert.equal(themeById('bogus').id, 'default', '未知 id 应回退默认主题');
});

test('logo：结构完整且 SVG 非空', async () => {
  const { LOGOS } = await import('../src/renderer/core/logos.js');
  assert.ok(Array.isArray(LOGOS) && LOGOS.length >= 4, '至少应有 4 套 logo');
  const ids = new Set();
  for (const logo of LOGOS) {
    assert.ok(logo.id && !ids.has(logo.id), `logo id 必须唯一：${logo.id}`);
    ids.add(logo.id);
    assert.ok(logo.name, 'logo 必须有名称');
    assert.ok(typeof logo.svg === 'string' && logo.svg.trim().startsWith('<svg'), `logo ${logo.id} 必须是内联 SVG`);
  }
  assert.ok(ids.has('neon'), '必须保留默认 logo neon');
  assert.ok(ids.has('prism-core'), '必须包含新的星环晶核 logo');
});

test('logo：id 规范化解析', async () => {
  const { logoById } = await import('../src/renderer/core/logos.js');
  assert.equal(logoById('crystal').id, 'crystal');
  assert.equal(logoById('bogus').id, 'prism-core', '未知 id 应回退新的默认 logo');
});

test('logo：svgToCssUrl 生成可被 CSS url() 使用的 data URI', async () => {
  const { svgToCssUrl } = await import('../src/renderer/core/logos.js');
  const url = svgToCssUrl('<svg viewBox="0 0 10 10" fill="#abc"><path d="M0 0h10v10z"/></svg>');
  assert.ok(/^url\("data:image\/svg\+xml;charset=utf-8,/.test(url), '应以 CSS url() data URI 开头');
  assert.ok(url.endsWith('")'), '应以闭合引号结束');
  assert.ok(!/\s/.test(url), '空白必须编码，避免截断 CSS url');
  assert.ok(url.includes('%23'), '颜色 # 必须编码为 %23');
});

test('效果：结构完整且 id 唯一，默认磨砂玻璃', async () => {
  const { EFFECTS, effectById } = await import('../src/renderer/core/themes.js');
  assert.ok(Array.isArray(EFFECTS) && EFFECTS.length >= 3, '至少应有 3 种外观效果');
  const ids = new Set();
  for (const effect of EFFECTS) {
    assert.ok(effect.id && !ids.has(effect.id), `效果 id 必须唯一：${effect.id}`);
    ids.add(effect.id);
    assert.ok(effect.name, '效果必须有中文名称');
  }
  assert.ok(ids.has('glass') && ids.has('aurora') && ids.has('neon'), '必须包含磨砂玻璃、极光、霓虹');
});

test('效果：id 规范化解析与默认值', async () => {
  const { effectById } = await import('../src/renderer/core/themes.js');
  assert.equal(effectById('glass').id, 'glass');
  assert.equal(effectById('bogus').id, 'glass', '未知 id 应回退默认效果');
});
