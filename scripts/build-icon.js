'use strict';
/**
 * 把 assets/logo.svg 渲染成 1024 的 PNG。
 * 用 Electron 自己渲染，不引入 sharp / svg2png 这类原生依赖。
 *
 *   npm run icon
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SIZE = 1024;

app.disableHardwareAcceleration(); // 无头渲染更稳，也避免 GPU 差异导致抗锯齿不一致

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'), 'utf8');
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}
      svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));   // 等一帧，确保渐变和 mask 都画完

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), image.toPNG());
  console.log('assets/icon.png 已生成', image.getSize());

  win.destroy();

  // 顺便生成 macOS 的 .icns（iconutil 和 sips 都是系统自带，不用装东西）
  try {
    buildIcns(path.join(ROOT, 'assets', 'icon.png'), path.join(ROOT, 'assets'));
    console.log('assets/icon.icns 已生成');
  } catch (err) {
    console.warn('生成 .icns 失败（不影响使用，dock 图标走 icon.png）：', err.message);
  }

  app.quit();
});

function buildIcns(sourcePng, outDir) {
  const { execFileSync } = require('node:child_process');
  const iconset = path.join(outDir, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const specs = [[16, ''], [32, '@2x'], [32, ''], [64, '@2x'], [128, ''], [256, '@2x'],
    [256, ''], [512, '@2x'], [512, ''], [1024, '@2x']];
  const bases = [16, 16, 32, 32, 128, 128, 256, 256, 512, 512];

  specs.forEach(([px, suffix], i) => {
    const name = `icon_${bases[i]}x${bases[i]}${suffix}.png`;
    execFileSync('sips', ['-z', String(px), String(px), sourcePng, '--out', path.join(iconset, name)],
      { stdio: 'ignore' });
  });

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
}
