'use strict';

/**
 * Voicebox 服务管理器：检测 → 下载 → 解压 → 启动 → 就绪轮询。
 *
 * 设计约束：
 *  - 所有产物（二进制/模型/音频/profile/下载包）都在 userData/external/voicebox 下，
 *    仓库与源码里绝不出现 Voicebox 二进制或模型。
 *  - 端口 17493 已有可用 Voicebox 时直接复用，不重复启动。
 *  - 超时必须返回明确错误，禁止无限重试。
 *  - macOS 只走官方 arm64/x64 .app.tar.gz（MLX），不用 Docker、不下 Windows CUDA 包。
 *  - Windows CUDA 是可选项，仅用户显式触发 installGpuAcceleration() 时才下载。
 *
 * 本模块可被纯 Node require（无 electron 依赖），依赖通过构造参数注入以便单测。
 */

const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn, execFile } = require('node:child_process');

const { VoiceboxRestClient, DEFAULT_PORT, MODEL_SIZE } = require('./voicebox-rest');
const { resolveManifest, pickAsset, pickGpuAsset, isSupported } = require('./voicebox-platforms');

const GITHUB_API = 'https://api.github.com/repos/jamiepine/voicebox/releases/latest';
const BOOT_TIMEOUT_MS = 180000;      // 服务端启动就绪上限（模型下载发生在首次生成，不算在内）
const NET_TIMEOUT_MS = 15 * 1000;    // 元数据请求超时（查版本）
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 大包下载总超时，防无限挂起
const PROGRESS_EVERY = 2 * 1024 * 1024;     // 每 2MB 上报一次进度

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findFile(root, basename, maxDepth = 4) {
  if (!root || !fs.existsSync(root) || maxDepth < 0) return '';
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === basename.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, basename, maxDepth - 1);
      if (found) return found;
    }
  }
  return '';
}

/** 递归杀进程树：win32 taskkill /T /F，其它平台进程组 SIGKILL。 */
function killTree(child, platform = process.platform) {
  if (!child || child.killed) return;
  try {
    if (platform === 'win32') {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], () => {});
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } }
}

/**
 * HTTP 流式下载，支持断点续传与进度上报。
 * - 存在 .part 时用 Range 从断点继续，中断后不用整包重下；
 * - 每约 2MB 回调一次 onProgress({ received, total, bytes, percent })；
 * - 带总超时，不无限挂起；失败保留 .part 供续传。
 */
async function downloadFile(url, filePath, { fetchImpl = globalThis.fetch, onProgress, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const tempPath = `${filePath}.part`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = 0;
  try { existing = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0; } catch { existing = 0; }

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: existing > 0 ? { Range: `bytes=${existing}-` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, error: `下载失败：${error.message}`, partial: existing };
  }

  if (response.status === 416) {
    // 已有部分恰好等于完整大小：直接完成
    fs.renameSync(tempPath, filePath);
    const bytes = fs.statSync(filePath).size;
    if (onProgress) onProgress({ received: bytes, total: bytes, bytes, percent: 100 });
    return { ok: true, bytes, filePath, resumed: true };
  }
  if (response.status !== 200 && response.status !== 206) {
    return { ok: false, error: `下载失败：HTTP ${response.status}`, partial: existing };
  }

  const resumed = response.status === 206 && existing > 0;
  const resumeFrom = resumed ? existing : 0;
  const contentLength = Number(response.headers.get('content-length')) || 0;
  const total = contentLength + resumeFrom;
  let received = resumeFrom;
  let lastEmit = 0;

  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (onProgress && received - lastEmit >= PROGRESS_EVERY) {
        lastEmit = received;
        onProgress({ received, total, bytes: received, percent: total ? Math.min(100, Math.round((received / total) * 100)) : received });
      }
      cb(null, chunk);
    },
  });

  try {
    if (response.body && typeof response.body.getReader === 'function') {
      await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' }));
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      received += buffer.length;
      fs.writeFileSync(tempPath, buffer, { flag: resumed ? 'a' : 'w' });
    }
    fs.renameSync(tempPath, filePath);
    const bytes = fs.statSync(filePath).size;
    if (onProgress) onProgress({ received: bytes, total, bytes, percent: 100 });
    return { ok: true, bytes, filePath, resumed };
  } catch (error) {
    // 失败保留 .part，下次续传
    return { ok: false, error: `下载失败：${error.message}`, partial: received };
  }
}

