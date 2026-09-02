import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';
import {
  SHAPES, LINES, isLine, shapeMarkup, lineMarkup, arrowDefs,
  BACKGROUNDS, backgroundDefs, PIE_COLORS,
} from './figureshapes.js';
import {
  ROUTES, PORTS, portPoint, wireMarkup, wireLabelMarkup, isWire,
  wireMidpoint as wireMidpointOf,
} from './figurewires.js';

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

  let editingId = null;                                   // 正在画布内编辑文字的对象
  let background = config.get('research.figureBg', 'white');

  function bgSpec() {
    return BACKGROUNDS[background] || BACKGROUNDS.white;
  }

  /** 把背景应用到画布 DOM（导出时另有一份，见 toSvg） */
  function applyBackground() {
    const spec = bgSpec();
    board.style.backgroundColor = spec.color || 'transparent';
    board.classList.toggle('is-grid', spec.pattern === 'grid');
    board.classList.toggle('is-dots', spec.pattern === 'dots');
    board.classList.toggle('is-transparent', !spec.color);
  }

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
    if (item?.route && typeof routeSelect !== 'undefined') routeSelect.value = item.route;
    // 锚点和连线选中态都画在连线层上，选中一变就得重画
    if (typeof renderWires === 'function') renderWires();
  }

  function removeItem(id) {
    // 连在这个图形上的线也要一起删，不然会剩下指向空气的线
    items = items.filter((entry) => !(isWire(entry)
      && (entry.from?.id === id || entry.to?.id === id)));
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
    const line = isLine(type);
    // 新建就给能看的默认样式：以前默认透明填充 + 透明描边，加进来是"隐形"的
    const item = {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      x: 70 + (items.length % 4) * 24,
      y: 70 + (items.length % 4) * 24,
      width: line ? 240 : type === 'pie' ? 200 : type === 'container' ? 320 : 180,
      height: line ? 6 : type === 'pie' ? 200 : type === 'container' ? 220 : 110,
      fill: line || type === 'container' || type === 'bracket' ? 'transparent' : '#dce8ff',
      stroke: type === 'container' ? '#7b8aa5' : '#3d6fe8',
      color: '#14213d',
      text: '',
      fontSize: 18,
      strokeWidth: line ? 4 : type === 'container' ? 2 : 2,
      radius: type === 'roundRect' ? 16 : 0,
      dash: type === 'container' ? 'dashed' : 'solid',
      slices: type === 'pie' ? 6 : undefined,
      sliceColors: type === 'pie' ? [...PIE_COLORS] : undefined,
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
    // 原来用 window.prompt —— Electron 不实现它，点"文字"完全没反应，
    // 对一张全是标注的科研图来说这个工具等于不存在。改成画布内直接编辑。
    record(cloneItems());
    const text = '';
    const item = {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'text', x: 80, y: 80 + items.length * 18, width: 240, height: 54,
      fill: 'transparent', stroke: 'transparent', color: '#14213d', text, fontSize: 22, angle: 0,
      strokeWidth: 0, opacity: 1,
    };
    items = [...items, item];
    selectedId = item.id;
    selectedIds = new Set([item.id]);
    editingId = item.id;          // 直接进入编辑态，落笔即可打字
    persist();
    renderBoard();
  }

  /** 提交画布内编辑的文字 */
  function commitText(id, value) {
    const item = items.find((entry) => entry.id === id);
    editingId = null;
    if (!item) return renderBoard();
    const next = String(value ?? '').replace(/\u00a0/g, ' ').trim();
    if (!next) {                  // 空文本没有意义，直接删掉，免得画布上留隐形块
      items = items.filter((entry) => entry.id !== id);
      selectedId = null;
      selectedIds = new Set();
    } else if (next !== item.text) {
      item.text = next;
    }
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
    const spec = bgSpec();

    // 和画布共用 shapeMarkup / lineMarkup —— 导出和屏幕上看到的必然一致
    const defs = [];
    const body = items.filter((item) => !isWire(item)).map((item) => {
      const g = (inner) => `<g transform="translate(${item.x} ${item.y}) rotate(${item.angle || 0} ${item.width / 2} ${item.height / 2})" opacity="${item.opacity ?? 1}">${inner}</g>`;

      if (item.type === 'image') {
        return g(`<image href="${item.dataUrl}" x="0" y="0" width="${item.width}" height="${item.height}" preserveAspectRatio="xMidYMid meet"/>`);
      }
      if (item.type === 'text') {
        // 逐行输出，导出的换行才和画布一致
        const lines = String(item.text || '').split('\n');
        const size = item.fontSize || 22;
        const tspans = lines.map((line, i) => `<tspan x="0" dy="${i === 0 ? 0 : size * 1.35}">${escapeXml(line)}</tspan>`).join('');
        return g(`<text x="0" y="${size}" font-family="'PingFang SC','Microsoft YaHei',Arial,sans-serif" font-size="${size}" font-weight="600" fill="${item.color}">${tspans}</text>`);
      }
      if (isLine(item.type)) {
        const markerId = `fbA${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
        defs.push(arrowDefs(item.stroke || '#3d6fe8', markerId));
        return g(lineMarkup(item, markerId));
      }
      return g(shapeMarkup(item));
    }).join('');

    // 连线也要进导出，而且和画布共用同一份路径算法
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    let wireBody = '';
    for (const wire of items.filter(isWire)) {
      const markerId = `fbW${String(wire.id).replace(/[^a-zA-Z0-9]/g, '')}`;
      defs.push(arrowDefs(wire.stroke || '#3d6fe8', markerId));
      wireBody += wireMarkup(wire, byId, { markerId }).replace(/<path class="fb-wire-hit"[^>]*\/>/g, '');
    }
    for (const wire of items.filter(isWire)) wireBody += wireLabelMarkup(wire, byId);

    const bgDef = backgroundDefs(spec.pattern);
    const bgRect = spec.color
      ? `<rect width="100%" height="100%" fill="${spec.color}"/>`
      : '';                                  // 透明背景就什么都不画，导出带 alpha
    const bgPattern = spec.pattern ? `<rect width="100%" height="100%" fill="url(#fbBg)"/>` : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `<defs>${bgDef}${defs.join('')}</defs>${bgRect}${bgPattern}${wireBody}${body}</svg>`;
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

  /** 连接线画在一整块覆盖画布的 SVG 上 —— 它们跨越任意距离，塞不进单个定位 div */
  const wireLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wireLayer.setAttribute('class', 'figureboard__wires');
  /** 连线标签单独一层，画在图形之上；线本身仍在图形之下 */
  const labelLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  labelLayer.setAttribute('class', 'figureboard__wire-labels');

  const itemById = () => new Map(items.map((entry) => [entry.id, entry]));

  function renderWires() {
    const size = canvasSize();
    wireLayer.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    wireLayer.setAttribute('width', size.width);
    wireLayer.setAttribute('height', size.height);

    const byId = itemById();
    const wires = items.filter(isWire);
    const defs = [];
    let body = '';
    for (const wire of wires) {
      const markerId = `fbW${String(wire.id).replace(/[^a-zA-Z0-9]/g, '')}`;
      defs.push(arrowDefs(wire.stroke || '#3d6fe8', markerId));
      body += wireMarkup(wire, byId, { markerId, selected: selectedIds.has(wire.id) });
    }
    labelLayer.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    labelLayer.setAttribute('width', size.width);
    labelLayer.setAttribute('height', size.height);
    labelLayer.innerHTML = wires.map((wire) => wireLabelMarkup(wire, byId)).join('');

    // 选中单个图形时，四条边上给出锚点，从锚点拖出去就是连线
    let handles = '';
    if (selectedIds.size === 1) {
      const only = byId.get([...selectedIds][0]);
      if (only && !isWire(only) && only.type !== 'text') {
        for (const port of PORTS) {
          const pt = portPoint(only, port);
          handles += `<circle class="fb-port" cx="${pt.x}" cy="${pt.y}" r="6" `
            + `data-port="${port}" data-owner="${only.id}"/>`;
        }
      }
    }
    wireLayer.innerHTML = `<defs>${defs.join('')}</defs>${body}${handles}`;
  }

  function renderBoard() {
    board.replaceChildren();
    if (!items.length) board.appendChild(empty);
    board.appendChild(wireLayer);          // 连线在底层，图形压在上面
    for (const item of items) {
      if (isWire(item)) continue;          // 连线不用定位 div，走 wireLayer
      let content;
      if (item.type === 'image') {
        content = h('img', { src: item.dataUrl, alt: '科研素材', draggable: 'false' });
      } else if (item.type === 'text') {
        content = h('span', {
          class: `figureboard__text${editingId === item.id ? ' is-editing' : ''}`,
          contenteditable: editingId === item.id ? 'true' : null,
          onblur: (event) => { if (editingId === item.id) commitText(item.id, event.currentTarget.textContent); },
          onkeydown: (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); }
            // Enter 提交、Shift+Enter 换行；输入法组合中的回车不算
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          },
        }, item.text);
      } else {
        // 形状和线条走同一份几何定义，所见即所得地对应导出的 SVG
        const markerId = `fbA${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
        const inner = isLine(item.type)
          ? `<defs>${arrowDefs(item.stroke || '#3d6fe8', markerId)}</defs>${lineMarkup(item, markerId)}`
          : shapeMarkup(item);
        content = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        content.setAttribute('class', 'figureboard__svg');
        content.setAttribute('viewBox', `0 0 ${Math.max(1, item.width)} ${Math.max(1, item.height)}`);
        content.setAttribute('width', '100%');
        content.setAttribute('height', '100%');
        content.innerHTML = inner;
      }
      const resize = h('span', { class: 'figureboard__resize' });
      const rotate = h('span', { class: 'figureboard__rotate', title: '旋转' });
      const element = h('div', {
        class: `figureboard__item figureboard__item--${item.type}${selectedIds.has(item.id) ? ' is-selected' : ''}`,
        dataset: { id: item.id },
        style: { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, background: item.type === 'image' ? item.fill : 'transparent', borderColor: 'transparent', color: ['line', 'dashed', 'arrow', 'double-arrow'].includes(item.type) ? item.stroke : item.color, '--figure-fill': item.fill, '--figure-stroke': item.stroke, '--figure-stroke-width': `${item.strokeWidth || 0}px`, fontSize: `${item.fontSize}px`, opacity: item.opacity ?? 1, transform: `rotate(${item.angle || 0}deg)` },
        onpointerdown: (event) => { if (editingId !== item.id) startDrag(event, item, element); },
        ondblclick: (event) => {
          if (item.type !== 'text') return;
          event.stopPropagation();
          editingId = item.id;
          renderBoard();
        },
        onclick: (event) => { event.stopPropagation(); selectItem(item.id); },
      }, content, resize, rotate);
      board.appendChild(element);
    }
    board.appendChild(labelLayer);
    board.appendChild(boardHint);
    renderWires();

    if (editingId) {
      const editable = board.querySelector('.figureboard__text.is-editing');
      if (editable) {
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);              // 光标落到末尾
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  /** 把浏览器坐标换成画布坐标（画布可滚动，不能直接用 clientX） */
  function boardPoint(event) {
    const rect = board.getBoundingClientRect();
    return { x: event.clientX - rect.x + board.scrollLeft, y: event.clientY - rect.y + board.scrollTop };
  }

  /** 光标下的图形（用于把线吸附到目标）。排除连线本身和正在连的源图形 */
  function shapeAt(point, excludeId) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (isWire(it) || it.id === excludeId) continue;
      if (point.x >= it.x && point.x <= it.x + it.width
        && point.y >= it.y && point.y <= it.y + it.height) return it;
    }
    return null;
  }

  /** 从某个锚点拖出一条连线 */
  function startWire(event, ownerId, port) {
    event.preventDefault();
    event.stopPropagation();
    const before = cloneItems();
    const wire = {
      id: `wire-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'wire',
      from: { id: ownerId, port },
      to: null,
      toPoint: boardPoint(event),
      route: config.get('research.figureRoute', 'elbow'),
      stroke: '#3d6fe8', strokeWidth: 2, dash: 'solid',
      arrowEnd: true, arrowStart: false, label: '', color: '#14213d', fontSize: 13,
      x: 0, y: 0, width: 0, height: 0, opacity: 1, angle: 0,
    };
    items = [...items, wire];
    renderWires();

    const move = (moveEvent) => {
      const pt = boardPoint(moveEvent);
      const hit = shapeAt(pt, ownerId);
      wire.to = hit ? { id: hit.id, port: 'auto' } : null;
      wire.toPoint = hit ? null : pt;
      renderWires();
      // 悬停到可连的图形上时给个高亮，让人知道会连上
      for (const node of board.querySelectorAll('.figureboard__item')) {
        node.classList.toggle('is-wire-target', Boolean(hit) && node.dataset.id === hit.id);
      }
    };
    const end = (upEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      for (const node of board.querySelectorAll('.is-wire-target')) node.classList.remove('is-wire-target');
      const pt = boardPoint(upEvent);
      const hit = shapeAt(pt, ownerId);
      if (!hit && Math.hypot(pt.x - portPoint(itemById().get(ownerId), port).x,
        pt.y - portPoint(itemById().get(ownerId), port).y) < 16) {
        items = items.filter((entry) => entry.id !== wire.id);   // 原地松手视为取消
        renderBoard();
        return;
      }
      record(before);
      persist();
      selectItem(wire.id);
      renderBoard();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  wireLayer.addEventListener('pointerdown', (event) => {
    const portNode = event.target.closest('.fb-port');
    if (portNode) return startWire(event, portNode.dataset.owner, portNode.dataset.port);
    const wireId = event.target.getAttribute?.('data-wire');
    if (wireId) {
      event.stopPropagation();
      selectItem(wireId, event.shiftKey);
      renderBoard();
    }
  });

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
      renderWires();       // 连线跟着图形实时走
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
      renderWires();
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

  /**
   * 关掉素材浏览区。
   * 原来只有 openSite 没有对应的关闭 —— 点开一个素材网站就再也收不回去，
   * 画布被永久挤到一边，webview 也一直挂着占资源。
   */
  function closeSite() {
    activeSite = null;
    browserPane.setAttribute('hidden', '');
    workspace.classList.remove('has-browser');
    siteViewHost.replaceChildren();          // 顺手销毁 webview，别让它在后台跑
    for (const button of siteList.querySelectorAll('.figureboard__site-button')) {
      button.classList.remove('is-active');
    }
    boardHint.hidden = sources.classList.contains('is-open');
  }

  function openSite(site) {
    if (activeSite?.url === site.url) return closeSite();   // 再点一次同一个 = 收起
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
  /** 连线标签：浮在线中点的小输入框。同样不用 window.prompt —— Electron 不支持 */
  function openWireLabel(wire) {
    document.querySelector('.figureboard__wire-label-input')?.remove();
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    const mid = wireMidpointOf(wire, byId);
    if (!mid) return;
    const input = h('input', {
      class: 'field field--sm figureboard__wire-label-input',
      value: wire.label || '',
      placeholder: '连线上的文字',
      style: { left: `${mid.x - 70}px`, top: `${mid.y - 14}px` },
      onkeydown: (event) => {
        if (event.key === 'Escape') { input.remove(); return; }
        if (event.key !== 'Enter' || event.isComposing) return;
        const before = cloneItems();
        wire.label = input.value.trim();
        record(before);
        persist();
        input.remove();
        renderBoard();
      },
      onblur: () => input.remove(),
    });
    board.appendChild(input);
    input.focus();
    input.select();
  }

  /** 图标按钮：只放图标，说明走 tooltip —— 一排中文按钮又长又难认 */
  const toolBtn = (icon, title, onClick, extra = '') => h('button', {
    class: `btn btn--sm figureboard__tool-btn ${extra}`.trim(),
    title,
    onclick: onClick,
  }, iconFor(icon, 'ui-icon figureboard__tool-icon'));

  const shapeButtons = Object.entries(SHAPES)
    .map(([type, meta]) => toolBtn(meta.icon, meta.label, () => addShape(type)));
  const lineButtons = Object.entries(LINES)
    .map(([type, meta]) => toolBtn(meta.icon, meta.label, () => addShape(type)));

  const textBtn = toolBtn('textTool', '文字（双击可再编辑）', addText);
  const undoBtn = toolBtn('undo', '撤销 (Cmd+Z)', undo);
  const redoBtn = toolBtn('redo', '重做 (Cmd+Shift+Z)', redo);
  const duplicateBtn = toolBtn('copy', '原地复制一份 (Cmd+D)', duplicateSelected);
  const copyBtn = toolBtn('copy', '复制选中对象 (Cmd+C)', copySelected);
  const cutBtn = toolBtn('cut', '剪切 (Cmd+X)', cutSelected);
  const pasteObjectBtn = toolBtn('paste', '粘贴对象 (Cmd+V)', pasteSelected);
  const layerUpBtn = toolBtn('layerUp', '上移一层', () => moveLayer(1));
  const layerTopBtn = toolBtn('layerTop', '置顶', () => moveLayer('top'));
  const rotateBtn = toolBtn('rotateCw', '旋转 15°', rotateSelected);
  const groupBtn = toolBtn('group', '组合选中对象', groupSelected);
  const ungroupBtn = toolBtn('ungroup', '取消组合', ungroupSelected);
  const alignLeftBtn = toolBtn('alignLeft', '左对齐', () => alignSelected('left'));
  const alignCenterBtn = toolBtn('alignCenterH', '水平居中对齐', () => alignSelected('center'));
  const alignTopBtn = toolBtn('alignTop', '顶端对齐', () => alignSelected('top'));
  const deleteBtn = toolBtn('trash', '删除选中', () => selectedId && removeItem(selectedId), 'figureboard__danger');
  const pasteBtn = toolBtn('image', '把剪贴板里的图片贴进画布', pasteImage);
  const importBtn = toolBtn('image', '从文件导入图片', importImage);
  const addSiteBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: addSite }, '添加网站');

  const fillInput = h('input', { class: 'figureboard__color', type: 'color', value: '#dce8ff', title: '填充色', onchange: (event) => updateSelected({ fill: event.currentTarget.value }) });
  const strokeInput = h('input', { class: 'figureboard__color', type: 'color', value: '#3d6fe8', title: '描边色', onchange: (event) => updateSelected({ stroke: event.currentTarget.value }) });
  const strokeWidthInput = h('input', { class: 'figureboard__range', type: 'range', min: '0', max: '12', step: '1', value: '2', title: '描边粗细', oninput: (event) => updateSelected({ strokeWidth: Number(event.currentTarget.value) }) });
  const radiusInput = h('input', { class: 'figureboard__range', type: 'range', min: '0', max: '60', step: '1', value: '0', title: '圆角半径', oninput: (event) => updateSelected({ radius: Number(event.currentTarget.value) }) });
  const dashSelect = h('select', { class: 'field field--sm figureboard__select', title: '描边样式', onchange: (event) => updateSelected({ dash: event.currentTarget.value }) },
    h('option', { value: 'solid' }, '实线'),
    h('option', { value: 'dashed' }, '虚线'),
    h('option', { value: 'dotted' }, '点线'),
  );
  const routeSelect = h('select', { class: 'field field--sm figureboard__select', title: '连接线走向（选中连线可改，也决定新连线的默认）', onchange: (event) => { config.set('research.figureRoute', event.currentTarget.value); updateSelected({ route: event.currentTarget.value }); } },
    ...Object.entries(ROUTES).map(([key, meta]) => h('option', { value: key }, meta.label)));
  const arrowEndBtn = toolBtn('lineArrow', '这条连线的箭头开关', () => {
    const wire = items.find((entry) => selectedIds.has(entry.id) && isWire(entry));
    if (!wire) return toast('先选中一条连线', 'info');
    updateSelected({ arrowEnd: !(wire.arrowEnd !== false) });
  });
  const wireLabelBtn = toolBtn('wireLabel', '给选中的连线加/改文字', () => {
    const wire = items.find((entry) => selectedIds.has(entry.id) && isWire(entry));
    if (!wire) return toast('先选中一条连线', 'info');
    openWireLabel(wire);
  });

  const sliceInput = h('input', { class: 'figureboard__range', type: 'range', min: '2', max: '12', step: '1', value: '6', title: '饼图扇区数', oninput: (event) => updateSelected({ slices: Number(event.currentTarget.value) }) });
  const transparentFillBtn = h('button', { class: 'btn btn--sm', title: '去掉填充', onclick: () => updateSelected({ fill: 'transparent' }) }, '无填充');
  const transparentStrokeBtn = h('button', { class: 'btn btn--sm', title: '去掉描边', onclick: () => updateSelected({ stroke: 'transparent' }) }, '无描边');

  const bgSelect = h('select', { class: 'field field--sm figureboard__select', title: '画布背景', onchange: (event) => { background = event.currentTarget.value; config.set('research.figureBg', background); applyBackground(); } },
    ...Object.entries(BACKGROUNDS).map(([key, meta]) => h('option', { value: key }, meta.label)));

  const exportSvgBtn = h('button', { class: 'btn btn--sm', title: '矢量，投稿和 LaTeX 用这个', onclick: exportSvg }, 'SVG');
  const exportPngBtn = h('button', { class: 'btn btn--sm btn--primary', title: '位图，贴进 PPT / Word', onclick: exportPng }, 'PNG');

  const opacityInput = h('input', { class: 'figureboard__range', type: 'range', min: '10', max: '100', step: '1', value: '100', title: '对象透明度', oninput: (event) => updateSelected({ opacity: Number(event.currentTarget.value) / 100 }) });
  function toggleSources() {
    const opening = !sources.classList.contains('is-open');
    sources.classList.toggle('is-open', opening);
    // 收起素材库时把浏览区一并收掉，否则画布仍被挤在一边
    if (!opening && activeSite) closeSite();
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
      h('div', { class: 'figureboard__tools' },
        h('div', { class: 'figureboard__group', title: '形状' }, ...shapeButtons),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '连线与文字' }, ...lineButtons, textBtn, routeSelect, arrowEndBtn, wireLabelBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '样式' },
          fillInput, strokeInput, transparentFillBtn, transparentStrokeBtn,
          dashSelect, strokeWidthInput, radiusInput, sliceInput, opacityInput),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '排列' },
          alignLeftBtn, alignCenterBtn, alignTopBtn, groupBtn, ungroupBtn,
          layerUpBtn, layerTopBtn, rotateBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '编辑' },
          undoBtn, redoBtn, copyBtn, cutBtn, pasteObjectBtn, duplicateBtn, deleteBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '画布与导出' },
          pasteBtn, importBtn, iconFor('canvasBg', 'ui-icon figureboard__tool-icon'), bgSelect, exportSvgBtn, exportPngBtn),
      ),
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
    h('div', { class: 'figureboard__pane-head' },
      h('strong', {}, '素材浏览区'),
      h('span', { class: 'faint' }, '再点一次同一个网站也能收起'),
      h('span', { class: 'figureboard__bar-spacer' }),
      h('button', { class: 'btn btn--sm btn--ghost', title: '收起素材浏览区，把画布还回来', onclick: closeSite }, '收起 ✕'),
    ),
    siteViewHost,
  );
  sources.append(
    h('div', { class: 'figureboard__section-title' }, '素材网站'),
    h('div', { class: 'figureboard__site-form' }, siteName, siteUrl, addSiteBtn),
    siteList,
  );
  bgSelect.value = background;
  applyBackground();
  renderSites();
  renderBoard();
}
