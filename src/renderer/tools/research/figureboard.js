import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

const DEFAULT_SITES = [
  { name: 'BioRender', url: 'https://www.biorender.com/', desc: '生命科学插图素材', emoji: '🧬' },
  { name: 'Mind the Graph', url: 'https://mindthegraph.com/', desc: '科研图形摘要', emoji: '📊' },
  { name: 'diagrams.net', url: 'https://app.diagrams.net/', desc: '架构图 / 流程图', emoji: '🔷' },
  { name: 'Excalidraw', url: 'https://excalidraw.com/', desc: '手绘风图示', emoji: '✏️' },
  { name: 'Figma', url: 'https://www.figma.com/', desc: '界面与矢量设计', emoji: '◈' },
];

const MAX_IMAGE_EDGE = 2400;

function imageDataUrl(data) {
  return `data:${data.mime};base64,${data.base64}`;
}

async function compressImage(data) {
  const image = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error('图片无法读取，请重新复制。'));
    node.src = imageDataUrl(data);
  });
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

export function createFigureboard(root, ctx) {
  const { config } = ctx;
  const siteViewHost = h('div', { class: 'figureboard__site-view' });
  const siteList = h('div', { class: 'figureboard__site-list' });
  const sources = h('aside', { class: 'figureboard__sources' });
  const browserPane = h('section', { class: 'figureboard__browser', hidden: true });
  const board = h('div', { class: 'figureboard__canvas', tabindex: '0' });
  const empty = h('div', { class: 'figureboard__empty' },
    h('span', { class: 'empty__icon' }, '🖼️'),
    '把科研截图、图表或公式粘贴到这里',
    h('br'),
    h('span', { class: 'faint' }, '⌘V 粘贴图片 · 拖动素材调整位置 · Delete 删除选中素材'),
  );
  board.appendChild(empty);
  let selectedId = null;
  let selectedIds = new Set();
  let activeSite = null;
  let sites = [...DEFAULT_SITES, ...(config.get('research.figureSites') || [])];
  let items = (config.get('research.figureItems') || []).map((item) => (
    ['rect', 'ellipse', 'diamond'].includes(item.type) && item.stroke === '#3d6fe8' && item.fill === '#dce8ff'
      ? { ...item, stroke: 'transparent', fill: 'transparent' }
      : item
  ));
  let undoStack = [];
  let redoStack = [];
  let internalClipboard = [];
  let marquee = null;
  let saveTimer;

  function cloneItems(value = items) {
    return JSON.parse(JSON.stringify(value));
  }

  function record(before) {
    undoStack.push(before);
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => config.set('research.figureItems', items), 160);
  }

  function selectItem(id, additive = false) {
    if (!id) {
      selectedId = null;
      selectedIds.clear();
    } else {
      const item = items.find((entry) => entry.id === id);
      const group = item?.groupId ? items.filter((entry) => entry.groupId === item.groupId).map((entry) => entry.id) : [id];
      if (!additive) selectedIds.clear();
      for (const groupId of group) {
        if (additive && selectedIds.has(groupId)) selectedIds.delete(groupId);
        else selectedIds.add(groupId);
      }
      selectedId = selectedIds.values().next().value || null;
    }
    for (const element of board.querySelectorAll('.figureboard__item')) element.classList.toggle('is-selected', selectedIds.has(element.dataset.id));
    const item = items.find((entry) => entry.id === id);
    if (item?.fill?.startsWith('#')) fillInput.value = item.fill;
    if (item?.stroke?.startsWith('#')) strokeInput.value = item.stroke;
    if (item && typeof opacityInput !== 'undefined') opacityInput.value = String(Math.round((item.opacity ?? 1) * 100));
    if (item && typeof strokeWidthInput !== 'undefined') strokeWidthInput.value = String(item.strokeWidth ?? 3);
  }

  function removeItem(id) {
    record(cloneItems());
    const ids = selectedIds.size ? selectedIds : new Set([id]);
    items = items.filter((item) => !ids.has(item.id));
    selectedId = null;
    selectedIds.clear();
    persist();
    renderBoard();
  }

  function addImage(dataUrl, naturalWidth = 900, naturalHeight = 600) {
    record(cloneItems());
    const maxWidth = Math.min(420, Math.max(180, board.clientWidth * 0.55));
    const scale = Math.min(1, maxWidth / naturalWidth);
    const item = {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'image',
      dataUrl,
      x: 28 + (items.length % 4) * 18,
      y: 28 + (items.length % 4) * 18,
      width: Math.round(naturalWidth * scale),
      height: Math.round(naturalHeight * scale),
    };
    items = [...items, item];
    selectedId = item.id;
    selectedIds = new Set([item.id]);
    persist();
    renderBoard();
  }

  function addShape(type) {
    record(cloneItems());
    const item = {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      x: 70 + (items.length % 4) * 24,
      y: 70 + (items.length % 4) * 24,
      width: type === 'arrow' ? 240 : 180,
      height: type === 'arrow' ? 4 : 110,
      fill: 'transparent',
      stroke: ['line', 'dashed', 'arrow', 'double-arrow'].includes(type) ? '#3d6fe8' : 'transparent',
      color: '#14213d',
      text: '',
      fontSize: 18,
      strokeWidth: type === 'arrow' || type === 'double-arrow' || type === 'line' || type === 'dashed' ? 4 : 3,
      opacity: 1,
      angle: 0,
    };
    items = [...items, item];
    selectedId = item.id;
    selectedIds = new Set([item.id]);
    persist();
    renderBoard();
  }

  function addText() {
    const text = window.prompt('输入科研图中的文字');
    if (!text?.trim()) return;
    record(cloneItems());
    const item = {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'text', x: 80, y: 80 + items.length * 18, width: 240, height: 54,
      fill: 'transparent', stroke: 'transparent', color: '#14213d', text: text.trim(), fontSize: 22, angle: 0,
      strokeWidth: 0, opacity: 1,
    };
    items = [...items, item];
    selectedId = item.id;
    persist();
    renderBoard();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneItems());
    items = undoStack.pop();
    selectedId = null;
    selectedIds.clear();
    persist();
    renderBoard();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneItems());
    items = redoStack.pop();
    selectedId = null;
    selectedIds.clear();
    persist();
    renderBoard();
  }

  function duplicateSelected() {
    const sources = items.filter((item) => selectedIds.has(item.id));
    if (!sources.length) return toast('先选中一个素材', 'info');
    record(cloneItems());
    const copies = sources.map((source) => ({ ...source, id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`, x: source.x + 24, y: source.y + 24 }));
    items = [...items, ...copies];
    selectedId = copies[0].id;
    selectedIds = new Set(copies.map((copy) => copy.id));
    persist();
    renderBoard();
  }

  function copySelected() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (!selected.length) return toast('先框选或 Shift 选中素材', 'info');
    internalClipboard = cloneItems(selected);
    toast(`已复制 ${selected.length} 个对象`, 'good');
  }

  function cutSelected() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (!selected.length) return toast('先框选或 Shift 选中素材', 'info');
    internalClipboard = cloneItems(selected);
    record(cloneItems());
    items = items.filter((item) => !selectedIds.has(item.id));
    selectedId = null;
    selectedIds.clear();
    persist();
    renderBoard();
    toast(`已剪切 ${selected.length} 个对象`, 'good');
  }

  function pasteSelected() {
    if (!internalClipboard.length) return toast('图板剪贴板为空', 'info');
    record(cloneItems());
    const copies = internalClipboard.map((item) => ({ ...item, id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`, x: item.x + 24, y: item.y + 24 }));
    items = [...items, ...copies];
    selectedId = copies[0].id;
    selectedIds = new Set(copies.map((item) => item.id));
    persist();
    renderBoard();
  }

  function startMarquee(event) {
    const boardBox = board.getBoundingClientRect();
    const startX = event.clientX - boardBox.left + board.scrollLeft;
    const startY = event.clientY - boardBox.top + board.scrollTop;
    const mark = h('div', { class: 'figureboard__marquee' });
    board.appendChild(mark);
    let area = null;
    const update = (moveEvent) => {
      const currentX = moveEvent.clientX - boardBox.left + board.scrollLeft;
      const currentY = moveEvent.clientY - boardBox.top + board.scrollTop;
      area = { x: Math.min(startX, currentX), y: Math.min(startY, currentY), width: Math.abs(currentX - startX), height: Math.abs(currentY - startY) };
      Object.assign(mark.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` });
    };
    const finish = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      mark.remove();
      if (!area || area.width < 6 || area.height < 6) return selectItem(null);
      const selected = items.filter((item) => item.x < area.x + area.width && item.x + item.width > area.x && item.y < area.y + area.height && item.y + item.height > area.y);
      selectedIds = new Set(selected.map((item) => item.id));
      selectedId = selected[0]?.id || null;
      renderBoard();
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish, { once: true });
    event.preventDefault();
  }

  function moveLayer(direction) {
    const index = items.findIndex((item) => item.id === selectedId);
    if (index < 0) return;
    const next = direction === 'top' ? items.length - 1 : direction === 'bottom' ? 0 : index + direction;
    if (next < 0 || next >= items.length || next === index) return;
    record(cloneItems());
    const copy = [...items];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    items = copy;
    persist();
    renderBoard();
  }

  function updateSelected(patch) {
    const selected = items.filter((entry) => selectedIds.has(entry.id));
    if (!selected.length) return toast('先选中一个图形或素材', 'info');
    record(cloneItems());
    selected.forEach((item) => Object.assign(item, patch));
    persist();
    renderBoard();
  }

  function rotateSelected() {
    const item = items.find((entry) => entry.id === selectedId);
    if (!item) return toast('先选中一个图形或素材', 'info');
    updateSelected({ angle: (Number(item.angle) || 0) + 15 });
  }

  function groupSelected() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (selected.length < 2) return toast('按住 Shift 选中至少两个对象', 'info');
    record(cloneItems());
    const groupId = `group-${Date.now()}`;
    selected.forEach((item) => { item.groupId = groupId; });
    persist();
    renderBoard();
  }

  function ungroupSelected() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (!selected.some((item) => item.groupId)) return;
    record(cloneItems());
    selected.forEach((item) => { delete item.groupId; });
    persist();
    renderBoard();
  }

  function alignSelected(mode) {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (selected.length < 2) return toast('按住 Shift 选中至少两个对象', 'info');
    record(cloneItems());
    const left = Math.min(...selected.map((item) => item.x));
    const right = Math.max(...selected.map((item) => item.x + item.width));
    const top = Math.min(...selected.map((item) => item.y));
    const bottom = Math.max(...selected.map((item) => item.y + item.height));
    selected.forEach((item) => {
      if (mode === 'left') item.x = left;
      if (mode === 'right') item.x = right - item.width;
      if (mode === 'top') item.y = top;
      if (mode === 'bottom') item.y = bottom - item.height;
      if (mode === 'center') item.x = Math.round((left + right - item.width) / 2);
      if (mode === 'middle') item.y = Math.round((top + bottom - item.height) / 2);
    });
    persist();
    renderBoard();
  }

  function escapeXml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function canvasSize() {
    const maxX = Math.max(board.clientWidth, ...items.map((item) => item.x + item.width + 40), 900);
    const maxY = Math.max(board.clientHeight, ...items.map((item) => item.y + item.height + 40), 650);
    return { width: Math.round(maxX), height: Math.round(maxY) };
  }

  function toSvg() {
    const { width, height } = canvasSize();
    const body = items.map((item) => {
      const transform = `translate(${item.x} ${item.y}) rotate(${item.angle || 0} ${item.width / 2} ${item.height / 2})`;
      if (item.type === 'image') return `<image href="${item.dataUrl}" x="0" y="0" width="${item.width}" height="${item.height}" preserveAspectRatio="xMidYMid meet"/>`;
      if (item.type === 'text') return `<text x="0" y="${Math.max(24, item.fontSize)}" font-family="Arial, sans-serif" font-size="${item.fontSize}" font-weight="600" fill="${item.color}">${escapeXml(item.text)}</text>`;
      if (['arrow', 'double-arrow', 'line', 'dashed'].includes(item.type)) {
        const markers = item.type === 'arrow' ? 'marker-end="url(#arrow)"' : item.type === 'double-arrow' ? 'marker-start="url(#arrow)" marker-end="url(#arrow)"' : '';
        const dash = item.type === 'dashed' ? 'stroke-dasharray="12 9"' : '';
        return `<line x1="0" y1="${(item.strokeWidth || 4) / 2}" x2="${item.width}" y2="${(item.strokeWidth || 4) / 2}" stroke="${item.stroke}" stroke-width="${item.strokeWidth || 4}" ${markers} ${dash}/>`;
      }
      const radius = item.type === 'ellipse' ? item.height / 2 : item.type === 'diamond' ? 0 : 12;
      if (item.type === 'diamond') return `<polygon points="${item.width / 2},0 ${item.width},${item.height / 2} ${item.width / 2},${item.height} 0,${item.height / 2}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="${item.strokeWidth || 0}"/>`;
      return `<rect x="0" y="0" width="${item.width}" height="${item.height}" rx="${radius}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="${item.strokeWidth || 0}"/>`;
    }).map((content, index) => `<g transform="translate(${items[index].x} ${items[index].y}) rotate(${items[index].angle || 0} ${items[index].width / 2} ${items[index].height / 2})">${content}</g>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#3d6fe8"/></marker></defs><rect width="100%" height="100%" fill="#f7f8fb"/>${body}</svg>`;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg() {
    downloadBlob(new Blob([toSvg()], { type: 'image/svg+xml' }), '科研图板.svg');
    toast('SVG 已导出', 'good');
  }

  async function exportPng() {
    const svg = toSvg();
    const { width, height } = canvasSize();
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    canvas.getContext('2d').scale(2, 2);
    canvas.getContext('2d').drawImage(image, 0, 0);
    canvas.toBlob((blob) => { if (blob) { downloadBlob(blob, '科研图板.png'); toast('PNG 已导出', 'good'); } }, 'image/png');
  }

  async function pasteImage() {
    const data = await window.toolbox.clipboard.readImage();
    if (!data?.ok) return toast(data?.error || '剪贴板里没有图片', 'info');
    try {
      const image = await compressImage(data);
      addImage(image.dataUrl, image.width, image.height);
      toast('图片已粘贴到科研图板', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function importImage() {
    const data = await window.toolbox.files.pickImage();
    if (!data || data.error) return data?.error && toast(data.error, 'bad');
    try {
      const image = await compressImage(data);
      addImage(image.dataUrl, image.width, image.height);
      toast('图片已加入科研图板', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function renderBoard() {
    board.replaceChildren();
    if (!items.length) board.appendChild(empty);
    for (const item of items) {
      let content;
      if (item.type === 'image') content = h('img', { src: item.dataUrl, alt: '科研素材', draggable: 'false' });
      else if (item.type === 'text') content = h('span', { class: 'figureboard__text' }, item.text);
      else if (['arrow', 'double-arrow', 'line', 'dashed'].includes(item.type)) content = h('span', { class: `figureboard__line${item.type === 'arrow' ? ' is-arrow' : ''}${item.type === 'double-arrow' ? ' is-double' : ''}${item.type === 'dashed' ? ' is-dashed' : ''}` });
      else content = h('span', { class: `figureboard__shape figureboard__shape--${item.type}` });
      const resize = h('span', { class: 'figureboard__resize' });
      const rotate = h('span', { class: 'figureboard__rotate', title: '旋转' });
      const element = h('div', {
        class: `figureboard__item figureboard__item--${item.type}${selectedIds.has(item.id) ? ' is-selected' : ''}`,
        dataset: { id: item.id },
        style: { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, background: ['rect', 'ellipse', 'diamond'].includes(item.type) ? 'transparent' : item.fill, borderColor: item.stroke, color: ['line', 'dashed', 'arrow', 'double-arrow'].includes(item.type) ? item.stroke : item.color, '--figure-fill': item.fill, '--figure-stroke': item.stroke, '--figure-stroke-width': `${item.strokeWidth || 0}px`, fontSize: `${item.fontSize}px`, opacity: item.opacity ?? 1, transform: `rotate(${item.angle || 0}deg)` },
        onpointerdown: (event) => startDrag(event, item, element),
        onclick: (event) => { event.stopPropagation(); selectItem(item.id); },
      }, content, resize, rotate);
      board.appendChild(element);
    }
    board.appendChild(boardHint);
  }

  function startDrag(event, item, element) {
    if (event.target.classList.contains('figureboard__resize')) return startResize(event, item, element);
    if (event.target.classList.contains('figureboard__rotate')) return startRotate(event, item, element);
    event.preventDefault();
    if (!selectedIds.has(item.id)) selectItem(item.id, event.shiftKey);
    const startX = event.clientX;
    const startY = event.clientY;
    const dragged = items.filter((entry) => selectedIds.has(entry.id));
    const origins = dragged.map((entry) => ({ item: entry, x: entry.x, y: entry.y }));
    const before = cloneItems();
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      for (const origin of origins) {
        origin.item.x = Math.max(0, Math.round((origin.x + dx) / 8) * 8);
        origin.item.y = Math.max(0, Math.round((origin.y + dy) / 8) * 8);
        const node = board.querySelector(`[data-id="${origin.item.id}"]`);
        if (node) { node.style.left = `${origin.item.x}px`; node.style.top = `${origin.item.y}px`; }
      }
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      record(before);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  function startResize(event, item, element) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = item.width;
    const startHeight = item.height;
    const before = cloneItems();
    const move = (moveEvent) => {
      item.width = Math.max(120, Math.round(startWidth + moveEvent.clientX - startX));
      item.height = Math.max(40, Math.round(startHeight + moveEvent.clientY - startY));
      element.style.width = `${item.width}px`;
      element.style.height = `${item.height}px`;
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      record(before);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  function startRotate(event, item, element) {
    event.preventDefault();
    event.stopPropagation();
    const box = element.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    const originalAngle = Number(item.angle) || 0;
    const before = cloneItems();
    const move = (moveEvent) => {
      const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
      item.angle = Math.round(originalAngle + ((angle - startAngle) * 180) / Math.PI);
      element.style.transform = `rotate(${item.angle}deg)`;
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      record(before);
      persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  function openSite(site) {
    activeSite = site;
    browserPane.removeAttribute('hidden');
    workspace.classList.add('has-browser');
    boardHint.hidden = true;
    siteViewHost.replaceChildren(h('webview', { class: 'figureboard__webview', partition: 'persist:research-figure', src: site.url, allowpopups: true }));
    for (const button of siteList.querySelectorAll('.figureboard__site-button')) button.classList.toggle('is-active', button.dataset.url === site.url);
  }

  async function addSite() {
    const name = siteName.value.trim();
    let url = siteUrl.value.trim();
    if (!name || !url) return toast('名称和网址都要填', 'info');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { return toast('网址格式不对', 'bad'); }
    if (sites.some((site) => site.url === url)) return toast('这个素材网站已经存在', 'info');
    const site = { name, url, desc: '自定义素材网站', emoji: 'globe' };
    sites = [...sites, site];
    await config.set('research.figureSites', sites.slice(DEFAULT_SITES.length));
    siteName.value = '';
    siteUrl.value = '';
    renderSites();
    openSite(site);
  }

  function renderSites() {
    siteList.replaceChildren(...sites.map((site) => h('button', {
      class: `figureboard__site-button${activeSite?.url === site.url ? ' is-active' : ''}`,
      dataset: { url: site.url },
      onclick: () => openSite(site),
    }, iconFor(site.emoji || 'globe', 'ui-icon figureboard__site-icon'), h('span', {}, h('strong', {}, site.name), h('small', {}, site.desc || site.url)))));
  }

  const siteName = h('input', { class: 'field field--sm', placeholder: '网站名称' });
  const siteUrl = h('input', { class: 'field field--sm', placeholder: 'https://素材网站…' });
  const addSiteBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: addSite }, '添加网站');
  const pasteBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: pasteImage }, '粘贴图片');
  const importBtn = h('button', { class: 'btn btn--sm', onclick: importImage }, '导入图片');
  const rectBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('rect') }, '矩形');
  const ellipseBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('ellipse') }, '圆形');
  const diamondBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('diamond') }, '菱形');
  const arrowBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('arrow') }, '箭头');
  const dashedBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('dashed') }, '虚线');
  const doubleArrowBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('double-arrow') }, '双箭头');
  const lineBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: () => addShape('line') }, '连线');
  const textBtn = h('button', { class: 'btn btn--sm figureboard__tool-btn', onclick: addText }, '文字');
  const undoBtn = h('button', { class: 'btn btn--sm', title: '撤销', onclick: undo }, '↶');
  const redoBtn = h('button', { class: 'btn btn--sm', title: '重做', onclick: redo }, '↷');
  const duplicateBtn = h('button', { class: 'btn btn--sm', onclick: duplicateSelected }, '复制');
  const layerUpBtn = h('button', { class: 'btn btn--sm', title: '上移一层', onclick: () => moveLayer(1) }, '上移');
  const layerTopBtn = h('button', { class: 'btn btn--sm', title: '置顶', onclick: () => moveLayer('top') }, '置顶');
  const rotateBtn = h('button', { class: 'btn btn--sm', title: '旋转 15°', onclick: rotateSelected }, '旋转');
  const copyBtn = h('button', { class: 'btn btn--sm', title: '复制选中对象', onclick: copySelected }, '复制对象');
  const cutBtn = h('button', { class: 'btn btn--sm', title: '剪切选中对象', onclick: cutSelected }, '剪切');
  const pasteObjectBtn = h('button', { class: 'btn btn--sm', title: '粘贴已复制的图板对象', onclick: pasteSelected }, '粘贴对象');
  const groupBtn = h('button', { class: 'btn btn--sm', title: '组合选中对象', onclick: groupSelected }, '组合');
  const ungroupBtn = h('button', { class: 'btn btn--sm', title: '取消组合', onclick: ungroupSelected }, '取消组合');
  const alignLeftBtn = h('button', { class: 'btn btn--sm', title: '左对齐', onclick: () => alignSelected('left') }, '左对齐');
  const alignCenterBtn = h('button', { class: 'btn btn--sm', title: '水平居中对齐', onclick: () => alignSelected('center') }, '居中');
  const alignTopBtn = h('button', { class: 'btn btn--sm', title: '顶端对齐', onclick: () => alignSelected('top') }, '顶对齐');
  const deleteBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: () => selectedId && removeItem(selectedId) }, '删除');
  const fillInput = h('input', { class: 'figureboard__color', type: 'color', value: '#dce8ff', title: '填充色', onchange: (event) => updateSelected({ fill: event.currentTarget.value }) });
  const strokeInput = h('input', { class: 'figureboard__color', type: 'color', value: '#3d6fe8', title: '边框色', onchange: (event) => updateSelected({ stroke: event.currentTarget.value }) });
  const strokeWidthInput = h('input', { class: 'figureboard__range', type: 'range', min: '0', max: '12', step: '1', value: '3', title: '边框/线条粗细', oninput: (event) => updateSelected({ strokeWidth: Number(event.currentTarget.value) }) });
  const opacityInput = h('input', { class: 'figureboard__range', type: 'range', min: '10', max: '100', step: '1', value: '100', title: '对象透明度', oninput: (event) => updateSelected({ opacity: Number(event.currentTarget.value) / 100 }) });
  const exportSvgBtn = h('button', { class: 'btn btn--sm', onclick: exportSvg }, '导出 SVG');
  const exportPngBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: exportPng }, '导出 PNG');
  const transparentFillBtn = h('button', { class: 'btn btn--sm', onclick: () => updateSelected({ fill: 'transparent' }) }, '透明填充');
  const transparentStrokeBtn = h('button', { class: 'btn btn--sm', onclick: () => updateSelected({ stroke: 'transparent' }) }, '无边框');
  const boardColor = h('input', { class: 'figureboard__color', type: 'color', value: config.get('research.figureBackground', '#f7f8fb'), title: '画布背景色', onchange: (event) => { board.style.backgroundColor = event.currentTarget.value; config.set('research.figureBackground', event.currentTarget.value); } });
  function toggleSources() {
    sources.classList.toggle('is-open');
    boardHint.hidden = activeSite || sources.classList.contains('is-open');
  }

  const sourcesToggle = h('button', { class: 'figureboard__sources-toggle', title: '展开/收起素材库', onclick: toggleSources }, '素材');
  const boardHint = h('button', { class: 'figureboard__board-hint', onclick: () => { sources.classList.add('is-open'); boardHint.hidden = true; } }, '素材库已收起 · 点击打开素材网站');
  const workspace = h('div', { class: 'figureboard__workspace' });

  board.addEventListener('paste', (event) => { if ([...(event.clipboardData?.items || [])].some((item) => item.type.startsWith('image/'))) { event.preventDefault(); pasteImage(); } });
  board.addEventListener('pointerdown', (event) => { if (event.target === board) startMarquee(event); });
  board.addEventListener('keydown', (event) => { if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); removeItem(selectedId); } });
  board.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
    if (event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelected(); }
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelected(); }
    if (event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
  });

  root.append(
    h('div', { class: 'bar bar--drag figureboard__bar' },
      h('strong', {}, 'PPT图板'),
      h('span', { class: 'faint' }, '单页科研图片工作台'),
      sourcesToggle,
      h('span', { class: 'figureboard__bar-spacer' }),
      h('div', { class: 'figureboard__tools' }, rectBtn, ellipseBtn, diamondBtn, arrowBtn, dashedBtn, doubleArrowBtn, lineBtn, textBtn),
      h('span', { class: 'figureboard__tool-sep' }), fillInput, strokeInput, strokeWidthInput, opacityInput, boardColor, transparentFillBtn, transparentStrokeBtn, rotateBtn, groupBtn, ungroupBtn, alignLeftBtn, alignCenterBtn, alignTopBtn, layerUpBtn, layerTopBtn, undoBtn, redoBtn, copyBtn, cutBtn, pasteObjectBtn, duplicateBtn, deleteBtn,
      h('span', { class: 'figureboard__tool-sep' }), pasteBtn, importBtn, exportSvgBtn, exportPngBtn,
    ),
    workspace,
  );
  workspace.append(
    sources,
    browserPane,
    h('section', { class: 'figureboard__board-pane' },
      h('div', { class: 'figureboard__pane-head' }, h('strong', {}, '科研图片画布'), h('span', { class: 'faint' }, '右侧粘贴 / 拖动 / 缩放')),
      board,
    ),
  );
  browserPane.append(
    h('div', { class: 'figureboard__pane-head' }, h('strong', {}, '素材浏览区'), h('span', { class: 'faint' }, '点击左侧网站打开')),
    siteViewHost,
  );
  sources.append(
    h('div', { class: 'figureboard__section-title' }, '素材网站'),
    h('div', { class: 'figureboard__site-form' }, siteName, siteUrl, addSiteBtn),
    siteList,
  );
  board.style.backgroundColor = config.get('research.figureBackground', '#f7f8fb');
  renderSites();
  renderBoard();
}