class VoiceboxService {
  /**
   * @param {object} [options]
   * @param {Function} options.getUserDataPath  ()=> string，electron 场景传 app.getPath('userData')
   * @param {Function} [options.getWindow]      ()=> BrowserWindow|null，状态推送
   * @param {string} [options.platform]         process.platform
   * @param {string} [options.arch]             process.arch
   * @param {object} [options.spawn]            可注入
   * @param {object} [options.execFile]
   * @param {Function} [options.fetchImpl]      node18+ global fetch 或注入
   * @param {number} [options.port]
   */
  constructor({
    getUserDataPath,
    getWindow = () => null,
    platform = process.platform,
    arch = process.arch,
    spawnImpl,
    execFileImpl = execFile,
    fetchImpl = globalThis.fetch,
    port = DEFAULT_PORT,
    bootTimeoutMs = BOOT_TIMEOUT_MS,
  } = {}) {
    if (typeof getUserDataPath !== 'function') throw new Error('VoiceboxService 需要 getUserDataPath()');
    this.getUserDataPath = getUserDataPath;
    this.getWindow = getWindow;
    this.platform = platform;
    this.arch = arch;
    this.spawnImpl = spawnImpl || spawn;
    this.execFileImpl = execFileImpl;
    this.fetchImpl = fetchImpl;
    this.port = port;

    this.client = new VoiceboxRestClient({ port, fetchImpl });
    this.child = null;
    this.bootTimeoutMs = bootTimeoutMs;
    const manifest = resolveManifest(platform, arch);
    const gpuInstalled = Boolean(manifest?.gpuAsset) && Boolean(findFile(this.cudaDir(), manifest.gpuRel?.at(-1) || 'voicebox-server.exe'));
    this.state = {
      status: 'idle',        // idle | installing | starting | running | error
      port,
      managed: false,
      platform,
      arch,
      modelSize: MODEL_SIZE,
      mcpUrl: `http://127.0.0.1:${port}/mcp/`,
      restUrl: `http://127.0.0.1:${port}`,
      error: '',
      exists: false,
      gpu: gpuInstalled,
    };
    this.listeners = new Set();
  }

  /** 外部工具根目录：userData/external/voicebox */
  rootDir() {
    return path.join(this.getUserDataPath(), 'external', 'voicebox');
  }
  downloadsDir() { return path.join(this.rootDir(), 'downloads'); }
  dataDir() { return path.join(this.rootDir(), 'data'); }
  modelsDir() { return path.join(this.rootDir(), 'models'); }
  cudaDir() { return path.join(this.rootDir(), 'cuda'); }
  serverPath() {
    const manifest = resolveManifest(this.platform, this.arch);
    if (!manifest) return '';
    // 若已装 GPU 变体且存在，优先使用；保持服务端与随包 DLL 在同一解压目录。
    const cudaServer = manifest.gpuAsset ? findFile(this.cudaDir(), manifest.gpuRel?.at(-1) || 'voicebox-server.exe') : '';
    if (this.state.gpu && cudaServer) return cudaServer;
    return path.join(this.rootDir(), ...manifest.serverRel);
  }

  onStatus(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
    this.getWindow()?.webContents?.send('voicebox:status', this.state);
  }

  status() {
    const exists = Boolean(this.serverPath()) && fs.existsSync(this.serverPath());
    const manifest = resolveManifest(this.platform, this.arch);
    return { ...this.state, exists, manifest: manifest ? { key: manifest.key, display: manifest.display, extract: manifest.extract } : null, supported: isSupported(this.platform, this.arch) };
  }

