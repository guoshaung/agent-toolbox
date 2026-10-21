'use strict';

// Original, code-generated palettes. The same stops drive the CSS preview and PNG render.
const PALETTES = [
  ['aurora', '极光夜航', '#8fb4ff', '#1a2442', 'acrylic', 72, 22, ['#142d4e', '#534082', '#bd78a1']],
  ['forest', '雨后森林', '#8fe3b6', '#17372e', 'glass', 62, 16, ['#153c37', '#347d69', '#afc58b']],
  ['sakura', '樱色晨光', '#f59fb8', '#563644', 'mica', 88, 28, ['#8c7299', '#d4a8b9', '#f7d9ba']],
  ['ocean', '海盐蓝', '#87deef', '#17384a', 'glass', 55, 12, ['#123047', '#2c8098', '#b6ddd8']],
  ['dusk', '落日来信', '#ffbc91', '#4a2d40', 'acrylic', 68, 20, ['#3c305e', '#b56b83', '#efbb89']],
  ['lavender', '薰衣草', '#c9b6ff', '#34304f', 'mica', 80, 26, ['#343c67', '#8b7eb0', '#d7b6d5']],
  ['sand', '沙丘', '#e6c597', '#453a31', 'glass', 70, 15, ['#55483d', '#b2946e', '#f1d9af']],
  ['ember', '余烬', '#ffa485', '#402527', 'acrylic', 75, 24, ['#26283a', '#8e424d', '#da8569']],
  ['arctic', '极地', '#a9dfea', '#2c4452', 'mica', 85, 30, ['#30435a', '#779eae', '#d3e8e5']],
  ['graphite', '石墨', '#b6c5dd', '#272d37', 'solid', 100, 0, ['#151d28', '#47515e', '#87919b']],
  ['meadow', '春日原野', '#c6df8e', '#34442f', 'glass', 65, 18, ['#31554f', '#8ba66b', '#e3d8a1']],
  ['neon', '霓虹漫游', '#d4a5ff', '#30244b', 'acrylic', 65, 24, ['#12253d', '#654199', '#ca6ba0']],
];

const PRESETS = PALETTES.map(([id, name, accent, tint, effect, opacity, blur, colors]) => ({
  id, name, accent, tint, effect, opacity, blur, colors,
  gradient: `linear-gradient(135deg, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})`,
}));

const WALLPAPER_SIZES = [
  { id: 'fhd', name: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'qhd', name: '2560 × 1440', width: 2560, height: 1440 },
  { id: 'uhd', name: '3840 × 2160', width: 3840, height: 2160 },
  { id: 'wide', name: '3440 × 1440', width: 3440, height: 1440 },
];

function makeBackgroundSvg(presetId, sizeId = 'fhd') {
  const preset = PRESETS.find(item => item.id === presetId);
  const size = WALLPAPER_SIZES.find(item => item.id === sizeId);
  if (!preset) throw new Error('渐变配色不存在');
  if (!size) throw new Error('不支持的壁纸尺寸');
  const { width, height } = size;
  // CSS 135deg uses a 45deg vector. Coordinates use CSS's magic-corner gradient length,
  // so wide screens match the preview rather than stretching a diagonal SVG gradient.
  const extent = (width + height) / 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${width / 2 - extent}" y1="${height / 2 - extent}" x2="${width / 2 + extent}" y2="${height / 2 + extent}">${preset.colors.map((color, index) => `<stop offset="${[0, 0.55, 1][index]}" stop-color="${color}"/>`).join('')}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return { svg, width, height, name: `${preset.name} ${width}x${height}.png`, preset: preset.id };
}

async function renderBackground(presetId, sizeId) {
  const background = makeBackgroundSvg(presetId, sizeId);
  const buffer = await require('sharp')(Buffer.from(background.svg)).png().toBuffer();
  return { ...background, buffer };
}

module.exports = { PRESETS, WALLPAPER_SIZES, makeBackgroundSvg, renderBackground };
