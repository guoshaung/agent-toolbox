'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  VOICEBOX_DOWNLOAD_URL,
  VOICEBOX_DOCS_URL,
  VOICEBOX_REPOSITORY,
  VoiceBoxService,
  candidatePaths,
  findInstalledVoicebox,
} = require('../src/main/voicebox-service');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-voicebox-'));
}

test('Voicebox 使用官方 GitHub 项目和官方下载入口', () => {
  assert.equal(VOICEBOX_REPOSITORY, 'https://github.com/jamiepine/voicebox');
  assert.equal(VOICEBOX_DOWNLOAD_URL, 'https://voicebox.sh/download');
  assert.equal(VOICEBOX_DOCS_URL, 'https://docs.voicebox.sh/');
});

test('Voicebox 安装路径按平台解析，不混用工具箱容器目录', () => {
  const home = '/Users/example';
  assert.deepEqual(candidatePaths('darwin', home), [
    '/Applications/Voicebox.app',
    '/Users/example/Applications/Voicebox.app',
    '/Users/example/Downloads/Voicebox.app',
  ]);
  assert.match(candidatePaths('win32', 'C:\\Users\\example', { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\Local' })[0], /Voicebox\\Voicebox\.exe$/);
  assert.equal(candidatePaths('linux', home)[0], '/usr/bin/voicebox');
});

test('Voicebox 未安装时返回明确状态且不会启动任何工具箱容器', async () => {
  const home = tempHome();
  let openCalls = 0;
  const service = new VoiceBoxService({
    app: { getPath: () => home },
    shell: { openPath: () => { openCalls += 1; return Promise.resolve(''); } },
    platform: 'darwin',
  });
  try {
    const state = service.status();
    assert.equal(state.installed, false);
    assert.equal(state.status, 'not-installed');
    const result = await service.start();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NOT_INSTALLED');
    assert.equal(openCalls, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Voicebox 已安装时打开官方应用原路径，并保留官方图标', async () => {
  const home = tempHome();
  const appPath = path.join(home, 'Applications', 'Voicebox.app');
  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  fs.mkdirSync(appPath);
  const opened = [];
  const service = new VoiceBoxService({
    app: { getPath: () => home },
    shell: { openPath: (value) => { opened.push(value); return Promise.resolve(''); } },
    platform: 'darwin',
  });
  try {
    assert.equal(findInstalledVoicebox({ platform: 'darwin', home }), appPath);
    const result = await service.start();
    assert.equal(result.ok, true);
    assert.deepEqual(opened, [appPath]);
    assert.equal(result.state.appPath, appPath);
    assert.equal(result.state.status, 'installed');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Voicebox 的 GitHub、下载和文档按钮只打开固定官方地址', async () => {
  const opened = [];
  const service = new VoiceBoxService({ shell: { openExternal: (url) => { opened.push(url); return Promise.resolve(); } } });
  assert.deepEqual(await service.openProject(), { ok: true, url: VOICEBOX_REPOSITORY });
  assert.deepEqual(await service.openDownload(), { ok: true, url: VOICEBOX_DOWNLOAD_URL });
  assert.deepEqual(await service.openDocs(), { ok: true, url: VOICEBOX_DOCS_URL });
  assert.deepEqual(opened, [VOICEBOX_REPOSITORY, VOICEBOX_DOWNLOAD_URL, VOICEBOX_DOCS_URL]);
});
