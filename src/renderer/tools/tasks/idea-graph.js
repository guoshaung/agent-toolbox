import { h, toast } from '../../core/ui.js';

/**
 * 想法关系图：
 *  - 每条想法可以自己选一个渐变背景（🎨）
 *  - 想法卡片能拖：拖的不是卡片本身，而是从卡片里"拖出一个编号"；卡片原地留一个配对的 #n 徽标
 *  - 编号落在右侧的关系图窗口里变成节点；节点能拖着摆位置
 *  - 连线由你自己来：点一个节点、再点另一个 = 连一条；双击线加标签；线上的 × 删线
 *  - 点节点会把左边对应的卡片滚过来闪一下
 * 数据存 config：tasks.ideaGraph = { nodes:[{ n, ideaId, x, y }], links:[{ a, b, label }], next }
 * 颜色存在想法自己身上：idea.color = 预设 id
 */
// 默认「自动」：每条按它在列表里的位置轮换一个渐变，不用你手动点；🎨 里选了就固定；「无」= 明确不上色
export const IDEA_GRADIENTS = [
  { id: '', name: '自动（按顺序换色）', css: '' },
  { id: 'none', name: '无', css: '' },
  { id: 'blue', name: '蓝紫', css: 'linear-gradient(135deg, rgba(91,140,255,.34), rgba(180,140,255,.22))' },
  { id: 'teal', name: '青绿', css: 'linear-gradient(135deg, rgba(63,185,138,.32), rgba(79,195,239,.2))' },
  { id: 'sunset', name: '橙粉', css: 'linear-gradient(135deg, rgba(240,163,58,.34), rgba(255,127,176,.22))' },
  { id: 'gold', name: '金', css: 'linear-gradient(135deg, rgba(223,161,69,.34), rgba(255,226,122,.18))' },
  { id: 'rose', name: '玫红', css: 'linear-gradient(135deg, rgba(229,100,95,.32), rgba(255,127,176,.2))' },
  { id: 'mint', name: '薄荷', css: 'linear-gradient(135deg, rgba(140,240,216,.28), rgba(111,224,200,.14))' },
  { id: 'slate', name: '灰蓝', css: 'linear-gradient(135deg, rgba(120,140,170,.3), rgba(60,70,90,.2))' },
  { id: 'violet', name: '紫', css: 'linear-gradient(135deg, rgba(180,140,255,.34), rgba(110,71,196,.22))' },
];
export const gradientCss = (id) => IDEA_GRADIENTS.find((g) => g.id === id)?.css || '';
const AUTO_IDS = IDEA_GRADIENTS.filter((g) => g.css).map((g) => g.id);
const NODE_STROKE = { blue: '#5b8cff', teal: '#3fb98a', sunset: '#f0a33a', gold: '#dfa145', rose: '#e5645f', mint: '#6fe0c8', slate: '#8a9bb5', violet: '#b48cff' };

