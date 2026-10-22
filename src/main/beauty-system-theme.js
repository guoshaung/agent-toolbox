'use strict';
const fs = require('node:fs');
const { renderBackground } = require('./beauty-backgrounds');
class SystemThemeSession {
  constructor(beauty, normalize) { this.beauty = beauty; this.normalize = normalize; }
  async apply(payload) {
    const b = this.beauty;
    if (b.platform !== 'win32') throw new Error('电脑主题仅支持 Windows');
    const profile = this.normalize(payload?.profile), options = payload?.options;
    if (!options || !['wallpaper', 'explorer', 'colors'].every(k => typeof options[k] === 'boolean') || !['wallpaper', 'explorer', 'colors'].some(k => options[k])) throw new Error('请选择需要应用的电脑主题项目');
    const data = b.read();
    for (const id of [profile.backgroundId, profile.characterId].filter(Boolean)) if (!data.assets.some(x => x.id === id) || !fs.existsSync(b.assetPath(id))) throw new Error('主题素材缺失，请重新选择');
    if (options.explorer && !(await b.explorerEngine.status()).registered) throw new Error('请先点击“启用资源管理器组件”并完成 Windows 授权；尚未更改电脑主题');
    // Prepare and decode both layers before touching any Windows state.
    let explorerBuffer;
    const sharp = require('sharp');
    if (options.explorer) {
      if (profile.characterId && !profile.backgroundId) explorerBuffer = await sharp(b.assetPath(profile.characterId)).resize({ width: 480, height: 640, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      else {
        const source = profile.backgroundId ? fs.readFileSync(b.assetPath(profile.backgroundId)) : (await renderBackground(profile.preset, 'fhd')).buffer;
        let canvas = sharp(source).resize(1280, 800, { fit: 'cover' });
        if (profile.characterId) {
          const figure = await sharp(b.assetPath(profile.characterId)).resize({ width: 500, height: 700, fit: 'inside' }).png().toBuffer(), dimensions = await sharp(figure).metadata();
          canvas = canvas.composite([{ input: figure, left: 1260 - dimensions.width, top: 800 - dimensions.height }]);
        }
        explorerBuffer = await canvas.png().toBuffer();
      }
    }
    let wallpaperId = profile.backgroundId;
    if (options.wallpaper) {
      if (profile.characterId) wallpaperId = (await b._composeCharacterWallpaper({ id: profile.characterId, backgroundId: profile.backgroundId, preset: profile.preset, size: 'fhd' })).generatedAssetId;
      else if (!wallpaperId) {
        const rendered = await renderBackground(profile.preset, 'fhd'), current = b.read();
        wallpaperId = (await b.storeAsset(rendered.buffer, { name: profile.name + ' · 桌面', kind: 'generated' }, current)).id; b.write(current);
      }
    }
    const state = b.read();
    state.themeSession = { version: 1, startedAt: state.themeSession?.startedAt || new Date().toISOString(), phase: 'applying', name: profile.name, options, error: '' }; b.write(state);
    try {
      if (options.wallpaper) await b._applyWallpaper(wallpaperId);
      if (options.colors) {
        const rgb = profile.tint.slice(1).match(/../g).map(x => parseInt(x, 16)), light = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 >= 145;
        await b._applyPersonalization({ apps: light ? 'light' : 'dark', system: light ? 'light' : 'dark', transparency: profile.effect === 'solid' ? 'off' : 'on' });
      }
      const engine = options.explorer ? await b.explorerEngine.apply(explorerBuffer, { cover: !!profile.backgroundId || !profile.characterId }) : await b.explorerEngine.status();
      const current = b.read(); current.themeSession.phase = engine.pendingWindow ? 'waiting-for-explorer' : 'applied'; current.themeSession.at = new Date().toISOString(); b.write(current);
      return { ...b.list(), explorerEngine: engine };
    } catch (error) {
      const current = b.read(); current.themeSession.phase = 'failed'; current.themeSession.error = error.message; b.write(current); throw error;
    }
  }
  async restore() {
    const b = this.beauty, errors = [];
    if (b.platform !== 'win32') throw new Error('恢复电脑主题仅支持 Windows');
    const attempt = async (part, action) => { try { await action(); } catch (error) { errors.push({ part, error: error.message }); } };
    await attempt('资源管理器人物与背景', () => b.explorerEngine.disable());
    if (b.read().personalizationRecovery) await attempt('Windows 配色', () => b._restorePersonalization());
    if (b.read().recovery) await attempt('桌面壁纸', () => b._restoreWallpaper());
    const current = b.read();
    if (errors.length) current.themeSession = { ...(current.themeSession || {}), version: 1, phase: 'restore-failed', error: errors.map(e => `${e.part}：${e.error}`).join('；') };
    else current.themeSession = null;
    b.write(current);
    return { ...b.list(), restoreErrors: errors, explorerEngine: await b.explorerEngine.status() };
  }
}
module.exports = { SystemThemeSession };
