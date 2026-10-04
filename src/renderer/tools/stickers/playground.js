import { h, toast, debounce } from '../../core/ui.js';

/**
 * 表情包「玩法」：全在本地 canvas 里跑，不联网、不用 AI。
 *  1) 一明一暗：白底看到 A 图、黑底看到 B 图的隐藏图（靠 PNG 透明通道）。
 *  2) 二维码融合：把图融进二维码，每个码点保留中心真码色 + 定位角实心，保证能扫。
 *  3) 照片马赛克：用本地库里的图当像素块，拼成一张大图。
 *  4) meme 配字：给图加暴躁风上下配字（描边）。不含任何模板图。
 */

const sx = () => window.toolbox.stickers;

// ---- 通用小工具 ----
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('图片加载失败')); im.src = src; });
}
function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s; const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function offscreen(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

async function saveCanvas(canvas, { title, category }, reloadLib) {
  const r = await sx().saveComposed({ dataUrl: canvas.toDataURL('image/png'), title, category, tags: [category] });
  if (r?.ok) { toast('已存进本地库', 'good'); reloadLib?.(); } else toast(r?.error || '保存失败', 'bad');
}
function downloadCanvas(canvas, name) {
  window.toolbox.files.saveImage({ dataUrl: canvas.toDataURL('image/png'), defaultName: name }).then((r) => { if (r?.ok) toast('已下载', 'good'); else if (!r?.canceled) toast(r?.error || '下载失败', 'bad'); });
}

/** 选图浮层：从本地库选，或从电脑选。回调给一个 data URL（不污染画布） */
function openPicker(onPick) {
  const grid = h('div', { class: 'stk__pickgrid' }, h('div', { class: 'stk__status' }, '加载中…'));
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: () => {
    const f = fileInput.files?.[0]; if (!f) return;
    const fr = new FileReader(); fr.onload = () => { close(); onPick(fr.result, f.name.replace(/\.[^.]+$/, '')); }; fr.readAsDataURL(f);
  } });
  const overlay = h('div', { class: 'stk__overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'stk__picker' },
      h('div', { class: 'stk__pickbar' },
        h('strong', {}, '选一张图'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, '从电脑选图'),
        h('button', { class: 'btn', onclick: () => close() }, '关闭'),
      ),
      grid, fileInput,
    ),
  );
  function close() { overlay.remove(); }
  document.body.appendChild(overlay);
  sx().list({}).then((r) => {
    grid.replaceChildren();
    const items = r.items || [];
    if (!items.length) { grid.append(h('div', { class: 'empty' }, '本地库还没有图，先去导入或在线找，或点上面「从电脑选图」。')); return; }
    for (const it of items) {
      grid.append(h('img', { class: 'stk__pickitem', src: it.url, loading: 'lazy', title: it.title || '', onclick: async () => {
        const d = await sx().dataUrl(it.id);
        if (!d?.ok) return toast(d?.error || '读取失败', 'bad');
        close(); onPick(d.dataUrl, it.title || '');
      } }));
    }
  });
}

/** 一个「选图按钮 + 缩略预览」控件 */
function sourceSlot(label, onLoaded) {
  let img = null; let url = '';
  const thumb = h('div', { class: 'stk__slotthumb' }, '＋');
  const btn = h('button', { class: 'stk__slot', onclick: () => openPicker(async (dataUrl) => { url = dataUrl; img = await loadImage(dataUrl); thumb.replaceChildren(h('img', { src: dataUrl })); onLoaded?.(img); }) }, thumb, h('span', {}, label));
  return { el: btn, get: () => img, getUrl: () => url };
}

