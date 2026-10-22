'use strict';

// Independent asset/profile storage. Never writes the Toolbox config or MToolBox files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { makeNativeRecipe } = require('./beauty-recipes');
const { mergeNativeIni, readIni, writeNewIni } = require('./beauty-ini');
const { PRESETS, WALLPAPER_SIZES, renderBackground } = require('./beauty-backgrounds');
const { normalizeWindowsOptions, personalizationPlan, validatePersonalizationValues } = require('./beauty-personalization');
const { BeautyNativePreview } = require('./beauty-native-preview');
const { WindowAppearance } = require('./beauty-window-appearance');
const { BeautyFolderImport } = require('./beauty-folder-import');
const { BeautyFolderJobs } = require('./beauty-folder-jobs');
const { BeautyCatalog } = require('./beauty-catalog');
const { PreparedBeautyPackages } = require('./beauty-prepared-packages');
const { ExplorerBeautyEngine } = require('./beauty-explorer-engine');
const { SystemThemeSession } = require('./beauty-system-theme');
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_BUNDLE = 2 * Math.ceil(MAX_IMAGE * 4 / 3) + 256 * 1024;
const ASSET_ID = /^[a-f0-9]{64}$/;
const PROFILE_ID = /^[a-zA-Z0-9-]{1,64}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function decodeRaster(buffer) {
  if (buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && [1, 2].includes(buffer.readUInt16LE(2))) return require('./beauty-icons').decodeIcon(buffer);
  const png = buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('只接受真实的 PNG、JPEG 或 WebP 图片');
  return require('sharp')(buffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
}
async function makeThumbnail(buffer) {
  const sharp = require('sharp');
  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  const thumbnail = await image.resize({ width: 384, height: 216, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75, effort: 3 }).toBuffer();
  return { buffer: thumbnail, width: metadata.width, height: metadata.height };
}
function writeImmutable(file, buffer) {
  if (fs.existsSync(file)) return;
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer, { flag: 'wx' });
    if (!fs.existsSync(file)) fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function normalizeProfile(input) {
  if (!input || !PROFILE_ID.test(input.id || '')) throw new Error('主题 ID 无效');
  const color = (v, fallback) => /^#[a-f0-9]{6}$/i.test(v || '') ? v : fallback;
  const number = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
  return { id: input.id, name: String(input.name || '我的主题').slice(0, 60),
    accent: color(input.accent, '#8fb4ff'), tint: color(input.tint, '#1a2442'),
    effect: ['glass', 'acrylic', 'mica', 'solid'].includes(input.effect) ? input.effect : 'acrylic',
    opacity: number(input.opacity, 15, 100, 72), blur: number(input.blur, 0, 40, 22),
    backgroundId: ASSET_ID.test(input.backgroundId || '') ? input.backgroundId : '',
    characterId: ASSET_ID.test(input.characterId || '') ? input.characterId : '',
    preset: PRESETS.some(p => p.id === input.preset) ? input.preset : 'aurora', windows: normalizeWindowsOptions(input.windows) };
}

class SystemBeauty {
  constructor({ root, native, decodeImage, thumbnailImage, explorerEngine, platform = process.platform }) {
    this.root = root;
    this.file = path.join(root, 'library.json');
    this.native = native || new WindowsBeautyBridge();
    this.decodeImage = decodeImage || decodeRaster;
    this.thumbnailImage = thumbnailImage || makeThumbnail;
    this.platform = platform;
    this.preview = new BeautyNativePreview({ platform });
    this.windowAppearance = new WindowAppearance({ root: path.join(root, 'window-appearance'), platform });
    this.folderImport = new BeautyFolderImport();
    this.catalog = new BeautyCatalog({ root: path.join(root, 'catalog') });
    this.prepared = new PreparedBeautyPackages(root);
    this.explorerEngine = explorerEngine || new ExplorerBeautyEngine({ root: path.join(root, 'explorer-engine'), platform });
    this.systemTheme = new SystemThemeSession(this, normalizeProfile);
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
  thumbnailPath(id) {
    if (!ASSET_ID.test(id || '')) throw new Error('素材 ID 无效');
    return path.join(this.root, 'thumbnails', `${id}.webp`);
  }
  async storeAsset(buffer, metadata, data) {
    if (buffer.length > MAX_IMAGE) throw new Error('图片超过 25 MB，请缩小图片后重试');
    const id = crypto.createHash('sha256').update(buffer).digest('hex');
    const thumbnail = await this.thumbnailImage(buffer);
    fs.mkdirSync(path.join(this.root, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'thumbnails'), { recursive: true });
    // Content-addressed images are immutable. Windows and libvips can hold read handles;
    // a duplicate import must never truncate a file currently displayed or used as wallpaper.
    writeImmutable(this.assetPath(id), buffer);
    writeImmutable(this.thumbnailPath(id), thumbnail.buffer);
    let asset = data.assets.find(item => item.id === id);
    if (!asset) {
      asset = { id, name: String(metadata.name).slice(0, 120), kind: metadata.kind || 'imported', addedAt: new Date().toISOString() };
      data.assets.push(asset);
    }
    Object.assign(asset, { width: thumbnail.width, height: thumbnail.height, bytes: buffer.length });
    if (metadata.source) {
      asset.source ||= metadata.source;
      asset.sources ||= [];
      if (!asset.sources.some(item => JSON.stringify(item) === JSON.stringify(metadata.source))) asset.sources.push(metadata.source);
    }
    if (metadata.kind === 'character') asset.kind = 'character';
    return asset;
  }
  list() {
    const data = this.read();
    return { supported: this.platform === 'win32', nativePreview: this.preview.capability, windowAppearance: this.windowAppearance.list(), presets: PRESETS, wallpaperSizes: WALLPAPER_SIZES,
      assets: data.assets.map(a => ({ ...a, url: pathToFileURL(this.assetPath(a.id)).href,
        thumbnailUrl: pathToFileURL(fs.existsSync(this.thumbnailPath(a.id)) ? this.thumbnailPath(a.id) : this.assetPath(a.id)).href })),
      profiles: data.profiles, packages: (data.packages || []).map(p => ({ ...p, previewUrl: p.preview && /^[a-f0-9]{64}$/.test(p.preview) ? pathToFileURL(path.join(this.root, 'package-previews', p.preview + '.webp')).href : '' })),
      activeProfileId: data.activeProfileId || '', themeSession: data.themeSession || null, recovery: data.recovery ? { available: true, at: data.recovery.at } : null,
      personalizationRecovery: data.personalizationRecovery ? { available: true, at: data.personalizationRecovery.at, fields: Object.keys(data.personalizationRecovery.values || {}) } : null };
  }
  applySystemTheme(payload) { return this.serial(() => this.systemTheme.apply(payload)); }
  restoreSystemTheme() { return this.serial(() => this.systemTheme.restore()); }
  importPreparedPackages() {
    return this.serial(async () => {
      const plan = this.prepared.plan(), errors = []; let added = 0;
      for (const pkg of plan) {
        const data = this.read(), previousPackage = (data.packages || []).find(p => p.id === pkg.id), assetIds = [...(previousPackage?.assetIds || [])];
        const initialErrors = errors.length;
        let backgroundId = '', characterId = '', preview = previousPackage?.preview || '';
        for (const image of pkg.images) {
          try {
            const buffer = await this.decodeImage(this.prepared.image(image.file));
            if (image.role === 'preview') {
              const thumb = await this.thumbnailImage(buffer); preview = crypto.createHash('sha256').update(thumb.buffer).digest('hex');
              fs.mkdirSync(path.join(this.root, 'package-previews'), { recursive: true });
              writeImmutable(path.join(this.root, 'package-previews', preview + '.webp'), thumb.buffer); continue;
            }
            const count = data.assets.length;
            const asset = await this.storeAsset(buffer, { name: image.name, kind: image.role,
              source: { packageId: pkg.id, title: pkg.title, author: pkg.author, url: pkg.source } }, data);
            added += data.assets.length - count; if (!assetIds.includes(asset.id)) assetIds.push(asset.id);
            if (image.role === 'character') characterId ||= asset.id;
            if (image.role === 'wallpaper') backgroundId ||= asset.id;
            this.write(data);
          } catch (error) { errors.push({ package: pkg.title, name: image.name, error: error.message }); }
        }
        const profileId = `source-${pkg.id}`;
        if ((backgroundId || characterId) && !data.profiles.some(p => p.id === profileId)) data.profiles.push(normalizeProfile({ ...PRESETS[0], id: profileId, name: pkg.title, preset: PRESETS[0].id, backgroundId, characterId }));
        data.packages ||= [];
        data.packages = data.packages.filter(p => p.id !== pkg.id);
        data.packages.push({ id: pkg.id, title: pkg.title, author: pkg.author, source: pkg.source, assetIds, profileId, preview, failedCount: errors.length - initialErrors, importedAt: new Date().toISOString() });
        this.write(data);
      }
      return { ...this.list(), added, packagesImported: plan.length, errors };
    });
  }
  importCatalogMaterials(id) {
    return this.serial(async () => {
      const entries = id === 'all' ? this.catalog.data.entries : [this.catalog.entry(id)];
      const imported = [], errors = []; let added = 0;
      for (const entry of entries) for (let index = 0; index < entry.materials.length; index++) {
        try {
          const source = await this.catalog.material(entry.id, index);
          const data = this.read(), previous = data.assets.length;
          const asset = await this.storeAsset(await this.decodeImage(source.buffer), { name: source.name, kind: 'character', source: source.source }, data);
          this.write(data); added += data.assets.length - previous; imported.push(asset.id);
        } catch (error) { errors.push({ name: entry.materials[index].name, error: error.message }); }
      }
      return { ...this.list(), imported, added, errors };
    });
  }
  composeCharacterWallpaper(payload) { return this.serial(() => this._composeCharacterWallpaper(payload)); }
  async _composeCharacterWallpaper(payload) {
      const data = this.read(), asset = data.assets.find(a => a.id === payload?.id && a.kind === 'character');
      if (!asset) throw new Error('请选择已导入的人物素材');
      const background = await renderBackground(payload.preset, payload.size);
      const sharp = require('sharp'), meta = await sharp(background.buffer).metadata();
      if (payload.backgroundId) {
        if (!data.assets.some(a => a.id === payload.backgroundId)) throw new Error('壁纸底图不存在');
        background.buffer = await sharp(this.assetPath(payload.backgroundId), { limitInputPixels: 40_000_000 }).resize(meta.width, meta.height, { fit: 'cover' }).png().toBuffer();
      }
      const character = await sharp(this.assetPath(asset.id), { limitInputPixels: 40_000_000 }).resize({ width: Math.round(meta.width * .45), height: Math.round(meta.height * .82), fit: 'inside' }).png().toBuffer();
      const foreground = await sharp(character).metadata();
      const buffer = await sharp(background.buffer).composite([{ input: character, left: meta.width - foreground.width - Math.round(meta.width * .04), top: meta.height - foreground.height }]).png().toBuffer();
      const result = await this.storeAsset(buffer, { name: `${asset.name} · 合成壁纸`, kind: 'generated', source: asset.source }, data);
      this.write(data); return { ...this.list(), generatedAssetId: result.id };
  }
  importImages(paths) {
    return this.serial(async () => {
      if (!Array.isArray(paths) || paths.length > 30) throw new Error('一次最多导入 30 张图片');
      const data = this.read();
      const imported = [], errors = [];
      for (const file of paths) {
        try {
          const icon = ['.ico', '.cur'].includes(path.extname(file).toLowerCase());
          if (!['.png', '.jpg', '.jpeg', '.webp', '.ico', '.cur'].includes(path.extname(file).toLowerCase())) throw new Error('支持 PNG、JPEG、WebP、ICO、CUR 图片');
          const stat = fs.statSync(file);
          if (!stat.isFile() || stat.size > MAX_IMAGE) throw new Error('图片不能超过 25 MB');
          const input = fs.readFileSync(file);
          if (input.length > MAX_IMAGE) throw new Error('图片不能超过 25 MB');
          const buffer = await this.decodeImage(input);
          const asset = await this.storeAsset(buffer, { name: path.basename(file), kind: icon ? 'icon' : 'imported' }, data);
          imported.push(asset.id);
        } catch (error) { errors.push({ name: path.basename(String(file)), error: error.message }); }
      }
      this.write(data);
      return { imported, errors, ...this.list() };
    });
  }
  importFolder(id, controls = {}) {
    return this.serial(async () => {
      let data = this.read(); const previous = data.assets.length;
      const result = await this.folderImport.consume(id, async (input, name) => {
        const next = { ...data, assets: data.assets.map(asset => ({ ...asset })) };
        const asset = await this.storeAsset(await this.decodeImage(input), { name }, next);
        this.write(next); // Keep completed images if a later file or process fails.
        data = next;
        return asset.id;
      }, { ...controls, onProgress: state => controls.onProgress?.({ ...state, added: data.assets.length - previous }) });
      return { ...result, added: data.assets.length - previous, ...this.list() };
    });
  }
  generateBackground(payload = {}) {
    return this.serial(async () => {
      const background = await renderBackground(payload.preset, payload.size || 'fhd');
      const data = this.read();
      const asset = await this.storeAsset(background.buffer, { name: background.name, kind: 'generated' }, data);
      this.write(data);
      return { generatedAssetId: asset.id, ...this.list() };
    });
  }
  prepareThumbnails() {
    return this.serial(async () => {
      const data = this.read(), errors = [];
      let prepared = 0;
      for (const asset of data.assets) {
        try {
          if (fs.existsSync(this.thumbnailPath(asset.id))) continue;
          const file = this.assetPath(asset.id);
          if (fs.statSync(file).size > MAX_IMAGE) throw new Error('图片超过大小限制');
          const thumbnail = await this.thumbnailImage(fs.readFileSync(file));
          fs.mkdirSync(path.join(this.root, 'thumbnails'), { recursive: true });
          writeImmutable(this.thumbnailPath(asset.id), thumbnail.buffer);
          Object.assign(asset, { width: thumbnail.width, height: thumbnail.height });
          prepared++;
        } catch (error) { errors.push({ name: asset.name, error: error.message }); }
      }
      this.write(data);
      return { prepared, errors, ...this.list() };
    });
  }
  saveProfile(input) {
    return this.serial(() => {
      const profile = normalizeProfile(input), data = this.read();
      if (profile.backgroundId && !data.assets.some(a => a.id === profile.backgroundId)) throw new Error('背景素材不存在，请重新导入');
      if (profile.characterId && !data.assets.some(a => a.id === profile.characterId && a.kind === 'character')) throw new Error('人物素材不存在，请重新导入');
      data.profiles = data.profiles.filter(p => p.id !== profile.id);
      data.profiles.push(profile);
      data.activeProfileId = profile.id;
      this.write(data);
      return this.list();
    });
  }
  deleteProfile(id) {
    return this.serial(() => {
      if (!PROFILE_ID.test(id || '')) throw new Error('主题 ID 无效');
      const data = this.read();
      data.profiles = data.profiles.filter(p => p.id !== id);
      if (data.activeProfileId === id) data.activeProfileId = data.profiles[0]?.id || '';
      this.write(data);
      return this.list();
    });
  }
  selectProfile(id) {
    return this.serial(() => {
      const data = this.read();
      if (!PROFILE_ID.test(id || '') || !data.profiles.some(p => p.id === id)) throw new Error('主题不存在');
      data.activeProfileId = id;
      this.write(data);
      return this.list();
    });
  }
  deleteAsset(id) {
    return this.serial(() => {
      const file = this.assetPath(id), data = this.read();
      if (data.profiles.some(p => p.backgroundId === id || p.characterId === id)) throw new Error('这张图片正被已保存主题使用，请先更换主题背景或删除主题');
      if ((data.packages || []).some(p => p.assetIds.includes(id))) throw new Error('这张素材属于已导入预设，请保留预设素材');
      if (data.recovery?.lastApplied === file) throw new Error('这张图片正作为桌面壁纸使用，请先恢复原壁纸');
      data.assets = data.assets.filter(a => a.id !== id);
      this.write(data);
      // Manifest first: if interrupted, an orphan image is harmless; a dangling reference is not.
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(this.thumbnailPath(id))) fs.unlinkSync(this.thumbnailPath(id));
      return this.list();
    });
  }
  exportBundle(input) {
    const profile = normalizeProfile(input), data = this.read();
    const bundle = { format: 'agent-toolbox-beauty', version: 1, theme: { ...profile, backgroundId: '', characterId: '' } };
    for (const [field, id] of [['background', profile.backgroundId], ['character', profile.characterId]]) if (id) {
      const asset = data.assets.find(a => a.id === id);
      if (!asset) throw new Error('背景素材不存在');
      const file = this.assetPath(asset.id);
      if (fs.statSync(file).size > MAX_IMAGE) throw new Error('图片超过主题包大小限制');
      bundle[field] = { mime: 'image/png', name: String(asset.name).slice(0, 120), kind: asset.kind === 'character' ? 'character' : 'image',
        sourceArticleId: asset.source?.articleId, base64: fs.readFileSync(file).toString('base64') };
      if (asset.source?.packageId && /^https:\/\/winmoes\.com\/workshop\/packages\/[a-z0-9]{1,32}$/.test(asset.source.url || '')) bundle[field].sourcePackage = {
        packageId: asset.source.packageId, title: String(asset.source.title || '').slice(0, 100), author: String(asset.source.author || '').slice(0, 80), url: asset.source.url };
    }
    return JSON.stringify(bundle, null, 2);
  }
  importBundle(text) {
    return this.serial(async () => {
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BUNDLE) throw new Error('主题包过大或格式无效');
      let bundle;
      try { bundle = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('主题包不是有效的 JSON 文件'); }
      if (!bundle || bundle.format !== 'agent-toolbox-beauty' || bundle.version !== 1 || !bundle.theme || typeof bundle.theme !== 'object' || Array.isArray(bundle.theme)) throw new Error('不支持的主题包格式或版本');
      const profile = normalizeProfile({ ...bundle.theme, id: crypto.randomUUID(), backgroundId: '', characterId: '' });
      const decoded = [];
      for (const field of ['background', 'character']) if (bundle[field] != null) {
        const background = bundle[field];
        if (background.mime !== 'image/png' || typeof background.base64 !== 'string' || background.base64.length > Math.ceil(MAX_IMAGE * 4 / 3)) throw new Error('主题包中的图片格式无效');
        const base64 = background.base64;
        if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('主题包中的图片编码无效');
        const input = Buffer.from(base64, 'base64');
        if (input.length > MAX_IMAGE || input.toString('base64') !== base64) throw new Error('主题包中的图片编码无效');
        if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('主题包中的图片必须是真实 PNG');
        const buffer = await this.decodeImage(input);
        if (buffer.length > MAX_IMAGE) throw new Error('主题包中的图片过大');
        decoded.push({ field, background, buffer });
      }
      const data = this.read();
      for (const { field, background, buffer } of decoded) {
        const item = this.catalog.data.entries.find(x => x.id === background.sourceArticleId);
        const sourcePackage = background.sourcePackage;
        const packageSource = sourcePackage && /^[a-z0-9]{1,32}$/.test(sourcePackage.packageId || '') && sourcePackage.url === `https://winmoes.com/workshop/packages/${sourcePackage.packageId}`
          ? { packageId: sourcePackage.packageId, url: sourcePackage.url, title: String(sourcePackage.title || '').slice(0, 100), author: String(sourcePackage.author || '').slice(0, 80) } : undefined;
        const asset = await this.storeAsset(buffer, { name: path.basename(String(background.name || '主题背景.png')), kind: field === 'character' || background.kind === 'character' ? 'character' : 'imported',
          source: item ? { articleId: item.id, url: item.url, author: item.author } : packageSource }, data);
        profile[field === 'character' ? 'characterId' : 'backgroundId'] = asset.id;
      }
      data.profiles.push(profile);
      data.activeProfileId = profile.id;
      this.write(data);
      return { importedProfileId: profile.id, ...this.list() };
    });
  }
  applyWallpaper(id) { return this.serial(() => this._applyWallpaper(id)); }
  async _applyWallpaper(id) {
      if (this.platform !== 'win32') throw new Error('应用桌面壁纸仅支持 Windows');
      const data = this.read(), asset = this.assetPath(id);
      if (!data.assets.some(a => a.id === id) || !fs.existsSync(asset)) throw new Error('请先导入背景图片');
      if (!data.recovery) {
        const original = await this.native.wallpaper();
        if (typeof original !== 'string') throw new Error('无法识别当前壁纸路径，已停止应用');
        const recoveryId = crypto.randomUUID();
        // Persist the baseline before calling any mutating Windows API, even if it fails.
        let copy = '';
        if (original) {
          if (!fs.existsSync(original)) throw new Error('原壁纸文件不存在，无法备份，已停止应用');
          fs.mkdirSync(path.join(this.root, 'recovery'), { recursive: true });
          copy = path.join(this.root, 'recovery', `wallpaper-${recoveryId}${path.extname(original).slice(0, 12) || '.bmp'}`);
          fs.copyFileSync(original, copy);
        }
        data.recovery = { id: recoveryId, original, copy, at: new Date().toISOString(), lastApplied: '' };
        this.write(data);
      }
      // Write intent first: a crash after the API must still leave a recoverable state.
      data.recovery.lastApplied = asset;
      this.write(data);
      await this.native.setWallpaper(asset);
      return this.list();
  }
  restoreWallpaper() { return this.serial(() => this._restoreWallpaper()); }
  async _restoreWallpaper() {
      if (this.platform !== 'win32') throw new Error('恢复桌面壁纸仅支持 Windows');
      const data = this.read(), recovery = data.recovery;
      if (!recovery) throw new Error('还没有可恢复的壁纸备份');
      // Refuse malformed persisted paths before touching the OS.
      if (typeof recovery.original !== 'string' || typeof recovery.copy !== 'string' ||
        (!!recovery.original !== !!recovery.copy)) throw new Error('壁纸备份记录无效，请保留恢复记录');
      if (recovery.id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(recovery.id)) throw new Error('壁纸备份 ID 无效');
      const backupName = recovery.id ? `wallpaper-${recovery.id}` : 'wallpaper';
      const expectedCopy = path.join(this.root, 'recovery', `${backupName}${path.extname(recovery.original || '').slice(0, 12) || '.bmp'}`);
      if (recovery.copy && path.resolve(recovery.copy) !== path.resolve(expectedCopy) &&
        (!fs.existsSync(recovery.copy) || !fs.existsSync(expectedCopy) || fs.realpathSync(recovery.copy) !== fs.realpathSync(expectedCopy))) throw new Error('壁纸备份路径无效');
      // Restore the bytes captured at first apply; Spotlight may replace its original path.
      const original = !recovery.original ? '' : expectedCopy;
      if (original && !fs.existsSync(original)) throw new Error('壁纸备份丢失，请保留恢复记录');
      await this.native.setWallpaper(original);
      data.recovery = null;
      this.write(data);
      return this.list();
  }
  applyPersonalization(options) { return this.serial(() => this._applyPersonalization(options)); }
  async _applyPersonalization(options) {
      if (this.platform !== 'win32') throw new Error('Windows 外观仅支持 Windows');
      const plan = personalizationPlan(options);
      if (!Object.keys(plan).length) throw new Error('请先选择需要更改的 Windows 外观项');
      const data = this.read();
      if (data.personalizationRecovery && data.personalizationRecovery.version !== 1) throw new Error('Windows 外观备份版本无法识别');
      const saved = data.personalizationRecovery ? validatePersonalizationValues(data.personalizationRecovery.values) : {};
      const current = await this.native.personalization();
      const original = { ...saved };
      for (const key of Object.keys(plan)) {
        if (!Object.hasOwn(original, key)) original[key] = current[key];
      }
      // Capture only touched fields, including missing values. Refuse unexpected types before any OS mutation.
      const values = validatePersonalizationValues(original);
      data.personalizationRecovery = { version: 1, at: data.personalizationRecovery?.at || new Date().toISOString(), values };
      this.write(data);
      const result = await this.native.setPersonalization(plan);
      return { ...this.list(), personalizationNotified: result?.notified !== false };
  }
  restorePersonalization() { return this.serial(() => this._restorePersonalization()); }
  async _restorePersonalization() {
      if (this.platform !== 'win32') throw new Error('Windows 外观仅支持 Windows');
      const data = this.read(), recovery = data.personalizationRecovery;
      if (!recovery || recovery.version !== 1) throw new Error('还没有可恢复的 Windows 外观备份');
      const result = await this.native.setPersonalization(validatePersonalizationValues(recovery.values));
      data.personalizationRecovery = null;
      this.write(data);
      return { ...this.list(), personalizationNotified: result?.notified !== false };
  }

}

