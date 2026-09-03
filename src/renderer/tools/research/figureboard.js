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
import { FIGURE_ASSETS, FIGURE_SOURCE_LINKS } from './figureassets.js';

const DEFAULT_SITES = [
  { name: 'BioRender', url: 'https://www.biorender.com/', desc: '生命科学插图素材', emoji: '🧬' },
  { name: 'Mind the Graph', url: 'https://mindthegraph.com/', desc: '科研图形摘要', emoji: '📊' },
  { name: 'diagrams.net', url: 'https://app.diagrams.net/', desc: '架构图 / 流程图', emoji: '🔷' },
  { name: 'Excalidraw', url: 'https://excalidraw.com/', desc: '手绘风图示', emoji: '✏️' },
  { name: 'Figma', url: 'https://www.figma.com/', desc: '界面与矢量设计', emoji: '◈' },
  ...FIGURE_SOURCE_LINKS,
];

const MAX_IMAGE_EDGE = 2400;
const AI_DRAWING_URL = 'https://chatgpt.com/';
const AI_PROMPT_PRESETS = [
  { id: 'pixel-person', label: '像素风人物', prompt: '科研图板素材：一个单独的像素风研究员人物，半身，正面，干净轮廓，有限配色，透明背景，无文字，无阴影，适合作为科研流程图 icon。' },
  { id: 'pixel-tool', label: '像素风工具', prompt: '科研图板素材：一个单独的像素风实验室工具图标（试管、烧杯和小型传感器组合），正面，清晰像素边缘，透明背景，无文字，适合作为科研流程图节点。' },
  { id: 'realistic-device', label: '真实风格设备', prompt: '科研图板素材：一个单独的真实风格科研仪器，棚拍产品视图，柔和均匀光线，边缘清晰，透明背景，无文字，无 logo，适合论文配图。' },
  { id: 'flat-icon', label: '扁平科研图标', prompt: '科研图板素材：一个单独的现代扁平矢量科研图标，主题是数据分析与神经网络，蓝绿色配色，透明背景，无文字，无渐变，适合论文图示。' },
  { id: 'medical-illustration', label: '医学插图', prompt: '科研图板素材：一个单独的医学科研插图元素，主题是细胞与分子结构，简洁准确，白色和蓝绿色配色，透明背景，无文字，适合论文流程图。' },
];

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
  const localAssetList = h('div', { class: 'figureboard__asset-list' });
  const sources = h('aside', { class: 'figureboard__sources' });
  const browserPane = h('section', { class: 'figureboard__browser', hidden: true });
  const browserTitle = h('strong', {}, '素材浏览区');
  const browserHint = h('span', { class: 'faint' }, '再点一次同一个网站也能收起');
  const board = h('div', { class: 'figureboard__canvas', tabindex: '0' });
  const contextMenu = h('div', { class: 'figureboard__context-menu', hidden: true });
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
  let customAssets = config.get('research.figureCustomAssets') || [];
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
    board.style.backgroundImage = spec.pattern || !spec.color ? '' : 'none';
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
    if (item && typeof effectSelect !== 'undefined') effectSelect.value = item.effect || 'none';
    if (item && typeof fontSelect !== 'undefined') fontSelect.value = item.fontFamily || 'Arial, Helvetica, sans-serif';
    if (item && typeof curveBendInput !== 'undefined') curveBendInput.value = String(item.curveBend ?? 0);
    if (item?.route && typeof routeSelect !== 'undefined') routeSelect.value = item.route;
    if (item && typeof arrowStyleSelect !== 'undefined') arrowStyleSelect.value = item.arrowStyle || 'standard';
    // 锚点和连线选中态都画在连线层上，选中一变就得重画
    if (typeof renderWires === 'function') renderWires();
  }

  function closeContextMenu() {
    contextMenu.setAttribute('hidden', '');
  }

  function contextAction(label, action, disabled = false) {
    return h('button', {
      class: 'figureboard__context-action',
      disabled,
      onclick: () => { closeContextMenu(); action(); },
    }, label);
  }

  function openContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target.closest?.('.figureboard__item');
    if (target) {
      const id = target.dataset.id;
      if (!selectedIds.has(id)) selectItem(id);
    }
    const hasSelection = selectedIds.size > 0;
    const hasMultiple = selectedIds.size > 1;
    contextMenu.replaceChildren(
      h('div', { class: 'figureboard__context-title' }, target ? '对象操作' : '画布操作'),
      h('div', { class: 'figureboard__context-group' },
        contextAction('上移一层', () => moveLayer(1), !hasSelection),
        contextAction('置顶', () => moveLayer('top'), !hasSelection),
        contextAction('下移一层', () => moveLayer(-1), !hasSelection),
        contextAction('置底', () => moveLayer('bottom'), !hasSelection),
      ),
      h('div', { class: 'figureboard__context-group' },
        contextAction('组合选中对象', groupSelected, !hasMultiple),
        contextAction('取消组合', ungroupSelected, !hasSelection),
        contextAction('复制选中对象', duplicateSelected, !hasSelection),
        contextAction('删除选中对象', () => selectedId && removeItem(selectedId), !hasSelection),
      ),
      h('div', { class: 'figureboard__context-group' },
        contextAction('添加矩形', () => addShape('rect')),
        contextAction('添加文字', addText),
        contextAction('粘贴图片', pasteImage),
      ),
    );
    contextMenu.removeAttribute('hidden');
    const margin = 8;
    const menuWidth = 190;
    const menuHeight = contextMenu.offsetHeight || 300;
    const left = Math.min(event.clientX, window.innerWidth - menuWidth - margin);
    const top = Math.min(event.clientY, window.innerHeight - menuHeight - margin);
    contextMenu.style.left = `${Math.max(margin, left)}px`;
    contextMenu.style.top = `${Math.max(margin, top)}px`;
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
      effect: 'none',
    };
    items = [...items, item];
    selectedId = item.id;
    selectedIds = new Set([item.id]);
    persist();
    renderBoard();
  }

  function addAsset(asset) {
    addImage(asset.dataUrl, asset.width, asset.height);
    toast(`已加入素材：${asset.label}`, 'good');
  }

  async function saveAsCustomAsset(image) {
    const name = assetNameInput.value.trim() || `科研素材 ${customAssets.length + 1}`;
    const category = assetCategoryInput.value.trim() || '我的素材';
    const asset = {
      id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: name,
      category,
      width: image.width,
      height: image.height,
      dataUrl: image.dataUrl,
      source: '用户导入 / 网页版 AI 绘图',
      custom: true,
    };
    customAssets = [...customAssets, asset];
    await config.set('research.figureCustomAssets', customAssets);
    assetNameInput.value = '';
    renderLocalAssets();
    addAsset(asset);
    toast(`已保存到我的素材包：${asset.label}`, 'good', 4500);
  }

  async function saveClipboardAsAsset() {
    const data = await window.toolbox.clipboard.readImage();
    if (!data?.ok) return toast(data?.error || '剪贴板里没有图片', 'info');
    try {
      await saveAsCustomAsset(await compressImage(data));
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function importAsAsset() {
    const data = await window.toolbox.files.pickImage();
    if (!data || data.error) return data?.error && toast(data.error, 'bad');
    try {
      await saveAsCustomAsset(await compressImage(data));
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function removeCustomAsset(id) {
    customAssets = customAssets.filter((asset) => asset.id !== id);
    await config.set('research.figureCustomAssets', customAssets);
    renderLocalAssets();
    toast('已从我的素材包移除', 'good');
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
      effect: 'none',
      angle: 0,
    };
    items = [...items, item];
    selectedId = item.id;
    selectedIds = new Set([item.id]);
    persist();
    renderBoard();
  }

  function presetShape(type, props = {}) {
    const line = isLine(type);
    return {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      x: 0, y: 0,
      width: line ? 160 : type === 'container' ? 860 : 180,
      height: line ? 6 : type === 'container' ? 300 : 100,
      fill: line || type === 'container' ? 'transparent' : '#e8f0ff',
      stroke: type === 'container' ? '#6e809f' : '#3d6fe8',
      color: '#14213d',
      text: '',
      fontSize: 18,
      strokeWidth: line ? 3 : type === 'container' ? 2 : 3,
      arrowStyle: 'standard',
      radius: type === 'roundRect' ? 16 : 0,
      dash: type === 'container' ? 'dashed' : 'solid',
      opacity: 1,
      effect: 'none',
      angle: 0,
      ...props,
    };
  }

  function presetText(text, x, y, props = {}) {
    return presetShape('text', {
      x, y, width: props.width || 210, height: props.height || 42,
      color: props.color || '#14213d', fontSize: props.fontSize || 20, text,
      fontFamily: props.fontFamily || 'Arial, Helvetica, sans-serif',
      fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
      ...props,
    });
  }

  function presetImage(asset, x, y, width = 72, height = 72, props = {}) {
    return {
      id: `figure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'image', dataUrl: asset.dataUrl, x, y, width, height,
      fill: 'transparent', stroke: 'transparent', opacity: 1, effect: 'none', angle: 0, ...props,
    };
  }

  function presetWire(from, to, props = {}) {
    return presetShape('wire', {
      from: { id: from, port: 'right' },
      to: { id: to, port: 'left' },
      toPoint: null, x: 0, y: 0, width: 0, height: 0,
      fill: 'transparent', stroke: '#1d2738', strokeWidth: 1.7,
      arrowEnd: true, arrowStart: false, route: 'straight', curveBend: 0, label: '',
      arrowStyle: 'standard',
      ...props,
    });
  }

  function buildPreset(kind, offset = 0) {
    const title = kind === 'pipeline' ? '研究流程图' : kind === 'architecture' ? '模型架构图' : kind === 'experiment' ? '实验对比图' : kind === 'paper-architecture' ? '论文架构图 · Data Prune / Collaborative Structure / Semantic Fusion' : kind === 'agentarchive' ? 'Agent Archive 发现与迭代' : 'AgentSquare 模块化智能体框架';
    if (kind === 'agentarchive') {
      const agentAsset = FIGURE_ASSETS.find((asset) => asset.id === 'agent-square');
      const eagleAsset = FIGURE_ASSETS.find((asset) => asset.id === 'eagle-solid');
      const moduleAsset = FIGURE_ASSETS.find((asset) => asset.id === 'module-pool');
      const memoryAsset = FIGURE_ASSETS.find((asset) => asset.id === 'memory-node');
      const frame = presetShape('container', { x: 35 + offset, y: 55 + offset, width: 1000, height: 420, fill: '#fff', stroke: '#17202f', strokeWidth: 2.5, radius: 22, effect: 'soft' });
      const meta = presetShape('roundRect', { x: 70 + offset, y: 115 + offset, width: 190, height: 78, fill: '#fff', stroke: '#18334b', strokeWidth: 2, radius: 14, effect: 'lift' });
      const archive = presetShape('roundRect', { x: 355 + offset, y: 225 + offset, width: 220, height: 82, fill: '#fff', stroke: '#31566e', strokeWidth: 2, radius: 14, effect: 'lift' });
      const note = presetShape('container', { x: 700 + offset, y: 85 + offset, width: 290, height: 115, fill: '#fafafa', stroke: '#9aa4ad', strokeWidth: 1.5, radius: 8, dash: 'dashed', effect: 'soft' });
      const examples = presetShape('container', { x: 85 + offset, y: 320 + offset, width: 900, height: 130, fill: '#fff', stroke: '#b8c0c7', strokeWidth: 1.5, radius: 10, effect: 'soft' });
      const cardA = presetShape('roundRect', { x: 105 + offset, y: 340 + offset, width: 250, height: 90, fill: '#f8fbff', stroke: '#527b98', strokeWidth: 1.5, radius: 12 });
      const cardB = presetShape('roundRect', { x: 390 + offset, y: 340 + offset, width: 250, height: 90, fill: '#f8fcf9', stroke: '#4b8d78', strokeWidth: 1.5, radius: 12 });
      const cardC = presetShape('roundRect', { x: 675 + offset, y: 340 + offset, width: 250, height: 90, fill: '#fffaf3', stroke: '#b58145', strokeWidth: 1.5, radius: 12 });
      return [frame, presetText(title, 55 + offset, 10 + offset, { width: 520, fontSize: 24, color: '#17202f' }), presetText('Next interesting agent', 355 + offset, 25 + offset, { width: 250, fontSize: 15, color: '#17202f' }),
        meta, archive, note, examples, cardA, cardB, cardC,
        presetImage(agentAsset, 135 + offset, 130 + offset, 45, 45), presetImage(eagleAsset, 420 + offset, 240 + offset, 38, 38), presetImage(moduleAsset, 175 + offset, 352 + offset, 32, 32), presetImage(agentAsset, 460 + offset, 352 + offset, 32, 32), presetImage(memoryAsset, 745 + offset, 352 + offset, 32, 32),
        presetText('Meta Agent', 110 + offset, 165 + offset, { width: 145, fontSize: 19 }), presetText('Agent Archive', 390 + offset, 275 + offset, { width: 180, fontSize: 19 }), presetText('New Agent', 620 + offset, 160 + offset, { width: 150, fontSize: 19 }),
        presetText('Summary and motivation:\n“Based on previous agents …”\nName: Divide and Conquer Agent\nCode: def forward(Task): …', 715 + offset, 105 + offset, { width: 250, height: 90, fontSize: 11 }),
        presetText('Multi-step Peer Review Agent', 125 + offset, 432 + offset, { width: 210, fontSize: 11 }), presetText('Verified Multimodal Agent', 410 + offset, 432 + offset, { width: 210, fontSize: 11 }), presetText('Divide and Conquer Agent', 695 + offset, 432 + offset, { width: 210, fontSize: 11 }),
        presetWire(meta.id, archive.id, { stroke: '#15202d', strokeWidth: 2.3, route: 'straight', from: { id: meta.id, port: 'bottom' }, to: { id: archive.id, port: 'left' } }), presetWire(archive.id, note.id, { stroke: '#26384b', strokeWidth: 1.6, route: 'elbow', from: { id: archive.id, port: 'right' }, to: { id: note.id, port: 'bottom' } }), presetShape('arrow', { x: 160 + offset, y: 85 + offset, width: 680, height: 4, fill: 'transparent', stroke: '#15202d', strokeWidth: 2.5, arrowEnd: true, dash: 'solid' }), presetWire(meta.id, meta.id, { stroke: '#1e6585', strokeWidth: 2.8, route: 'curve', curveBend: 18, from: { id: meta.id, port: 'top' }, to: { id: meta.id, port: 'right' } }),
        presetText('Input', 235 + offset, 210 + offset, { width: 70, fontSize: 14 }), presetText('Test performance on tasks\nand add to archive', 575 + offset, 245 + offset, { width: 220, fontSize: 13 }), presetText('Refine until novel\nand error-free', 265 + offset, 100 + offset, { width: 160, fontSize: 13 }), presetText('Examples of Discovered Agents', 400 + offset, 450 + offset, { width: 300, fontSize: 15, color: '#17202f' })];
    }
    if (kind === 'agentsquare') {
      const eagleAsset = FIGURE_ASSETS.find((asset) => asset.id === 'eagle-solid');
      const agentAsset = FIGURE_ASSETS.find((asset) => asset.id === 'agent-square');
      const moduleAsset = FIGURE_ASSETS.find((asset) => asset.id === 'module-pool');
      const memoryAsset = FIGURE_ASSETS.find((asset) => asset.id === 'memory-node');
      const frame = presetShape('container', { x: 20 + offset, y: 65 + offset, width: 1000, height: 420, fill: '#fffaf0', stroke: '#152b59', strokeWidth: 3, radius: 28, dash: 'solid', effect: 'soft' });
      const pie = presetShape('pie', { x: 48 + offset, y: 145 + offset, width: 190, height: 190, slices: 6, stroke: '#354b86', strokeWidth: 2, effect: 'soft', sliceColors: ['#d5e7ff', '#f7d5df', '#d8f0d7', '#f8e1b6', '#dcd3f2', '#ccebee'] });
      const pool = presetShape('roundRect', { x: 480 + offset, y: 190 + offset, width: 145, height: 120, fill: '#d7e7ff', stroke: '#2b66d9', strokeWidth: 3, radius: 18, effect: 'glow' });
      const stackBack = presetShape('roundRect', { x: 290 + offset, y: 152 + offset, width: 150, height: 174, fill: '#f4f6fa', stroke: '#7b8799', strokeWidth: 1.5, radius: 14, angle: -2, effect: 'soft' });
      const stackMid = presetShape('roundRect', { x: 302 + offset, y: 144 + offset, width: 150, height: 174, fill: '#fafbfc', stroke: '#68768a', strokeWidth: 1.5, radius: 14, angle: 1, effect: 'soft' });
      const stackFront = presetShape('roundRect', { x: 314 + offset, y: 136 + offset, width: 150, height: 174, fill: '#fff', stroke: '#152b59', strokeWidth: 2, radius: 14, effect: 'lift' });
      const evaluation = presetShape('container', { x: 745 + offset, y: 80 + offset, width: 250, height: 105, fill: '#fffdf8', stroke: '#33466d', strokeWidth: 2, radius: 18, dash: 'dashed', effect: 'soft' });
      const cardA = presetShape('roundRect', { x: 650 + offset, y: 270 + offset, width: 105, height: 155, fill: '#fff', stroke: '#3e66b3', strokeWidth: 2, radius: 16, effect: 'soft' });
      const cardB = presetShape('roundRect', { x: 775 + offset, y: 270 + offset, width: 105, height: 155, fill: '#fff', stroke: '#7657a8', strokeWidth: 2, radius: 16, effect: 'soft' });
      const cardC = presetShape('roundRect', { x: 900 + offset, y: 270 + offset, width: 105, height: 155, fill: '#fff', stroke: '#c7833d', strokeWidth: 2, radius: 16, effect: 'soft' });
      return [frame, presetText(title, 60 + offset, 38 + offset, { width: 650, fontSize: 25, color: '#152b59' }),
        presetText('Diverse agents', 75 + offset, 90 + offset, { fontSize: 15 }), presetText('Standardized agents', 285 + offset, 90 + offset, { fontSize: 15 }), presetText('Module pool', 495 + offset, 125 + offset, { fontSize: 15 }),
        presetText('Agent Square', 660 + offset, 210 + offset, { width: 130, fontSize: 15 }), presetText('Evaluation', 840 + offset, 100 + offset, { fontSize: 15 }),
        pie, stackBack, stackMid, stackFront, pool, evaluation, cardA, cardB, cardC,
        presetShape('triangle', { x: 338 + offset, y: 176 + offset, width: 28, height: 28, fill: '#fff', stroke: '#152b59', strokeWidth: 1.5 }), presetShape('diamond', { x: 385 + offset, y: 214 + offset, width: 28, height: 28, fill: '#fff', stroke: '#152b59', strokeWidth: 1.5 }), presetShape('rect', { x: 338 + offset, y: 255 + offset, width: 28, height: 28, fill: '#fff', stroke: '#152b59', strokeWidth: 1.5 }), presetShape('ellipse', { x: 387 + offset, y: 258 + offset, width: 28, height: 28, fill: '#fff', stroke: '#152b59', strokeWidth: 1.5 }),
        presetImage(agentAsset, 80 + offset, 155 + offset, 34, 34), presetImage(eagleAsset, 185 + offset, 170 + offset, 28, 28), presetImage(memoryAsset, 105 + offset, 275 + offset, 28, 28),
        presetImage(moduleAsset, 335 + offset, 175 + offset, 42, 42), presetImage(agentAsset, 375 + offset, 245 + offset, 40, 40), presetImage(moduleAsset, 505 + offset, 210 + offset, 52, 52), presetImage(agentAsset, 660 + offset, 135 + offset, 64, 64), presetImage(agentAsset, 665 + offset, 290 + offset, 48, 48), presetImage(eagleAsset, 790 + offset, 290 + offset, 48, 48), presetImage(memoryAsset, 915 + offset, 290 + offset, 48, 48),
        presetText('Game\nVoyager  ·  DEPS', 72 + offset, 195 + offset, { width: 160, fontSize: 11 }), presetText('Simulation', 190 + offset, 225 + offset, { fontSize: 11 }), presetText('Tool use', 68 + offset, 255 + offset, { fontSize: 11 }), presetText('Self-driving', 165 + offset, 340 + offset, { fontSize: 11 }), presetText('General-purpose\nReasoning', 68 + offset, 375 + offset, { width: 160, fontSize: 11 }),
        presetText('Planning  ·  Reasoning\nTooluse  ·  Memory', 330 + offset, 285 + offset, { width: 140, fontSize: 11 }), presetText('🙂  😐  ☹️', 765 + offset, 130 + offset, { width: 200, fontSize: 12 }), presetText('Planning', 655 + offset, 360 + offset, { fontSize: 11 }), presetText('Reasoning', 780 + offset, 360 + offset, { fontSize: 11 }), presetText('Memory', 905 + offset, 360 + offset, { fontSize: 11 }),
        presetWire(pie.id, stackFront.id, { stroke: '#182234', strokeWidth: 2.6, route: 'straight' }), presetWire(stackFront.id, pool.id, { stroke: '#40506b', strokeWidth: 2.1, route: 'straight' }), presetWire(pool.id, cardA.id, { stroke: '#2b66d9', strokeWidth: 3, route: 'straight' }), presetWire(cardA.id, cardB.id, { stroke: '#4a5870', strokeWidth: 1.8, route: 'straight' }), presetWire(cardB.id, cardC.id, { stroke: '#4a5870', strokeWidth: 1.4, route: 'straight' }),
        presetText('△ Planning    ◇ Reasoning    □ Tooluse    ○ Memory', 300 + offset, 450 + offset, { width: 680, fontSize: 12, color: '#152b59' })];
    }
    if (kind === 'paper-architecture') {
      const green = '#3d7837';
      const greenLine = '#82b56e';
      const blue = '#3e6f9e';
      const blueLine = '#6d91b5';
      const orange = '#e67f43';
      const orangeLine = '#efa16f';
      const ink = '#263238';
      const softInk = '#68727d';
      const paleGreen = '#f3faef';
      const paleBlue = '#edf5fc';
      const paleOrange = '#fff5ec';
      const objects = [];
      const add = (item) => { objects.push(item); return item; };
      const box = (type, props) => add(presetShape(type, props));
      const text = (value, x, y, props = {}) => add(presetText(value, x + offset, y + offset, {
        fontFamily: props.fontFamily || 'Arial, Helvetica, sans-serif',
        ...props,
      }));
      const wire = (from, to, props = {}) => add(presetWire(from.id, to.id, {
        route: props.route || 'elbow',
        from: { id: from.id, port: props.fromPort || 'auto' },
        to: { id: to.id, port: props.toPort || 'auto' },
        stroke: props.stroke || '#71808b',
        strokeWidth: props.strokeWidth || 1.8,
        dash: props.dash || 'solid',
        label: props.label || '',
        arrowStyle: props.arrowStyle || 'standard',
        ...props,
      }));
      const X = (value) => value + offset;

      box('container', { x: X(22), y: X(34), width: 1500, height: 720, fill: '#ffffff', stroke: '#cbd4dc', strokeWidth: 2, radius: 18, dash: 'solid', effect: 'soft' });
      text('Data\nPrune', 54, 62, { width: 120, height: 66, fontSize: 24, color: green, fontFamily: 'Georgia, Times New Roman, serif' });
      text('Collaborative Structure', 570, 62, { width: 330, fontSize: 24, color: blue, fontFamily: 'Georgia, Times New Roman, serif' });
      text('Semantic fusion', 1115, 62, { width: 260, fontSize: 24, color: orange, fontFamily: 'Georgia, Times New Roman, serif' });

      const dataset = box('cylinder', { x: X(118), y: X(92), width: 300, height: 62, fill: '#ffffff', stroke: green, strokeWidth: 2.2 });
      text('▤  Full Dataset U', 174, 111, { width: 190, fontSize: 17, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      const zeroShot = box('roundRect', { x: X(42), y: X(172), width: 134, height: 74, fill: '#dceeff', stroke: '#4d86b4', strokeWidth: 2, radius: 12 });
      text('❄  Zero-shot\nLLM', 56, 187, { width: 108, height: 48, fontSize: 15, color: ink });
      const topK = box('capsule', { x: X(153), y: X(174), width: 230, height: 40, fill: '#dff1d4', stroke: greenLine, strokeWidth: 2 });
      text('Candidate Top-K selection', 172, 185, { width: 190, fontSize: 14, color: '#456238' });
      const pool = box('capsule', { x: X(183), y: X(225), width: 170, height: 40, fill: '#e6f7dd', stroke: greenLine, strokeWidth: 2 });
      text('Candidate Pool', 206, 236, { width: 125, fontSize: 14, color: '#456238' });
      const surrogate = box('roundRect', { x: X(418), y: X(172), width: 124, height: 74, fill: '#e5f3dc', stroke: greenLine, strokeWidth: 2, radius: 12 });
      text('◈\nSurrogate Model', 430, 181, { width: 100, height: 54, fontSize: 14, color: ink });
      const effort = box('roundRect', { x: X(52), y: X(300), width: 110, height: 44, fill: '#f1f3f5', stroke: '#aab3b9', strokeWidth: 1.5, radius: 10 });
      text('Effort\nScore Eᵤ', 63, 306, { width: 88, height: 32, fontSize: 13, color: ink });
      const influence = box('roundRect', { x: X(420), y: X(300), width: 126, height: 44, fill: '#f1f3f5', stroke: '#aab3b9', strokeWidth: 1.5, radius: 10 });
      text('Influence\nScore Iᵤ', 435, 306, { width: 98, height: 32, fontSize: 13, color: ink });
      const normalize = box('roundRect', { x: X(147), y: X(291), width: 242, height: 62, fill: '#f3f5f6', stroke: '#aab3b9', strokeWidth: 1.7, radius: 18 });
      text('Min-Max Normalization\n& Linear Combo λ', 171, 301, { width: 195, height: 40, fontSize: 15, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      text('Sorted Queue by Quality Qᵤ', 146, 364, { width: 250, fontSize: 13, color: softInk, fontFamily: 'Georgia, Times New Roman, serif' });

      const pruneGroup = box('container', { x: X(38), y: X(388), width: 510, height: 312, fill: '#fbfff9', stroke: greenLine, strokeWidth: 2, radius: 16, dash: 'dashed' });
      const truncate = box('roundRect', { x: X(58), y: X(429), width: 216, height: 190, fill: paleGreen, stroke: greenLine, strokeWidth: 1.8, radius: 18 });
      const tail = box('roundRect', { x: X(294), y: X(429), width: 234, height: 190, fill: '#fff9e9', stroke: '#e0b454', strokeWidth: 1.8, radius: 18 });
      text('Structure-aware\nAdaptive Data Prune', 57, 663, { width: 300, height: 34, fontSize: 15, color: green });
      text('Dynamic Truncation', 82, 445, { width: 170, fontSize: 16, color: '#638b52' });
      text('Cumulative Quality\nThreshold γ', 88, 480, { width: 140, height: 40, fontSize: 12, color: '#638b52', fontFamily: 'Georgia, Times New Roman, serif' });
      text('✂  Truncation point', 83, 535, { width: 160, fontSize: 13, color: '#638b52' });
      text('▥\nTruncate TOP T\nHigh-value\nUsers', 100, 555, { width: 150, height: 68, fontSize: 14, color: '#638b52' });
      text('CV-aware Tail Sampling', 310, 445, { width: 205, fontSize: 16, color: '#c18a00' });
      text('Long-Tail Users Pool', 327, 480, { width: 170, fontSize: 12, color: '#c18a00', fontFamily: 'Georgia, Times New Roman, serif' });
      text('▥  Data Bins     ◇ CV Calculator', 309, 520, { width: 210, fontSize: 13, color: '#c18a00' });
      text('Adaptive Sampling Rate ρᵦ', 310, 557, { width: 205, fontSize: 13, color: '#c18a00', fontFamily: 'Georgia, Times New Roman, serif' });
      text('Randomly Sampling Long-Tail Users', 307, 595, { width: 220, fontSize: 12, color: '#c18a00' });
      const coreset = box('roundRect', { x: X(153), y: X(630), width: 230, height: 36, fill: '#eef0ed', stroke: '#9aa49c', strokeWidth: 1.4, radius: 12 });
      text('▤  Adaptive Pruned Coreset S', 169, 639, { width: 200, fontSize: 13, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });

      const prompt = box('roundRect', { x: X(570), y: X(94), width: 770, height: 92, fill: '#f4f4f3', stroke: '#9b9d9c', strokeWidth: 1.6, radius: 14, dash: 'dashed' });
      text('▤  Discrete Prompts T_disc', 598, 104, { width: 310, fontSize: 16, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      text('#Question: A user has given high ratings to the following movies: <ItemTitleList>.\nAdditionally, we have …… in the feature <UserID>……<TargetItemTitle> with the feature <TargetItemID>?\nAnswer with “Yes” or “No”.', 590, 132, { width: 710, height: 44, fontSize: 12, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });

      const lowerGroup = box('container', { x: X(568), y: X(210), width: 465, height: 178, fill: paleBlue, stroke: blueLine, strokeWidth: 2, radius: 16, dash: 'dashed' });
      text('Lower Branch', 584, 221, { width: 160, fontSize: 18, color: blue });
      const teacher = box('roundRect', { x: X(598), y: X(252), width: 170, height: 60, fill: '#d7edff', stroke: '#4d8fc5', strokeWidth: 1.7, radius: 12 });
      const student = box('roundRect', { x: X(598), y: X(326), width: 170, height: 60, fill: '#d7edff', stroke: '#4d8fc5', strokeWidth: 1.7, radius: 12 });
      text('❄  Teacher\nLLM', 620, 263, { width: 125, height: 40, fontSize: 15, color: ink });
      text('❄  Student\nLLM', 620, 337, { width: 125, height: 40, fontSize: 15, color: ink });
      const distill = box('roundRect', { x: X(831), y: X(288), width: 128, height: 58, fill: '#ffffff', stroke: '#526170', strokeWidth: 1.6, radius: 11 });
      text('MSE Loss\nL_distill', 849, 298, { width: 92, height: 38, fontSize: 14, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      text('Teacher\nLogits O_T', 775, 253, { width: 78, height: 38, fontSize: 12, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      text('Student\nLogits O_S', 775, 328, { width: 78, height: 38, fontSize: 12, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });

      const upperGroup = box('container', { x: X(568), y: X(418), width: 465, height: 178, fill: paleBlue, stroke: blueLine, strokeWidth: 2, radius: 16, dash: 'dashed' });
      text('Upper Branch', 584, 429, { width: 160, fontSize: 18, color: blue });
      const lora = box('roundRect', { x: X(598), y: X(463), width: 190, height: 70, fill: '#ffe5d6', stroke: '#eb8650', strokeWidth: 1.8, radius: 14 });
      text('❄  LLM   +   ◉ LoRA', 616, 480, { width: 160, fontSize: 16, color: ink });
      text('Frozen LLM with Active LoRA', 616, 545, { width: 250, fontSize: 15, color: ink });
      const bce = box('roundRect', { x: X(831), y: X(477), width: 128, height: 58, fill: '#ffffff', stroke: '#526170', strokeWidth: 1.6, radius: 11 });
      text('Calculate Loss\nL_BCE', 847, 487, { width: 98, height: 38, fontSize: 14, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      const softPrompt = box('roundRect', { x: X(1040), y: X(317), width: 118, height: 42, fill: '#dff3e3', stroke: '#8ab79a', strokeWidth: 1.5, radius: 9 });
      text('Soft Prompt P', 1052, 328, { width: 95, fontSize: 14, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      text('θ*LoRA', 1017, 519, { width: 90, fontSize: 15, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });

      const fusion = box('container', { x: X(1070), y: X(210), width: 425, height: 490, fill: paleOrange, stroke: orangeLine, strokeWidth: 2, radius: 18, dash: 'dashed' });
      const mapping = box('roundRect', { x: X(1124), y: X(242), width: 260, height: 42, fill: '#fff0e2', stroke: orangeLine, strokeWidth: 1.6, radius: 10 });
      text('MLP Mapping Layer ψ', 1150, 253, { width: 210, fontSize: 15, color: '#aa5a2e', fontFamily: 'Georgia, Times New Roman, serif' });
      const embedding = box('roundRect', { x: X(1212), y: X(300), width: 105, height: 40, fill: '#ffe6d6', stroke: orangeLine, strokeWidth: 1.5, radius: 8 });
      text('eᵤ, eᵢ', 1232, 310, { width: 65, fontSize: 16, color: ink, fontFamily: 'Georgia, Times New Roman, serif' });
      const mixed = box('roundRect', { x: X(1100), y: X(365), width: 320, height: 62, fill: '#fffaf6', stroke: '#c96022', strokeWidth: 2, radius: 12 });
      text('Mixed Sequence:\nE_mixed = [P; eᵤ; eᵢ]', 1130, 375, { width: 260, height: 40, fontSize: 16, color: '#9f4a1e', fontFamily: 'Georgia, Times New Roman, serif' });
      const projector = box('roundRect', { x: X(1118), y: X(461), width: 120, height: 68, fill: '#ffd9c5', stroke: '#d56b32', strokeWidth: 1.8, radius: 13 });
      const llm = box('roundRect', { x: X(1295), y: X(461), width: 128, height: 68, fill: '#d8efff', stroke: '#4d8fc5', strokeWidth: 1.8, radius: 13 });
      text('▲\nProjector', 1142, 469, { width: 75, height: 44, fontSize: 15, color: '#d15d27', fontFamily: 'Georgia, Times New Roman, serif' });
      text('❄  ◉\nLLM', 1320, 469, { width: 80, height: 44, fontSize: 16, color: ink });
      const prediction = box('roundRect', { x: X(1118), y: X(574), width: 140, height: 50, fill: '#fff7ef', stroke: orangeLine, strokeWidth: 1.5, radius: 10 });
      const cie = box('roundRect', { x: X(1295), y: X(574), width: 150, height: 50, fill: '#fff7ef', stroke: orangeLine, strokeWidth: 1.5, radius: 10 });
      text('Prediction\nyᵤ,ᵢ', 1138, 582, { width: 100, height: 36, fontSize: 14, color: '#9f4a1e', fontFamily: 'Georgia, Times New Roman, serif' });
      text('Compute L_CIE', 1315, 590, { width: 110, fontSize: 14, color: '#9f4a1e', fontFamily: 'Georgia, Times New Roman, serif' });
      text('Rec. Probability', 1120, 640, { width: 140, fontSize: 12, color: orange, fontFamily: 'Georgia, Times New Roman, serif' });
      text('CIE Loss Calculation', 1290, 640, { width: 170, fontSize: 12, color: softInk, fontFamily: 'Georgia, Times New Roman, serif' });

      wire(dataset, topK, { fromPort: 'bottom', toPort: 'top', stroke: greenLine, strokeWidth: 2.2, route: 'straight', arrowStyle: 'bold' });
      wire(topK, pool, { fromPort: 'bottom', toPort: 'top', stroke: greenLine, strokeWidth: 2.2, route: 'straight', arrowStyle: 'bold' });
      wire(pool, normalize, { fromPort: 'bottom', toPort: 'top', stroke: greenLine, strokeWidth: 2.2, route: 'straight', arrowStyle: 'bold' });
      wire(zeroShot, effort, { fromPort: 'bottom', toPort: 'top', stroke: '#82939f', route: 'straight', arrowStyle: 'fine' });
      wire(surrogate, influence, { fromPort: 'bottom', toPort: 'top', stroke: '#82939f', route: 'straight', arrowStyle: 'fine' });
      wire(effort, normalize, { fromPort: 'right', toPort: 'left', stroke: '#82939f', route: 'straight', arrowStyle: 'fine' });
      wire(influence, normalize, { fromPort: 'left', toPort: 'right', stroke: '#82939f', route: 'straight', arrowStyle: 'fine' });
      wire(normalize, coreset, { fromPort: 'bottom', toPort: 'top', stroke: greenLine, strokeWidth: 2.2, route: 'straight', arrowStyle: 'bold' });
      wire(coreset, lowerGroup, { fromPort: 'right', toPort: 'left', stroke: greenLine, strokeWidth: 2.2, label: 'S', arrowStyle: 'bold' });
      wire(prompt, lowerGroup, { fromPort: 'bottom', toPort: 'top', stroke: blueLine, dash: 'dashed', label: 'T_disc', arrowStyle: 'fine' });
      wire(teacher, distill, { fromPort: 'right', toPort: 'left', stroke: blue, strokeWidth: 2, arrowStyle: 'standard' });
      wire(student, distill, { fromPort: 'right', toPort: 'left', stroke: blue, strokeWidth: 2, arrowStyle: 'standard' });
      wire(distill, softPrompt, { fromPort: 'right', toPort: 'left', stroke: blueLine, dash: 'dashed', label: 'distill', arrowStyle: 'fine' });
      wire(lora, bce, { fromPort: 'right', toPort: 'left', stroke: blue, strokeWidth: 2, arrowStyle: 'standard' });
      wire(bce, softPrompt, { fromPort: 'right', toPort: 'bottom', stroke: blueLine, dash: 'dashed', arrowStyle: 'fine' });
      wire(softPrompt, mapping, { fromPort: 'right', toPort: 'left', stroke: orange, strokeWidth: 2, label: 'P', arrowStyle: 'bold' });
      wire(mapping, embedding, { fromPort: 'bottom', toPort: 'top', stroke: orangeLine, route: 'straight', arrowStyle: 'standard' });
      wire(embedding, mixed, { fromPort: 'bottom', toPort: 'top', stroke: orangeLine, route: 'straight', arrowStyle: 'standard' });
      wire(mixed, projector, { fromPort: 'bottom', toPort: 'top', stroke: orange, strokeWidth: 2, arrowStyle: 'bold' });
      wire(projector, llm, { fromPort: 'right', toPort: 'left', stroke: orange, strokeWidth: 2, arrowStyle: 'bold' });
      wire(llm, prediction, { fromPort: 'bottom', toPort: 'top', stroke: orangeLine, arrowStyle: 'standard' });
      wire(llm, cie, { fromPort: 'bottom', toPort: 'top', stroke: '#9da5ab', dash: 'dashed', label: 'L_CIE', arrowStyle: 'fine' });
      return objects;
    }
    const container = presetShape('container', { x: 70 + offset, y: 120 + offset, width: 900, height: kind === 'experiment' ? 390 : 300 });
    const titleItem = presetText(title, 88 + offset, 54 + offset, { width: 360, height: 44, fontSize: 26, color: '#1f396d' });
    if (kind === 'pipeline') {
      const input = presetShape('roundRect', { x: 125 + offset, y: 215 + offset, fill: '#e5efff' });
      const process = presetShape('roundRect', { x: 405 + offset, y: 215 + offset, fill: '#e8f7f1', stroke: '#2f9a83' });
      const output = presetShape('roundRect', { x: 685 + offset, y: 215 + offset, fill: '#fff0df', stroke: '#c7833d' });
      return [container, titleItem, input, process, output,
        presetWire(input.id, process.id), presetWire(process.id, output.id),
        presetText('数据输入', 145 + offset, 247 + offset, { fontSize: 20 }),
        presetText('特征与模型', 420 + offset, 247 + offset, { fontSize: 20 }),
        presetText('预测输出', 710 + offset, 247 + offset, { fontSize: 20 }),
        presetText('可复现实验流程 · 数据 → 方法 → 结果', 105 + offset, 145 + offset, { width: 600, fontSize: 15, color: '#5e6d87' })];
    }
    if (kind === 'architecture') {
      const memory = presetShape('cylinder', { x: 125 + offset, y: 245 + offset, fill: '#e5efff' });
      const encoder = presetShape('hexagon', { x: 410 + offset, y: 245 + offset, fill: '#e8f7f1', stroke: '#2f9a83' });
      const decision = presetShape('diamond', { x: 710 + offset, y: 245 + offset, fill: '#fff0df', stroke: '#c7833d' });
      return [container, titleItem, memory, encoder, decision,
        presetWire(memory.id, encoder.id), presetWire(encoder.id, decision.id),
        presetText('文献 / 数据', 145 + offset, 278 + offset, { fontSize: 19 }),
        presetText('编码器', 458 + offset, 278 + offset, { fontSize: 20 }),
        presetText('决策层', 755 + offset, 278 + offset, { fontSize: 20 }),
        presetText('输入空间', 145 + offset, 170 + offset, { fontSize: 15, color: '#5e6d87' }),
        presetText('表示学习', 455 + offset, 170 + offset, { fontSize: 15, color: '#5e6d87' }),
        presetText('输出空间', 755 + offset, 170 + offset, { fontSize: 15, color: '#5e6d87' })];
    }
    const chart = presetShape('pie', { x: 150 + offset, y: 215 + offset, width: 240, height: 240, slices: 5 });
    const barA = presetShape('roundRect', { x: 560 + offset, y: 215 + offset, width: 290, height: 58, fill: '#e5efff' });
    const barB = presetShape('roundRect', { x: 560 + offset, y: 315 + offset, width: 230, height: 58, fill: '#e8f7f1', stroke: '#2f9a83' });
    const barC = presetShape('roundRect', { x: 560 + offset, y: 415 + offset, width: 170, height: 58, fill: '#fff0df', stroke: '#c7833d' });
    return [container, titleItem, chart, barA, barB, barC,
      presetText('方法占比', 195 + offset, 305 + offset, { fontSize: 20 }),
      presetText('Ours    0.87', 580 + offset, 227 + offset, { fontSize: 18 }),
      presetText('Baseline  0.69', 580 + offset, 327 + offset, { fontSize: 18 }),
      presetText('Ablation  0.54', 580 + offset, 427 + offset, { fontSize: 18 }),
      presetText('结果对比 · 条件、指标和结论分层呈现', 105 + offset, 145 + offset, { width: 620, fontSize: 15, color: '#5e6d87' })];
  }

  function insertPreset(kind) {
    record(cloneItems());
    const offset = items.length ? 24 : 0;
    const added = buildPreset(kind, offset);
    items = [...items, ...added];
    if (kind === 'paper-architecture') {
      background = 'white';
      config.set('research.figureBg', background);
      applyBackground();
    }
    selectedIds = new Set();
    selectedId = null;
    persist();
    renderBoard();
    toast(`已插入${kind === 'pipeline' ? '流程图' : kind === 'architecture' ? '模型架构图' : kind === 'experiment' ? '实验对比图' : kind === 'paper-architecture' ? '论文三段式架构图' : kind === 'agentarchive' ? 'Agent Archive 复合图' : 'AgentSquare 复合图'}，可继续拖动和改层级`, 'good');
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
      strokeWidth: 0, opacity: 1, fontFamily: 'Arial, Helvetica, sans-serif',
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

  function nudgeSelected(dx, dy) {
    const selected = items.filter((entry) => selectedIds.has(entry.id) && !isWire(entry));
    if (!selected.length) return;
    record(cloneItems());
    selected.forEach((item) => { item.x += dx; item.y += dy; });
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

  function effectSpec(effect) {
    return {
      soft: { dx: 0, dy: 4, blur: 7, color: '#53627a66' },
      lift: { dx: 0, dy: 8, blur: 12, color: '#152b594d' },
      glow: { dx: 0, dy: 0, blur: 10, color: '#3d6fe866' },
    }[effect] || null;
  }

  function effectFilter(effect, id) {
    const spec = effectSpec(effect);
    if (!spec) return '';
    return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="${spec.dx}" dy="${spec.dy}" stdDeviation="${spec.blur}" flood-color="${spec.color}"/></filter>`;
  }

  function cssEffect(effect) {
    const spec = effectSpec(effect);
    return spec ? `drop-shadow(${spec.dx}px ${spec.dy}px ${spec.blur}px ${spec.color})` : 'none';
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
        const filterId = `fbE${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
        if (item.effect) defs.push(effectFilter(item.effect, filterId));
        return g(`<image href="${item.dataUrl}" x="0" y="0" width="${item.width}" height="${item.height}" preserveAspectRatio="xMidYMid meet"${item.effect ? ` filter="url(#${filterId})"` : ''}/>`);
      }
      if (item.type === 'text') {
        // 逐行输出，导出的换行才和画布一致
        const lines = String(item.text || '').split('\n');
        const size = item.fontSize || 22;
        const tspans = lines.map((line, i) => `<tspan x="0" dy="${i === 0 ? 0 : size * 1.35}">${escapeXml(line)}</tspan>`).join('');
        return g(`<text x="0" y="${size}" font-family="${escapeXml(item.fontFamily || 'Arial, Helvetica, sans-serif')}" font-size="${size}" font-weight="600" fill="${item.color}">${tspans}</text>`);
      }
      if (isLine(item.type)) {
        const markerId = `fbA${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
      defs.push(arrowDefs(item.stroke || '#3d6fe8', markerId, item.arrowStyle));
        return g(lineMarkup(item, markerId));
      }
      const filterId = `fbE${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
      if (item.effect) defs.push(effectFilter(item.effect, filterId));
      return g(item.effect ? `<g filter="url(#${filterId})">${shapeMarkup(item)}</g>` : shapeMarkup(item));
    }).join('');

    // 连线也要进导出，而且和画布共用同一份路径算法
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    let wireBody = '';
    for (const wire of items.filter(isWire)) {
      const markerId = `fbW${String(wire.id).replace(/[^a-zA-Z0-9]/g, '')}`;
      defs.push(arrowDefs(wire.stroke || '#3d6fe8', markerId, wire.arrowStyle));
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

  async function exportSvg() {
    const result = await window.toolbox.files.saveText({ content: toSvg(), extension: 'svg', defaultName: '科研图板.svg' });
    if (result.ok) toast(`SVG 已保存：${result.path}`, 'good', 5000);
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
    const result = await window.toolbox.files.saveImage({ dataUrl: canvas.toDataURL('image/png'), defaultName: '科研图板.png' });
    if (result.ok) toast(`PNG 已保存：${result.path}`, 'good', 5000);
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
      defs.push(arrowDefs(wire.stroke || '#3d6fe8', markerId, wire.arrowStyle));
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
          ? `<defs>${arrowDefs(item.stroke || '#3d6fe8', markerId, item.arrowStyle)}</defs>${lineMarkup(item, markerId)}`
          : shapeMarkup(item);
        const effectId = `fbE${String(item.id).replace(/[^a-zA-Z0-9]/g, '')}`;
        content = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        content.setAttribute('class', 'figureboard__svg');
        content.setAttribute('viewBox', `0 0 ${Math.max(1, item.width)} ${Math.max(1, item.height)}`);
        content.setAttribute('width', '100%');
        content.setAttribute('height', '100%');
        content.innerHTML = `${item.effect ? `<defs>${effectFilter(item.effect, effectId)}</defs><g filter="url(#${effectId})">${inner}</g>` : inner}`;
      }
      const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((direction) => h('span', { class: `figureboard__resize figureboard__resize--${direction}`, dataset: { resize: direction } }));
      const rotate = h('span', { class: 'figureboard__rotate', title: '旋转' });
      const element = h('div', {
        class: `figureboard__item figureboard__item--${item.type}${selectedIds.has(item.id) ? ' is-selected' : ''}`,
        dataset: { id: item.id },
        style: { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, background: item.type === 'image' ? item.fill : 'transparent', borderColor: 'transparent', color: ['line', 'dashed', 'arrow', 'double-arrow'].includes(item.type) ? item.stroke : item.color, '--figure-fill': item.fill, '--figure-stroke': item.stroke, '--figure-stroke-width': `${item.strokeWidth || 0}px`, fontSize: `${item.fontSize}px`, fontFamily: item.fontFamily || 'Arial, Helvetica, sans-serif', opacity: item.opacity ?? 1, filter: item.type === 'image' ? cssEffect(item.effect) : 'none', transform: `rotate(${item.angle || 0}deg)` },
        onpointerdown: (event) => { if (editingId !== item.id) startDrag(event, item, element); },
        ondblclick: (event) => {
          if (item.type !== 'text') return;
          event.stopPropagation();
          editingId = item.id;
          renderBoard();
        },
        onclick: (event) => { event.stopPropagation(); selectItem(item.id); },
      }, content, ...resizeHandles, rotate);
      board.appendChild(element);
    }
    board.appendChild(labelLayer);
    board.appendChild(boardHint);
    boardHint.hidden = Boolean(items.length || activeSite || sources.classList.contains('is-open'));
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
      route: config.get('research.figureRoute', 'elbow'), curveBend: 0,
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
    const startLeft = item.x;
    const startTop = item.y;
    const direction = event.target.dataset.resize || 'se';
    const moveLeft = direction.includes('w');
    const moveTop = direction.includes('n');
    const moveRight = direction.includes('e');
    const moveBottom = direction.includes('s');
    const before = cloneItems();
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let nextWidth = startWidth + (moveRight ? dx : moveLeft ? -dx : 0);
      let nextHeight = startHeight + (moveBottom ? dy : moveTop ? -dy : 0);
      nextWidth = Math.max(40, Math.round(nextWidth));
      nextHeight = Math.max(30, Math.round(nextHeight));
      item.width = nextWidth;
      item.height = nextHeight;
      if (moveLeft) item.x = Math.round(startLeft + startWidth - nextWidth);
      if (moveTop) item.y = Math.round(startTop + startHeight - nextHeight);
      element.style.width = `${item.width}px`;
      element.style.height = `${item.height}px`;
      element.style.left = `${item.x}px`;
      element.style.top = `${item.y}px`;
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
    browserTitle.textContent = '素材浏览区';
    browserHint.textContent = '再点一次同一个网站也能收起';
    for (const button of siteList.querySelectorAll('.figureboard__site-button')) {
      button.classList.remove('is-active');
    }
    boardHint.hidden = Boolean(items.length || sources.classList.contains('is-open'));
  }

  function openSite(site) {
    if (activeSite?.url === site.url) return closeSite();   // 再点一次同一个 = 收起
    activeSite = site;
    browserPane.removeAttribute('hidden');
    workspace.classList.add('has-browser');
    boardHint.hidden = true;
    browserTitle.textContent = site.name;
    browserHint.textContent = '网页素材可复制后回到左侧保存';
    siteViewHost.replaceChildren(h('webview', { class: 'figureboard__webview', partition: 'persist:research-figure', src: site.url, allowpopups: true }));
    for (const button of siteList.querySelectorAll('.figureboard__site-button')) button.classList.toggle('is-active', button.dataset.url === site.url);
  }

  function openAiDrawing() {
    const site = { name: '网页版 AI 绘图', url: AI_DRAWING_URL };
    if (activeSite?.url === site.url) return closeSite();
    activeSite = site;
    browserPane.removeAttribute('hidden');
    workspace.classList.add('has-browser');
    boardHint.hidden = true;
    browserTitle.textContent = '网页版 AI 绘图';
    browserHint.textContent = '在网页内登录并生成图片，复制图片后点左侧“存入我的素材包”';
    siteViewHost.replaceChildren(h('webview', {
      class: 'figureboard__webview',
      partition: 'persist:figure-ai',
      src: AI_DRAWING_URL,
      allowpopups: true,
    }));
    for (const button of siteList.querySelectorAll('.figureboard__site-button')) button.classList.remove('is-active');
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

  function renderLocalAssets() {
    localAssetList.replaceChildren(...[...FIGURE_ASSETS, ...customAssets].map((asset) => {
      const card = h('div', { class: `figureboard__asset-card${asset.custom ? ' is-custom' : ''}` });
      const button = h('button', {
        class: 'figureboard__asset-button',
        title: `${asset.label} · 点击加入画布`,
        onclick: () => addAsset(asset),
      }, h('img', { src: asset.dataUrl, alt: asset.label }), h('span', {}, h('strong', {}, asset.label), h('small', {}, asset.category)));
      card.appendChild(button);
      if (asset.custom) card.appendChild(h('button', {
        class: 'figureboard__asset-delete',
        title: '从我的素材包移除',
        'aria-label': `删除 ${asset.label}`,
        onclick: (event) => { event.stopPropagation(); removeCustomAsset(asset.id); },
      }, '×'));
      return card;
    }));
  }

  const siteName = h('input', { class: 'field field--sm', placeholder: '网站名称' });
  const siteUrl = h('input', { class: 'field field--sm', placeholder: 'https://素材网站…' });
  const assetNameInput = h('input', { class: 'field field--sm', placeholder: '素材名称（可选）' });
  const assetCategoryInput = h('input', { class: 'field field--sm', placeholder: '分类，如：像素风 / 设备' });
  const aiPresetSelect = h('select', { class: 'field field--sm figureboard__select' }, ...AI_PROMPT_PRESETS.map((preset) => h('option', { value: preset.id }, preset.label)));
  const aiPromptInput = h('textarea', { class: 'field figureboard__ai-prompt', rows: '4', placeholder: '选择预设后可继续补充科研对象、颜色和构图…' });
  function syncAiPrompt() {
    const preset = AI_PROMPT_PRESETS.find((item) => item.id === aiPresetSelect.value) || AI_PROMPT_PRESETS[0];
    aiPromptInput.value = preset.prompt;
  }
  aiPresetSelect.addEventListener('change', syncAiPrompt);
  syncAiPrompt();
  const copyPromptBtn = h('button', {
    class: 'btn btn--sm',
    onclick: async () => {
      const prompt = aiPromptInput.value.trim();
      if (!prompt) return toast('先输入绘图提示词', 'info');
      await window.toolbox.clipboard.write(prompt);
      toast('科研素材提示词已复制，打开网页后直接粘贴', 'good');
    },
  }, '复制提示词');
  const openAiBtn = h('button', {
    class: 'btn btn--sm btn--primary',
    onclick: async () => {
      const prompt = aiPromptInput.value.trim();
      if (!prompt) return toast('先输入绘图提示词', 'info');
      await window.toolbox.clipboard.write(prompt);
      openAiDrawing();
      toast('提示词已复制，进入网页版后直接粘贴', 'good');
    },
  }, '复制提示词并打开');
  const clipboardAssetBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: saveClipboardAsAsset }, '粘贴并存入素材包');
  const importAssetBtn = h('button', { class: 'btn btn--sm', onclick: importAsAsset }, '导入并存入素材包');
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
    'data-tooltip': title,
    'aria-label': title,
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
  const layerUpBtn = toolBtn('layerUp', '上移一层：让选中对象盖住下面一层', () => moveLayer(1));
  const layerTopBtn = toolBtn('layerTop', '置顶：让选中对象盖住所有对象', () => moveLayer('top'));
  const rotateBtn = toolBtn('rotateCw', '旋转 15°：让选中对象顺时针转动', rotateSelected);
  const groupBtn = toolBtn('group', '组合：把多个对象当成一个整体移动和缩放', groupSelected);
  const ungroupBtn = toolBtn('ungroup', '取消组合：拆开刚才组合的对象', ungroupSelected);
  const alignLeftBtn = toolBtn('alignLeft', '左对齐：按最左边对象的边缘对齐', () => alignSelected('left'));
  const alignCenterBtn = toolBtn('alignCenterH', '水平居中：让选中对象的中心线重合', () => alignSelected('center'));
  const alignTopBtn = toolBtn('alignTop', '顶端对齐：按最上方对象的边缘对齐', () => alignSelected('top'));
  const deleteBtn = toolBtn('trash', '删除：移除选中的对象和关联连线', () => selectedId && removeItem(selectedId), 'figureboard__danger');
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
  const effectSelect = h('select', { class: 'field field--sm figureboard__select', title: '边框效果', onchange: (event) => updateSelected({ effect: event.currentTarget.value }) },
    h('option', { value: 'none' }, '无效果'),
    h('option', { value: 'soft' }, '柔和阴影'),
    h('option', { value: 'lift' }, '悬浮阴影'),
    h('option', { value: 'glow' }, '边框光晕'),
  );
  const fontSelect = h('select', { class: 'field field--sm figureboard__select', title: '文字字体', onchange: (event) => updateSelected({ fontFamily: event.currentTarget.value }) },
    h('option', { value: 'Arial, Helvetica, sans-serif' }, '论文无衬线'),
    h('option', { value: 'Avenir Next, Arial, sans-serif' }, 'Avenir Next'),
    h('option', { value: 'Inter, Arial, sans-serif' }, 'Inter'),
    h('option', { value: 'Nunito Sans, Avenir Next, sans-serif' }, 'Nunito Sans（圆润）'),
  );
  const routeSelect = h('select', { class: 'field field--sm figureboard__select', title: '连接线走向（选中连线可改，也决定新连线的默认）', onchange: (event) => { config.set('research.figureRoute', event.currentTarget.value); updateSelected({ route: event.currentTarget.value }); } },
    ...Object.entries(ROUTES).map(([key, meta]) => h('option', { value: key }, meta.label)));
  const arrowStyleSelect = h('select', { class: 'field field--sm figureboard__select', title: '箭头头部粗细（选中连线可改）', onchange: (event) => updateSelected({ arrowStyle: event.currentTarget.value }) },
    h('option', { value: 'fine' }, '细箭头'),
    h('option', { value: 'standard' }, '标准箭头'),
    h('option', { value: 'bold' }, '粗箭头'),
  );
  const curveBendInput = h('input', { class: 'figureboard__range figureboard__curve-range', type: 'range', min: '-120', max: '160', step: '1', value: '0', title: '曲线弯曲程度（选中曲线后调整）', oninput: (event) => updateSelected({ curveBend: Number(event.currentTarget.value) }) });
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
  const presetSelect = h('select', { class: 'field field--sm figureboard__select', title: '插入一套已排好层级的科研图结构' },
    h('option', { value: 'pipeline' }, '流程图模板'),
    h('option', { value: 'architecture' }, '架构图模板'),
    h('option', { value: 'paper-architecture' }, '论文三段式架构图'),
    h('option', { value: 'experiment' }, '实验图模板'),
    h('option', { value: 'agentsquare' }, 'AgentSquare 复合图'),
    h('option', { value: 'agentarchive' }, 'Agent Archive 复合图'),
  );
  const presetBtn = h('button', { class: 'btn btn--sm', title: '插入一套有容器、边框、节点和标签的科研图', onclick: () => insertPreset(presetSelect.value) }, '插入结构');

  const opacityInput = h('input', { class: 'figureboard__range', type: 'range', min: '10', max: '100', step: '1', value: '100', title: '对象透明度', oninput: (event) => updateSelected({ opacity: Number(event.currentTarget.value) / 100 }) });
  function toggleSources() {
    const opening = !sources.classList.contains('is-open');
    sources.classList.toggle('is-open', opening);
    // 收起素材库时把浏览区一并收掉，否则画布仍被挤在一边
    if (!opening && activeSite) closeSite();
    boardHint.hidden = Boolean(items.length || activeSite || sources.classList.contains('is-open'));
  }

  const sourcesToggle = h('button', { class: 'figureboard__sources-toggle', title: '展开/收起素材库', onclick: toggleSources }, '素材');
  const boardHint = h('button', { class: 'figureboard__board-hint', onclick: () => { sources.classList.add('is-open'); boardHint.hidden = true; } }, '素材库已收起 · 点击打开素材网站');
  const workspace = h('div', { class: 'figureboard__workspace' });
  const tooltip = h('div', { class: 'figureboard__tooltip', role: 'tooltip', hidden: true });

  function hideTooltip() {
    tooltip.setAttribute('hidden', '');
  }

  function showTooltip(target) {
    const text = target?.dataset?.tooltip || target?.getAttribute?.('title');
    if (!text || target === tooltip || target.matches?.('option')) return;
    tooltip.textContent = text;
    tooltip.removeAttribute('hidden');
    const rect = target.getBoundingClientRect();
    const margin = 10;
    const top = rect.bottom + margin + tooltip.offsetHeight > window.innerHeight
      ? rect.top - tooltip.offsetHeight - margin
      : rect.bottom + margin;
    const left = Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, rect.left + (rect.width - tooltip.offsetWidth) / 2));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function isEditableTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  }

  function handleShortcut(event) {
    if (!root.isConnected) return;
    if (isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (modifier && key === 'y') { event.preventDefault(); redo(); return; }
    if (modifier && key === 'c') { event.preventDefault(); copySelected(); return; }
    if (modifier && key === 'x') { event.preventDefault(); cutSelected(); return; }
    if (modifier && key === 'v') { if (event.target !== board) { event.preventDefault(); pasteSelected(); } return; }
    if (modifier && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
    if (modifier && key === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelected() : groupSelected(); return; }
    if (!modifier && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); if (selectedId) removeItem(selectedId); return; }
    if (!modifier && event.key === 'Escape') { closeContextMenu(); selectItem(null); return; }
    if (!modifier && event.key === 'ArrowLeft') { event.preventDefault(); nudgeSelected(event.shiftKey ? -10 : -1, 0); return; }
    if (!modifier && event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(event.shiftKey ? 10 : 1, 0); return; }
    if (!modifier && event.key === 'ArrowUp') { event.preventDefault(); nudgeSelected(0, event.shiftKey ? -10 : -1); return; }
    if (!modifier && event.key === 'ArrowDown') { event.preventDefault(); nudgeSelected(0, event.shiftKey ? 10 : 1); return; }
    if (!modifier && key === 'r') { event.preventDefault(); addShape('rect'); return; }
    if (!modifier && key === 't') { event.preventDefault(); addText(); return; }
    if (!modifier && key === 'l') { event.preventDefault(); addShape('arrow'); }
  }

  board.addEventListener('paste', (event) => { if ([...(event.clipboardData?.items || [])].some((item) => item.type.startsWith('image/'))) { event.preventDefault(); pasteImage(); } });
  board.addEventListener('contextmenu', openContextMenu);
  board.addEventListener('pointerdown', (event) => { if (event.target === board) startMarquee(event); });
  document.addEventListener('keydown', handleShortcut);
  document.addEventListener('pointerdown', (event) => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });

  root.append(
    h('div', { class: 'bar bar--drag figureboard__bar' },
      h('strong', {}, 'PPT图板'),
      h('span', { class: 'faint' }, '单页科研图片工作台 · ⌘Z 撤销 · ⌘G 组合 · 方向键微调 · R/T/L 快速插入'),
      sourcesToggle,
      h('span', { class: 'figureboard__bar-spacer' }),
      h('div', { class: 'figureboard__tools' },
        h('div', { class: 'figureboard__group', title: '形状' }, ...shapeButtons),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '连线与文字' }, ...lineButtons, textBtn, routeSelect, arrowStyleSelect, curveBendInput, arrowEndBtn, wireLabelBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '样式' },
          fillInput, strokeInput, transparentFillBtn, transparentStrokeBtn,
          dashSelect, effectSelect, fontSelect, strokeWidthInput, radiusInput, sliceInput, opacityInput),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '排列' },
          alignLeftBtn, alignCenterBtn, alignTopBtn, groupBtn, ungroupBtn,
          layerUpBtn, layerTopBtn, rotateBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '编辑' },
          undoBtn, redoBtn, copyBtn, cutBtn, pasteObjectBtn, duplicateBtn, deleteBtn),
        h('span', { class: 'figureboard__tool-sep' }),
        h('div', { class: 'figureboard__group', title: '画布与导出' },
          presetSelect, presetBtn, pasteBtn, importBtn, iconFor('canvasBg', 'ui-icon figureboard__tool-icon'), bgSelect, exportSvgBtn, exportPngBtn),
      ),
    ),
    workspace,
  );
  document.body.appendChild(tooltip);
  root.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tooltip], [title]');
    if (target && root.contains(target)) showTooltip(target);
  });
  root.addEventListener('pointerout', (event) => {
    const target = event.target.closest?.('[data-tooltip], [title]');
    if (!target || !root.contains(target)) return;
    if (!event.relatedTarget || !target.contains(event.relatedTarget)) hideTooltip();
  });
  root.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-tooltip], [title]');
    if (target && root.contains(target)) showTooltip(target);
  });
  root.addEventListener('focusout', hideTooltip);
  workspace.append(
    sources,
    browserPane,
    h('section', { class: 'figureboard__board-pane' },
      h('div', { class: 'figureboard__pane-head' }, h('strong', {}, '科研图片画布'), h('span', { class: 'faint' }, '右侧粘贴 / 拖动 / 缩放')),
      board,
    ),
  );
  document.body.appendChild(contextMenu);
  browserPane.append(
    h('div', { class: 'figureboard__pane-head' },
      browserTitle,
      browserHint,
      h('span', { class: 'figureboard__bar-spacer' }),
      h('button', { class: 'btn btn--sm btn--ghost', title: '收起素材浏览区，把画布还回来', onclick: closeSite }, '收起 ✕'),
    ),
    siteViewHost,
  );
  sources.append(
    h('div', { class: 'figureboard__section-title' }, '内置素材包'),
    localAssetList,
    h('div', { class: 'figureboard__asset-save' },
      assetNameInput,
      assetCategoryInput,
      h('div', { class: 'figureboard__asset-save-actions' }, clipboardAssetBtn, importAssetBtn),
      h('small', { class: 'faint' }, '网页生成图或截图可复制 / 导入，保存后下次启动仍在。'),
    ),
    h('div', { class: 'figureboard__section-title' }, '素材网站'),
    h('div', { class: 'figureboard__site-form' }, siteName, siteUrl, addSiteBtn),
    siteList,
    h('div', { class: 'figureboard__section-title' }, 'AI 素材工坊'),
    h('div', { class: 'figureboard__ai-box' },
      h('div', { class: 'figureboard__ai-title' }, '网页版 GPT Image'),
      h('small', { class: 'faint' }, '无需 API Key；首次在网页内登录，生成后复制图片。'),
      aiPresetSelect,
      aiPromptInput,
      h('div', { class: 'figureboard__ai-actions' }, copyPromptBtn, openAiBtn),
    ),
  );
  bgSelect.value = background;
  applyBackground();
  renderLocalAssets();
  renderSites();
  renderBoard();
}