export function createPlayground(root, { reloadLib }) {
  const tabs = [
    { id: 'fuse', name: '✨ AI 融合', build: buildFuse },
    { id: 'dual', name: '一明一暗', build: buildDual },
    { id: 'qr', name: '二维码融合', build: buildQr },
    { id: 'mosaic', name: '照片马赛克', build: buildMosaic },
    { id: 'meme', name: 'meme 配字', build: buildMeme },
  ];
  const tabBar = h('div', { class: 'stk__playtabs' });
  const pane = h('div', { class: 'stk__playpane' });
  root.replaceChildren(tabBar, pane);
  let active = '';
  function show(id) {
    active = id;
    [...tabBar.children].forEach((b) => b.classList.toggle('tag--on', b.dataset.id === id));
    pane.replaceChildren();
    tabs.find((t) => t.id === id).build(pane, { reloadLib });
  }
  for (const t of tabs) tabBar.append(h('button', { class: 'tag stk__chip', dataset: { id: t.id }, onclick: () => show(t.id) }, t.name));
  show('fuse');
}

// ---------- 0) AI 融合（复用已配好的生图模型） ----------
function buildFuse(pane, { reloadLib }) {
  const slots = [sourceSlot('图 1'), sourceSlot('图 2'), sourceSlot('图 3（可选）'), sourceSlot('图 4（可选）')];
  const prompt = h('textarea', { class: 'field', rows: 2, placeholder: '想怎么融合？留空自动融合。例：把这两个角色合成一个，戴上第二张的帽子，白底' });
  const sizeSel = h('select', { class: 'field' }, ...['1024x1024', '1024x1536', '1536x1024'].map((s) => h('option', { value: s }, s)));
  const preview = h('div', { class: 'stk__preview stk__preview--checker' }, h('div', { class: 'empty' }, '融合结果会出现在这里，并自动存进本地库'));
  const genBtn = h('button', { class: 'btn btn--on', onclick: gen }, '融合（用生图模型）');

  async function gen() {
    const st = await sx().imageStatus();
    if (!st.hasKey) { toast('还没配生图模型的 Key —— 去「语音」工具的「教学配图 API」里填好地址和 Key（image 通道，和教学幻灯片共用）', 'bad'); return; }
    const urls = slots.map((s) => s.getUrl()).filter(Boolean);
    if (!urls.length) { toast('至少选一张图', 'bad'); return; }
    genBtn.disabled = true; genBtn.textContent = '融合中…（十几秒）';
    preview.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 正在让模型融合…'));
    const r = await sx().fuse({ dataUrls: urls, prompt: prompt.value, size: sizeSel.value });
    genBtn.disabled = false; genBtn.textContent = '融合（用生图模型）';
    if (r?.ok) { preview.replaceChildren(h('img', { class: 'stk__canvas', src: r.item.url })); toast('融合完成，已存进本地库', 'good'); reloadLib?.(); }
    else preview.replaceChildren(h('div', { class: 'empty' }, r?.error === 'no-key' ? '没配生图模型 Key（去「语音」工具配）' : `融合失败：${r?.error || ''}`));
  }

  pane.append(
    h('p', { class: 'stk__hint' }, '选 1–4 张表情包，交给已配好的生图模型（gpt-image-2.5 那类）融合成一张新的，用的是设置好的 image 通道 Key，不额外配置。GIF 自动取首帧。'),
    h('div', { class: 'stk__slots' }, ...slots.map((s) => s.el)),
    h('label', { class: 'stk__field' }, '融合指令（可选）', prompt),
    h('div', { class: 'stk__row' }, h('label', {}, '尺寸', sizeSel), genBtn),
    preview,
  );
}