class WindowsBeautyBridge {
  constructor({ exec = execFileAsync, platform = process.platform } = {}) { this.exec = exec; this.platform = platform; }
  async run(operation, file = '') {
    if (this.platform !== 'win32') throw new Error('原生桥接仅支持 Windows');
    if (!['wallpaper', 'set-wallpaper', 'probe', 'personalization', 'set-personalization'].includes(operation)) throw new Error('原生操作无效');
    const script = path.join(__dirname, 'system-beauty-native.ps1');
    // Read through Electron's asar filesystem; PowerShell cannot open a path inside app.asar.
    // User paths or JSON are UTF-8 base64 data, never interpolated as PowerShell code.
    const encodedPath = Buffer.from(file, 'utf8').toString('base64');
    const command = `& {\n${fs.readFileSync(script, 'utf8')}\n} -Operation '${operation}' -ImagePath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')))`;
    const { stdout } = await this.exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }
  async wallpaper() { return (await this.run('wallpaper')).path; }
  async setWallpaper(file) { return this.run('set-wallpaper', file); }
  async personalization() { return this.run('personalization'); }
  async setPersonalization(values) { return this.run('set-personalization', JSON.stringify(validatePersonalizationValues(values))); }
  async probe() { return this.platform === 'win32' ? this.run('probe') : { supported: false, running: false }; }
}

