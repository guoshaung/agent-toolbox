import { h } from './ui.js';

const PATHS = {
  zap: '<path d="m13 2-9 11h7l-1 9 9-12h-7l1-8Z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>',
  pen: '<path d="m4 20 4.2-1 9.9-9.9a2.5 2.5 0 0 0-3.5-3.5L4.7 15.5 4 20Z"/><path d="m13.5 7.5 3 3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  flask: '<path d="M9 3h6M10 3v5l-5.2 9.1A2 2 0 0 0 6.5 20h11a2 2 0 0 0 1.7-2.9L14 8V3"/><path d="M7.5 15h9"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/><circle cx="12" cy="3" r="1"/>',
  archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 9 4 2.5-4 2.5V9Z"/>',
  graduation: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.2V16c2.8 2.2 7.2 2.2 10 0v-4.8M21 9v6"/>',
  scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 9h10M7 12h7M7 15h5"/>',
  checkList: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m7 9 1.5 1.5L11 8M13 9h4M7 15l1.5 1.5L11 14M13 15h4"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Z"/><path d="M6 8h4M14 8h4"/>',
  testTube: '<path d="M9 3h6M10 3v11.5a2.5 2.5 0 0 0 5 0V3M8 18h8"/><path d="M10 11h5"/>',
  smartphone: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M10 18.5h4"/>',
  settings: '<path d="m12 3 1 2.2a7.4 7.4 0 0 1 1.8.8L17 5l2 2-1 2.2c.3.6.6 1.2.8 1.8L21 12l-2.2 1a7.4 7.4 0 0 1-.8 1.8L19 17l-2 2-2.2-1a7.4 7.4 0 0 1-1.8.8L12 21l-2.2-1a7.4 7.4 0 0 1-1.8-.8L6 19l-2-2 1-2.2a7.4 7.4 0 0 1-.8-1.8L2 12l2.2-1c.2-.6.5-1.2.8-1.8L4 7l2-2 2.2 1c.6-.3 1.2-.6 1.8-.8L12 3Z"/><circle cx="12" cy="12" r="3"/>',
  paperclip: '<path d="m9 12 5.8-5.8a3.2 3.2 0 0 1 4.5 4.5l-7.5 7.5a5 5 0 1 1-7-7L12 4"/>',
  link: '<path d="m9.5 14.5 5-5M7 17l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M17 7l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  // ---- 图板：形状 ----
  shapeRect: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>',
  shapeRound: '<rect x="3.5" y="6" width="17" height="12" rx="4"/>',
  shapeCapsule: '<rect x="3" y="7.5" width="18" height="9" rx="4.5"/>',
  shapeEllipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  shapeDiamond: '<path d="M12 4 20 12 12 20 4 12Z"/>',
  shapeTriangle: '<path d="M12 5 20 19H4Z"/>',
  shapeHexagon: '<path d="M8 5h8l4 7-4 7H8l-4-7Z"/>',
  shapeParallel: '<path d="M7.5 6H21l-4.5 12H3Z"/>',
  shapeCylinder: '<ellipse cx="12" cy="7" rx="7" ry="2.8"/><path d="M5 7v10c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V7"/>',
  shapeStar: '<path d="m12 4 2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 6.9 19l1.1-5.5L4 9.7 9.6 9Z"/>',
  shapePie: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.5h8.5M12 12 6 18.5"/>',
  shapeContainer: '<rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke-dasharray="3.5 2.5"/>',
  shapeBracket: '<path d="M15 4c-2.2 0-2.5 1.3-2.5 4S11 12 10 12c1 0 2.5.7 2.5 4s.3 4 2.5 4"/>',
  // ---- 图板：线条 ----
  linePlain: '<path d="M4 12h16"/>',
  lineArrow: '<path d="M4 12h14M14 7.5 19.5 12 14 16.5"/>',
  lineDouble: '<path d="M6 12h12M9.5 7.5 5 12l4.5 4.5M14.5 7.5 19 12l-4.5 4.5"/>',
  lineDashed: '<path d="M4 12h3M10 12h4M17 12h3"/>',
  wireElbow: '<path d="M4 6h7v12h6M14 15l3 3-3 3"/>',
  wireCurve: '<path d="M4 6c7 0 3 12 10 12h3M14 15l3 3-3 3"/>',
  wireStraight: '<path d="M4 18 17 6M13 6h4v4"/>',
  wireLabel: '<path d="M4 12h16M9 8v8"/><rect x="8" y="9.5" width="8" height="5" rx="1.5" fill="currentColor" stroke="none" opacity=".25"/>',
  // ---- 图板：操作 ----
  textTool: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.6-4.3 3.4 3 2.6-2.3 4.4 4"/>',
  undo: '<path d="M4 9h9a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4"/>',
  redo: '<path d="M20 9h-9a5 5 0 0 0 0 10h5M20 9l-4-4M20 9l-4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7 18 4M15.7 15.7 6 4"/>',
  paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9.5 5V3.6h5V5"/>',
  group: '<rect x="4" y="4" width="8" height="8" rx="1.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/>',
  ungroup: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5" stroke-dasharray="3 2"/>',
  alignLeft: '<path d="M4 4v16M8 8h11M8 16h7"/>',
  alignCenterH: '<path d="M12 3v18M6.5 8h11M8.5 16h7"/>',
  alignTop: '<path d="M4 4h16M8 8v11M16 8v7"/>',
  layerUp: '<path d="m12 4 8 5-8 5-8-5Z"/><path d="m4 15 8 5 8-5"/>',
  layerTop: '<path d="m12 3 9 5.5-9 5.5L3 8.5Z"/><path d="M12 17.5v3"/>',
  rotateCw: '<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.8 2-1.8 0-1.6-1.4-1.7-1.4-3 0-1 .8-1.7 1.9-1.7H16a5 5 0 0 0 5-5C21 6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>',
  canvasBg: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 4.5v15M14.5 4.5v15M3.5 14.5h17" stroke-opacity=".45"/>',
  x: '<path d="M5 4h3.1l4 5.2L16.5 4H19l-5.7 6.7L20 20h-3.1l-4.4-5.8L7.2 20H4.7l6-7.1L5 4Z" fill="currentColor" stroke="none"/>',
};

const ALIASES = {
  '⚡': 'zap', '📖': 'book', '✍️': 'pen', '🎯': 'target', '🔬': 'flask', '🔍': 'search',
  '🧑‍🏫': 'graduation', '🗂': 'archive', '📺': 'monitor', '🧲': 'magnet', '🧪': 'testTube',
  '▣': 'smartphone', '◉': 'bot', '⚙︎': 'settings', '⌁': 'scan', '📚': 'book', '🌐': 'globe',
  '🏫': 'graduation', '🏛️': 'graduation', '🌏': 'globe', '🎓': 'graduation', '🗃️': 'archive',
  '🧠': 'bot', '📄': 'book', '🧬': 'flask', '🔗': 'link', '🟢': 'target', '🔷': 'target',
  '✏️': 'pen', '◈': 'target', '＋': 'plus', '↗': 'external', '←': 'arrowLeft', '→': 'arrowRight',
  '⟳': 'refresh', '•••': 'more', '📎': 'paperclip', '🔗': 'link', '✕': 'close',
};

export function iconFor(name, className = 'ui-icon') {
  const key = ALIASES[name] || name || 'globe';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[key] || PATHS.globe;
  return svg;
}

export function iconLabel(icon, label, className = 'icon-label') {
  return h('span', { class: className }, iconFor(icon), h('span', {}, label));
}