// ---------- 1) 一明一暗 ----------
function buildDual(pane, { reloadLib }) {
  const canvas = h('canvas', { class: 'stk__canvas' });
  const a = sourceSlot('白底显示这张 (A)');
  const b = sourceSlot('黑底显示这张 (B)');
  let bg = 'checker';
  const wrap = h('div', { class: 'stk__preview stk__preview--checker' }, canvas);
  const sizeR = h('input', { type: 'range', min: 200, max: 800, step: 20, value: 420 });

  function bgBtn(v, label) { return h('button', { class: 'btn', onclick: () => { bg = v; wrap.className = `stk__preview stk__preview--${v}`; } }, label); }

  async function gen() {
    const A = a.get(); const B = b.get();
    if (!A || !B) return toast('先选好 A、B 两张图', 'bad');
    const W = Number(sizeR.value); const H = Math.round(W * A.height / A.width);
    const ca = offscreen(W, H); const cb = offscreen(W, H);
    drawCover(ca.getContext('2d'), A, W, H); drawCover(cb.getContext('2d'), B, W, H);
    const da = ca.getContext('2d').getImageData(0, 0, W, H);
    const db = cb.getContext('2d').getImageData(0, 0, W, H);
    const out = new ImageData(W, H);
    for (let i = 0; i < da.data.length; i += 4) {
      const ga = (da.data[i] * 0.299 + da.data[i + 1] * 0.587 + da.data[i + 2] * 0.114) / 255;
      const gb = (db.data[i] * 0.299 + db.data[i + 1] * 0.587 + db.data[i + 2] * 0.114) / 255;
      const ap = 0.5 + ga * 0.5;   // A 压到 [0.5,1]（白底可见）
      const bp = gb * 0.5;         // B 压到 [0,0.5]（黑底可见）
      const alpha = 1 - ap + bp;
      const color = alpha > 0.001 ? bp / alpha : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.round(color * 255);
      out.data[i + 3] = Math.round(alpha * 255);
    }
    canvas.width = W; canvas.height = H; canvas.getContext('2d').putImageData(out, 0, 0);
    void bg;
  }

  pane.append(
    h('p', { class: 'stk__hint' }, '选两张图：放在浅色背景（微信白色聊天）里显示 A，放在深色背景（暗黑模式）里显示 B。'),
    h('div', { class: 'stk__slots' }, a.el, b.el),
    h('div', { class: 'stk__row' }, h('label', {}, '输出宽度', sizeR), h('button', { class: 'btn btn--on', onclick: gen }, '生成')),
    h('div', { class: 'stk__row' }, h('span', { class: 'stk__hint' }, '预览背景：'), bgBtn('checker', '棋盘'), bgBtn('white', '白'), bgBtn('black', '黑')),
    wrap,
    resultBar(canvas, '一明一暗', reloadLib),
  );
}

// ---------- 2) 二维码融合 ----------
function buildQr(pane, { reloadLib }) {
  const canvas = h('canvas', { class: 'stk__canvas' });
  const src = sourceSlot('选表情包图案');
  const text = h('input', { class: 'field', value: 'https://', placeholder: '要编码的网址 / 文字' });
  const scaleR = h('input', { type: 'range', min: 6, max: 18, step: 1, value: 11 });
  const ratioR = h('input', { type: 'range', min: 20, max: 60, step: 5, value: 35 });

  async function gen() {
    const img = src.get();
    if (!img) return toast('先选一张图案', 'bad');
    const m = await sx().qrMatrix(text.value);
    if (!m?.ok) return toast(m?.error === 'no-text' ? '先填要编码的内容' : (m?.error || '生成失败'), 'bad');
    const { size, data } = m;
    const scale = Number(scaleR.value); const margin = 4;
    const total = (size + margin * 2) * scale;
    canvas.width = total; canvas.height = total;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, total, total);
    // 图铺在码区
    const area = size * scale;
    ctx.save(); ctx.beginPath(); ctx.rect(margin * scale, margin * scale, area, area); ctx.clip();
    ctx.drawImage(img, ...coverBox(img, area, area, margin * scale, margin * scale)); ctx.restore();
    const center = Number(ratioR.value) / 100; // 中心真码块占比
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      const dark = data[r * size + c];
      const isFinder = (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
      const x = (margin + c) * scale; const y = (margin + r) * scale;
      ctx.fillStyle = dark ? '#000' : '#fff';
      if (isFinder) { ctx.fillRect(x, y, scale, scale); }
      else { const s2 = scale * center; ctx.fillRect(x + (scale - s2) / 2, y + (scale - s2) / 2, s2, s2); }
    }
  }

  pane.append(
    h('p', { class: 'stk__hint' }, '把图融进二维码。定位角和每个码点中心保留真码色 —— 保证能扫；「图案占比」越大越好看、越小越好扫。'),
    h('div', { class: 'stk__slots' }, src.el),
    h('label', { class: 'stk__field' }, '内容', text),
    h('div', { class: 'stk__row' }, h('label', {}, '码点像素', scaleR), h('label', {}, '图案占比', ratioR), h('button', { class: 'btn btn--on', onclick: gen }, '生成')),
    h('div', { class: 'stk__preview stk__preview--white' }, canvas),
    resultBar(canvas, '二维码', reloadLib),
  );
}
function coverBox(img, w, h, ox = 0, oy = 0) {
  const s = Math.max(w / img.width, h / img.height); const dw = img.width * s; const dh = img.height * s;
  return [ox + (w - dw) / 2, oy + (h - dh) / 2, dw, dh];
}

