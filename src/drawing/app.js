'use strict';
// Shared by the desktop iframe and iPad Safari. No Node, clipboard-read or cloud dependency.
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), token = params.get('token');
const uuid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const client = uuid(), key = id || 'unpaired';
const auth = { Authorization: 'Bearer ' + token, 'X-Toolbox-Id': id || '' };
const query = '?id=' + encodeURIComponent(id || '') + '&token=' + encodeURIComponent(token || '');
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const PAGE_W = 1120, PAGE_H = 1584;
let state = { pages: {}, objects: {}, seq: 0 }, page = 'first', tool = 'pen', zoom = .6, pan = { x: 30, y: 30 };
let pending = [], live = new Map(), selection = [], gesture = null, pointer = null, points = [], lasso = [], dragging = null;
let online = false, flushing = false, db, eventSource, ready = false, fitted = false, liveAt = 0, active = true;
let history = [], future = [], imageCache = new Map(), saveTimer, pendingLive = null, liveSending = false;
const touchPoints = new Map();
function status(text, good = online) { $('status').textContent = text; $('dot').classList.toggle('online', good); }
function badge() { status(online ? pending.length ? `同步中 · ${pending.length} 项` : '已同步到电脑' : `连接中断 · 待同步 ${pending.length} 项`); }
function openDb() {
  return new Promise((resolve, reject) => { const r = indexedDB.open('toolbox-drawing-v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function storage(mode, action) { return new Promise((resolve, reject) => { const tx = db.transaction('data', mode); const req = action(tx.objectStore('data')); tx.oncomplete = () => resolve(req?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('本地保存失败')); }); }
function cacheState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => storage('readwrite', s => s.put(state, key + ':state')).catch(e => status('本地缓存失败：' + e.message, false)), 500); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...auth, ...options.headers }, signal: AbortSignal.timeout(12000) });
  const result = await response.json(); if (!response.ok) { const e = Error(result.error || '请求失败'); e.status = response.status; throw e; } return result;
}
function apply(op) {
  if (op.kind === 'page') state.pages = { ...state.pages, [op.value.id]: op.value };
  if (op.kind === 'put') state.objects = { ...state.objects, [op.value.id]: { ...op.value, revision: op.seq } };
  if (op.kind === 'remove') delete state.objects[op.target];
  state.seq = Math.max(state.seq || 0, op.seq || 0);
}
function overlayPending() { for (const op of pending) apply(op); }
function visibleObjects() { return Object.values(state.objects).filter(v => v.page === page).sort((a, b) => Number(!!b.background) - Number(!!a.background)); }
function refreshPages() {
  const list = Object.values(state.pages); if (!list.some(p => p.id === page)) page = list[0]?.id || 'first';
  $('pages').replaceChildren(...list.map(p => { const b = document.createElement('button'); b.textContent = p.name; b.className = page === p.id ? 'active' : ''; b.onclick = () => { page = p.id; selection = []; refreshPages(); draw(); }; return b; }));
  $('paper').value = state.pages[page]?.paper || 'dots'; $('pageName').textContent = state.pages[page]?.name || '绘图本';
}
function enqueue(changes, remember = true) {
  const action = () => enqueueNow(changes, remember);
  queueChain = queueChain.then(action, action); return queueChain;
}
async function enqueueNow(changes, remember = true) {
  if (!ready) return;
  const undo = changes.map(c => c.kind === 'put' || c.kind === 'remove' ? state.objects[c.value?.id || c.target] : null);
  const ops = changes.map(c => ({ ...c, id: uuid(), client }));
  // Durable local outbox before optimistic drawing. Network failure never deletes it.
  const next = [...pending, ...ops]; await storage('readwrite', s => s.put(next, key + ':pending')); pending = next;
  ops.forEach(apply); if (remember) { history.push({ changes, undo }); future = []; }
  cacheState(); refreshPages(); draw(); badge(); flush();
}
async function flush() {
  if (flushing || !online || !ready) return; flushing = true;
  try { while (pending.length && online) {
    const op = pending[0]; await api('/api/op', { method: 'POST', body: JSON.stringify(op) });
    // Read latest queue after await; new pointer events may have appended operations.
    await mutateQueue(op.id);
  } } catch (e) { if (e.status) status(e.message + ' · 未同步内容保留在本机', false); else { online = false; badge(); } }
  finally { flushing = false; badgeIfSafe(); }
}
let queueChain = Promise.resolve();
function mutateQueue(removeId) { const action = async () => { const next = pending.filter(o => o.id !== removeId); await storage('readwrite', s => s.put(next, key + ':pending')); pending = next; }; queueChain = queueChain.then(action, action); return queueChain; }
function badgeIfSafe() { if (online && !pending.length) badge(); }
function connect() {
  eventSource?.close();
  eventSource = new EventSource('/api/events' + query);
  eventSource.addEventListener('snapshot', event => {
    state = JSON.parse(event.data); overlayPending(); online = true;
    $('identity').textContent = `已配对 #${state.identity.code} · ${state.identity.name}`;
    refreshPages(); if (!fitted) fit(); draw(); cacheState(); badge(); flush();
  });
  eventSource.addEventListener('operation', event => { const op = JSON.parse(event.data); live.delete(op.client); apply(op); overlayPending(); refreshPages(); draw(); cacheState(); });
  eventSource.addEventListener('live', event => { const op = JSON.parse(event.data); if (op.client === client) return; if (op.value) live.set(op.client, { value: op.value, at: Date.now() }); else live.delete(op.client); draw(); });
  eventSource.onerror = () => { online = false; badge(); };
}
function box(o) {
  if (o.type === 'image') return { x: o.x, y: o.y, w: o.w, h: o.h };
  const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1]);
  const x = Math.min(...xs) + o.x, y = Math.min(...ys) + o.y;
  return { x: x - o.width, y: y - o.width, w: Math.max(...xs) + o.x - x + o.width * 2, h: Math.max(...ys) + o.y - y + o.width * 2 };
}
function imageFor(asset) {
  if (!imageCache.has(asset)) { const image = new Image(); image.src = '/api/image/' + asset + query; image.onload = draw; image.onerror = () => { imageCache.delete(asset); }; imageCache.set(asset, image); } return imageCache.get(asset);
}
function paint(o) {
  if (o.type === 'image') { const image = imageFor(o.asset); if (image.complete && image.naturalWidth) ctx.drawImage(image, o.x, o.y, o.w, o.h); return; }
  ctx.save(); ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (o.tool === 'marker') ctx.globalAlpha = .22;
  const p = o.points; ctx.beginPath();
  if (o.tool === 'marker') { ctx.lineWidth = o.width * 3; ctx.moveTo(o.x + p[0][0], o.y + p[0][1]); for (const v of p) ctx.lineTo(o.x + v[0], o.y + v[1]); ctx.stroke(); }
  else if (p.length === 1) { ctx.arc(o.x + p[0][0], o.y + p[0][1], o.width * (.25 + p[0][2] * .75) / 2, 0, Math.PI * 2); ctx.fill(); }
  else for (let i = 1; i < p.length; i++) { ctx.beginPath(); ctx.lineWidth = o.width * (.25 + (p[i][2] + p[i - 1][2]) * .375); ctx.moveTo(o.x + p[i - 1][0], o.y + p[i - 1][1]); ctx.lineTo(o.x + p[i][0], o.y + p[i][1]); ctx.stroke(); }
  ctx.restore();
}
function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
  paintPage();
  if (lasso.length) { ctx.beginPath(); ctx.moveTo(...lasso[0]); lasso.forEach(p => ctx.lineTo(...p)); ctx.strokeStyle = '#457c99'; ctx.lineWidth = 1 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.stroke(); ctx.setLineDash([]); }
  for (const object of visibleObjects().filter(o => selection.includes(o.id))) { const b = box(object); ctx.strokeStyle = '#457c99'; ctx.lineWidth = 1 / zoom; ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); }
  $('hint').hidden = visibleObjects().length > 0 || !!pointer; $('zoom').textContent = Math.round(zoom * 100) + '%';
}
function paintPage(exporting = false) {
  ctx.fillStyle = '#fffefb'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, PAGE_W, PAGE_H); ctx.clip();
  const paper = state.pages[page]?.paper; ctx.strokeStyle = '#dce5e9'; ctx.fillStyle = '#c9d8df'; ctx.lineWidth = .6;
  if (paper === 'grid' || paper === 'lines') { ctx.beginPath(); for (let y = 32; y < PAGE_H; y += 32) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); } if (paper === 'grid') for (let x = 32; x < PAGE_W; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); } ctx.stroke(); }
  if (paper === 'dots') for (let x = 32; x < PAGE_W; x += 32) for (let y = 32; y < PAGE_H; y += 32) { ctx.beginPath(); ctx.arc(x, y, .9, 0, 7); ctx.fill(); }
  visibleObjects().forEach(paint);
  if (!exporting) { for (const v of live.values()) if (Date.now() - v.at < 4000 && v.value.page === page) paint(v.value); if (pointer && points.length) paint(currentStroke()); }
  ctx.restore();
}
function fit() { zoom = Math.max(.15, Math.min(1, (canvas.clientWidth - 50) / PAGE_W, (canvas.clientHeight - 40) / PAGE_H)); pan = { x: (canvas.clientWidth - PAGE_W * zoom) / 2, y: 20 }; fitted = true; draw(); }
function locate(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - pan.x) / zoom, (e.clientY - r.top - pan.y) / zoom, e.pointerType === 'pen' ? Math.max(.05, e.pressure) : .5]; }
function currentStroke() { return { id: pointer?.strokeId || 'live', page, type: 'stroke', tool, x: 0, y: 0, points, color: $('color').value, width: Number($('width').value) }; }
function sendLive(value) {
  if (!online) return; pendingLive = value;
  if (liveSending) return; liveSending = true;
  (async () => { try { while (pendingLive !== undefined) { const value = pendingLive; pendingLive = undefined; await api('/api/live', { method: 'POST', body: JSON.stringify({ client, value }) }); } } catch { /* Committed stroke is durably queued separately. */ } finally { liveSending = false; } })();
}
function hit(p, b) { return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h; }
function inside(p, poly) { let result = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result; } return result; }
function safe(action) { return (...args) => { try { return Promise.resolve(action(...args)).catch(e => status(e.message, false)); } catch (e) { status(e.message, false); } }; }
canvas.addEventListener('pointerdown', e => {
  if (!ready || e.button > 0) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') { touchPoints.set(e.pointerId, [e.clientX, e.clientY]); if (touchPoints.size === 2 && pointer?.type !== 'pen') { pointer = null; points = []; lasso = []; if (dragging) dragging.forEach(o => { state.objects[o.id] = o; }); dragging = null; sendLive(null); const [a, b] = [...touchPoints.values()]; gesture = { distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), zoom, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pan: { ...pan } }; return; } if ($('pencil').checked && tool !== 'hand' || pointer?.type === 'pen') return; }
  if (pointer) return;
  const p = locate(e); pointer = { id: e.pointerId, type: e.pointerType, start: p, screen: [e.clientX, e.clientY], pan: { ...pan }, strokeId: uuid() };
  if (tool === 'pen' || tool === 'marker') points = [p];
  if (tool === 'select') { dragging = visibleObjects().filter(o => selection.includes(o.id)); if (!dragging.some(o => hit(p, box(o)))) { const object = [...visibleObjects()].reverse().find(o => o.type === 'image' && !o.background && hit(p, box(o))); selection = object ? [object.id] : []; dragging = object ? [object] : []; lasso = object ? [] : [p.slice(0, 2)]; } }
  if (tool === 'eraser') eraseAt(p); draw();
});
function eraseAt(p) { const object = [...visibleObjects()].reverse().find(o => { if (o.type !== 'stroke' || !hit(p, box(o))) return false; return o.points.some((q, i) => { if (!i) return Math.hypot(q[0] + o.x - p[0], q[1] + o.y - p[1]) < o.width + 12; const a = o.points[i - 1], dx = q[0] - a[0], dy = q[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - o.x - a[0]) * dx + (p[1] - o.y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(a[0] + t * dx + o.x - p[0], a[1] + t * dy + o.y - p[1]) < o.width + 12; }); }); if (object && !pending.some(op => op.kind === 'remove' && op.target === object.id)) safe(() => enqueue([{ kind: 'remove', target: object.id }]))(); }
canvas.addEventListener('pointermove', e => {
  if (touchPoints.has(e.pointerId)) touchPoints.set(e.pointerId, [e.clientX, e.clientY]);
  if (gesture && touchPoints.size === 2 && !pointer?.type?.includes('pen')) { const [a, b] = [...touchPoints.values()], r = canvas.getBoundingClientRect(), center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; zoom = Math.max(.15, Math.min(3, gesture.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.distance)); pan = { x: center[0] - r.left - (gesture.center[0] - r.left - gesture.pan.x) * zoom / gesture.zoom, y: center[1] - r.top - (gesture.center[1] - r.top - gesture.pan.y) * zoom / gesture.zoom }; draw(); return; }
  if (!pointer || e.pointerId !== pointer.id) return; const p = locate(e);
  if (tool === 'pen' || tool === 'marker') { let samples; try { samples = e.getCoalescedEvents?.(); } catch { /* HTTP Safari falls back to ordinary Pointer Events. */ } for (const sample of samples?.length ? samples : [e]) if (points.length < 19000) points.push(locate(sample)); if (Date.now() - liveAt > 70) { liveAt = Date.now(); const stroke = currentStroke(); sendLive({ ...stroke, points: points.slice(-300) }); } }
  if (tool === 'hand') pan = { x: pointer.pan.x + e.clientX - pointer.screen[0], y: pointer.pan.y + e.clientY - pointer.screen[1] };
  if (tool === 'eraser') eraseAt(p);
  if (tool === 'select') { if (dragging?.length) for (const o of dragging) state.objects[o.id] = { ...o, x: o.x + p[0] - pointer.start[0], y: o.y + p[1] - pointer.start[1] }; else lasso.push(p.slice(0, 2)); }
  draw();
});
async function finish(e) {
  touchPoints.delete(e.pointerId); if (touchPoints.size < 2) gesture = null;
  if (!pointer || pointer.id !== e.pointerId) return;
  const stroke = points.length ? currentStroke() : null;
  if (tool === 'select') { if (dragging?.length) { const changes = dragging.map(o => ({ kind: 'put', value: state.objects[o.id] })); dragging.forEach(o => { state.objects[o.id] = o; }); await enqueue(changes); } else if (lasso.length > 2) selection = visibleObjects().filter(o => { if (o.background) return false; const b = box(o); return inside([b.x + b.w / 2, b.y + b.h / 2], lasso); }).map(o => o.id); }
  pointer = null; points = []; lasso = []; dragging = null; sendLive(null);
  if (stroke) await enqueue([{ kind: 'put', value: stroke }]); draw();
}
canvas.addEventListener('pointerup', safe(finish)); canvas.addEventListener('pointercancel', safe(finish));
document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => { if (pointer) return; tool = button.dataset.tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected', b === button)); }; });
$('addPage').onclick = safe(async () => { const value = { id: uuid(), name: '绘图本 · ' + String(Object.keys(state.pages).length + 1).padStart(2, '0'), paper: $('paper').value }; await enqueue([{ kind: 'page', value }], false); page = value.id; selection = []; refreshPages(); fit(); });
$('paper').onchange = safe(() => enqueue([{ kind: 'page', value: { ...state.pages[page], paper: $('paper').value } }], false));
$('delete').onclick = safe(async () => { await enqueue(selection.map(target => ({ kind: 'remove', target }))); selection = []; draw(); });
$('undo').onclick = safe(async () => { const item = history.pop(); if (!item) return; const changes = item.changes.map((op, i) => item.undo[i] ? { kind: 'put', value: item.undo[i] } : { kind: 'remove', target: op.value?.id || op.target }); await enqueue(changes, false); future.push(item); });
$('redo').onclick = safe(async () => { const item = future.pop(); if (!item) return; await enqueue(item.changes, false); history.push(item); });
async function importImage(file) {
  if (!online) throw Error('图片导入需要连接电脑；已有笔迹可继续离线绘制');
  if (file.size > 8 * 1024 * 1024) throw Error('图片请控制在 8 MB 以内');
  status('正在同步图片…'); const result = await api('/api/image', { method: 'POST', body: file });
  const w = Math.min(700, result.width), h = result.height * w / result.width;
  const value = { id: uuid(), type: 'image', page, asset: result.asset, x: 100, y: 120, w, h };
  await enqueue([{ kind: 'put', value }]); selection = [value.id]; document.querySelector('[data-tool=select]').click();
}
$('image').onclick = () => $('file').click(); $('file').onchange = safe(async () => { if ($('file').files[0]) await importImage($('file').files[0]); $('file').value = ''; });
for (const [id, factor] of [['shrink', .8], ['enlarge', 1.25]]) $(id).onclick = safe(() => enqueue(visibleObjects().filter(o => selection.includes(o.id) && o.type === 'image' && !o.background).map(o => ({ kind: 'put', value: { ...o, w: Math.max(10, Math.min(5000, o.w * factor)), h: Math.max(10, Math.min(5000, o.h * factor)) } }))));
$('pdf').onclick = () => $('pdfFile').click();
$('pdfFile').onchange = safe(async () => {
  const file = $('pdfFile').files[0]; if (!file) return;
  if (!online) throw Error('请连接电脑后导入 PDF');
  if (file.size > 20 * 1024 * 1024) throw Error('PDF 请控制在 20 MB 以内');
  const pdfjs = await import('/pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    if (document.numPages > 30 || Object.keys(state.pages).length + document.numPages > 100) throw Error('单次最多 30 页，绘图本最多 100 页');
    for (let n = 1; n <= document.numPages; n++) {
      status(`导入 PDF ${n}/${document.numPages}`);
      const pdfPage = await document.getPage(n), base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(PAGE_W / base.width, PAGE_H / base.height) });
      const target = window.document.createElement('canvas'); target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      await pdfPage.render({ canvasContext: target.getContext('2d'), viewport }).promise;
      const blob = await new Promise(resolve => target.toBlob(resolve, 'image/png'));
      const image = await api('/api/image', { method: 'POST', body: blob });
      const pageId = uuid(); await enqueue([{ kind: 'page', value: { id: pageId, name: file.name.replace(/\.pdf$/i, '').slice(0, 60) + ' · ' + n, paper: 'plain' } },
        { kind: 'put', value: { id: uuid(), page: pageId, type: 'image', asset: image.asset, x: (PAGE_W - target.width) / 2, y: 0, w: target.width, h: target.height, background: true } }], false);
      page = pageId; pdfPage.cleanup();
    }
    refreshPages(); fit(); badge();
  } finally { await document.destroy(); $('pdfFile').value = ''; }
});
document.addEventListener('paste', safe(async event => { const item = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (item) { event.preventDefault(); await importImage(item.getAsFile()); } }));
canvas.addEventListener('dragover', e => e.preventDefault()); canvas.addEventListener('drop', safe(async e => { e.preventDefault(); for (const file of e.dataTransfer.files) if (file.type.startsWith('image/')) await importImage(file); }));
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); } });
function changeZoom(factor) { const previous = zoom; zoom = Math.max(.15, Math.min(3, zoom * factor)); const x = canvas.clientWidth / 2, y = canvas.clientHeight / 2; pan = { x: x - (x - pan.x) * zoom / previous, y: y - (y - pan.y) * zoom / previous }; draw(); }
$('zoomIn').onclick = () => changeZoom(1.2); $('zoomOut').onclick = () => changeZoom(1 / 1.2); $('fit').onclick = fit;
canvas.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) changeZoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); else { pan.x -= e.deltaX; pan.y -= e.deltaY; draw(); } }, { passive: false });
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
$('export').onclick = safe(async () => { await Promise.all(visibleObjects().filter(o => o.type === 'image').map(o => { const image = imageFor(o.asset); return image.decode(); })); canvas.width = PAGE_W; canvas.height = PAGE_H; ctx.setTransform(1, 0, 0, 1, 0, 0); paintPage(true); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (blob) download(blob, (state.pages[page]?.name || '绘图') + '.png'); draw(); });
$('backup').onclick = safe(async () => { const images = {}; for (const o of Object.values(state.objects)) if (o.type === 'image' && !images[o.asset]) { const response = await fetch('/api/image/' + o.asset + query); if (!response.ok) throw Error('图片备份失败，请连接电脑后重试'); const blob = await response.blob(); images[o.asset] = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); }); } download(new Blob([JSON.stringify({ version: 1, pages: state.pages, objects: state.objects, images, pending })], { type: 'application/json' }), 'Toolbox-绘图本.json'); });
$('reconnect').onclick = () => location.reload();
window.addEventListener('online', () => { connect(); });
document.addEventListener('visibilitychange', () => { active = !document.hidden; if (active && ready) { connect(); draw(); } });
new ResizeObserver(() => { if (!fitted) fit(); else draw(); }).observe($('viewport'));
setInterval(() => { if (active) { for (const [id, item] of live) if (Date.now() - item.at > 4000) live.delete(id); if (live.size) draw(); if (online) flush(); } }, 2000);
(async () => {
  if (!id || !token) { $('pair').showModal(); return; }
  db = await openDb(); pending = await storage('readonly', s => s.get(key + ':pending')) || [];
  const saved = await storage('readonly', s => s.get(key + ':state')); if (saved) state = saved;
  ready = true; overlayPending(); refreshPages(); draw(); connect();
})().catch(e => status('无法安全保存绘图：' + e.message, false));
