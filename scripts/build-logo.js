'use strict';
/**
 * Logo 的唯一源头。跑一次生成两个产物，避免图标和界面里的标记走样：
 *   assets/logo.svg            —— 完整图标（深底 + 霓虹芯片），App 图标由它渲染
 *   src/renderer/core/logo.js  —— 只有标记本身（透明底），给侧栏用
 *
 *   npm run logo   生成 svg
 *   npm run icon   由 svg 渲染 png / icns
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const PALETTES = {
  // 去掉发白的高光，整体压向饱和的代码绿
  neon: { light: '#3BFFB4', core: '#00FF9C', deep: '#00A867' },
  mint: { light: '#5CFFC4', core: '#00FF9C', deep: '#00CE86' },
};
const NEON = PALETTES.neon;
const BG = { top: '#0B2A1D', mid: '#05160E', bottom: '#010805' };

/** 四角星：AI 的通用符号。腰收得越紧越锐利 */
function spark(cx, cy, r, waist = 0.09) {
  const k = r * waist;
  return `M${cx} ${cy - r} Q${cx + k} ${cy - k}, ${cx + r} ${cy} `
       + `Q${cx + k} ${cy + k}, ${cx} ${cy + r} `
       + `Q${cx - k} ${cy + k}, ${cx - r} ${cy} `
       + `Q${cx - k} ${cy - k}, ${cx} ${cy - r} Z`;
}

/** 芯片引脚。每边 2 根 —— 3 根在 32px 下会糊成一圈毛边 */
function pins(bodyInset, { stick = 80, overlap = 34, thick = 54, spread = 132 } = {}) {
  const near = bodyInset;
  const far = 1024 - bodyInset;
  const len = stick + overlap;              // 露在外面的 + 埋进芯片体的
  const r = thick / 2;
  const out = [];
  for (const t of [512 - spread, 512 + spread]) {
    out.push(`<rect x="${near - stick}" y="${t - r}" width="${len}" height="${thick}" rx="${r}"/>`);
    out.push(`<rect x="${far - overlap}" y="${t - r}" width="${len}" height="${thick}" rx="${r}"/>`);
    out.push(`<rect x="${t - r}" y="${near - stick}" width="${thick}" height="${len}" rx="${r}"/>`);
    out.push(`<rect x="${t - r}" y="${far - overlap}" width="${thick}" height="${len}" rx="${r}"/>`);
  }
  return out.join('\n      ');
}

/** @param p.prefix 给 id 加前缀，防止内联进页面时和别的 SVG 撞 id */
function build({ prefix = '', withBackground = true, palette = NEON,
                 outlined = true, bodyInset = 262, sparkR = 190, glow = 0.6,
                 stroke = 84 } = {}) {
  const id = (name) => `${prefix}${name}`;
  const bodySize = 1024 - bodyInset * 2;
  const body = outlined
    ? `<rect x="${bodyInset}" y="${bodyInset}" width="${bodySize}" height="${bodySize}" rx="92"
        fill="none" stroke="url(#${id('neon')})" stroke-width="${stroke}"/>
      <path d="${spark(512, 512, sparkR * 0.62)}" fill="url(#${id('neon')})"/>`
    : `<g mask="url(#${id('cut')})"><rect width="1024" height="1024" fill="url(#${id('neon')})"/></g>`;
  const glyph = `<g fill="url(#${id('neon')})">
      ${pins(bodyInset)}
    </g>
    ${body}`;

  return `<svg viewBox="0 0 1024 1024"${withBackground ? ' xmlns="http://www.w3.org/2000/svg"' : ' aria-hidden="true"'}>
  <defs>
${withBackground ? `    <linearGradient id="${id('bg')}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG.top}"/>
      <stop offset="0.55" stop-color="${BG.mid}"/>
      <stop offset="1" stop-color="${BG.bottom}"/>
    </linearGradient>
` : ''}    <linearGradient id="${id('neon')}" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${palette.light}"/>
      <stop offset="0.45" stop-color="${palette.core}"/>
      <stop offset="1" stop-color="${palette.deep}"/>
    </linearGradient>
    <filter id="${id('glow')}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <mask id="${id('cut')}">
      <rect width="1024" height="1024" fill="black"/>
      <rect x="${bodyInset}" y="${bodyInset}" width="${bodySize}" height="${bodySize}" rx="88" fill="white"/>
      <path d="${spark(512, 512, sparkR)}" fill="black"/>
    </mask>
  </defs>
${withBackground ? `  <rect width="1024" height="1024" rx="224" fill="url(#${id('bg')})"/>\n` : ''}  <g filter="url(#${id('glow')})" opacity="${glow}">${glyph}</g>
  ${glyph}
</svg>`;
}

module.exports = { build, PALETTES };

if (require.main !== module) return;

fs.writeFileSync(path.join(ROOT, 'assets', 'logo.svg'), `${build({ withBackground: true })}\n`);

const mark = build({ prefix: 'tbx', withBackground: false });
fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'core', 'logo.js'),
`/**
 * 侧栏上的标记。**这个文件由 scripts/build-logo.js 生成，别手改。**
 * 改造型请改那个脚本，然后跑：npm run logo && npm run icon
 *
 * 这里是无底色版本（只有霓虹芯片），因为侧栏本身就是深色，
 * 再套一层深色圆角底会糊成一团。
 */
export const LOGO_MARK_SVG = \`${mark}\`;
`);

console.log('已生成 assets/logo.svg 和 src/renderer/core/logo.js');
