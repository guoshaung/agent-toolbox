'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
const { ReadableStream } = require('node:stream/web');
const { VoiceboxService, downloadFile } = require('../src/main/voicebox-service');

const RELEASE_URL = /api\.github\.com\/repos\/jamiepine\/voicebox\/releases\/latest/;
const ASSET_URL = /github\.com\/jamiepine\/voicebox\/releases\/download\//;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => (typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body))),
  };
}

function makeFetch({ healthFactory, releaseAssets, assetBody }) {
  let healthCalls = 0;
  return async (url) => {
    const u = String(url);
    if (RELEASE_URL.test(u)) {
      return response(200, { tag_name: 'v0.5.0', assets: releaseAssets || [] });
    }
    if (ASSET_URL.test(u)) {
      return response(200, assetBody !== undefined ? assetBody : 'fake-package-bytes');
    }
    if (u.endsWith('/health')) {
      healthCalls += 1;
      return healthFactory(healthCalls);
    }
    if (u.endsWith('/profiles')) return response(200, []);
    if (u.endsWith('/generate/status')) return response(200, {});
    return response(404, { detail: 'no route in fake fetch' });
  };
}

function makeSpawn(records) {
  return (file, args, opts) => {
    records.push({ file, args, opts });
    const child = {
      pid: 4242,
      killed: false,
      stdout: { on() {} },
      stderr: { on() {} },
      kill() { child.killed = true; return true; },
      on: () => child,
    };
    return child;
  };
}

function makeExecFile({ onExtract } = {}) {
  return (file, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (onExtract) onExtract(file, args);
    queueMicrotask(() => cb(null, '', ''));
    return {};
  };
}

function setup({ healthFactory, releaseAssets, userData, platform = 'win32', arch = 'x64', makeServerFile = true } = {}) {
  const spawns = [];
  const extracts = [];
  const service = new VoiceboxService({
    getUserDataPath: () => userData,
    platform,
    arch,
    spawnImpl: makeSpawn(spawns),
    execFileImpl: makeExecFile({ onExtract: (file, args) => { extracts.push({ file, args }); } }),
    fetchImpl: makeFetch({ healthFactory, releaseAssets }),
    bootTimeoutMs: 60,
  });
  if (makeServerFile) {
    const rel = platform === 'win32' ? ['PFiles', 'Voicebox', 'voicebox-server.exe'] : ['Voicebox.app', 'Contents', 'MacOS', 'voicebox-server'];
    const p = path.join(service.rootDir(), ...rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'fake server');
  }
  return { service, spawns, extracts };
}

