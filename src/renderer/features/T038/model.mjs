export const SOURCE = 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html';
export function parseColor(value) {
  if (typeof value !== 'string') throw new Error('颜色必须是 #RGB 或 #RRGGBB');
  const match = value.trim().match(/^#([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!match) throw new Error('只支持不透明 sRGB 的 #RGB / #RRGGBB，不支持透明色或颜色名称');
  const hex = match[1].length === 3 ? [...match[1]].map((char) => char + char).join('') : match[1];
  return { hex: `#${hex.toUpperCase()}`, rgb: [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) };
}
export function luminance(value) {
  const channels = parseColor(value).rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(foreground, background) {
  const a = luminance(foreground); const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function evaluateAA(ratio, fontPt, bold = false) {
  if (!Number.isFinite(fontPt) || fontPt <= 0 || fontPt > 1000 || typeof bold !== 'boolean') throw new Error('字号需要为 0–1000 范围内的正数 pt，粗体需要为布尔值');
  if (!Number.isFinite(ratio) || ratio < 1 || ratio > 21) throw new Error('对比度需要在 1–21 范围内');
  const large = fontPt >= 18 || (bold && fontPt >= 14);
  const threshold = large ? 3 : 4.5;
  return { large, threshold, pass: ratio >= threshold };
}
function hex(rgb) { return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`; }
export function adjustmentCandidates(foreground, background, threshold) {
  const original = parseColor(foreground).rgb;
  if (contrastRatio(foreground, background) >= threshold) return [];
  const candidates = [];
  for (const target of [0, 255]) {
    for (let step = 1; step <= 256; step++) {
      const rgb = original.map((channel) => Math.round(channel + (target - channel) * step / 256));
      const color = hex(rgb); const ratio = contrastRatio(color, background);
      if (ratio >= threshold) {
        candidates.push({ foreground: color, background: parseColor(background).hex, ratio,
          direction: target === 0 ? '向黑色调整' : '向白色调整', distance: Math.hypot(...rgb.map((channel, index) => channel - original[index])) });
        break;
      }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}
export function checkPair({ label = '', foreground, background, fontPt = 12, bold = false }) {
  const fg = parseColor(foreground).hex; const bg = parseColor(background).hex;
  const ratio = contrastRatio(fg, bg); const result = evaluateAA(ratio, fontPt, bold);
  return { label: String(label).slice(0, 120), foreground: fg, background: bg, fontPt, bold, ratio, ...result,
    candidates: adjustmentCandidates(fg, bg, result.threshold) };
}
export function createReport(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > 40) throw new Error('一次检查 1–40 个配色');
  return { schemaVersion: 1, featureId: 'T038', standard: 'WCAG 2.2 SC 1.4.3 AA text contrast', source: SOURCE,
    scope: '不透明 sRGB 文字配色的阈值检查；不代表完整无障碍合规。pt 指最终呈现字号；不处理透明、渐变、图片背景、抗锯齿及特殊字体。',
    results: pairs.map((pair, index) => { try { return { index: index + 1, ok: true, ...checkPair(pair) }; }
      catch (error) { return { index: index + 1, label: String(pair?.label || '').slice(0, 120), ok: false, error: error.message }; } }) };
}
