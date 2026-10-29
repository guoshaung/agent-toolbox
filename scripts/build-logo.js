'use strict';
/**
 * Logo 的唯一源头。跑一次生成两个产物：
 *   assets/logo.svg            —— 完整图标（深石墨底 + 冷白印记），App 图标由它渲染
 *   src/renderer/core/logo.js  —— 只有印记本身（透明底），给侧栏用
 *   npm run logo / npm run icon
 *
 * 造型：抽象几何「等距立方体」工坊印记（container = 工具箱）。纯单色冷白，
 * 无四角星、无芯片引脚、无霓虹发光——能融入深石墨背景（Linear / Raycast 取向）。
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const INK = '#E6EDF3';   // 冷白
const BG = '#141720';    // 深石墨（与科研页背景一致，App 图标用）

// 兼容老的 import（logo-preview 等）保留导出；造型已不分色。
const PALETTES = { mono: { light: INK, core: INK, deep: INK } };

/** 等距立方体：正六边形轮廓 + 中心 Y 三辐条（三个可见面），两面微填充做光影。纯冷白线稿。 */
function build({ prefix = '', withBackground = true } = {}) {
  void prefix; // 新造型无 gradient/mask id，无需前缀；保留参数兼容旧调用。
  const T = '512 168', UR = '810 340', LR = '810 684', B = '512 856', LL = '214 684', UL = '214 340', C = '512 512';
  const hex = `M${T} L${UR} L${LR} L${B} L${LL} L${UL} Z`;
  const spokes = `M${C} L${T} M${C} L${LR} M${C} L${LL}`;
  const faceRight = `M${C} L${T} L${UR} L${LR} Z`;  // 受光面
  const faceLeft = `M${C} L${T} L${UL} L${LL} Z`;
  const glyph = `
    <path d="${faceRight}" fill="${INK}" fill-opacity="0.16"/>
    <path d="${faceLeft}" fill="${INK}" fill-opacity="0.07"/>
    <path d="${hex}" fill="none" stroke="${INK}" stroke-width="46" stroke-linejoin="round"/>
    <path d="${spokes}" fill="none" stroke="${INK}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 1024 1024"${withBackground ? ' xmlns="http://www.w3.org/2000/svg"' : ' aria-hidden="true"'}>
${withBackground ? `  <rect width="1024" height="1024" rx="224" fill="${BG}"/>\n` : ''}  <g>${glyph}
  </g>
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
 * 无底色版本（只有冷白几何印记）：侧栏本身深色，不再套深色圆角底。
 */
export const LOGO_MARK_SVG = \`${mark}\`;
`);

console.log('已生成 assets/logo.svg 和 src/renderer/core/logo.js');