test('service：下载器流式写入 .part 后原子完成', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-download-'));
  try {
    const output = path.join(dir, 'Voicebox.msi');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('part-one-'));
        controller.enqueue(Buffer.from('part-two'));
        controller.close();
      },
    });
    const result = await downloadFile('https://example.invalid/file', output, {
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, body }),
    });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(output, 'utf8'), 'part-one-part-two');
    assert.equal(fs.existsSync(`${output}.part`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('service：下载器支持断点续传（Range 请求 + .part 续写）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-resume-'));
  try {
    const output = path.join(dir, 'Voicebox.msi');
    const part = `${output}.part`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(part, 'part-a-'); // 模拟已下载 7 字节

    let requestedRange = null;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('part-b'));
        controller.close();
      },
    });
    const result = await downloadFile('https://example.invalid/file', output, {
      fetchImpl: async (_url, init) => {
        requestedRange = init.headers.Range || null;
        return {
          ok: true,
          status: requestedRange ? 206 : 200,
          headers: { get: (name) => (name.toLowerCase() === 'content-length' ? '6' : null) },
          body,
        };
      },
    });
    assert.equal(requestedRange, 'bytes=7-', '应从 7 字节处续传');
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(output, 'utf8'), 'part-a-part-b', '.part 应被续写后原子重命名');
    assert.equal(result.resumed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('service：refreshStatus 能识别应用重启前已运行的外部实例', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-refresh-'));
  try {
    const { service } = setup({ userData, healthFactory: () => response(200, { status: 'healthy', backend_type: 'pytorch', gpu_available: false }), makeServerFile: false });
    assert.equal(service.status().status, 'idle');
    const refreshed = await service.refreshStatus();
    assert.equal(refreshed.status, 'running');
    assert.equal(refreshed.managed, false);
    assert.equal(refreshed.backend, 'pytorch');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：端口 17493 已有健康实例时直接复用，不重复启动', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-reuse-'));
  try {
    const { service, spawns } = setup({ userData, healthFactory: () => response(200, { status: 'healthy', backend_type: 'pytorch' }), makeServerFile: false });
    const result = await service.start();
    assert.equal(result.ok, true);
    assert.equal(result.managed, false);
    assert.equal(spawns.length, 0, '不应启动新进程');
    assert.equal(service.status().status, 'running');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：本地已安装时直接启动，参数指向 userData 下数据目录', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-local-'));
  try {
    let calls = 0;
    const { service, spawns } = setup({
      userData,
      healthFactory: () => { calls += 1; return calls >= 2 ? response(200, { status: 'healthy' }) : response(200, { status: 'starting' }); },
    });
    const result = await service.start();
    assert.equal(result.ok, true);
    assert.equal(result.managed, true);
    assert.equal(spawns.length, 1);
    const [file, args, opts] = [spawns[0].file, spawns[0].args, spawns[0].opts];
    assert.equal(path.basename(file), 'voicebox-server.exe');
    assert.ok(args.includes('--port'));
    assert.ok(args.indexOf('--data-dir') >= 0);
    assert.equal(args[args.indexOf('--data-dir') + 1], path.join(service.rootDir(), 'data'));
    assert.ok(String(opts.env.VOICEBOX_MODELS_DIR).includes('external'));
    assert.match(String(opts.env.VOICEBOX_MODELS_DIR), /voicebox[\\/]models$/);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：fresh 环境自动下载→解压→启动（win32 msiexec /a）', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-fresh-'));
  try {
    const assets = [
      { name: 'Voicebox_0.5.0_x64_en-US.msi', browser_download_url: 'https://github.com/jamiepine/voicebox/releases/download/v0.5.0/Voicebox_0.5.0_x64_en-US.msi' },
      { name: 'voicebox-server-cuda.tar.gz', browser_download_url: 'https://github.com/jamiepine/voicebox/releases/download/v0.5.0/x' },
    ];
    let calls = 0;
    const { service, spawns, extracts } = setup({
      userData,
      releaseAssets: assets,
      makeServerFile: false,
      healthFactory: () => { calls += 1; return calls >= 3 ? response(200, { status: 'healthy' }) : response(200, { status: 'starting' }); },
    });
    // 模拟 msiexec /a 解包产出服务端二进制
    service.execFileImpl = makeExecFile({ onExtract: (file, args) => {
      extracts.push({ file, args });
      const server = path.join(service.rootDir(), 'PFiles', 'Voicebox', 'voicebox-server.exe');
      fs.mkdirSync(path.dirname(server), { recursive: true });
      fs.writeFileSync(server, 'fake server');
    } });
    const result = await service.start();
    assert.equal(result.ok, true);
    assert.equal(spawns.length, 1);
    assert.ok(extracts.some((e) => e.file === 'msiexec.exe' && e.args.includes('/a')), '应使用 msiexec /a 管理式解包');
    assert.equal(fs.existsSync(path.join(service.downloadsDir(), 'Voicebox_0.5.0_x64_en-US.msi')), true, '安装包落在 userData 下载目录');
    assert.equal(service.status().exists, true);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：启动超时返回明确错误，不做无限重试', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-timeout-'));
  try {
    const { service, spawns } = setup({
      userData,
      healthFactory: () => response(200, { status: 'starting' }),
    });
    const t0 = Date.now();
    const result = await service.start();
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, false);
    assert.match(result.error, /启动超时/);
    assert.ok(elapsed < 5000, '超时应按 bootTimeoutMs 快速返回，而不是无限等待');
    assert.equal(service.status().status, 'error');
    assert.ok(spawns.length >= 1);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：不支持平台直接报错', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-unsup-'));
  try {
    const service = new VoiceboxService({ getUserDataPath: () => userData, platform: 'linux', arch: 'x64', fetchImpl: async () => response(500, {}), bootTimeoutMs: 60 });
    const result = await service.start();
    assert.equal(result.ok, false);
    assert.match(result.error, /不支持/);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：stop 清空受管进程状态', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-stop-'));
  try {
    let calls = 0;
    const { service, spawns } = setup({ userData, platform: 'darwin', arch: 'arm64', healthFactory: () => { calls += 1; return calls >= 2 ? response(200, { status: 'healthy' }) : response(200, { status: 'starting' }); } });
    await service.start();
    assert.ok(spawns.length >= 1);
    const stopped = await service.stop();
    assert.equal(stopped.ok, true);
    assert.equal(service.status().status, 'idle');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：Windows GPU 加速显式下载 tar 包，完整解压后下次启动可检测', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-gpu-'));
  try {
    const assets = [
      { name: 'Voicebox_0.5.0_x64_en-US.msi', browser_download_url: 'https://github.com/jamiepine/voicebox/releases/download/v0.5.0/Voicebox_0.5.0_x64_en-US.msi' },
      { name: 'voicebox-server-cuda.tar.gz', browser_download_url: 'https://github.com/jamiepine/voicebox/releases/download/v0.5.0/voicebox-server-cuda.tar.gz' },
    ];
    const { service, extracts } = setup({
      userData,
      releaseAssets: assets,
      makeServerFile: false,
      healthFactory: () => response(200, { status: 'starting' }),
    });
    service.execFileImpl = makeExecFile({ onExtract: (file, args) => {
      extracts.push({ file, args });
      if (file === 'tar') {
        const server = path.join(service.cudaDir(), 'voicebox-server-cuda', 'voicebox-server.exe');
        fs.mkdirSync(path.dirname(server), { recursive: true });
        fs.writeFileSync(server, 'cuda server');
        fs.writeFileSync(path.join(path.dirname(server), 'cudart.dll'), 'runtime');
      }
    } });
    const result = await service.installGpuAcceleration();
    assert.equal(result.ok, true, result.error || JSON.stringify(result));
    assert.ok(extracts.some((e) => e.file === 'tar' && e.args.includes('-xzf')), 'CUDA .tar.gz 必须用 tar 解压');
    assert.ok(service.serverPath().includes('voicebox-server-cuda'));

    const restarted = new VoiceboxService({ getUserDataPath: () => userData, platform: 'win32', arch: 'x64', fetchImpl: async () => response(500, {}) });
    assert.equal(restarted.status().gpu, true, '重启后通过文件检测恢复 GPU 状态');
    assert.ok(restarted.serverPath().includes('voicebox-server-cuda'));
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：macOS 不提供 Windows CUDA 安装', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-mac-gpu-'));
  try {
    const service = new VoiceboxService({ getUserDataPath: () => userData, platform: 'darwin', arch: 'arm64', fetchImpl: async () => response(500, {}) });
    const result = await service.installGpuAcceleration();
    assert.equal(result.ok, false);
    assert.match(result.error, /Windows x64/);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('service：mcpInfo 保留 MCP 端点但注明内部走 REST', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vbsvc-mcp-'));
  try {
    const service = new VoiceboxService({ getUserDataPath: () => userData, fetchImpl: async () => response(500, {}) });
    const info = service.mcpInfo();
    assert.equal(info.url, 'http://127.0.0.1:17493/mcp/');
    assert.match(info.note, /REST/);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
