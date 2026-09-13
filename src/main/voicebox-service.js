'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VOICEBOX_NAME = 'Voicebox';
const VOICEBOX_REPOSITORY = 'https://github.com/jamiepine/voicebox';
const VOICEBOX_DOWNLOAD_URL = 'https://voicebox.sh/download';
const VOICEBOX_DOCS_URL = 'https://docs.voicebox.sh/';

function homePath(app, env = process.env) {
  try {
    const home = app?.getPath?.('home');
    if (home) return home;
  } catch {}
  return env.HOME || env.USERPROFILE || os.homedir();
}

function uniquePaths(paths, pathApi = path) {
  return [...new Set(paths.filter(Boolean).map((candidate) => pathApi.normalize(candidate)))];
}

function candidatePaths(platform = process.platform, home = os.homedir(), env = process.env) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (platform === 'darwin') {
    return uniquePaths([
      '/Applications/Voicebox.app',
      path.join(home, 'Applications', 'Voicebox.app'),
      path.join(home, 'Downloads', 'Voicebox.app'),
    ], pathApi);
  }
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = env.LOCALAPPDATA || pathApi.join(home, 'AppData', 'Local');
    return uniquePaths([
      pathApi.join(programFiles, 'Voicebox', 'Voicebox.exe'),
      pathApi.join(programFilesX86, 'Voicebox', 'Voicebox.exe'),
      pathApi.join(localAppData, 'Programs', 'Voicebox', 'Voicebox.exe'),
      pathApi.join(localAppData, 'Voicebox', 'Voicebox.exe'),
    ], pathApi);
  }
  return uniquePaths([
    '/usr/bin/voicebox',
    '/opt/Voicebox/voicebox',
    path.join(home, '.local', 'bin', 'voicebox'),
    path.join(home, 'Applications', 'Voicebox.AppImage'),
    path.join(home, 'Downloads', 'Voicebox.AppImage'),
  ]);
}

function findInstalledVoicebox({ platform = process.platform, home, env = process.env, fsModule = fs } = {}) {
  const candidates = candidatePaths(platform, home || os.homedir(), env);
  return candidates.find((candidate) => {
    try { return fsModule.existsSync(candidate); } catch { return false; }
  }) || '';
}

function openExternal(shell, url) {
  if (!shell?.openExternal) return Promise.resolve({ ok: false, error: '系统浏览器接口不可用。' });
  return Promise.resolve(shell.openExternal(url))
    .then(() => ({ ok: true, url }))
    .catch((error) => ({ ok: false, error: error.message || String(error) }));
}

class VoiceBoxService {
  constructor({ app, shell, getWindow, platform = process.platform, env = process.env, fsModule = fs } = {}) {
    this.app = app;
    this.shell = shell;
    this.getWindow = getWindow;
    this.platform = platform;
    this.env = env;
    this.fs = fsModule;
    this.listeners = new Set();
  }

  onStatus(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current() {
    const home = homePath(this.app, this.env);
    const appPath = findInstalledVoicebox({ platform: this.platform, home, env: this.env, fsModule: this.fs });
    return {
      ok: true,
      name: VOICEBOX_NAME,
      projectUrl: VOICEBOX_REPOSITORY,
      downloadUrl: VOICEBOX_DOWNLOAD_URL,
      docsUrl: VOICEBOX_DOCS_URL,
      platform: this.platform,
      installed: Boolean(appPath),
      appPath,
      status: appPath ? 'installed' : 'not-installed',
    };
  }

  emit() {
    const state = this.current();
    for (const listener of this.listeners) listener(state);
    const win = this.getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send('voicebox:status', state);
    return state;
  }

  status() { return this.current(); }

  async start() {
    const state = this.current();
    if (!state.installed) {
      return {
        ok: false,
        code: 'NOT_INSTALLED',
        error: '没有检测到官方 Voicebox，请先下载安装包并完成安装。',
        state,
      };
    }
    if (!this.shell?.openPath) return { ok: false, error: '系统应用启动接口不可用。', state };
    try {
      const error = await this.shell.openPath(state.appPath);
      if (error) return { ok: false, error, state };
      return { ok: true, state: this.emit() };
    } catch (error) {
      return { ok: false, error: error.message || String(error), state };
    }
  }

  openProject() { return openExternal(this.shell, VOICEBOX_REPOSITORY); }

  openDownload() { return openExternal(this.shell, VOICEBOX_DOWNLOAD_URL); }

  openDocs() { return openExternal(this.shell, VOICEBOX_DOCS_URL); }
}

module.exports = {
  VOICEBOX_DOCS_URL,
  VOICEBOX_DOWNLOAD_URL,
  VOICEBOX_NAME,
  VOICEBOX_REPOSITORY,
  VoiceBoxService,
  candidatePaths,
  findInstalledVoicebox,
};