function registerSystemBeautyIpc(ipcMain, { getUserDataPath, dialog, getWindow, shell }) {
  const beauty = new SystemBeauty({ root: path.join(fs.realpathSync(getUserDataPath()), 'system-beauty') });
  const rendererRoot = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href;
  const folderJobs = new BeautyFolderJobs();
  const folderOwner = event => {
    const frame = event.senderFrame, url = frame.url;
    return { key: `${event.sender.id}:${frame.processId}:${frame.routingId}:${url}`, alive: () => !frame.isDestroyed() && frame.url === url };
  };
  function handle(name, fn, withEvent = false) {
    ipcMain.handle(`systemBeauty:${name}`, async (event, ...args) => {
      try {
        const url = new URL(event.senderFrame.url);
        if (url.protocol !== 'file:' || !url.href.startsWith(rendererRoot) || !url.pathname.endsWith('.html')) throw new Error('仅允许工具箱本地页面访问');
        return { ok: true, data: await (withEvent ? fn(event, ...args) : fn(...args)) };
      } catch (error) { return { ok: false, error: error.message }; }
    });
  }
  async function openLocalFolder(relative = '') {
    const folder = path.join(fs.realpathSync(getUserDataPath()), 'system-beauty', relative);
    fs.mkdirSync(folder, { recursive: true });
    // Explorer may not follow the userData junction even when Node can read it.
    // Pass the physical directory across the app boundary; keep stored settings intact.
    const error = await shell.openPath(fs.realpathSync(folder));
    if (error) throw new Error(error);
    return {};
  }
  beauty.explorerEngine.openFolder = () => openLocalFolder('theme-test');
  handle('list', () => beauty.list());
  handle('explorerEngineStatus', () => beauty.explorerEngine.status());
  handle('restartExplorerEngine', () => beauty.serial(async () => ({ ...beauty.list(), explorerEngine: await beauty.explorerEngine.restart() })));
  handle('openExplorerThemeTest', () => openLocalFolder('theme-test'));
  handle('installExplorerEngine', () => beauty.serial(async () => ({ ...beauty.list(), explorerEngine: await beauty.explorerEngine.install() })));
  handle('uninstallExplorerEngine', () => beauty.serial(async () => ({ ...beauty.list(), explorerEngine: await beauty.explorerEngine.uninstall() })));
  handle('applySystemTheme', payload => beauty.applySystemTheme(payload));
  handle('restoreSystemTheme', () => beauty.restoreSystemTheme());
  handle('catalog', () => beauty.catalog.list());
  handle('importPreparedPackages', () => beauty.importPreparedPackages());
  handle('cacheCatalogCovers', () => beauty.catalog.cacheCovers());
  handle('importCatalogMaterials', id => beauty.importCatalogMaterials(id));
  handle('composeCharacterWallpaper', payload => beauty.composeCharacterWallpaper(payload));
  handle('openCatalogSource', async id => { const entry = beauty.catalog.entry(id); await shell.openExternal(entry.packages[0]?.url || entry.url); return {}; });
  handle('generateBackground', payload => beauty.generateBackground(payload));
  handle('prepareThumbnails', () => beauty.prepareThumbnails());
  handle('importImages', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: '导入美化背景素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与图标', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'cur'] }] });
    return result.canceled ? { canceled: true } : beauty.importImages(result.filePaths);
  });
  handle('saveProfile', p => beauty.saveProfile(p));
  handle('scanImageFolder', async event => {
    const owner = folderOwner(event);
    const selected = await dialog.showOpenDialog(getWindow(), { title: '选择美化素材文件夹（先预览，再导入）', properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths?.length) return { canceled: true };
    const preview = await beauty.folderImport.scan(selected.filePaths[0]);
    folderJobs.bind(preview, owner); return preview;
  }, true);
  handle('cancelImageFolder', (event, id) => { folderJobs.checkPreview(id, folderOwner(event)); return beauty.folderImport.cancel(id); }, true);
  handle('importImageFolder', (event, id) => folderJobs.run(id, folderOwner(event), controls => beauty.importFolder(id, controls)), true);
  handle('imageFolderProgress', (event, id) => folderJobs.status(id, folderOwner(event)), true);
  handle('stopImageFolderImport', (event, id) => folderJobs.stop(id, folderOwner(event)), true);
  handle('deleteProfile', id => beauty.deleteProfile(id));
  handle('selectProfile', id => beauty.selectProfile(id));
  handle('deleteAsset', id => beauty.deleteAsset(id));
  handle('exportBundle', async profile => {
    const text = beauty.exportBundle(profile);
    const selected = await dialog.showSaveDialog(getWindow(), { title: '导出便携主题包（包含背景图片）', defaultPath: '我的主题.toolbox-theme.json', filters: [{ name: 'Toolbox 主题包', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    fs.writeFileSync(selected.filePath, text, 'utf8');
    return { path: selected.filePath };
  });
  handle('importBundle', async () => {
    const selected = await dialog.showOpenDialog(getWindow(), { title: '导入 Toolbox 主题包', properties: ['openFile'], filters: [{ name: 'Toolbox 主题包', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePaths.length) return { canceled: true };
    const file = selected.filePaths[0];
    if (fs.statSync(file).size > MAX_BUNDLE) throw new Error('主题包超过大小限制');
    return beauty.importBundle(fs.readFileSync(file, 'utf8'));
  });
  handle('exportRecipe', async payload => {
    const recipe = makeNativeRecipe(payload?.engine, normalizeProfile(payload?.profile));
    const selected = await dialog.showSaveDialog(getWindow(), { title: '导出原生引擎配方（手动导入后生效）', defaultPath: recipe.fileName, filters: [{ name: '原生引擎配置', extensions: ['ini'] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    fs.writeFileSync(selected.filePath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(recipe.text, 'utf16le')]));
    return { path: selected.filePath, engine: recipe.engine };
  });
  handle('exportMergedRecipe', async payload => {
    const recipe = makeNativeRecipe(payload?.engine, normalizeProfile(payload?.profile));
    const source = await dialog.showOpenDialog(getWindow(), { title: '读取已有引擎 INI（只读）', properties: ['openFile'], filters: [{ name: '原生引擎配置', extensions: ['ini'] }] });
    if (source.canceled || !source.filePaths?.length) return { canceled: true };
    const merged = mergeNativeIni(readIni(source.filePaths[0]), recipe);
    const target = await dialog.showSaveDialog(getWindow(), { title: '另存合并版 INI（请选择新文件名）', defaultPath: path.join(path.dirname(source.filePaths[0]), recipe.fileName.replace('.ini', '-merged.ini')), filters: [{ name: '原生引擎配置', extensions: ['ini'] }] });
    if (target.canceled || !target.filePath) return { canceled: true };
    writeNewIni(target.filePath, merged.buffer);
    return { path: target.filePath, engine: recipe.engine, encoding: merged.encoding };
  });
  handle('applyWallpaper', id => beauty.applyWallpaper(id));
  handle('restoreWallpaper', () => beauty.restoreWallpaper());
  handle('personalization', async () => ({ values: await beauty.native.personalization() }));
  handle('applyPersonalization', options => beauty.applyPersonalization(options));
  handle('restorePersonalization', () => beauty.restorePersonalization());
  handle('previewNative', profile => beauty.preview.open(normalizeProfile(profile)));
  handle('refreshWindows', async () => { await beauty.windowAppearance.refresh(); return beauty.list(); });
  handle('applyWindowAppearance', async payload => { await beauty.windowAppearance.apply(payload?.targetId, payload?.options); return beauty.list(); });
  handle('restoreWindowAppearance', async id => { await beauty.windowAppearance.restore(id); return beauty.list(); });
  handle('restoreAllWindowAppearances', async () => {
    const result = await beauty.windowAppearance.restoreAll();
    return { ...beauty.list(), windowRestoreSummary: result.restoreSummary };
  });
  handle('forgetClosedWindow', async id => { await beauty.windowAppearance.forgetClosed(id); return beauty.list(); });
  handle('probe', () => beauty.native.probe());
  handle('openFolder', () => openLocalFolder());
  return beauty;
}

module.exports = { SystemBeauty, WindowsBeautyBridge, normalizeProfile, registerSystemBeautyIpc, MAX_BUNDLE };
