'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSubtitleFiles, findGeneratedTranscript, findLarkCli, findLocalTranscript, findYtDlp, localVideoFiles, prepareLocalVideos, saveMarkdownReport, saveReport, transcribeBilibiliFallback } = require('../src/main/video-report');

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

test('本地视频准备会展开文件夹并读取同名字幕', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-local-'));
  const progress = [];
  try {
    const first = path.join(dir, 'lecture.mp4');
    const second = path.join(dir, 'demo.mov');
    fs.writeFileSync(first, 'not a real video');
    fs.writeFileSync(second, 'not a real video');
    fs.writeFileSync(path.join(dir, 'lecture.srt'), '1\n00:00:00,000 --> 00:00:01,000\n本地字幕内容。\n', 'utf8');
    assert.equal(findLocalTranscript(first), path.join(dir, 'lecture.srt'));
    assert.deepEqual(localVideoFiles([dir]), [second, first]);
    const result = await prepareLocalVideos([dir], { useWhisper: false, onProgress: (state) => progress.push(state) });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 2);
    const withSubtitle = result.items.find((item) => item.name === 'lecture.mp4');
    const withoutSubtitle = result.items.find((item) => item.name === 'demo.mov');
    assert.equal(withSubtitle.source, 'sidecar');
    assert.match(withSubtitle.text, /本地字幕内容/);
    assert.equal(withoutSubtitle.ok, false);
    assert.match(withoutSubtitle.error, /同名字幕/);
    assert.ok(progress.some((state) => state.status === 'reading-sidecar'));
    assert.ok(progress.some((state) => state.status === 'failed'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('批量报告使用唯一文件名，不会覆盖同一分钟内的报告', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-reports-'));
  try {
    const first = saveReport(dir, { title: '同名视频', markdown: '# 第一条', publish: false });
    const second = saveReport(dir, { title: '同名视频', markdown: '# 第二条', publish: false });
    assert.notEqual(first.localPath, second.localPath);
    assert.equal(fs.readFileSync(first.localPath, 'utf8'), '# 第一条');
    assert.equal(fs.readFileSync(second.localPath, 'utf8'), '# 第二条');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('科研 Markdown 报告可以保存到独立目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-research-reports-'));
  try {
    const result = saveMarkdownReport(dir, { title: '论文结构化分析', markdown: '# 论文结构化分析', sourceId: '/tmp/paper.pdf', publish: false, folder: 'research-reports' });
    assert.equal(result.ok, true);
    assert.match(result.localPath, /research-reports/);
    assert.equal(fs.readFileSync(result.localPath, 'utf8'), '# 论文结构化分析');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lark-cli 与 yt-dlp 路径发现使用 Windows 分隔符', () => {
  const fakeFs = {
    constants: { X_OK: 1 },
    readdirSync: () => [],
    accessSync: (candidate) => {
      if (candidate === 'C:\\Tools\\lark-cli.cmd' || candidate === 'C:\\Tools\\yt-dlp.exe') return;
      throw new Error('not found');
    },
  };
  const env = { PATH: 'C:\\Tools;C:\\Windows\\System32', APPDATA: 'C:\\Users\\test\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };
  assert.equal(findLarkCli({ platform: 'win32', env, home: 'C:\\Users\\test', fsModule: fakeFs }).cli, 'C:\\Tools\\lark-cli.cmd');
  assert.equal(findYtDlp({ platform: 'win32', env, home: 'C:\\Users\\test', fsModule: fakeFs }), 'C:\\Tools\\yt-dlp.exe');
});

test('Windows lark-cli.cmd 发布调用开启 shell 兼容执行', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/video-report.js'), 'utf8');
  assert.ok(source.includes('shell: /\\.cmd$/i.test(found.cli)'));
});

test('Voicebox 转写成功后会把字幕文本留在本地转写目录', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-voicebox-transcript-'));
  const transcriptDir = path.join(dir, 'video-transcripts');
  const video = path.join(dir, 'lecture.mp4');
  fs.writeFileSync(video, 'video fixture');
  global.fetch = async (url) => {
    if (url.endsWith('/transcribe')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ text: '第一段字幕。第二段字幕。', duration: 4 }) };
    throw new Error(`unexpected url: ${url}`);
  };
  try {
    const result = await prepareLocalVideos([video], { transcriptDir });
    assert.equal(result.items[0].source, 'voicebox-whisper');
    assert.ok(result.items[0].transcriptPath);
    assert.equal(fs.readFileSync(result.items[0].transcriptPath, 'utf8'), '第一段字幕。第二段字幕。');
    assert.equal(JSON.parse(fs.readFileSync(`${result.items[0].transcriptPath}.json`, 'utf8')).source, video);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B 站无字幕兜底会下载媒体、调用 Voicebox 并保存转写文本', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-bilibili-fallback-'));
  const transcriptDir = path.join(dir, 'video-transcripts');
  const fakeYtDlp = path.join(dir, process.platform === 'win32' ? 'yt-dlp.cmd' : 'yt-dlp');
  const script = process.platform === 'win32'
    ? '@echo off\r\nset output=\r\n:loop\r\nif "%~1"=="-o" (set output=%~2& shift)\r\nif not "%~1"=="" (shift&goto loop)\r\nset output=%output:%%(ext)%%=mp4%\r\necho video>"%output%"\r\n'
    : '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "-o" ]; then output="$2"; shift; fi\n  shift\ndone\noutput=$(printf "%s" "$output" | sed "s/%(ext)s/mp4/")\nprintf "video" > "$output"\n';
  fs.writeFileSync(fakeYtDlp, script, 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(fakeYtDlp, 0o755);
  global.fetch = async (url) => {
    if (url.endsWith('/transcribe')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ text: 'B 站本地转写内容。', duration: 2 }) };
    throw new Error(`unexpected url: ${url}`);
  };
  try {
    const progress = [];
    const result = await transcribeBilibiliFallback(fakeYtDlp, 'https://www.bilibili.com/video/BV1234567890/', 'BV1234567890', { label: '测试会话', args: [] }, { transcriptDir, voiceboxModel: 'base', onProgress: (state) => progress.push(state) });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'voicebox');
    assert.equal(result.episodes[0].text, 'B 站本地转写内容。');
    assert.ok(result.transcriptPath);
    assert.equal(fs.readFileSync(result.transcriptPath, 'utf8'), 'B 站本地转写内容。');
    assert.ok(progress.some((state) => state.status === 'transcribing'));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('相同视频重复处理时会复用未过期的本地转写缓存', async () => {
  const originalFetch = global.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-video-cache-'));
  const transcriptDir = path.join(dir, 'video-transcripts');
  const video = path.join(dir, 'lecture.mp4');
  fs.writeFileSync(video, 'video fixture');
  let transcribeCalls = 0;
  global.fetch = async (url) => {
    if (!url.endsWith('/transcribe')) throw new Error(`unexpected url: ${url}`);
    transcribeCalls += 1;
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ text: '缓存字幕内容。', duration: 2 }) };
  };
  try {
    const first = await prepareLocalVideos([video], { transcriptDir });
    const cached = findGeneratedTranscript(transcriptDir, video);
    const second = await prepareLocalVideos([video], { transcriptDir });
    assert.equal(first.items[0].source, 'voicebox-whisper');
    assert.equal(cached.text, '缓存字幕内容。');
    assert.equal(second.items[0].source, 'voicebox-whisper');
    assert.equal(second.items[0].transcriptPath, cached.path);
    assert.equal(transcribeCalls, 1);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
