import { h } from './ui.js';
import { iconFor } from './icons.js';

/**
 * 「更多」轮盘：三层同心圆，铺满整个窗口。
 *
 *   中心      当前类别名 / 收起
 *   第一圈    类别，绕一整圈均匀摆（学习科研 / 写作代码 / AI 伙伴 / 生活效率 / 设备外观 / 其他）
 *   第二圈    点开一个类别，那一类的工具在它两侧扇形排开
 *   第三圈    有子页的工具（科研 / 专注）再点「›」，子页再排一圈，一内一外交错免得标签打架
 *
 * 动效：从「更多」按钮的位置缩放到屏幕中央；节点从圆心弹射到位；圆环涟漪扩散；连线画出来；
 * 中心呼吸光。整个轮盘下面垫一层全屏背板：点背板就收 —— webview 里的点击本来传不到主页面，
 * 背板挡在前面才收得掉。
 */

const RING = [0, 160, 320, 470];     // 各层半径（窗口够大时），0 是中心
const NODE = 56;
const STEP2 = 24;                    // 第二圈相邻工具的角距（原来 17 挤成一团）
const STEP3 = 15;                    // 第三圈相邻子页的角距
const ZIGZAG = 62;                   // 第三圈内外交错的径向距离

/** 以锚点为圆心、给定半径的圆，哪段角度落在视口里。返回 [from, to]（度，0 = 右，负 = 上）。 */
export function fitArc({ x, y, radius, width, height, pad = NODE / 2 + 8 }) {
  const ok = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const px = x + radius * Math.cos(rad); const py = y + radius * Math.sin(rad);
    return px - pad >= 0 && px + pad <= width && py - pad >= 0 && py + pad <= height;
  };
  let best = null; let cur = null;
  for (let deg = 120; deg >= -240; deg -= 2) {
    if (ok(deg)) { if (!cur) cur = { from: deg, to: deg }; else cur.to = deg; }
    else if (cur) { if (!best || Math.abs(cur.from - cur.to) > Math.abs(best.from - best.to)) best = cur; cur = null; }
  }
  if (cur && (!best || Math.abs(cur.from - cur.to) > Math.abs(best.from - best.to))) best = cur;
  if (!best) return [-80, -10];
  return [Math.min(best.from, best.to), Math.max(best.from, best.to)];
}

