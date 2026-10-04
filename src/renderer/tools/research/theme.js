import { h } from '../../core/ui.js';

/**
 * 科研板块的「学术」视觉：衬线字体、纸张质感、刊头装饰、高对比的次要文字。
 * 只作用在 .research--academic 之下，不碰别的工具。图都是这里现画的 SVG（data URI），不依赖网络。
 */
export const SERIF = '"Charter", "Iowan Old Style", "Georgia", "Palatino", "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", serif';

const CSS = `
.research--academic { --serif: ${SERIF}; --ink: #ece6d8; --ink-dim: #b9b1a1; --ink-faint: #8d8574; --gold: #d6be8c; --gold-soft: rgba(214,190,140,.16); --paper: #f5f0e6; --paper-ink: #201d19; --paper-line: #d9d0bf; }
.research--academic .research__topbar { min-height: 52px; padding-inline: 16px; border-bottom: 1px solid rgba(214,190,140,.28); background: linear-gradient(180deg, rgba(48,40,30,.78), rgba(22,19,16,.55)), repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px), var(--bg); }
.research--academic .research__topbar > strong { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; flex: 0 0 auto; font-family: var(--serif); font-size: 16px; font-weight: 600; letter-spacing: .18em; color: var(--ink); }
.research--academic .research__emblem { width: 22px; height: 22px; opacity: .9; flex: 0 0 auto; }
.research--academic .research__subbar { flex-wrap: wrap; row-gap: 4px; min-width: 0; }
.research--academic .research__subbtn { font-family: var(--serif); letter-spacing: .02em; font-size: 12.5px; padding-inline: 9px; border-radius: 6px; color: var(--ink-dim); border-color: transparent; background: transparent; white-space: nowrap; }
.research--academic .research__subbtn:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.research--academic .research__subbtn.is-active { background: var(--gold-soft); border-color: rgba(214,190,140,.55); color: #f3e9d2; }
.research--academic .research__subbody { background: radial-gradient(ellipse at 20% 0%, rgba(214,190,140,.09), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(91,140,255,.06), transparent 50%), repeating-linear-gradient(0deg, rgba(255,255,255,.012) 0 1px, transparent 1px 3px), var(--bg); }
.research--academic .research__panel { font-family: var(--serif); color: var(--ink); }
/* 次要文字提亮：原来的 faint 在有底色的地方几乎看不见 */
.research--academic .research__panel .faint { color: var(--ink-dim) !important; }
.research--academic .research__panel .tag { color: var(--ink-dim); border-color: rgba(214,190,140,.3); }
.research--academic .research__panel .card__title, .research--academic .research__panel h2, .research--academic .research__panel h3 { font-family: var(--serif); letter-spacing: .01em; }
/* 控件保持 UI 字体，正文类的 textarea 走衬线（各页自己指定） */
.research--academic .research__panel .btn, .research--academic .research__panel select, .research--academic .research__panel input { font-family: var(--font); }
/* 刊头 */
.rs-mast { display: flex; align-items: flex-end; gap: 16px; padding: 4px 0 12px; border-bottom: 1px solid rgba(214,190,140,.28); margin-bottom: 12px; }
.rs-mast__kicker { font-family: var(--font); font-size: 10.5px; letter-spacing: .28em; text-transform: uppercase; color: var(--gold); margin-bottom: 4px; }
.rs-mast__title { font-family: var(--serif); font-size: 26px; line-height: 1.15; margin: 0; color: var(--ink); font-weight: 600; }
.rs-mast__sub { font-family: var(--serif); font-style: italic; color: var(--ink-dim); font-size: 13px; margin-top: 4px; }
.rs-mast__art { margin-left: auto; height: 54px; opacity: .85; flex: 0 0 auto; }
.rs-orn { display: block; width: 100%; height: 14px; margin: 6px 0; }
/* 空状态的插画 */
.rs-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 30px 20px; }
.rs-hero img { width: min(520px, 90%); height: auto; filter: drop-shadow(0 18px 40px rgba(0,0,0,.35)); }
.rs-hero h3 { font-family: var(--serif); font-size: 22px; margin: 10px 0 2px; color: var(--ink); }
.rs-hero p { font-family: var(--serif); color: var(--ink-dim); max-width: 520px; line-height: 1.8; margin: 0; }
/* 手稿纸：正文编辑区 */
.rs-sheet { background: var(--paper); color: var(--paper-ink); border: 1px solid var(--paper-line); border-radius: 4px; box-shadow: 0 1px 0 #fff inset, 0 14px 40px rgba(0,0,0,.35); font-family: var(--serif); font-size: 14px; line-height: 1.85; padding: 26px 30px; }
.rs-sheet::placeholder { color: #8f887b; font-style: italic; }
.rs-sheet:focus { outline: none; box-shadow: 0 1px 0 #fff inset, 0 14px 40px rgba(0,0,0,.35), 0 0 0 3px rgba(214,190,140,.35); }
`;