const CSS = `
.tk__ideas.is-graph { display:grid; grid-template-columns: minmax(0, 1fr) minmax(380px, 42%); gap:14px; overflow:hidden; }
.tk__ideas-left { min-height:0; display:flex; flex-direction:column; gap:14px; }
.tk__ideas.is-graph .tk__ideas-left { overflow:auto; padding-right:4px; }
.tk__idea-card[draggable="true"] { cursor:grab; }
.tk__idea-card.is-flash { box-shadow:0 0 0 2px var(--accent), 0 0 24px color-mix(in srgb, var(--accent) 45%, transparent); transition:box-shadow .2s; }
.tk__idea-card.has-color { border-color:transparent; }
.tk__idea-num { display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:22px; padding:0 7px; border-radius:999px; background:var(--accent); color:#fff; font:700 11.5px/1 var(--mono); letter-spacing:.3px; box-shadow:0 2px 8px rgba(0,0,0,.25); }
.tk__idea-grip { color:var(--text-faint); font-size:13px; cursor:grab; user-select:none; padding:0 2px; }
.tk__color-btn { width:24px; height:24px; border-radius:50%; border:2px solid rgba(255,255,255,.35); background:var(--bg-sunken); cursor:pointer; padding:0; font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,.3); }
.tk__color-btn:hover { border-color:#fff; transform:scale(1.08); }
.tk__color-pop { position:absolute; z-index:30; display:flex; gap:6px; padding:8px; border:1px solid var(--line); border-radius:10px; background:var(--panel); box-shadow:0 10px 30px rgba(0,0,0,.35); }
.tk__color-pop button { width:26px; height:26px; border-radius:8px; border:1px solid var(--line); cursor:pointer; padding:0; background:var(--bg-sunken); }
.tk__color-pop button.is-on { outline:2px solid var(--accent); }
.tk__drag-ghost { position:fixed; top:-200px; left:-200px; display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:var(--accent); color:#fff; font:700 12px/1 var(--mono); box-shadow:0 6px 18px rgba(0,0,0,.35); pointer-events:none; }
.ig { display:flex; flex-direction:column; min-height:0; border:1px solid var(--line); border-radius:14px; background:var(--bg-raised); overflow:hidden; }
.ig__bar { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--line-soft, var(--line)); font-size:12px; }
.ig__bar strong { font-size:13px; }
.ig__hint { color:var(--text-faint); font-size:11.5px; }
.ig__stage { position:relative; flex:1; min-height:320px; background: radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%), var(--bg); }
.ig__stage.is-over { outline:2px dashed var(--accent); outline-offset:-6px; }
.ig__svg { width:100%; height:100%; display:block; user-select:none; }
.ig__node { cursor:pointer; }
.ig__node rect { fill:var(--panel); stroke:var(--line); stroke-width:1.5; }
.ig__node.is-src rect { stroke:var(--accent); stroke-width:2.5; }
.ig__node .ig__n { font:700 11px var(--mono); fill:#fff; }
.ig__node .ig__t { font-size:11.5px; fill:var(--text); }
.ig__node .ig__x { font-size:11px; fill:var(--text-faint); cursor:pointer; }
.ig__node .ig__x:hover { fill:var(--bad); }
.ig__link { stroke:var(--text-dim); stroke-width:1.8; stroke-opacity:.7; }
.ig__link-hit { stroke:transparent; stroke-width:14; cursor:pointer; }
.ig__link-label { font-size:10.5px; fill:var(--text-dim); paint-order:stroke; stroke:var(--bg); stroke-width:3px; pointer-events:none; }
.ig__link-x { font-size:11px; fill:var(--text-faint); cursor:pointer; }
.ig__link-x:hover { fill:var(--bad); }
.ig__empty { position:absolute; inset:0; display:grid; place-content:center; text-align:center; color:var(--text-dim); font-size:12.5px; line-height:1.8; pointer-events:none; padding:20px; }
.ig__status { position:absolute; left:10px; bottom:8px; font-size:11.5px; color:var(--accent); pointer-events:none; }
`;

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const firstLine = (t) => String(t || '').split('\n').map((l) => l.replace(/^#+\s*/, '').replace(/\$+[^$]*\$+/g, '').trim()).find(Boolean) || '';

export function createIdeaGraph({ config, getIdeas, persistIdeas, rerenderIdeas }) {
  if (!document.getElementById('ideagraph-css')) document.head.append(h('style', { id: 'ideagraph-css' }, CSS));
  const load = () => { const g = config.get('tasks.ideaGraph') || {}; return { nodes: Array.isArray(g.nodes) ? g.nodes : [], links: Array.isArray(g.links) ? g.links : [], next: Number(g.next) || 1 }; };
  let g = load();
  const save = () => config.set('tasks.ideaGraph', g);
  let open = Boolean(config.get('tasks.ideaGraphOpen', false));
  let srcN = null;                // 连线起点
  let container = null;           // .tk__ideas

  // ---------- 面板 ----------
  const status = h('div', { class: 'ig__status' });
  const empty = h('div', { class: 'ig__empty' }, h('div', {}, h('b', {}, '把左边的想法拖进来'), h('br'), '拖出来的是一个编号，想法原地会留一个配对的 #n。', h('br'), '进来之后：点一个节点、再点另一个 = 连线；双击线加标签。'));
  const stage = h('div', { class: 'ig__stage' }, empty, status);
  const svg = svgEl('svg', { class: 'ig__svg' });
  const linkLayer = svgEl('g'); const nodeLayer = svgEl('g');
  svg.append(linkLayer, nodeLayer); stage.append(svg);
  const panel = h('div', { class: 'ig', hidden: !open },
    h('div', { class: 'ig__bar' }, h('strong', {}, '🕸 关系图'), h('span', { class: 'ig__hint' }, '拖想法进来 · 点两个节点连线 · 双击线写标签'), h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--xs btn--ghost', title: '清空整张图（想法本身不删）', onclick: () => { if (!g.nodes.length || confirm('清空关系图？想法本身不会删。')) { g = { nodes: [], links: [], next: 1 }; save(); draw(); rerenderIdeas(); } } }, '清空'),
      h('button', { class: 'btn btn--xs btn--ghost', onclick: () => toggle(false) }, '收起')),
    stage);

  // 拖进来 = 落一个编号节点
  stage.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-idea')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stage.classList.add('is-over'); } });
  stage.addEventListener('dragleave', () => stage.classList.remove('is-over'));
  stage.addEventListener('drop', (e) => {
    stage.classList.remove('is-over');
    const ideaId = e.dataTransfer.getData('application/x-idea'); if (!ideaId) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    dropIdea(ideaId, e.clientX - r.left, e.clientY - r.top);
  });
  svg.addEventListener('click', () => { if (srcN != null) { srcN = null; draw(); } });

  function dropIdea(ideaId, x, y) {
    let node = g.nodes.find((n) => n.ideaId === ideaId);
    if (node) { node.x = x; node.y = y; }
    else { node = { n: g.next++, ideaId, x, y }; g.nodes.push(node); }
    save(); draw(); rerenderIdeas();
    toast(`#${node.n} 落进关系图了`, 'good', 1800);
  }

  function nodeFor(ideaId) { return g.nodes.find((n) => n.ideaId === ideaId) || null; }
  /** 这条想法实际用哪个渐变：明确选了就用选的；'none' 不上色；没选就按它在列表里的位置轮换 */
  function colorIdOf(idea) {
    if (!idea) return '';
    if (idea.color === 'none') return '';
    if (idea.color) return idea.color;
    // 按创建先后排名，而不是按列表位置：新想法插在最前面时，老想法的颜色不会跟着全变
    const rank = (getIdeas() || []).filter((i) => (i.at || 0) < (idea.at || 0)).length;
    return AUTO_IDS[rank % AUTO_IDS.length];
  }
  function ideaOf(node) { return (getIdeas() || []).find((i) => i.id === node.ideaId) || null; }

  // ---------- 画 ----------
  function draw() {
    // 想法被删了的节点一并清掉
    const ids = new Set((getIdeas() || []).map((i) => i.id));
    const before = g.nodes.length;
    g.nodes = g.nodes.filter((n) => ids.has(n.ideaId));
    const ns = new Set(g.nodes.map((n) => n.n));
    g.links = g.links.filter((l) => ns.has(l.a) && ns.has(l.b));
    if (g.nodes.length !== before) save();
    empty.hidden = g.nodes.length > 0;
    status.textContent = srcN != null ? `连线中：从 #${srcN} 出发，点另一个节点；点空白取消` : '';
    linkLayer.replaceChildren(); nodeLayer.replaceChildren();
    const pos = new Map(g.nodes.map((n) => [n.n, n]));
    for (const l of g.links) {
      const a = pos.get(l.a); const b = pos.get(l.b); if (!a || !b) continue;
      const line = svgEl('line', { class: 'ig__link', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      const hit = svgEl('line', { class: 'ig__link-hit', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      hit.addEventListener('dblclick', (e) => { e.stopPropagation(); const v = prompt('这条线的标签（留空删标签）', l.label || ''); if (v === null) return; l.label = v.trim(); save(); draw(); });
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      const label = svgEl('text', { class: 'ig__link-label', x: mx, y: my - 6, 'text-anchor': 'middle' }); label.textContent = l.label || '';
      const x = svgEl('text', { class: 'ig__link-x', x: mx + 6, y: my + 12 }); x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); g.links = g.links.filter((z) => z !== l); save(); draw(); });
      linkLayer.append(line, hit, label, x);
    }
    for (const n of g.nodes) {
      const idea = ideaOf(n); const text = firstLine(idea?.text).slice(0, 16);
      const w = Math.max(70, 34 + text.length * 11.5 + 18);
      const gEl = svgEl('g', { class: `ig__node${srcN === n.n ? ' is-src' : ''}`, transform: `translate(${n.x},${n.y})` });
      const rect = svgEl('rect', { x: -w / 2, y: -15, width: w, height: 30, rx: 15 });
      const stroke = NODE_STROKE[colorIdOf(idea)]; if (stroke) rect.setAttribute('stroke', stroke);
      const pill = svgEl('rect', { x: -w / 2 + 4, y: -11, width: 26, height: 22, rx: 11, fill: stroke || 'var(--accent)' });
      const num = svgEl('text', { class: 'ig__n', x: -w / 2 + 17, y: 4, 'text-anchor': 'middle' }); num.textContent = `#${n.n}`;
      const t = svgEl('text', { class: 'ig__t', x: -w / 2 + 36, y: 4 }); t.textContent = text;
      const x = svgEl('text', { class: 'ig__x', x: w / 2 - 12, y: 4 }); x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); g.nodes = g.nodes.filter((z) => z !== n); g.links = g.links.filter((l) => l.a !== n.n && l.b !== n.n); if (srcN === n.n) srcN = null; save(); draw(); rerenderIdeas(); });
      gEl.append(rect, pill, num, t, x);
      attachNode(gEl, n);
      nodeLayer.append(gEl);
    }
  }

  function attachNode(gEl, n) {
    let drag = null; let moved = false;
    gEl.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('ig__x')) return; drag = { x: e.clientX, y: e.clientY, ox: n.x, oy: n.y }; moved = false; gEl.setPointerCapture(e.pointerId); e.stopPropagation(); });
    gEl.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; const dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; n.x = drag.ox + dx; n.y = drag.oy + dy; gEl.setAttribute('transform', `translate(${n.x},${n.y})`); redrawLinksOnly(); });
    gEl.addEventListener('pointerup', () => { if (!drag) return; drag = null; if (moved) { save(); draw(); } });
    gEl.addEventListener('click', (e) => {
      e.stopPropagation(); if (moved) return;
      if (srcN == null) { srcN = n.n; draw(); jumpTo(n.ideaId); return; }
      if (srcN === n.n) { srcN = null; draw(); return; }
      const a = Math.min(srcN, n.n); const b = Math.max(srcN, n.n);
      if (!g.links.some((l) => Math.min(l.a, l.b) === a && Math.max(l.a, l.b) === b)) { g.links.push({ a: srcN, b: n.n, label: '' }); toast(`#${srcN} — #${n.n} 连上了`, 'good', 1500); }
      srcN = null; save(); draw();
    });
  }
  function redrawLinksOnly() {
    const pos = new Map(g.nodes.map((n) => [n.n, n]));
    const lines = linkLayer.querySelectorAll('line');
    g.links.forEach((l, i) => { const a = pos.get(l.a); const b = pos.get(l.b); if (!a || !b) return; for (const ln of [lines[i * 2], lines[i * 2 + 1]]) { if (!ln) continue; ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y); } });
  }

  function jumpTo(ideaId) {
    // 模块里的 CSS 常量把 window.CSS 挡住了，显式走 window
    const card = document.querySelector(`.tk__idea-card[data-idea-id="${window.CSS.escape(ideaId)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-flash'); setTimeout(() => card.classList.remove('is-flash'), 1200);
  }

  // ---------- 卡片侧：拖出编号 / 徽标 / 颜色 ----------
  let ghost = null;
  function attachCard(card, idea, metaRow) {
    card.dataset.ideaId = idea.id;
    const colorId = colorIdOf(idea);
    const css = gradientCss(colorId);
    if (css) { card.style.background = `${css}, var(--panel)`; card.classList.add('has-color'); }
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-idea', idea.id);
      e.dataTransfer.effectAllowed = 'copy';
      const n = nodeFor(idea.id)?.n || g.next;
      if (!ghost) { ghost = h('div', { class: 'tk__drag-ghost' }); document.body.append(ghost); }
      ghost.textContent = `#${n}`;
      e.dataTransfer.setDragImage(ghost, 18, 14);
      if (!open) toggle(true);       // 一拖就把关系图打开，有地方可以落
    });
    const node = nodeFor(idea.id);
    const badge = node ? h('span', { class: 'tk__idea-num', title: '在关系图里的编号，点一下定位', onclick: () => { toggle(true); srcN = null; draw(); } }, `#${node.n}`) : null;
    const grip = h('span', { class: 'tk__idea-grip', title: '按住拖到右边关系图里，会拖出一个编号' }, '⠿');
    // 一个带当前颜色的圆色块，一眼看得见；点开换色
    const colorBtn = h('button', { class: 'tk__color-btn', title: `背景颜色（现在：${IDEA_GRADIENTS.find((x) => x.id === (idea.color || ''))?.name || '自动'}），点一下换`, style: css ? { background: css } : {}, onclick: (e) => openColorPop(e.currentTarget, idea) }, css ? '' : '🎨');
    metaRow.prepend(grip, ...(badge ? [badge] : []));
    // 放在「提问」前面
    const primary = metaRow.querySelector('.btn--primary');
    if (primary) metaRow.insertBefore(colorBtn, primary); else metaRow.append(colorBtn);
  }

  function openColorPop(anchor, idea) {
    document.querySelector('.tk__color-pop')?.remove();
    const pop = h('div', { class: 'tk__color-pop' }, ...IDEA_GRADIENTS.map((gr) => h('button', {
      class: gr.id === (idea.color || '') ? 'is-on' : '', title: gr.name, style: gr.css ? { background: gr.css } : {},
      onclick: () => { idea.color = gr.id; persistIdeas(); pop.remove(); rerenderIdeas(); draw(); },
    }, gr.id === '' ? 'A' : gr.id === 'none' ? '∅' : '')));
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.left - 200)}px`; pop.style.top = `${r.bottom + 6}px`; pop.style.position = 'fixed';
    document.body.append(pop);
    const close = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  function toggle(next = !open) {
    open = next; config.set('tasks.ideaGraphOpen', open);
    panel.hidden = !open;
    container?.classList.toggle('is-graph', open);
    if (open) draw();
  }
  function mount(ideasPane) { container = ideasPane; container.classList.toggle('is-graph', open); }

  return { panel, attachCard, toggle, draw, mount, isOpen: () => open, count: () => g.nodes.length };
}