/** n 个节点在 [from, to] 里等距摆，围绕 center 展开；放不下就压缩角距。 */
export function placeOnArc(n, { from, to, center, step = STEP2 }) {
  if (n <= 0) return [];
  const span = Math.max(0, to - from);
  const s = Math.min(step, n > 1 ? span / (n - 1) : step);
  const total = s * (n - 1);
  let start = (center ?? (from + to) / 2) - total / 2;
  if (start < from) start = from;
  if (start + total > to) start = to - total;
  return Array.from({ length: n }, (_, i) => start + s * i);
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

export function createRadialMenu({ groups, tools, subsOf, isPinned, onOpen, onOpenSub, onTogglePin, getCurrentId, colorOf, onClose, railWidth = 92 }) {
  const backdrop = h('div', { class: 'radial__backdrop' });
  const stage = h('div', { class: 'radial__stage' });
  const svg = svgEl('svg', { class: 'radial__lines' });
  const root = h('div', { class: 'radial', hidden: true }, backdrop, svg, stage);
  document.body.appendChild(root);

  let center = { x: 600, y: 400 };
  let scale = 1;
  let level1 = null;   // 选中的类别 id
  let level2 = null;   // 选中的（有子页的）工具 id
  let hideTimer = 0;
  const groupNodes = new Map();   // 类别节点常驻，切类别时不重飞

  const byId = (id) => tools.find((t) => t.id === id);
  const r = (i) => RING[i] * scale;
  const polar = (deg, radius) => { const rad = (deg * Math.PI) / 180; return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) }; };
  const groupDegOf = (i) => -90 + (360 / groups.length) * i;   // 从正上方开始顺时针

  function node({ id, kind, label, icon, deg, radius, color, active, delay, extra, onClick, title }) {
    const p = polar(deg, radius);
    const el = h('button', { class: `radial__node radial__node--${kind}${active ? ' is-active' : ''}`, title: title || label, dataset: { id }, onclick: (e) => { e.stopPropagation(); onClick(e); } },
      h('span', { class: 'radial__node-icon' }, iconFor(icon)),
      h('span', { class: 'radial__node-label' }, label),
      extra || null,
    );
    el.style.setProperty('--x', `${p.x}px`); el.style.setProperty('--y', `${p.y}px`);
    el.style.setProperty('--from-x', `${center.x}px`); el.style.setProperty('--from-y', `${center.y}px`);
    if (color) el.style.setProperty('--node-color', color);
    el.style.setProperty('--delay', `${delay || 0}ms`);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    return el;
  }

  function line(fromDeg, fromR, toDeg, toR, cls = '', delay = 0) {
    const a = polar(fromDeg, fromR); const b = polar(toDeg, toR);
    const l = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `radial__line ${cls}`.trim(), pathLength: 1 });
    l.style.setProperty('--delay', `${delay}ms`);
    return l;
  }

  function ring(radius, cls, delay = 0) {
    const c = svgEl('circle', { cx: center.x, cy: center.y, r: radius, class: `radial__ring ${cls}`.trim() });
    c.style.setProperty('--delay', `${delay}ms`);
    return c;
  }

  function layout() {
    const width = window.innerWidth; const height = window.innerHeight;
    center = { x: railWidth + (width - railWidth) / 2, y: height / 2 + 8 };
    const room = Math.min(center.x - railWidth, width - center.x, center.y, height - center.y) - NODE * 0.8;
    // 第三圈允许比窗口略大一点点（节点贴边也看得见），不然半径被压得太小
    scale = Math.max(.5, Math.min(1, (room + 40) / (RING[3] + ZIGZAG)));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width); svg.setAttribute('height', height);
  }

  /** 类别圈：打开时画一次，之后只更新高亮 */
  function renderGroups() {
    const current = getCurrentId();
    groupNodes.clear();
    groups.forEach((g, i) => {
      const deg = groupDegOf(i);
      const el = node({ id: g.id, kind: 'group', label: g.label, icon: g.icon, deg, radius: r(1), color: g.color, active: level1 === g.id, delay: 60 + i * 45, title: `${g.label}：${g.tools.map((id) => byId(id)?.title).filter(Boolean).join('、')}`,
        extra: g.tools.includes(current) ? h('span', { class: 'radial__dot' }) : null,
        onClick: () => { level1 = level1 === g.id ? null : g.id; level2 = null; renderInner(); } });
      groupNodes.set(g.id, el);
    });
  }

  function hubEl() {
    const g = groups.find((x) => x.id === level1);
    const hub = h('button', { class: `radial__hub${g ? ' has-group' : ''}`, title: g ? '收起这一类' : '收起', onclick: (e) => { e.stopPropagation(); if (g) { level1 = null; level2 = null; renderInner(); } else close(); } },
      g ? h('span', { class: 'radial__hub-text' }, g.label) : h('span', { class: 'radial__hub-x' }, '×'));
    hub.style.setProperty('--x', `${center.x}px`); hub.style.setProperty('--y', `${center.y}px`);
    if (g) hub.style.setProperty('--node-color', g.color);
    return hub;
  }

  /** 第二、三圈 + 连线 + 中心 */
  function renderInner() {
    const current = getCurrentId();
    const lines = [ring(r(1), 'radial__ring--1', 0), ring(r(2), 'radial__ring--2', 120)];
    const inner = [];
    for (const [gid, el] of groupNodes) el.classList.toggle('is-active', gid === level1);

    if (level1) {
      const gi = groups.findIndex((x) => x.id === level1); const g = groups[gi];
      const gDeg = groupDegOf(gi);
      const list = g.tools.map(byId).filter(Boolean);
      const degs2 = placeOnArc(list.length, { from: gDeg - 175, to: gDeg + 175, center: gDeg, step: STEP2 * Math.max(.8, scale) });
      lines.push(line(gDeg, 0, gDeg, r(1) - NODE / 2 * scale, 'is-active', 0));
      list.forEach((t, i) => {
        const subs = subsOf(t.id);
        const pinned = isPinned(t.id);
        lines.push(line(gDeg, r(1) + NODE / 2 * scale, degs2[i], r(2) - NODE / 2 * scale, level2 === t.id ? 'is-active' : 'is-faint', 40 + i * 25));
        inner.push(node({ id: t.id, kind: 'tool', label: t.title, icon: t.icon, deg: degs2[i], radius: r(2), color: colorOf(t.id), active: level2 === t.id || current === t.id, delay: i * 28, title: t.hint || t.title,
          extra: h('span', { class: 'radial__badges' },
            h('button', { class: `radial__pin${pinned ? ' is-pinned' : ''}`, title: pinned ? '从左栏取下' : '钉到左栏', onclick: (e) => { e.stopPropagation(); onTogglePin(t.id); } }, pinned ? '★' : '☆'),
            subs ? h('button', { class: `radial__more${level2 === t.id ? ' is-open' : ''}`, title: '展开子页', onclick: (e) => { e.stopPropagation(); level2 = level2 === t.id ? null : t.id; renderInner(); } }, '›') : null,
          ),
          onClick: () => { close(); onOpen(t.id); } }));
      });

      if (level2) {
        const t = byId(level2); const subs = subsOf(level2) || [];
        const idx = list.findIndex((x) => x.id === level2);
        const degs3 = placeOnArc(subs.length, { from: degs2[idx] - 175, to: degs2[idx] + 175, center: degs2[idx], step: STEP3 * Math.max(.85, scale) });
        lines.push(ring(r(3), 'radial__ring--3', 0), ring(r(3) + ZIGZAG * scale, 'radial__ring--3', 80));
        subs.forEach((s, i) => {
          const radius = r(3) + (i % 2 ? ZIGZAG * scale : 0);
          lines.push(line(degs2[idx], r(2) + NODE / 2 * scale, degs3[i], radius - NODE / 2 * scale, 'is-faint', i * 20));
          inner.push(node({ id: `${t.id}:${s.id}`, kind: 'sub', label: s.label, icon: s.icon || t.icon, deg: degs3[i], radius, color: colorOf(t.id), delay: i * 22, title: `${t.title} → ${s.label}`,
            onClick: () => { close(); onOpenSub(t.id, s.id); } }));
        });
      }
    }
    svg.replaceChildren(...lines);
    stage.replaceChildren(hubEl(), ...groupNodes.values(), ...inner);
  }

  function open(anchorEl) {
    clearTimeout(hideTimer);
    layout();
    // 从「更多」按钮那个点放大出来
    const rect = anchorEl.getBoundingClientRect();
    root.style.setProperty('--origin-x', `${rect.left + rect.width / 2}px`);
    root.style.setProperty('--origin-y', `${rect.top + rect.height / 2}px`);
    root.hidden = false;
    renderGroups();
    renderInner();
    requestAnimationFrame(() => root.classList.add('is-open'));
  }

  function close() {
    if (root.hidden) return;
    root.classList.remove('is-open');
    onClose?.();
    hideTimer = setTimeout(() => { root.hidden = true; stage.replaceChildren(); svg.replaceChildren(); groupNodes.clear(); }, 260);
  }

  backdrop.addEventListener('pointerdown', (e) => { e.stopPropagation(); close(); });
  window.addEventListener('resize', () => { if (!root.hidden) { layout(); renderGroups(); renderInner(); } });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close(); });

  return { open, close, isOpen: () => !root.hidden, rerender: () => { if (!root.hidden) renderInner(); } };
}