function svgUri(svg) { return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`; }

/** 刊头徽记：一枚细线圆章，里面一个开合的书页 */
export function emblemSvg() {
  return `<svg class="research__emblem" viewBox="0 0 24 24" fill="none" stroke="#d6be8c" stroke-width="1.1" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10.5"/><circle cx="12" cy="12" r="8" stroke-opacity=".45"/><path d="M12 7.5c-1.6-1.1-3.4-1.3-5-.9v8.6c1.6-.4 3.4-.2 5 .9 1.6-1.1 3.4-1.3 5-.9V6.6c-1.6-.4-3.4-.2-5 .9z"/><path d="M12 7.5v8.6"/></svg>`;
}

/** 分隔花线：两道细线夹一颗小菱形 */
export function ornamentSvg() {
  return `<svg class="rs-orn" viewBox="0 0 400 14" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="7" x2="186" y2="7" stroke="#d6be8c" stroke-opacity=".45"/><line x1="214" y1="7" x2="400" y2="7" stroke="#d6be8c" stroke-opacity=".45"/><path d="M200 2l5 5-5 5-5-5z" fill="none" stroke="#d6be8c"/></svg>`;
}

/** 引文星座：一张确定性的节点-连线插画，用在空状态和刊头右侧 */
export function constellationUri({ w = 720, h = 260, seed = 7, accent = '#5b8cff', gold = '#d6be8c' } = {}) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pts = Array.from({ length: 26 }, () => ({ x: 30 + rnd() * (w - 60), y: 24 + rnd() * (h - 48), r: 2 + rnd() * 4.5, c: rnd() < .3 ? gold : accent }));
  let lines = '';
  for (let i = 0; i < pts.length; i += 1) for (let j = i + 1; j < pts.length; j += 1) {
    const a = pts[i]; const b = pts[j]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 130) lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${a.c}" stroke-opacity="${(0.55 - d / 300).toFixed(2)}" stroke-width="1"/>`;
  }
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${p.c}" fill-opacity=".9"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(p.r * 3).toFixed(1)}" fill="${p.c}" fill-opacity=".08"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="${accent}" stop-opacity=".16"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${lines}${dots}</svg>`;
  return svgUri(svg);
}

/** 给科研根节点套上学术皮；顶栏的「科研」两个字前面加徽记 */
export function applyResearchTheme(root) {
  if (!document.getElementById('research-academic-css')) document.head.append(h('style', { id: 'research-academic-css' }, CSS));
  root.classList.add('research--academic');
  const title = root.querySelector('.research__topbar > strong');
  if (title && !title.querySelector('.research__emblem')) title.insertAdjacentHTML('afterbegin', emblemSvg());
}

/** 页面刊头：小标 + 大标题 + 副题 + 右侧插画 */
export function masthead({ kicker, title, sub, art = true }) {
  return h('div', { class: 'rs-mast' },
    h('div', {}, h('div', { class: 'rs-mast__kicker' }, kicker), h('h2', { class: 'rs-mast__title' }, title), sub ? h('div', { class: 'rs-mast__sub' }, sub) : null),
    art ? h('img', { class: 'rs-mast__art', src: constellationUri({ w: 300, h: 90, seed: 11 }), alt: '' }) : null);
}

/** 空状态插画块 */
export function hero({ title, text, seed = 7, children = [] }) {
  return h('div', { class: 'rs-hero' }, h('img', { src: constellationUri({ seed }), alt: '' }), h('h3', {}, title), h('p', {}, text), ...children);
}
