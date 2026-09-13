'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('视频工具渲染器模块可以被 Electron 加载', async () => {
  const module = await import('../src/renderer/tools/video/index.js');
  assert.equal(typeof module.default.create, 'function');
});

test('视频学习区直接进入知识页并提供可放行的加载提示', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/video/index.js'), 'utf8');
  assert.match(source, /const BILIBILI_STUDY_URL = 'https:\/\/www\.bilibili\.com\/c\/knowledge\/'/);
  assert.match(source, /少女祈祷中/);
  assert.match(source, /did-stop-loading/);
});

test('视频学习区默认不抢网页全屏并按页面隔离缩放状态', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/video/index.js'), 'utf8');
  assert.match(source, /id: 'study-web-fullscreen',[\s\S]*?defaultOn: false/);
  assert.match(source, /agent-toolbox-smart-zoom:' \+ \(location\.pathname \|\| 'study'\)/);
  assert.match(source, /player[\s\S]*?event\.preventDefault\(\);[\s\S]*?page\.scrollTop \+= delta/);
});

test('视频报告提供多文件本地拖放区和批处理入口', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/tools/video/index.js'), 'utf8');
  assert.match(source, /video__local-dropzone/);
  assert.match(source, /multiple: true/);
  assert.match(source, /processLocalVideos\(localPathsFromDataTransfer/);
  assert.match(source, /video\.prepareLocal\(paths, \{ voiceboxModel: voiceboxSttSelect\.value \}\)/);
  assert.match(source, /voiceboxSttSelect/);
  assert.match(source, /apiCancelDownload/);
  assert.match(source, /setInterval\(loadVoiceboxProfiles, 10000\)/);
  assert.match(source, /同时发到飞书/);
  assert.match(source, /Voicebox 本地 Whisper 转写/);
  assert.match(source, /voiceboxModel: voiceboxSttSelect\.value/);
  assert.match(source, /onSubsProgress/);
});
