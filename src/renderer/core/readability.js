// Derive readable secondary text from the selected palette without changing saved preferences.
function rgb(hex) { const value = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)); }
function luminance(hex) { return rgb(hex).map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function readableText(color, surfaces, target = 5) {
  if (!/^#[\da-f]{6}$/i.test(color) || surfaces.some(v => !/^#[\da-f]{6}$/i.test(v))) return color;
  const ink = surfaces.reduce((sum, v) => sum + luminance(v), 0) / surfaces.length > .4 ? '#000000' : '#ffffff';
  const start = rgb(color), end = rgb(ink);
  for (let i = 0; i <= 100; i++) {
    const value = '#' + start.map((v, n) => Math.round(v + (end[n] - v) * i / 100).toString(16).padStart(2, '0')).join('');
    if (surfaces.every(bg => contrast(value, bg) >= target)) return value;
  }
  return ink;
}
