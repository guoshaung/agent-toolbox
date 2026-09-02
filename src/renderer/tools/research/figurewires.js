/**
 * 连接线：折线 / 曲线 / 直线，端点吸附到图形。
 *
 * 和普通图形的区别：连接线**没有自己的位置**，它的形状由两端绑定的图形算出来。
 * 所以图形一动，线自动跟着走；这也是"画流程图"和"画一堆方块"的分界线。
 *
 * 数据形状：
 *   { type:'wire', from:{id,port}, to:{id,port}|null, toPoint:{x,y},
 *     route:'elbow'|'curve'|'straight', stroke, strokeWidth, dash, arrowEnd, arrowStart, label }
 * to 为空、toPoint 有值时是"悬空的一端"（拖拽过程中，或故意指向空白处）。
 */

export const ROUTES = {
  elbow: { label: '折线', icon: 'wireElbow' },
  curve: { label: '曲线', icon: 'wireCurve' },
  straight: { label: '直线', icon: 'wireStraight' },
};

export const PORTS = ['top', 'right', 'bottom', 'left'];

const rectOf = (item) => ({
  x: item.x, y: item.y, w: Math.max(1, item.width), h: Math.max(1, item.height),
  cx: item.x + item.width / 2, cy: item.y + item.height / 2,
});

/** 某个锚点在画布上的坐标 */
export function portPoint(item, port) {
  const r = rectOf(item);
  if (port === 'top') return { x: r.cx, y: r.y };
  if (port === 'bottom') return { x: r.cx, y: r.y + r.h };
  if (port === 'left') return { x: r.x, y: r.cy };
  if (port === 'right') return { x: r.x + r.w, y: r.cy };
  return { x: r.cx, y: r.cy };
}

/** 端口的外法线方向，折线和曲线都靠它决定"先往哪边走" */
const normal = (port) => ({
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
}[port] || { x: 0, y: 0 });

/**
 * auto 端口：按两个图形的相对位置挑最合理的一条边。
 * 横向距离更大就走左右，否则走上下 —— 这样线不会绕着图形兜圈。
 */
