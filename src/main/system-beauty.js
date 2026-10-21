'use strict';

// Independent asset/profile storage. Never writes the Toolbox config or MToolBox files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const MAX_IMAGE = 25 * 1024 * 1024;
const ASSET_ID = /^[a-f0-9]{64}$/;
const PROFILE_ID = /^[a-zA-Z0-9-]{1,64}$/;
const PRESETS = [
  { id: 'aurora', name: '极光夜航', accent: '#8fb4ff', tint: '#1a2442', effect: 'acrylic', opacity: 72, blur: 22, gradient: 'linear-gradient(135deg, #142d4e, #534082 55%, #bd78a1)' },
  { id: 'forest', name: '雨后森林', accent: '#8fe3b6', tint: '#17372e', effect: 'glass', opacity: 62, blur: 16, gradient: 'linear-gradient(135deg, #153c37, #347d69 55%, #afc58b)' },
  { id: 'sakura', name: '樱色晨光', accent: '#f59fb8', tint: '#563644', effect: 'mica', opacity: 88, blur: 28, gradient: 'linear-gradient(135deg, #8c7299, #d4a8b9 55%, #f7d9ba)' },
  { id: 'ocean', name: '海盐蓝', accent: '#87deef', tint: '#17384a', effect: 'glass', opacity: 55, blur: 12, gradient: 'linear-gradient(135deg, #123047, #2c8098 55%, #b6ddd8)' },
];

function normalizeProfile(input) {
  if (!input || !PROFILE_ID.test(input.id || '')) throw new Error('主题 ID 无效');
  const color = (v, fallback) => /^#[a-f0-9]{6}$/i.test(v || '') ? v : fallback;
  const number = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
  return { id: input.id, name: String(input.name || '我的主题').slice(0, 60),
    accent: color(input.accent, '#8fb4ff'), tint: color(input.tint, '#1a2442'),
    effect: ['glass', 'acrylic', 'mica', 'solid'].includes(input.effect) ? input.effect : 'acrylic',
    opacity: number(input.opacity, 15, 100, 72), blur: number(input.blur, 0, 40, 22),
    backgroundId: ASSET_ID.test(input.backgroundId || '') ? input.backgroundId : '',
    preset: PRESETS.some(p => p.id === input.preset) ? input.preset : 'aurora' };
}

class SystemBeauty {
  constructor({ root, native, decodeImage, platform = process.platform }) {
    this.root = root;
    this.file = path.join(root, 'library.json');
    this.native = native || new WindowsBeautyBridge();
    this.decodeImage = decodeImage || (async buffer => require('sharp')(buffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer());
    this.platform = platform;
    this.pending = Promise.resolve();
  }
  serial(action) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, assets: [], profiles: [], recovery: null };
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.assets) || !Array.isArray(value.profiles)) throw new Error('素材库格式无法识别，请保留文件后检查');
    return value;
  }
  write(value) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  assetPath(id) {
    if (!ASSET_ID.test(id || '')) throw new Error('素材 ID 无效');
    return path.join(this.root, 'assets', `${id}.png`);
  }
  list() {
    const data = this.read();
    return { supported: this.platform === 'win32', presets: PRESETS,
      assets: data.assets.map(a => ({ ...a, url: pathToFileURL(this.assetPath(a.id)).href })),
      profiles: data.profiles, recovery: data.recovery ? { available: true, at: data.recovery.at } : null };
  }
  importImages(paths) {
    return this.serial(async () => {
      if (!Array.isArray(paths) || paths.length > 30) throw new Error('一次最多导入 30 张图片');
      const data = this.read();
      const imported = [], errors = [];
      for (const file of paths) {
        try {
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file).toLowerCase())) throw new Error('支持 PNG、JPEG、WebP 图片');
          const stat = fs.statSync(file);
          if (!stat.isFile() || stat.size > MAX_IMAGE) throw new Error('图片不能超过 25 MB');
          const input = fs.readFileSync(file);
          if (input.length > MAX_IMAGE) throw new Error('图片不能超过 25 MB');
          const buffer = await this.decodeImage(input);
          const id = crypto.createHash('sha256').update(buffer).digest('hex');
          fs.mkdirSync(path.join(this.root, 'assets'), { recursive: true });
          fs.writeFileSync(this.assetPath(id), buffer);
          if (!data.assets.some(a => a.id === id)) data.assets.push({ id, name: path.basename(file), addedAt: new Date().toISOString() });
          imported.push(id);
        } catch (error) { errors.push({ name: path.basename(String(file)), error: error.message }); }
      }
      this.write(data);
      return { imported, errors, ...this.list() };
    });
  }
  saveProfile(input) {
    return this.serial(() => {
      const profile = normalizeProfile(input), data = this.read();
      if (profile.backgroundId && !data.assets.some(a => a.id === profile.backgroundId)) throw new Error('背景素材不存在，请重新导入');
      data.profiles = data.profiles.filter(p => p.id !== profile.id);
      data.profiles.push(profile);
      this.write(data);
      return this.list();
    });
  }
  deleteProfile(id) {
    return this.serial(() => {
      if (!PROFILE_ID.test(id || '')) throw new Error('主题 ID 无效');
      const data = this.read();
      data.profiles = data.profiles.filter(p => p.id !== id);
      this.write(data);
      return this.list();
    });
  }
  applyWallpaper(id) {
    return this.serial(async () => {
      if (this.platform !== 'win32') throw new Error('应用桌面壁纸仅支持 Windows');
      const data = this.read(), asset = this.assetPath(id);
      if (!data.assets.some(a => a.id === id) || !fs.existsSync(asset)) throw new Error('请先导入背景图片');
      if (!data.recovery) {
        const original = await this.native.wallpaper();
        // Persist the baseline before calling any mutating Windows API, even if it fails.
        let copy = '';
        if (original) {
          if (!fs.existsSync(original)) throw new Error('原壁纸文件不存在，无法备份，已停止应用');
          fs.mkdirSync(path.join(this.root, 'recovery'), { recursive: true });
          copy = path.join(this.root, 'recovery', `wallpaper${path.extname(original).slice(0, 12) || '.bmp'}`);
          fs.copyFileSync(original, copy);
        }
        data.recovery = { original, copy, at: new Date().toISOString(), lastApplied: '' };
        this.write(data);
      }
      // Write intent first: a crash after the API must still leave a recoverable state.
      data.recovery.lastApplied = asset;
      this.write(data);
      await this.native.setWallpaper(asset);
      return this.list();
    });
  }
  restoreWallpaper() {
    return this.serial(async () => {
      if (this.platform !== 'win32') throw new Error('恢复桌面壁纸仅支持 Windows');
      const data = this.read(), recovery = data.recovery;
      if (!recovery) throw new Error('还没有可恢复的壁纸备份');
      // Refuse malformed persisted paths before touching the OS.
      const expectedCopy = path.join(this.root, 'recovery', `wallpaper${path.extname(recovery.original || '').slice(0, 12) || '.bmp'}`);
      if (recovery.copy && path.resolve(recovery.copy) !== path.resolve(expectedCopy)) throw new Error('壁纸备份路径无效');
      // Restore the bytes captured at first apply; Spotlight may replace its original path.
      const original = !recovery.original ? '' : recovery.copy;
      if (original && !fs.existsSync(original)) throw new Error('壁纸备份丢失，请保留恢复记录');
      await this.native.setWallpaper(original);
      data.recovery = null;
      this.write(data);
      return this.list();
    });
  }
}

