'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
const voiceboxSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/tools/voicebox/index.js'), 'utf8');
const researchSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/tools/research/index.js'), 'utf8');
const siteGridSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/core/sitegrid.js'), 'utf8');

test('Voice Box has a dedicated left-rail entry', () => {
  assert.match(appSource, /const voiceboxTool = TOOLS\.find\(\(tool\) => tool\.id === 'voicebox'\)/);
  assert.match(appSource, /const voiceboxButton = railButton\(voiceboxTool, 'rail__voicebox'\)/);
  assert.match(appSource, /taskButton,\s*voiceboxButton,\s*pinnedHost/);
});

test('Voicebox renderer is an official-project launcher shell', () => {
  assert.match(voiceboxSource, /OFFICIAL OPEN-SOURCE APP/);
  assert.match(voiceboxSource, /启动官方 Voicebox/);
  assert.match(voiceboxSource, /openDownload/);
  assert.doesNotMatch(voiceboxSource, /ASR Endpoint|saveConfig|cc-voice-input/);
});

test('科研顶部导航可以折叠并持久化状态', () => {
  assert.match(researchSource, /research\.chromeCompact/);
  assert.match(researchSource, /展开顶部/);
  assert.match(researchSource, /收起顶部/);
  assert.match(researchSource, /root\.classList\.toggle\('is-compact'/);
});

test('科研内嵌网页提供加载遮罩、超时恢复和空白页检测', () => {
  assert.match(siteGridSource, /sitegrid__loading/);
  assert.match(siteGridSource, /网页加载超时/);
  assert.match(siteGridSource, /showLoading\(view, site\.url\)/);
  assert.match(siteGridSource, /setTimeout\(\(\) => checkBlank\(view, siteUrl\), 1000\)/);
});