  /** 页面刷新时同步外部 Voicebox 的实际运行状态。 */
  async refreshStatus() {
    const health = await this.client.probeHealth();
    if (health.ok && health.running && health.healthy) {
      this.emit({
        status: 'running',
        managed: Boolean(this.child && !this.child.killed),
        error: '',
        backend: health.backend,
        gpuAvailable: health.gpuAvailable,
      });
    } else if (this.state.status === 'running' && !this.child) {
      this.emit({ status: 'idle', managed: false, error: '' });
    }
    return this.status();
  }

  mcpInfo() {
    return {
      url: `http://127.0.0.1:${this.port}/mcp/`,
      header: { 'X-Voicebox-Client-Id': 'agent-toolbox' },
      note: 'PPT 配音内部走 REST POST /generate（model_size 0.6B），MCP 仅供 Agent 使用。',
    };
  }

  /** 查询 GitHub latest release，返回匹配本平台的资产 { name, url }。 */
  async fetchReleaseAsset() {
    const manifest = resolveManifest(this.platform, this.arch);
    if (!manifest) return { ok: false, error: `当前平台不受支持：${this.platform}-${this.arch}` };
    let response;
    try {
      response = await this.fetchImpl(GITHUB_API, { headers: { 'User-Agent': 'agent-toolbox' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    } catch (error) {
      return { ok: false, error: `查询 Voicebox 版本失败：${error.message}` };
    }
    if (!response.ok) return { ok: false, error: `查询 Voicebox 版本失败：HTTP ${response.status}` };
    const release = await response.json().catch(() => null);
    if (!release || !Array.isArray(release.assets)) return { ok: false, error: 'Voicebox release 数据异常' };
    const asset = pickAsset(manifest, release.assets);
    if (!asset) return { ok: false, error: `在 release ${release.tag_name} 中找不到本平台安装包` };
    return { ok: true, manifest, asset: { name: asset.name, url: asset.browser_download_url }, assets: release.assets, version: release.tag_name };
  }

  /** 解压发行包到 rootDir。win32 用 msiexec /a 无提权解包；darwin 用系统 tar。 */
  async extractDownload(archivePath, targetDir) {
    const manifest = resolveManifest(this.platform, this.arch);
    if (!manifest) return { ok: false, error: '平台不受支持，无法解压' };
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      if (manifest.extract === 'msiexec') {
        // 管理式解包，不需要管理员权限；产物在 targetDir/PFiles/Voicebox
        await new Promise((resolve, reject) => {
          const args = ['/a', archivePath, '/qn', `TARGETDIR=${targetDir}`];
          const child = this.execFileImpl('msiexec.exe', args, { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
          if (child && typeof child.on === 'function') child.on('error', reject);
        });
      } else if (manifest.extract === 'tar') {
        await new Promise((resolve, reject) => {
          const args = ['-xzf', archivePath, '-C', targetDir];
          const child = this.execFileImpl('tar', args, { }, (error) => (error ? reject(error) : resolve()));
          if (child && typeof child.on === 'function') child.on('error', reject);
        });
      } else {
        return { ok: false, error: `未知解压方式：${manifest.extract}` };
      }
    } catch (error) {
      return { ok: false, error: `解压失败：${error.message}` };
    }
    return { ok: true };
  }

  async extractTarArchive(archivePath, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const child = this.execFileImpl('tar', ['-xzf', archivePath, '-C', targetDir], {}, (error) => (error ? reject(error) : resolve()));
        if (child && typeof child.on === 'function') child.on('error', reject);
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `解压失败：${error.message}` };
    }
  }

  /** 完整安装流程：本地已存在直接复用 → 查 release → 下载（已存在则跳过）→ 解压 → 校验。 */
  async install() {
    const manifest = resolveManifest(this.platform, this.arch);
    if (!manifest) return { ok: false, error: `当前平台不受支持：${this.platform}-${this.arch}` };
    const serverPath = this.serverPath();
    if (fs.existsSync(serverPath)) return { ok: true, reused: true, serverPath };

    const info = await this.fetchReleaseAsset();
    if (!info.ok) return info;

    this.emit({ status: 'installing', error: '', exists: false, progress: null });
    const archivePath = path.join(this.downloadsDir(), info.asset.name);
    if (!fs.existsSync(archivePath)) {
      const dl = await downloadFile(info.asset.url, archivePath, {
        fetchImpl: this.fetchImpl,
        onProgress: (progress) => this.emit({ status: 'installing', error: '', progress }),
      });
      if (!dl.ok) { this.emit({ status: 'error', error: dl.error, progress: null }); return dl; }
    }
    this.emit({ status: 'installing', error: '', progress: { percent: 100, phase: 'extracting' } });
    const ex = await this.extractDownload(archivePath, this.rootDir());
    if (!ex.ok) { this.emit({ status: 'error', error: ex.error, progress: null }); return ex; }
    if (!fs.existsSync(serverPath)) {
      const err = `安装完成但未找到服务端二进制：${serverPath}`;
      this.emit({ status: 'error', error: err, progress: null });
      return { ok: false, error: err };
    }
    this.emit({ status: 'idle', error: '', exists: true, progress: null });
    return { ok: true, reused: false, serverPath, version: info.version };
  }

  /** 启动（复用运行中 / 本地已存在 / 自动安装）。 */
  async start() {
    if (!isSupported(this.platform, this.arch)) {
      const err = `当前平台不支持 Voicebox：${this.platform}-${this.arch}`;
      this.emit({ status: 'error', error: err });
      return { ok: false, error: err };
    }
    // 1) 复用已运行实例
    const existing = await this.client.probeHealth();
    if (existing.ok && existing.running && existing.healthy) {
      this.emit({ status: 'running', managed: false, error: '', exists: true });
      return { ok: true, managed: false, ...this.state };
    }
    // 2) 安装（本地缺失才下载；已解压则跳过）
    const installed = await this.install();
    if (!installed.ok) return installed;

    // 3) 启动子进程
    const serverPath = this.serverPath();
    if (!fs.existsSync(serverPath)) {
      const err = `服务端不存在：${serverPath}`;
      this.emit({ status: 'error', error: err });
      return { ok: false, error: err };
    }
    this.emit({ status: 'starting', managed: true, error: '', exists: true });
    fs.mkdirSync(this.dataDir(), { recursive: true });
    fs.mkdirSync(this.modelsDir(), { recursive: true });
    const env = {
      ...process.env,
      VOICEBOX_MODELS_DIR: this.modelsDir(),
    };
    const args = ['--host', '127.0.0.1', '--port', String(this.port), '--data-dir', this.dataDir()];
    const child = this.spawnImpl(serverPath, args, { env, cwd: this.rootDir(), stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout?.on('data', (chunk) => { process.stdout.write(`[voicebox] ${chunk}`); });
    child.stderr?.on('data', (chunk) => { process.stderr.write(`[voicebox] ${chunk}`); });
    child.on('error', (error) => {
      this.child = null;
      this.emit({ status: 'error', error: `Voicebox 启动失败：${error.message}` });
    });
    child.on('close', (code) => {
      this.child = null;
      if (this.state.status === 'running' || this.state.status === 'starting') {
        this.emit({ status: 'error', error: `Voicebox 进程已退出（code=${code}）` });
      } else {
        this.emit({ status: 'idle', managed: false, error: '' });
      }
    });

    // 4) 就绪轮询，带 deadline，超时即失败
    const deadline = Date.now() + this.bootTimeoutMs;
    for (;;) {
      const health = await this.client.probeHealth();
      if (health.ok && health.running && health.healthy) {
        this.emit({ status: 'running', managed: true, error: '' });
        return { ok: true, managed: true, ...this.state };
      }
      if (Date.now() >= deadline) {
        const err = `Voicebox 启动超时（${Math.round(this.bootTimeoutMs / 1000)}s 内未就绪），请检查日志`;
        killTree(child, this.platform);
        this.emit({ status: 'error', error: err });
        return { ok: false, error: err };
      }
      await sleep(1000);
    }
  }

  /** 停止受管进程（不触碰外部已运行的实例）。 */
  async stop() {
    if (this.child && !this.child.killed) {
      this.emit({ status: 'stopping', managed: true, error: '' });
      killTree(this.child, this.platform);
      this.child = null;
    }
    this.emit({ status: 'idle', managed: false, error: '' });
    return { ok: true, ...this.state };
  }

  /** 可选 GPU 加速（仅 Windows x64）：下载 CUDA 服务端到 cuda/，下次启动优先使用。 */
  async installGpuAcceleration() {
    if (this.platform !== 'win32' || this.arch !== 'x64') {
      return { ok: false, error: 'GPU 加速目前仅支持 Windows x64（NVIDIA CUDA）。' };
    }
    const manifest = resolveManifest(this.platform, this.arch);
    if (!manifest || !manifest.gpuAsset) return { ok: false, error: '当前发行版没有提供 CUDA 服务端资产。' };
    const existingCudaServer = findFile(this.cudaDir(), manifest.gpuRel?.at(-1) || 'voicebox-server.exe');
    if (existingCudaServer) { this.emit({ gpu: true }); return { ok: true, reused: true }; }

    const info = await this.fetchReleaseAsset();
    if (!info.ok) return info;
    const asset = pickGpuAsset(manifest, info.assets || []);
    if (!asset) return { ok: false, error: 'release 中未找到 CUDA 服务端资产。' };
    const assetUrl = asset.browser_download_url || asset.url;
    if (!assetUrl) return { ok: false, error: 'CUDA 资产缺少下载地址。' };
    const archivePath = path.join(this.downloadsDir(), asset.name);
    if (!fs.existsSync(archivePath)) {
      const dl = await downloadFile(assetUrl, archivePath, {
        fetchImpl: this.fetchImpl,
        onProgress: (progress) => this.emit({ status: 'installing', error: '', progress, gpuInstall: true }),
      });
      if (!dl.ok) { this.emit({ status: 'error', error: dl.error, progress: null }); return dl; }
    }
    const ex = await this.extractTarArchive(archivePath, this.cudaDir());
    if (!ex.ok) return ex;
    // 保留 CUDA 发行包的完整目录结构，确保服务端旁边的 DLL / runtime 可被加载。
    const found = findFile(this.cudaDir(), manifest.gpuRel?.at(-1) || 'voicebox-server.exe');
    if (!found) return { ok: false, error: 'CUDA 服务端解压后未找到 voicebox-server.exe' };
    this.emit({ gpu: true });
    return { ok: true, reused: false, note: 'GPU 加速已就绪，下次启动生效（需重启 Voicebox）。' };
  }

  /** REST TTS：预设中文 profile + model_size 0.6B。返回音频文件与播放地址。 */
  async tts(text) {
    const profile = await this.client.ensureZhPresetProfile();
    if (!profile.ok) return profile;
    const gen = await this.client.generate({ text, profileId: profile.profileId });
    if (!gen.ok) return gen;
    const polled = await this.client.pollGeneration(gen.generationId);
    if (!polled.ok) return polled;
    const audio = await this.client.fetchAudio(gen.generationId);
    if (!audio.ok) return audio;
    const filePath = path.join(this.dataDir(), 'generations', `${gen.generationId}.wav`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, audio.buffer);
    return {
      ok: true,
      generationId: gen.generationId,
      filePath,
      audioUrl: VoiceboxRestClient.getAudioUrl(gen.generationId, this.port),
      duration: polled.duration,
      modelSize: MODEL_SIZE,
      profileId: profile.profileId,
    };
  }
}

module.exports = { VoiceboxService, killTree, downloadFile, BOOT_TIMEOUT_MS };