class WindowsBeautyBridge {
  constructor({ exec = execFileAsync, platform = process.platform } = {}) { this.exec = exec; this.platform = platform; }
  async run(operation, file = '') {
    if (this.platform !== 'win32') throw new Error('原生桥接仅支持 Windows');
    if (!['wallpaper', 'set-wallpaper', 'probe'].includes(operation)) throw new Error('原生操作无效');
    const script = path.join(__dirname, 'system-beauty-native.ps1');
    // Read through Electron's asar filesystem; PowerShell cannot open a path inside app.asar.
    // The sole user string is UTF-8 base64 data, never interpolated as PowerShell code.
    const encodedPath = Buffer.from(file, 'utf8').toString('base64');
    const command = `& {\n${fs.readFileSync(script, 'utf8')}\n} -Operation '${operation}' -ImagePath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')))`;
    const { stdout } = await this.exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }
  async wallpaper() { return (await this.run('wallpaper')).path; }
  async setWallpaper(file) { return this.run('set-wallpaper', file); }
  async probe() { return this.platform === 'win32' ? this.run('probe') : { supported: false, running: false }; }
}

function registerSystemBeautyIpc(ipcMain, { getUserDataPath, dialog, getWindow, shell }) {
  const beauty = new SystemBeauty({ root: path.join(getUserDataPath(), 'system-beauty') });
  const rendererRoot = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href;
  function handle(name, fn) {
    ipcMain.handle(`systemBeauty:${name}`, async (event, ...args) => {
      try {
        const url = new URL(event.senderFrame.url);
        if (url.protocol !== 'file:' || !url.href.startsWith(rendererRoot) || !url.pathname.endsWith('.html')) throw new Error('仅允许工具箱本地页面访问');
        return { ok: true, data: await fn(...args) };
      } catch (error) { return { ok: false, error: error.message }; }
    });
  }
  handle('list', () => beauty.list());
  handle('importImages', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: '导入美化背景素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    return result.canceled ? { canceled: true } : beauty.importImages(result.filePaths);
  });
  handle('saveProfile', p => beauty.saveProfile(p));
  handle('deleteProfile', id => beauty.deleteProfile(id));
  handle('applyWallpaper', id => beauty.applyWallpaper(id));
  handle('restoreWallpaper', () => beauty.restoreWallpaper());
  handle('probe', () => beauty.native.probe());
  handle('openFolder', async () => { fs.mkdirSync(beauty.root, { recursive: true }); const error = await shell.openPath(beauty.root); if (error) throw new Error(error); return {}; });
  return beauty;
}

module.exports = { SystemBeauty, WindowsBeautyBridge, normalizeProfile, registerSystemBeautyIpc };
