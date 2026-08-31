'use strict';
/** 定稿预览：大图看气质，48 / 32 / 16px 看小尺寸还认不认得出 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { build } = require('./build-logo');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const icon = build({ prefix: 'p1', withBackground: true });   // Dock 图标
  const mark = build({ prefix: 'p2', withBackground: false });  // 侧栏标记（无底）

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#14161c;font-family:-apple-system,"PingFang SC",sans-serif;color:#e6e9ef}
    .row{display:flex;align-items:flex-end;gap:34px;padding:34px}
    .col{display:flex;flex-direction:column;align-items:center;gap:12px}
    .label{font-size:14px;color:#9aa2b1}
    .s220 svg{width:220px;height:220px}.s96 svg{width:96px;height:96px}
    .s48 svg{width:48px;height:48px}.s32 svg{width:32px;height:32px}.s16 svg{width:16px;height:16px}
    .rail{background:#0b0d11;border-radius:10px;padding:14px 22px}
  </style>
  <div class="row">
    <div class="col"><div class="s220">${icon}</div><div class="label">Dock 图标</div></div>
    <div class="col"><div class="s96">${icon}</div><div class="label">96</div></div>
    <div class="col"><div class="s48">${icon}</div><div class="label">48</div></div>
    <div class="col"><div class="s32">${icon}</div><div class="label">32</div></div>
    <div class="col"><div class="s16">${icon}</div><div class="label">16</div></div>
    <div class="col"><div class="rail s32">${mark}</div><div class="label">侧栏（无底）</div></div>
  </div>`;

  const win = new BrowserWindow({ width: 800, height: 330, show: false });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'logo-preview.png'),
    (await win.webContents.capturePage()).toPNG());
  console.log('预览已生成');
  win.destroy();
  app.quit();
});