// ---------- 3) 照片马赛克 ----------
const avgCache = new Map(); // id -> {r,g,b, dataUrl}
function buildMosaic(pane, { reloadLib }) {
  const canvas = h('canvas', { class: 'stk__canvas' });
  const target = sourceSlot('选目标大图');
  const cellsR = h('input', { type: 'range', min: 20, max: 80, step: 5, value: 44 });
  const tileR = h('input', { type: 'range', min: 12, max: 32, step: 2, value: 20 });
  const tintR = h('input', { type: 'range', min: 0, max: 70, step: 5, value: 35 });
  const info = h('span', { class: 'stk__hint' }, '');

  async function ensureTiles() {
    const r = await sx().list({});
    const items = r.items || [];
    info.textContent = `素材：本地库 ${items.length} 张${items.length < 8 ? '（太少，拼出来会糊，多存点表情包）' : ''}`;
    const tiles = [];
    for (const it of items) {
      if (avgCache.has(it.id)) { tiles.push(avgCache.get(it.id)); continue; }
      try {
        const d = await sx().dataUrl(it.id); if (!d?.ok) continue;
        const im = await loadImage(d.dataUrl);
        const c = offscreen(12, 12); const cx = c.getContext('2d'); drawCover(cx, im, 12, 12);
        const px = cx.getImageData(0, 0, 12, 12).data;
        let R = 0; let G = 0; let B = 0; const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) { R += px[i]; G += px[i + 1]; B += px[i + 2]; }
        const t = { r: R / n, g: G / n, b: B / n, dataUrl: d.dataUrl, img: im };
        avgCache.set(it.id, t); tiles.push(t);
      } catch { /* 跳过坏图 */ }
    }
    return tiles;
  }

  async function gen() {
    const T = target.get();
    if (!T) return toast('先选目标大图', 'bad');
    const tiles = await ensureTiles();
    if (!tiles.length) return toast('本地库没有可用素材', 'bad');
    const cellsX = Number(cellsR.value); const tile = Number(tileR.value);
    const cellsY = Math.max(1, Math.round(cellsX * T.height / T.width));
    // 目标缩到 cellsX×cellsY，取每格平均色
    const small = offscreen(cellsX, cellsY); const sc = small.getContext('2d');
    drawCover(sc, T, cellsX, cellsY);
    const sd = sc.getImageData(0, 0, cellsX, cellsY).data;
    canvas.width = cellsX * tile; canvas.height = cellsY * tile;
    const ctx = canvas.getContext('2d');
    const tint = Number(tintR.value) / 100;
    for (let y = 0; y < cellsY; y += 1) for (let x = 0; x < cellsX; x += 1) {
      const i = (y * cellsX + x) * 4; const r = sd[i]; const g = sd[i + 1]; const b = sd[i + 2];
      let best = tiles[0]; let bd = Infinity;
      for (const t of tiles) { const d = (t.r - r) ** 2 + (t.g - g) ** 2 + (t.b - b) ** 2; if (d < bd) { bd = d; best = t; } }
      ctx.drawImage(best.img, x * tile, y * tile, tile, tile);
      if (tint > 0) { ctx.fillStyle = `rgba(${r},${g},${b},${tint})`; ctx.fillRect(x * tile, y * tile, tile, tile); }
    }
  }

  pane.append(
    h('p', { class: 'stk__hint' }, '用本地库里的图当「像素块」拼成目标大图。放大看每一块都是一张表情包。库里图越多越像。'),
    h('div', { class: 'stk__slots' }, target.el),
    info,
    h('div', { class: 'stk__row' }, h('label', {}, '横向格数', cellsR), h('label', {}, '每格像素', tileR), h('label', {}, '色彩贴合', tintR), h('button', { class: 'btn btn--on', onclick: gen }, '生成')),
    h('div', { class: 'stk__preview stk__preview--checker' }, canvas),
    resultBar(canvas, '马赛克', reloadLib),
  );
}

