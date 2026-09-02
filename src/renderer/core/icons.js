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