export function autoPort(item, towardPoint) {
  const r = rectOf(item);
  const dx = towardPoint.x - r.cx;
  const dy = towardPoint.y - r.cy;
  if (Math.abs(dx) / (r.w || 1) > Math.abs(dy) / (r.h || 1)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** 解析一端：返回 { point, port }；找不到图形返回 null */
function resolveEnd(end, freePoint, byId, otherPoint) {
  if (end?.id) {
    const item = byId.get(end.id);
    if (!item) return null;
    let port = !end.port || end.port === 'auto'
      ? autoPort(item, otherPoint || rectOf(item))
      : end.port;

    // 固定端口的回正：图形被拖到目标的另一侧后，原来的端口会朝着反方向，
    // 线就得先往外拐一圈再绕回来。这里保留用户选的"轴"（横或纵），只把边翻到对面。
    if (end.port && end.port !== 'auto' && otherPoint && !end.pinned) {
      const n = normal(port);
      const r = rectOf(item);
      const dir = { x: otherPoint.x - r.cx, y: otherPoint.y - r.cy };
      if (n.x * dir.x + n.y * dir.y < 0) port = OPPOSITE[port] || port;
    }
    return { point: portPoint(item, port), port };
  }
  if (freePoint) return { point: freePoint, port: 'auto' };
  return null;
}

/** 两端都要参考对方的位置来定 auto 端口，所以先用中心点粗定一次再互相修正 */
export function wireEnds(wire, byId) {
  const roughFrom = wire.from?.id ? rectOf(byId.get(wire.from.id) || { x: 0, y: 0, width: 1, height: 1 }) : wire.fromPoint;
  const roughTo = wire.to?.id ? rectOf(byId.get(wire.to.id) || { x: 0, y: 0, width: 1, height: 1 }) : wire.toPoint;
  if (!roughFrom || !roughTo) return null;

  const a = resolveEnd(wire.from, wire.fromPoint, byId, roughTo);
  const b = resolveEnd(wire.to, wire.toPoint, byId, roughFrom);
  if (!a || !b) return null;

  // 用初步算出的对端坐标再修正一次 auto 端口，贴合度更好
  const a2 = resolveEnd(wire.from, wire.fromPoint, byId, b.point) || a;
  const b2 = resolveEnd(wire.to, wire.toPoint, byId, a2.point) || b;
  return { a: a2, b: b2 };
}

/** 生成路径 d */
export function wirePath(wire, byId) {
  const ends = wireEnds(wire, byId);
  if (!ends) return null;
  const { a, b } = ends;
  const route = wire.route || 'elbow';

  if (route === 'straight') {
    return `M${a.point.x},${a.point.y} L${b.point.x},${b.point.y}`;
  }

  if (route === 'curve') {
    // 控制点沿各自端口的法线外推，出入口都垂直于图形边缘，看着才顺
    const dist = Math.max(48, Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y) * 0.45);
    const na = normal(a.port);
    const nb = normal(b.port);
    const c1 = { x: a.point.x + na.x * dist, y: a.point.y + na.y * dist };
    const c2 = { x: b.point.x + nb.x * dist, y: b.point.y + nb.y * dist };
    return `M${a.point.x},${a.point.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.point.x},${b.point.y}`;
  }

  // 折线：先沿法线出去一小段，再走一个直角，最后垂直进入对端
  const stub = 22;
  const na = normal(a.port);
  const nb = normal(b.port);
  const p1 = { x: a.point.x + na.x * stub, y: a.point.y + na.y * stub };
  const p2 = { x: b.point.x + nb.x * stub, y: b.point.y + nb.y * stub };
  const horizontalFirst = na.x !== 0;

  const obstacles = collectObstacles(byId, wire);
  const build = (t) => {
    const mid = horizontalFirst
      ? [{ x: p1.x + (p2.x - p1.x) * t, y: p1.y }, { x: p1.x + (p2.x - p1.x) * t, y: p2.y }]
      : [{ x: p1.x, y: p1.y + (p2.y - p1.y) * t }, { x: p2.x, y: p1.y + (p2.y - p1.y) * t }];
    return [a.point, p1, ...mid, p2, b.point];
  };

  // 候选一：挪拐点位置
  const candidates = [0.5, 0.3, 0.7, 0.15, 0.85, -0.35, 1.35].map(build);

  // 候选二：绕行。障碍正好卡在两点之间的通道里时，只挪拐点是绕不开的，
  // 必须整条线从障碍的上方或下方（横向连接时）兜过去。
  if (obstacles.length) {
    const top = Math.min(...obstacles.map((r) => r.y));
    const bottom = Math.max(...obstacles.map((r) => r.y + r.h));
    const left = Math.min(...obstacles.map((r) => r.x));
    const right = Math.max(...obstacles.map((r) => r.x + r.w));
    const gap = 28;
    if (horizontalFirst) {
      for (const y of [top - gap, bottom + gap]) {
        candidates.push([a.point, p1, { x: p1.x, y }, { x: p2.x, y }, p2, b.point]);
      }
    } else {
      for (const x of [left - gap, right + gap]) {
        candidates.push([a.point, p1, { x, y: p1.y }, { x, y: p2.y }, p2, b.point]);
      }
    }
  }

  // 挑一条"穿过图形最少、其次最短"的
  let best = null;
  for (const pts of candidates) {
    const score = { hits: countHits(pts, obstacles), len: pathLength(pts), pts };
    if (!best || score.hits < best.hits || (score.hits === best.hits && score.len < best.len)) best = score;
    if (best.hits === 0 && best.pts === candidates[0]) break;   // 默认那条就不撞，直接用
  }

  return best.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
}

/** 会挡路的图形：排除连线、文字，以及这条线自己的两端 */
function collectObstacles(byId, wire) {
  const skip = new Set([wire.from?.id, wire.to?.id].filter(Boolean));
  const out = [];
  for (const item of byId.values()) {
    if (item.type === 'wire' || item.type === 'text' || skip.has(item.id)) continue;
    if (!(item.width > 0 && item.height > 0)) continue;
    out.push({ x: item.x, y: item.y, w: item.width, h: item.height });
  }
  return out;
}

/**
 * 轴对齐线段和矩形是否相交。折线的每一段都是水平或垂直的，
 * 所以包围盒重叠就等于真的相交，不需要更复杂的判定。
 */
function segHitsRect(p1, p2, r, pad = 6) {
  const minX = Math.min(p1.x, p2.x) - pad;
  const maxX = Math.max(p1.x, p2.x) + pad;
  const minY = Math.min(p1.y, p2.y) - pad;
  const maxY = Math.max(p1.y, p2.y) + pad;
  return !(maxX < r.x || minX > r.x + r.w || maxY < r.y || minY > r.y + r.h);
}

function countHits(pts, obstacles) {
  let hits = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const rect of obstacles) if (segHitsRect(pts[i], pts[i + 1], rect)) hits += 1;
  }
  return hits;
}

function pathLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  }
  return len;
}

/** 线中点，用来放标签 */
export function wireMidpoint(wire, byId) {
  const ends = wireEnds(wire, byId);
  if (!ends) return null;
  return { x: (ends.a.point.x + ends.b.point.x) / 2, y: (ends.a.point.y + ends.b.point.y) / 2 };
}

/** 一条线的 SVG。hit 为 true 时额外输出一条透明粗线，用来点选 */
export function wireMarkup(wire, byId, { markerId, selected = false } = {}) {
  const d = wirePath(wire, byId);
  if (!d) return '';
  const sw = Math.max(1, Number(wire.strokeWidth) || 2);
  const stroke = wire.stroke || '#3d6fe8';
  const dash = wire.dash === 'dashed' ? `${sw * 3.5} ${sw * 2.5}`
    : wire.dash === 'dotted' ? `${sw * 0.1} ${sw * 2.2}` : '';
  const markerEnd = wire.arrowEnd === false ? '' : ` marker-end="url(#${markerId})"`;
  const markerStart = wire.arrowStart ? ` marker-start="url(#${markerId}Start)"` : '';

  return `<path class="fb-wire-hit" d="${d}" fill="none" stroke="transparent" stroke-width="${sw + 14}" data-wire="${wire.id}"/>`
    + (selected ? `<path d="${d}" fill="none" stroke="#5b8cff" stroke-width="${sw + 6}" stroke-opacity=".28" stroke-linecap="round" stroke-linejoin="round"/>` : '')
    + `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`
    + `${dash ? ` stroke-dasharray="${dash}"` : ''}${markerStart}${markerEnd} data-wire="${wire.id}"/>`;
}

/** 标签（画在线中点，带一块底色免得压在线上看不清） */
export function wireLabelMarkup(wire, byId) {
  if (!wire.label) return '';
  const mid = wireMidpoint(wire, byId);
  if (!mid) return '';
  const size = Number(wire.fontSize) || 13;
  const width = String(wire.label).length * size * 0.62 + 10;
  const escaped = String(wire.label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<rect x="${mid.x - width / 2}" y="${mid.y - size * 0.85}" width="${width}" height="${size * 1.7}" rx="4" fill="#ffffff" fill-opacity=".92"/>`
    + `<text x="${mid.x}" y="${mid.y + size * 0.36}" text-anchor="middle" font-size="${size}" `
    + `font-family="'PingFang SC','Microsoft YaHei',Arial,sans-serif" fill="${wire.color || '#14213d'}">${escaped}</text>`;
}

export const isWire = (item) => item?.type === 'wire';
