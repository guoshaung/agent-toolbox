import { parseJSON, checkAbort } from './json.mjs';
export { checkAbort };
export const LIMITS = Object.freeze({ items: 30, dimensionMm: 100000, coordinateMm: 200000, importBytes: 256 * 1024, outputBytes: 512 * 1024 });
export const ASSUMPTIONS = Object.freeze({ units: '统一厘米输入，最多一位小数；0.1cm=1mm，内部整数毫米精确计算，不隐式换算其他单位', origin: '房间左上角为(0,0)，x向右，y向下；物件坐标是其当前占地矩形的左上角', rotation: '仅0°或90°，90°交换原始宽/高，左上角坐标保持；不是绕中心转动，不自动调整位置', checks: '贴边/角接触不算重叠；正面积交集才报告重叠；房间边界允许等号，任一部分超界均报告', view: '房间与所有物件的完整边界共同决定等比例视野，负坐标/出界不会夹紧隐藏；拖动时视野固定，释放后重新包含全部轮廓', drag: 'Pointer屏幕坐标经SVG逆变换转换为毫米；拖动吸附到最近1mm，超坐标硬限额拒绝更新，不夹到房间内；取消拖动恢复拖动前坐标', keyboard: '选中物件/图形后方向键1cm，Shift+方向键10cm，Alt+方向键0.1cm；R旋转，Esc取消拖动，也可直接编辑x/y', scope: '仅二维静态矩形占地检查，不判断门口搬入、三维高度、通道安全、支撑承重、真实家具形状或最优摆放', recovery: '版本1草稿/完整JSON仅读取配置并重算，忽略旧位置检查结果；切换具体功能会丢失未保存内容' });
export const EXAMPLE = Object.freeze({ unit: 'cm', room: { width: '80.0', height: '60.0' }, items: [{ id: 'I1', name: '100×50矩形', width: '100.0', height: '50.0', x: '0.0', y: '0.0', allowRotate: true, rotation: 0 }] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label}结构不合法或包含未知字段。`); }
export function parseCm(value, coordinate = false) {
  if (typeof value !== 'string' || value.length > 20 || !(coordinate ? /^-?\d+(?:\.\d)?$/u : /^\d+(?:\.\d)?$/u).test(value)) throw new Error('厘米须为十进制文本、最多一位小数；仅坐标允许负值，不接受指数/空白/逗号。');
  const negative = value.startsWith('-'), [whole, fraction = '0'] = (negative ? value.slice(1) : value).split('.'); let mm = BigInt(whole) * 10n + BigInt(fraction); if (negative) mm = -mm;
  const limit = coordinate ? LIMITS.coordinateMm : LIMITS.dimensionMm;
  if (mm < BigInt(coordinate ? -limit : 1) || mm > BigInt(limit)) throw new Error(coordinate ? '坐标须为−20000.0至20000.0cm。' : '宽高须为0.1至10000.0cm。'); return Number(mm);
}
export function formatCm(mm) { if (!Number.isSafeInteger(mm)) throw new Error('毫米须为安全整数。'); const value = BigInt(mm), absolute = value < 0n ? -value : value; return `${value < 0n ? '-' : ''}${absolute / 10n}.${absolute % 10n}`; }
export function validateConfig(input) {
  exactKeys(input, ['unit', 'room', 'items'], '布局'); if (input.unit !== 'cm') throw new Error('仅接受统一cm单位。'); exactKeys(input.room, ['width', 'height'], '房间');
  const room = { widthMm: parseCm(input.room.width), heightMm: parseCm(input.room.height) };
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > LIMITS.items) throw new Error('请配置1–30个物件。');
  const ids = new Set(), items = input.items.map((item, index) => {
    exactKeys(item, ['id', 'name', 'width', 'height', 'x', 'y', 'allowRotate', 'rotation'], `物件${index + 1}`);
    if (typeof item.id !== 'string' || !/^I(?:[1-9]|[12]\d|30)$/u.test(item.id) || ids.has(item.id)) throw new Error('物件ID须为唯一I1–I30。'); ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name !== item.name.trim() || item.name.length > 80 || /[\u0000-\u001f\u007f]/u.test(item.name) || [...item.name].some(char => { const code = char.codePointAt(0); return (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff; })) throw new Error('物件名须为1–80单位，无首尾空白或非法XML字符。');
    if (typeof item.allowRotate !== 'boolean' || ![0, 90].includes(item.rotation) || (!item.allowRotate && item.rotation !== 0)) throw new Error('旋转仅0°/90°，90°必须启用允许旋转。');
    const originalWidthMm = parseCm(item.width), originalHeightMm = parseCm(item.height), xMm = parseCm(item.x, true), yMm = parseCm(item.y, true);
    return { id: item.id, name: item.name, xMm, yMm, originalWidthMm, originalHeightMm, widthMm: item.rotation === 90 ? originalHeightMm : originalWidthMm, heightMm: item.rotation === 90 ? originalWidthMm : originalHeightMm, rotation: item.rotation, allowRotate: item.allowRotate };
  });
  const config = { unit: 'cm', room: { width: formatCm(room.widthMm), height: formatCm(room.heightMm) }, items: items.map(item => ({ id: item.id, name: item.name, width: formatCm(item.originalWidthMm), height: formatCm(item.originalHeightMm), x: formatCm(item.xMm), y: formatCm(item.yMm), allowRotate: item.allowRotate, rotation: item.rotation })) };
  return { config, room, items };
}
export function intersection(left, right) {
  const xMm = Math.max(left.xMm, right.xMm), yMm = Math.max(left.yMm, right.yMm), widthMm = Math.min(left.xMm + left.widthMm, right.xMm + right.widthMm) - xMm, heightMm = Math.min(left.yMm + left.heightMm, right.yMm + right.heightMm) - yMm;
  return widthMm > 0 && heightMm > 0 ? { xMm, yMm, widthMm, heightMm, areaMm2: widthMm * heightMm } : null;
}
export function makeLayout(input) {
  const { config, room, items } = validateConfig(input), overlaps = [];
  const rects = items.map(item => {
    const overflow = { leftMm: Math.max(0, -item.xMm), topMm: Math.max(0, -item.yMm), rightMm: Math.max(0, item.xMm + item.widthMm - room.widthMm), bottomMm: Math.max(0, item.yMm + item.heightMm - room.heightMm) };
    return { ...item, overflow, outOfBounds: Object.values(overflow).some(value => value > 0), overlaps: [] };
  });
  for (let left = 0; left < rects.length; left++) for (let right = left + 1; right < rects.length; right++) {
    const area = intersection(rects[left], rects[right]); if (area) { overlaps.push({ leftId: rects[left].id, rightId: rects[right].id, intersection: area }); rects[left].overlaps.push(rects[right].id); rects[right].overlaps.push(rects[left].id); }
  }
  const minX = Math.min(0, ...rects.map(item => item.xMm)), minY = Math.min(0, ...rects.map(item => item.yMm)), maxX = Math.max(room.widthMm, ...rects.map(item => item.xMm + item.widthMm)), maxY = Math.max(room.heightMm, ...rects.map(item => item.yMm + item.heightMm));
  const margin = Math.max(20, Math.ceil(Math.max(maxX - minX, maxY - minY) * 0.04)), outOfBounds = rects.filter(item => item.outOfBounds).map(item => item.id);
  return { feature: 'T089', version: 1, kind: 'layout', draft: { feature: 'T089', version: 1, kind: 'draft', config }, assumptions: { ...ASSUMPTIONS }, room, rects, overlaps, outOfBounds, isValidPlacement: !outOfBounds.length && !overlaps.length, view: { minX: minX - margin, minY: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 } };
}
export async function importLayout(text, hooks = {}) {
  const envelope = (await parseJSON({ name: 'layout-import.json', text }, hooks)).root;
  if (!object(envelope) || envelope.feature !== 'T089' || envelope.version !== 1 || !['draft', 'layout'].includes(envelope.kind)) throw new Error('仅接受T089版本1草稿/完整JSON布局。');
  const draft = envelope.kind === 'layout' ? envelope.draft : envelope;
  exactKeys(draft, ['feature', 'version', 'kind', 'config'], '草稿'); if (draft.feature !== 'T089' || draft.version !== 1 || draft.kind !== 'draft') throw new Error('草稿版本或类型不合法。');
  checkAbort(hooks.signal); return makeLayout(draft.config);
}
export const escapeXML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function layoutSVG(report) {
  const view = report.view, fontSize = Math.max(5, Math.ceil(view.width / 65));
  const rect = (x, y, width, height, fill, stroke, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke" ${extra}/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.minX} ${view.minY} ${view.width} ${view.height}" width="1200" height="800" preserveAspectRatio="xMidYMid meet" role="img"><title>二维矩形摆放（厘米输入，绘图坐标单位毫米）</title><desc>${escapeXML(ASSUMPTIONS.scope)}。原点左上，x向右，y向下。</desc><metadata>${escapeXML(JSON.stringify(report))}</metadata>${rect(0, 0, report.room.widthMm, report.room.heightMm, '#edf2f7', '#475569')}<g font-family="sans-serif" font-size="${fontSize}"><text x="0" y="${-fontSize / 2}" fill="#111827">房间 ${formatCm(report.room.widthMm)}×${formatCm(report.room.heightMm)}cm；原点(0,0)</text>${report.rects.map(item => `<g><title>${escapeXML(item.id + ' ' + item.name)}</title>${rect(item.xMm, item.yMm, item.widthMm, item.heightMm, item.outOfBounds || item.overlaps.length ? '#fb923c' : '#93c5fd', '#1e3a8a', 'fill-opacity="0.55"')}<text x="${item.xMm + fontSize / 3}" y="${item.yMm + fontSize}" fill="#111827">${escapeXML(item.id + ' ' + item.name)}</text></g>`).join('')}</g></svg>\n`;
}
export async function serializeLayout(report, format, hooks = {}) {
  if (!['json', 'svg', 'md'].includes(format)) throw new Error('只支持JSON/SVG/Markdown。'); checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal);
  let result;
  if (format === 'json') result = JSON.stringify(report, null, 2) + '\n';
  else if (format === 'svg') result = layoutSVG(report);
  else {
    const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('*', '\\*').replaceAll('_', '\\_').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('[', '\\[').replaceAll(']', '\\]');
    result = `# 尺寸摆放试算\n\n房间 ${formatCm(report.room.widthMm)}×${formatCm(report.room.heightMm)}cm；出界${report.outOfBounds.length}物件，重叠${report.overlaps.length}对。二维检查通过=${report.isValidPlacement}。\n\n` + Object.entries(report.assumptions).map(([key, value]) => `- ${key}: ${value}\n`).join('');
    result += '\n| ID/名称 | x,y(cm) | 原始宽×高(cm) | 当前占地宽×高(cm) | 旋转 | 出界左/上/右/下(cm) | 重叠对象 |\n| --- | --- | --- | --- | --- | --- | --- |\n';
    result += report.rects.map(item => `| ${escape(item.id + ' ' + item.name)} | ${formatCm(item.xMm)},${formatCm(item.yMm)} | ${formatCm(item.originalWidthMm)}×${formatCm(item.originalHeightMm)} | ${formatCm(item.widthMm)}×${formatCm(item.heightMm)} | ${item.rotation}° | ${['leftMm', 'topMm', 'rightMm', 'bottomMm'].map(key => formatCm(item.overflow[key])).join('/')} | ${item.overlaps.join(',') || '无'} |\n`).join('');
    result += '\n## 交集（整数毫米、平方毫米）\n\n' + (report.overlaps.length ? report.overlaps.map(pair => `- ${pair.leftId}/${pair.rightId}: ${JSON.stringify(pair.intersection)}\n`).join('') : '无正面积交集。\n');
    result += '\n## 版本1恢复草稿\n\n```json\n' + JSON.stringify(report.draft, null, 2) + '\n```\n';
  }
  if (new TextEncoder().encode(result).length > LIMITS.outputBytes) throw new Error('导出超过512 KiB。'); checkAbort(hooks.signal); return result;
}