// ---------- 4) meme 配字 ----------
function buildMeme(pane, { reloadLib }) {
  const canvas = h('canvas', { class: 'stk__canvas' });
  const src = sourceSlot('选图', () => render());
  const top = h('input', { class: 'field', placeholder: '上配字' });
  const bottom = h('input', { class: 'field', placeholder: '下配字（暴躁点）' });
  const sizeR = h('input', { type: 'range', min: 6, max: 16, step: 1, value: 10 });
  const colorSel = h('select', { class: 'field' }, h('option', { value: '#fff' }, '白'), h('option', { value: '#ffe000' }, '黄'), h('option', { value: '#ff3b30' }, '红'), h('option', { value: '#000' }, '黑'));

  function wrapText(ctx, txt, maxW) {
    const words = String(txt || '').split(/(\s+)/); const lines = []; let cur = '';
    for (const w of words) {
      // 中文按字断，英文按词
      for (const ch of (/\s/.test(w) ? [w] : [...w])) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur.trim()); cur = ch.trim(); }
        else cur = test;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  function render() {
    const img = src.get(); if (!img) return;
    const W = Math.min(560, img.width); const H = Math.round(W * img.height / img.width);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const fs = Math.round(W * Number(sizeR.value) / 100);
    ctx.font = `900 ${fs}px Impact, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.fillStyle = colorSel.value; ctx.strokeStyle = colorSel.value === '#000' ? '#fff' : '#000'; ctx.lineWidth = Math.max(2, fs / 7);
    const put = (txt, top2) => {
      const lines = wrapText(ctx, txt, W * 0.94);
      lines.forEach((ln, idx) => {
        const y = top2 ? fs * (1.05 + idx * 1.05) : H - fs * (0.35 + (lines.length - 1 - idx) * 1.05);
        ctx.strokeText(ln, W / 2, y); ctx.fillText(ln, W / 2, y);
      });
    };
    ctx.textBaseline = 'alphabetic';
    if (top.value) put(top.value, true);
    if (bottom.value) put(bottom.value, false);
  }
  const live = debounce(render, 200);
  [top, bottom, sizeR, colorSel].forEach((el) => el.addEventListener('input', live));

  pane.append(
    h('p', { class: 'stk__hint' }, '给任意图配字。黄豆 / 暴躁老哥模板你自己导入或去「在线找」搜「黄豆」，这里负责配字描边。'),
    h('div', { class: 'stk__slots' }, src.el),
    h('label', { class: 'stk__field' }, '上', top),
    h('label', { class: 'stk__field' }, '下', bottom),
    h('div', { class: 'stk__row' }, h('label', {}, '字号', sizeR), h('label', {}, '颜色', colorSel), h('button', { class: 'btn', onclick: render }, '刷新')),
    h('div', { class: 'stk__preview stk__preview--checker' }, canvas),
    resultBar(canvas, 'meme', reloadLib),
  );
}

function resultBar(canvas, title, reloadLib) {
  return h('div', { class: 'stk__row stk__resultbar' },
    h('button', { class: 'btn btn--on', onclick: () => { if (!canvas.width) return toast('先生成', 'bad'); saveCanvas(canvas, { title, category: '玩法' }, reloadLib); } }, '存回库'),
    h('button', { class: 'btn', onclick: () => { if (!canvas.width) return toast('先生成', 'bad'); downloadCanvas(canvas, `${title}.png`); } }, '下载'),
  );
}
