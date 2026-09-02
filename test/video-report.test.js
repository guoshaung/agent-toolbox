'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSubtitleFiles } = require('../src/main/video-report');

test('单视频 NA 字幕文件会识别为第 1 集，并识别 B 站 AI 字幕', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-'));
  try {
    fs.writeFileSync(path.join(dir, 'NA.ai-zh.srt'), '1\n00:00:00,000 --> 00:00:01,000\n这是 AI 字幕。\n', 'utf8');
    const episodes = collectSubtitleFiles(dir);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].page, 1);
    assert.equal(episodes[0].ai, true);
    assert.match(episodes[0].text, /这是 AI 字幕/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同一集有官方和 AI 字幕时优先官方字幕', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-'));
  try {
    fs.writeFileSync(path.join(dir, '1.ai-zh.srt'), 'AI 内容', 'utf8');
    fs.writeFileSync(path.join(dir, '1.zh-Hans.srt'), '官方内容', 'utf8');
    const episodes = collectSubtitleFiles(dir);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].ai, false);
    assert.equal(episodes[0].text, '官方内容');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
