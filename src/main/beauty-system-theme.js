'use strict';
const fs = require('node:fs');
const { renderBackground } = require('./beauty-backgrounds');
class SystemThemeSession {
  constructor(beauty, normalize) { this.beauty = beauty; this.normalize = normalize; }
  async apply(payload) {
    const b = this.beauty;
    if (b.platform !== 'win32') throw new Error('电脑主题仅支持 Windows');
    let profile = this.normalize(payload?.profile);const options = {...payload?.options};
    for(const key of ['windows','icons','cursors','shellColors','taskbar','desktopMotion','matchPalette']) { if(options[key]===undefined)options[key]=false; else if(typeof options[key]!=='boolean')throw new Error('电脑主题范围无效'); }
    if (!['wallpaper', 'explorer', 'colors'].every(k => typeof options[k] === 'boolean') || !['wallpaper', 'explorer', 'colors','windows','icons','cursors','shellColors','taskbar','desktopMotion'].some(k => options[k])) throw new Error('请选择需要应用的电脑主题项目');
    const data = b.read();
    b.themeWindows.stop();
    for (const id of [profile.backgroundId, profile.characterId].filter(Boolean)) if (!data.assets.some(x => x.id === id) || !fs.existsSync(b.assetPath(id))) throw new Error('主题素材缺失，请重新选择');
    if(options.matchPalette&&profile.characterId){const palette=await require('./beauty-palette').portraitPalette(b.assetPath(profile.characterId));if(palette)profile={...profile,...palette};}
    if (options.explorer && !(await b.explorerEngine.status()).registered) throw new Error('请先点击“启用资源管理器组件”并完成 Windows 授权；尚未更改电脑主题');
    if (options.explorer && b.explorerEngine.ensureLoaded) await b.explorerEngine.ensureLoaded();
    const shellPlan=options.icons||options.cursors||options.shellColors?await b.shellAssets.prepare(b,profile,options):null;
    if(shellPlan&&b.shellAssets.native.run)await b.shellAssets.native.run('validate',{values:shellPlan.plan});
    if(options.taskbar)await (b.taskbarStyle.preflight?b.taskbarStyle.preflight():b.taskbarStyle.prepare());
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
    state.themeSession = { version: 1, startedAt: state.themeSession?.startedAt || new Date().toISOString(), phase: 'applying', name: profile.name, profile, options, error: '' }; b.write(state);
    try {
      // Capture the original shell/window values before broadcasts from wallpaper
      // or Windows color changes can rewrite them. Reapply the window plan after
      // the broadcasts, retaining this first baseline.
      if(shellPlan&&b.shellAssets.capture)await b.shellAssets.capture(shellPlan);
      if(options.windows)await b.themeWindows.apply(profile);
      if (options.wallpaper) await b._applyWallpaper(wallpaperId);
      if (options.colors) {
        const rgb = profile.tint.slice(1).match(/../g).map(x => parseInt(x, 16)), light = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 >= 145;
        await b._applyPersonalization({ apps: light ? 'light' : 'dark', system: light ? 'light' : 'dark', transparency: profile.effect === 'solid' ? 'off' : 'on' });
      }
      const engine = options.explorer ? await b.explorerEngine.apply(explorerBuffer, { cover: !!profile.backgroundId || !profile.characterId }) : await b.explorerEngine.status();
      let windowSummary;
      if(options.windows){windowSummary=await b.themeWindows.apply(profile);b.themeWindows.watch(profile,fn=>b.serial(fn));}
      const shellSummary=shellPlan?await b.shellAssets.apply(shellPlan):null;
      const taskbarSummary=options.taskbar?await b.taskbarStyle.apply(profile):null;
      let desktopSummary;
      if(options.desktopMotion){try{desktopSummary=await b.desktopScene.apply(b,profile);}catch(error){desktopSummary={running:false,error:error.message};}}
      else b.desktopScene.close();
      const current = b.read(); current.themeSession.phase = engine.pendingWindow ? 'waiting-for-explorer' : 'applied'; current.themeSession.at = new Date().toISOString();
      if(windowSummary)current.themeSession.windowSummary=windowSummary;
      if(shellSummary)current.themeSession.shellSummary=shellSummary;
      if(taskbarSummary)current.themeSession.taskbarSummary=taskbarSummary;
      if(desktopSummary)current.themeSession.desktopSummary=desktopSummary;
      b.write(current);
      return { ...b.list(), explorerEngine: engine };
    } catch (error) {
      const current = b.read(); current.themeSession.phase = 'failed'; current.themeSession.error = error.message; b.write(current); throw error;
    }
  }
  async restore() {
    const b = this.beauty, errors = [];
    b.themeWindows.stop();
    b.desktopScene.close();
    if (b.platform !== 'win32') throw new Error('恢复电脑主题仅支持 Windows');
    const attempt = async (part, action) => { try { await action(); } catch (error) { errors.push({ part, error: error.message }); } };
    await attempt('资源管理器人物与背景', () => b.explorerEngine.disable());
    await attempt('任务栏材质',()=>b.taskbarStyle.restore());
    await attempt('系统图标与鼠标指针',()=>b.shellAssets.restore());
    if (b.read().personalizationRecovery) await attempt('Windows 配色', () => b._restorePersonalization());
    if (b.read().recovery) await attempt('桌面壁纸', () => b._restoreWallpaper());
    if(b.themeWindows.list().records.length||b.read().themeSession?.options.windows)await attempt('窗口圆角、标题栏与材质', async()=>{const r=await b.themeWindows.restore();if(r.failed.length)throw Error(r.failed.map(x=>x.error).join('；'));});
    const current = b.read();
    if (errors.length) current.themeSession = { ...(current.themeSession || {}), version: 1, phase: 'restore-failed', error: errors.map(e => `${e.part}：${e.error}`).join('；') };
    else current.themeSession = null;
    b.write(current);
    return { ...b.list(), restoreErrors: errors, explorerEngine: await b.explorerEngine.status() };
  }
}
module.exports = { SystemThemeSession };
