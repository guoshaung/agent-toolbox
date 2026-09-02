/**
 * 图形定义。**画布渲染和 SVG 导出共用这一份**——
 * 原来画布用 CSS class、导出用另一套 SVG 代码，两边形状对不上，
 * 而且想加新图形要改两处还容易画歪。现在只写一次几何。
 */

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** 正多边形顶点，用来生成三角形/六边形/星形 */
function polygonPoints(cx, cy, rx, ry, sides, rotation = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push(`${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function starPoints(cx, cy, rx, ry, points = 5, inner = 0.42) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const ratio = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${(cx + rx * ratio * Math.cos(a)).toFixed(2)},${(cy + ry * ratio * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** 扇形路径，用于饼图的每一瓣 */
function sectorPath(cx, cy, rx, ry, startDeg, endDeg) {
  const toXY = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${cx.toFixed(2)},${cy.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} `
    + `A${rx.toFixed(2)},${ry.toFixed(2)} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

/** 饼图默认配色：柔和但可区分，学术图里不刺眼 */
export const PIE_COLORS = ['#cfe0ff', '#ffe0b8', '#d6f0d2', '#f8d3e0', '#e2d7f6', '#c9ecef', '#ffeeba', '#f3d5c0'];

export const SHAPES = {
  rect: { label: '矩形', icon: 'shapeRect', group: 'basic' },
  roundRect: { label: '圆角矩形', icon: 'shapeRound', group: 'basic' },
  capsule: { label: '胶囊', icon: 'shapeCapsule', group: 'basic' },
  ellipse: { label: '椭圆', icon: 'shapeEllipse', group: 'basic' },
  diamond: { label: '菱形', icon: 'shapeDiamond', group: 'basic' },
  triangle: { label: '三角形', icon: 'shapeTriangle', group: 'basic' },
  hexagon: { label: '六边形', icon: 'shapeHexagon', group: 'basic' },
  parallelogram: { label: '平行四边形', icon: 'shapeParallel', group: 'basic' },
  cylinder: { label: '圆柱 / 数据库', icon: 'shapeCylinder', group: 'basic' },
  star: { label: '星形', icon: 'shapeStar', group: 'basic' },
  pie: { label: '饼图', icon: 'shapePie', group: 'chart' },
  container: { label: '虚线框（分组）', icon: 'shapeContainer', group: 'chart' },
  bracket: { label: '大括号', icon: 'shapeBracket', group: 'chart' },
};

export const LINES = {
  line: { label: '直线', icon: 'linePlain' },
  arrow: { label: '箭头', icon: 'lineArrow' },
  'double-arrow': { label: '双向箭头', icon: 'lineDouble' },
  dashed: { label: '虚线', icon: 'lineDashed' },
};

export const isLine = (type) => Object.prototype.hasOwnProperty.call(LINES, type);
export const isShape = (type) => Object.prototype.hasOwnProperty.call(SHAPES, type);

/** 描边样式 → stroke-dasharray */
export function dashArray(style, strokeWidth = 2) {
  const w = Math.max(1, num(strokeWidth, 2));
  if (style === 'dashed') return `${w * 3.5} ${w * 2.5}`;
  if (style === 'dotted') return `${w * 0.1} ${w * 2.2}`;
  return '';
}

/**
 * 生成一个图形的 SVG 内容（不含外层 <svg>）。
 * 坐标以 0,0 为左上、item.width × item.height 为界。
 */
export function shapeMarkup(item) {
  const w = Math.max(1, num(item.width, 1));
  const h = Math.max(1, num(item.height, 1));
  const sw = num(item.strokeWidth, 0);
  const inset = sw / 2;                    // 描边居中，缩进半个线宽才不会被裁掉
  const iw = Math.max(1, w - sw);
  const ih = Math.max(1, h - sw);
  const fill = item.fill && item.fill !== 'transparent' ? item.fill : 'none';
  const stroke = item.stroke && item.stroke !== 'transparent' ? item.stroke : 'none';
  const dash = dashArray(item.dash, sw);
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`
    + (dash ? ` stroke-dasharray="${dash}"` : '') + ' stroke-linejoin="round"';

  const radius = Math.min(num(item.radius, 0), Math.min(iw, ih) / 2);

  switch (item.type) {
    case 'roundRect':
      return `<rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="${radius || Math.min(iw, ih) * 0.18}" ${common}/>`;
    case 'capsule':
      return `<rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="${ih / 2}" ${common}/>`;
    case 'container':
      return `<rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="${radius || 14}" fill="${fill}" stroke="${stroke}" stroke-width="${sw || 2}" stroke-dasharray="${dash || `${(sw || 2) * 4} ${(sw || 2) * 3}`}"/>`;
    case 'ellipse':
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${iw / 2}" ry="${ih / 2}" ${common}/>`;
    case 'diamond':
      return `<polygon points="${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}" ${common}/>`;
    case 'triangle':
      return `<polygon points="${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}" ${common}/>`;
    case 'hexagon':
      return `<polygon points="${polygonPoints(w / 2, h / 2, iw / 2, ih / 2, 6, 0)}" ${common}/>`;
    case 'parallelogram': {
      const skew = Math.min(iw * 0.22, 46);
      return `<polygon points="${skew + inset},${inset} ${w - inset},${inset} ${w - skew - inset},${h - inset} ${inset},${h - inset}" ${common}/>`;
    }
    case 'star':
      return `<polygon points="${starPoints(w / 2, h / 2, iw / 2, ih / 2)}" ${common}/>`;
    case 'cylinder': {
      const ry = Math.min(ih * 0.16, 26);
      return `<path d="M${inset},${inset + ry} A${iw / 2},${ry} 0 0 1 ${w - inset},${inset + ry} `
        + `L${w - inset},${h - inset - ry} A${iw / 2},${ry} 0 0 1 ${inset},${h - inset - ry} Z" ${common}/>`
        + `<path d="M${inset},${inset + ry} A${iw / 2},${ry} 0 0 0 ${w - inset},${inset + ry}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    case 'bracket': {
      const lip = Math.min(iw * 0.4, 26);
      return `<path d="M${w - inset},${inset} q-${lip},0 -${lip},${ih / 4} `
        + `q0,${ih / 4} -${Math.max(4, lip / 2)},${ih / 4} q${Math.max(4, lip / 2)},0 ${Math.max(4, lip / 2)},${ih / 4} `
        + `q0,${ih / 4} ${lip},${ih / 4}" fill="none" stroke="${stroke === 'none' ? '#14213d' : stroke}" stroke-width="${sw || 3}" stroke-linecap="round"/>`;
    }
    case 'pie': {
      const slices = Math.max(2, Math.min(12, num(item.slices, 6)));
      const step = 360 / slices;
      const colors = Array.isArray(item.sliceColors) && item.sliceColors.length ? item.sliceColors : PIE_COLORS;
      let out = '';
      for (let i = 0; i < slices; i++) {
        out += `<path d="${sectorPath(w / 2, h / 2, iw / 2, ih / 2, i * step, (i + 1) * step)}" `
          + `fill="${colors[i % colors.length]}" stroke="${stroke === 'none' ? '#ffffff' : stroke}" stroke-width="${sw || 2}"/>`;
      }
      return out;
    }
    default:                                  // rect 以及历史遗留类型
      return `<rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="${radius}" ${common}/>`;
  }
}

/** 线条类：横向一条线，箭头由 marker 提供 */
export function lineMarkup(item, markerId = 'fbArrow') {
  const w = Math.max(1, num(item.width, 1));
  const sw = Math.max(1, num(item.strokeWidth, 3));
  const y = Math.max(sw / 2, num(item.height, sw) / 2);
  const stroke = item.stroke && item.stroke !== 'transparent' ? item.stroke : '#3d6fe8';
  const dash = item.type === 'dashed' ? dashArray('dashed', sw) : dashArray(item.dash, sw);
  const markerStart = item.type === 'double-arrow' ? ` marker-start="url(#${markerId}Start)"` : '';
  const markerEnd = item.type === 'arrow' || item.type === 'double-arrow' ? ` marker-end="url(#${markerId})"` : '';
  return `<line x1="${sw / 2}" y1="${y}" x2="${w - sw / 2}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" `
    + `stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${markerStart}${markerEnd}/>`;
}

/** 箭头 marker 定义，画布和导出都要用；颜色跟着线条走 */
export function arrowDefs(color = '#3d6fe8', id = 'fbArrow') {
  // markerUnits="strokeWidth" 时箭头长度 = markerWidth × 线宽。
  // 原来给 9，线宽 4 就是 36 单位长的头，画在短箭头上会糊成一坨三角形。
  // 收到 4，头长约等于 4 倍线宽，长短箭头都还协调。
  const head = '<path d="M0,0 L0,5 L4.5,2.5 z"';
  return `<marker id="${id}" markerWidth="4.5" markerHeight="5" refX="4.2" refY="2.5" orient="auto" markerUnits="strokeWidth">`
    + `${head} fill="${color}"/></marker>`
    + `<marker id="${id}Start" markerWidth="4.5" markerHeight="5" refX="0.3" refY="2.5" orient="auto-start-reverse" markerUnits="strokeWidth">`
    + `${head} fill="${color}"/></marker>`;
}

/** 画布背景：纯色 / 网格 / 点阵 / 透明 */
export const BACKGROUNDS = {
  white: { label: '白色', color: '#ffffff', pattern: null },
  paper: { label: '米色（论文插图常用）', color: '#f6efe0', pattern: null },
  slate: { label: '浅灰', color: '#f2f4f8', pattern: null },
  grid: { label: '网格', color: '#ffffff', pattern: 'grid' },
  dots: { label: '点阵', color: '#ffffff', pattern: 'dots' },
  transparent: { label: '透明（导出无底色）', color: null, pattern: null },
};

export function backgroundDefs(kind, gridColor = '#dfe4ee') {
  if (kind === 'grid') {
    return `<pattern id="fbBg" width="24" height="24" patternUnits="userSpaceOnUse">`
      + `<path d="M24 0H0V24" fill="none" stroke="${gridColor}" stroke-width="1"/></pattern>`;
  }
  if (kind === 'dots') {
    return `<pattern id="fbBg" width="22" height="22" patternUnits="userSpaceOnUse">`
      + `<circle cx="2" cy="2" r="1.4" fill="${gridColor}"/></pattern>`;
  }
  return '';
}
