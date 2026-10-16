import { h } from '../../core/ui.js';
import { LIMITS, ASSUMPTIONS, EXAMPLE, formatCm, makeLayout, importLayout, serializeLayout, checkAbort } from './model.mjs';
const css = `.t089{display:grid;gap:12px;color:var(--text);max-width:1200px;margin:auto}.t089 label{display:grid;gap:6px}.t089 input,.t089 textarea,.t089 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.t089 textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace}.t089 .t089-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.t089 .t089-row>label{flex:1;min-width:135px}.t089 .t089-check{display:flex;align-items:center;gap:8px}.t089 .t089-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t089 .t089-status{padding:10px;background:var(--bg-sunken);white-space:pre-wrap}.t089 .t089-scroll{overflow:auto;max-height:400px}.t089 td,.t089 th{padding:8px;border-bottom:1px solid var(--line);min-width:95px;max-width:280px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;vertical-align:top}.t089 table{border-collapse:collapse;width:100%;font-size:13px}.t089 th{position:sticky;top:0;background:var(--bg-raised)}.t089 svg{display:block;width:100%;height:440px;border:1px solid var(--line);border-radius:8px;background:#fff;touch-action:none}.t089 svg [data-item-id]{cursor:grab;outline:none}.t089 svg [data-item-id]:focus rect{stroke:#0f172a;stroke-width:4}.t089 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t089 button:disabled{opacity:.5}`;
const label = (title, control) => h('label', {}, title, control);
const button = (title, action, primary = false) => h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', onclick: action }, title);
const cmInput = (title, value) => h('input', { type: 'text', inputmode: 'decimal', maxlength: 20, 'aria-label': title, value });
function s(tag, attributes = {}, text) { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value)); if (text !== undefined) element.textContent = text; return element; }
function table(headers, rows) { return h('div', { class: 't089-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...headers.map(value => h('th', {}, value)))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(value => h('td', {}, value))))))); }
async function readUTF8(file, signal) {
  if (file.size > LIMITS.importBytes) throw new Error('导入文件超过256 KiB。');
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader(), clean = () => signal.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    reader.onload = () => { clean(); resolve(reader.result); }; reader.onerror = () => { clean(); reject(new Error('文件读取失败。')); }; reader.onabort = () => { clean(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
  checkAbort(signal); try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw new Error('文件不是有效UTF-8，当前布局未替换。'); }
}
export default {
  id: 'T089',
  create(root) {
    let items = [{ id: 'I1', name: '物件1', width: '100.0', height: '50.0', x: '0.0', y: '0.0', allowRotate: true, rotation: 0 }], selected = 'I1', report = null, busy = false, alive = true, active = true, operation = null, drag = null, groups = new Map();
    const roomWidth = cmInput('房间宽厘米', '400.0'), roomHeight = cmInput('房间高厘米', '300.0');
    const picker = h('select', { 'aria-label': '选择摆放物件' }), name = h('input', { 'aria-label': '所选物件名称', maxlength: 80 });
    const width = cmInput('所选物件原始宽厘米', ''), height = cmInput('所选物件原始高厘米', ''), x = cmInput('所选物件x厘米', ''), y = cmInput('所选物件y厘米', '');
    const allowRotate = h('input', { type: 'checkbox', 'aria-label': '所选物件允许90度旋转' });
    const rotation = h('select', { 'aria-label': '所选物件旋转角度' }, h('option', { value: 0 }, '0°'), h('option', { value: 90 }, '90°（原始宽高交换）')); const option90 = rotation.children[1];
    const status = h('div', { class: 't089-status', role: 'status', 'aria-live': 'polite' });
    const resultHost = h('div'), svg = s('svg', { 'aria-label': '矩形摆放比例平面图', role: 'group', preserveAspectRatio: 'xMidYMid meet', tabindex: 0 }), detail = h('div');
    const file = h('input', { type: 'file', accept: '.json', 'aria-label': '导入T089布局JSON文件' }), pasted = h('textarea', { 'aria-label': '待导入T089布局JSON', rows: 4, placeholder: '版本1 T089草稿或完整JSON结果；导入时忽略旧检查并重算。' });
    const files = window.toolbox?.files, safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const item = () => items.find(item => item.id === selected), say = value => { if (alive) status.textContent = value; };
    const setControls = () => {
      if (!alive) return; const locked = busy || !!drag || !active;
      for (const control of panel.querySelectorAll('input,textarea,select,button')) control.disabled = locked;
      cancel.disabled = !busy && !drag;
      if (!locked) { add.disabled = items.length >= LIMITS.items; remove.disabled = items.length <= 1; json.disabled = svgSave.disabled = markdown.disabled = !report || !safeSave(); rotate.disabled = !item()?.allowRotate; option90.disabled = !item()?.allowRotate; }
      svg.setAttribute('aria-disabled', String(locked || !report));
    };
    const refreshPicker = () => { picker.replaceChildren(...items.map(item => h('option', { value: item.id }, `${item.id} ${item.name}`))); picker.value = selected; };
    const refreshEditor = () => {
      const current = item(); if (!current) return; name.value = current.name; width.value = current.width; height.value = current.height; x.value = current.x; y.value = current.y; allowRotate.checked = current.allowRotate; rotation.value = String(current.rotation);
    };
    const config = () => ({ unit: 'cm', room: { width: roomWidth.value, height: roomHeight.value }, items: items.map(item => ({ ...item })) });
    const focusSelected = () => groups.get(selected)?.focus?.({ preventScroll: true });
    const draw = () => {
      groups = new Map();
      if (!report) { svg.setAttribute('viewBox', '0 0 100 60'); svg.replaceChildren(s('text', { x: 2, y: 30, 'font-size': 4, fill: '#111827' }, '请修正输入，旧图形检查已废弃。')); return; }
      const view = drag?.view || report.view; svg.setAttribute('viewBox', `${view.minX} ${view.minY} ${view.width} ${view.height}`);
      const fontSize = Math.max(5, Math.ceil(Math.max(view.width / 65, view.height / 32))), nodes = [s('title', {}, '二维矩形摆放：x向右，y向下，坐标原点为房间左上'), s('desc', {}, '厘米输入，SVG内部单位毫米。Tab选中物件后可用方向键和R；触边不算重叠。'), s('rect', { x: 0, y: 0, width: report.room.widthMm, height: report.room.heightMm, fill: '#edf2f7', stroke: '#475569', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }), s('text', { x: 0, y: -fontSize / 2, 'font-size': fontSize, fill: '#111827', 'pointer-events': 'none' }, `房间${formatCm(report.room.widthMm)}×${formatCm(report.room.heightMm)}cm；(0,0)，x→ y↓`)];
      for (const rectangle of report.rects) {
        const group = s('g', { 'data-item-id': rectangle.id, tabindex: 0, role: 'button', 'aria-label': `${rectangle.id} ${rectangle.name}，x${formatCm(rectangle.xMm)} y${formatCm(rectangle.yMm)}厘米，${rectangle.rotation}度；方向键移动，R旋转`, 'aria-pressed': rectangle.id === selected });
        group.append(s('title', {}, `${rectangle.id} ${rectangle.name}：${rectangle.outOfBounds ? '出界' : '边界内'}，重叠${rectangle.overlaps.join(',') || '无'}`),
          s('rect', { x: rectangle.xMm, y: rectangle.yMm, width: rectangle.widthMm, height: rectangle.heightMm, fill: rectangle.outOfBounds || rectangle.overlaps.length ? '#fb923c' : '#93c5fd', 'fill-opacity': 0.55, stroke: rectangle.id === selected ? '#0f172a' : '#1e3a8a', 'stroke-width': rectangle.id === selected ? 3 : 2, 'vector-effect': 'non-scaling-stroke' }),
          s('text', { x: rectangle.xMm + fontSize / 3, y: rectangle.yMm + fontSize, 'font-size': fontSize, fill: '#111827', 'pointer-events': 'none' }, `${rectangle.id} ${rectangle.name.length > 24 ? rectangle.name.slice(0, 24) + '…' : rectangle.name}`));
        group.addEventListener('pointerdown', event => beginDrag(event, rectangle.id)); group.addEventListener('keydown', event => onKey(event, rectangle.id)); groups.set(rectangle.id, group); nodes.push(group);
      }
      svg.replaceChildren(...nodes);
    };
    const recompute = (message = '') => {
      if (!alive) return; report = null; detail.replaceChildren();
      try {
        report = makeLayout(config());
        resultHost.replaceChildren(h('h3', {}, `出界${report.outOfBounds.length}物件 · 重叠${report.overlaps.length}对 · 二维检查${report.isValidPlacement ? '通过' : '存在问题'}`),
          table(['物件/当前占地(cm)', '左上角x/y(cm)', '方向', '出界边及超出长度(cm)', '重叠对象'], report.rects.map(rectangle => [
            `${rectangle.id} ${rectangle.name} · ${formatCm(rectangle.widthMm)}×${formatCm(rectangle.heightMm)}`, `${formatCm(rectangle.xMm)}, ${formatCm(rectangle.yMm)}`, `${rectangle.rotation}°`,
            rectangle.outOfBounds ? ['leftMm', 'topMm', 'rightMm', 'bottomMm'].filter(key => rectangle.overflow[key] > 0).map(key => `${({ leftMm: '左', topMm: '上', rightMm: '右', bottomMm: '下' })[key]}${formatCm(rectangle.overflow[key])}`).join('；') : '边界内（贴边允许）', rectangle.overlaps.join('、') || '无'
          ])), h('p', { class: 't089-muted' }, `正面积交集：${report.overlaps.map(pair => `${pair.leftId}/${pair.rightId} ${pair.intersection.areaMm2}mm²`).join('；') || '无'}。仅二维矩形占地，不能据此判断能否搬入门口或三维空间。`));
        say((message ? message + '\n' : '') + `已按整数毫米重算：出界${report.outOfBounds.length}，重叠${report.overlaps.length}对。${drag ? '正在拖动：视野固定，释放后包含完整出界轮廓；Esc/取消恢复原位置。' : '不会自动夹到房间内；图形与副本保留所有位置。'}`);
      } catch (error) { resultHost.replaceChildren(); say('输入改变，旧检查已废弃。' + error.message); }
      draw(); setControls();
    };
    const choose = id => { if (!alive || !active || busy || drag || !items.some(item => item.id === id)) return; selected = id; picker.value = id; refreshEditor(); draw(); setControls(); };
    const move = (xMm, yMm, message = '') => {
      if (!Number.isSafeInteger(xMm) || !Number.isSafeInteger(yMm) || Math.abs(xMm) > LIMITS.coordinateMm || Math.abs(yMm) > LIMITS.coordinateMm) { say('超坐标硬限额：−20000.0至20000.0cm，拒绝此次更新，未夹紧到房间内。'); return false; }
      const current = item(); current.x = formatCm(xMm); current.y = formatCm(yMm); x.value = current.x; y.value = current.y; recompute(message); if (drag) focusSelected(); return true;
    };
    const rotateSelected = () => {
      if (!alive || !active || busy || drag || !item()?.allowRotate) return; item().rotation = item().rotation === 0 ? 90 : 0; rotation.value = String(item().rotation); recompute('旋转90°切换，当前左上角保持不变。'); focusSelected();
    };
    function onKey(event, id = selected) {
      if (!alive || !active || busy) return;
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(false); return; }
      if (drag || !report || event.ctrlKey || event.metaKey) return;
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); choose(id); focusSelected(); return; }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction && !['r', 'R'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); choose(id);
      if (direction) { const rectangle = report.rects.find(item => item.id === selected), step = event.altKey ? 1 : event.shiftKey ? 100 : 10; move(rectangle.xMm + direction[0] * step, rectangle.yMm + direction[1] * step, '键盘移动后已重算。'); focusSelected(); }
      else { rotateSelected(); focusSelected(); }
    }
    const point = event => {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) throw new Error('指针屏幕坐标不合法。');
      const matrix = svg.getScreenCTM(); if (!matrix) throw new Error('当前环境缺少SVG坐标变换，请使用数值或键盘编辑。'); const position = svg.createSVGPoint(); position.x = event.clientX; position.y = event.clientY;
      const local = position.matrixTransform(matrix.inverse()); if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) throw new Error('SVG坐标变换不合法。'); return local;
    };
    function beginDrag(event, id) {
      if (!alive || !active || busy || drag || !report || event.button !== 0 || event.isPrimary === false) return;
      let captured = false;
      try {
        const local = point(event); svg.setPointerCapture(event.pointerId); captured = true; event.preventDefault(); selected = id; picker.value = id; refreshEditor();
        const rectangle = report.rects.find(item => item.id === id); drag = { pointerId: event.pointerId, id, startPoint: local, xMm: rectangle.xMm, yMm: rectangle.yMm, view: { ...report.view } }; draw(); focusSelected(); setControls(); say('正在拖动：按真实SVG逆变换计算，1mm步进；释放重算完整视野，Esc或取消恢复拖动前位置。');
      } catch (error) { drag = null; if (captured) { try { svg.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ } } setControls(); say('无法开始拖动：' + error.message + ' 请用数值或键盘编辑。'); }
    }
    const pointerMove = event => {
      if (!alive || !active || !drag || event.pointerId !== drag.pointerId) return; event.preventDefault();
      try { const local = point(event); move(Math.round(drag.xMm + local.x - drag.startPoint.x), Math.round(drag.yMm + local.y - drag.startPoint.y)); } catch (error) { say(error.message); }
    };
    function finishDrag(commit, focus = true) {
      if (!drag) return; const previous = drag; drag = null;
      if (!commit) { const current = items.find(item => item.id === previous.id); if (current) { current.x = formatCm(previous.xMm); current.y = formatCm(previous.yMm); } }
      try { if (svg.hasPointerCapture(previous.pointerId)) svg.releasePointerCapture(previous.pointerId); } catch { /* Pointer already released by host. */ }
      if (alive) { refreshEditor(); recompute(commit ? '拖动位置已保留，视野包含所有出界部分。' : '拖动已取消，恢复拖动前坐标。'); if (focus) focusSelected(); }
    }
    const pointerUp = event => { if (drag?.pointerId === event.pointerId) { if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) pointerMove(event); finishDrag(true); } };
    const pointerCancel = event => { if (drag?.pointerId === event.pointerId) finishDrag(false); };
    const dragListeners = [['pointermove', pointerMove], ['pointerup', pointerUp], ['pointercancel', pointerCancel], ['lostpointercapture', pointerCancel], ['keydown', onKey]];
    let listenersAttached = false;
    const attach = () => { if (listenersAttached) return; for (const [type, listener] of dragListeners) svg.addEventListener(type, listener); listenersAttached = true; };
    const detach = () => { if (!listenersAttached) return; for (const [type, listener] of dragListeners) svg.removeEventListener(type, listener); listenersAttached = false; }; attach();
    picker.addEventListener('change', () => choose(picker.value)); roomWidth.addEventListener('input', () => recompute()); roomHeight.addEventListener('input', () => recompute());
    for (const [control, field] of [[name, 'name'], [width, 'width'], [height, 'height'], [x, 'x'], [y, 'y']]) control.addEventListener('input', () => { item()[field] = control.value; if (field === 'name') refreshPicker(); recompute(); });
    rotation.addEventListener('change', () => { item().rotation = Number(rotation.value); recompute('旋转角度已改变，左上角位置保持。'); });
    allowRotate.addEventListener('change', () => { if (!allowRotate.checked && item().rotation !== 0) { allowRotate.checked = true; say('请先恢复0°再关闭允许旋转；当前角度未改变。'); return; } item().allowRotate = allowRotate.checked; recompute(); });
    const add = button('添加矩形物件', () => { if (items.length >= LIMITS.items) return; const id = Array.from({ length: LIMITS.items }, (_, index) => 'I' + (index + 1)).find(id => !items.some(item => item.id === id)); items.push({ id, name: `物件${id}`, width: '50.0', height: '50.0', x: '0.0', y: '0.0', allowRotate: true, rotation: 0 }); selected = id; refreshPicker(); refreshEditor(); recompute('新物件放在原点；可能与现有物件重叠，请自行调整。'); });
    const remove = button('移除所选物件', () => { if (items.length <= 1) return; items = items.filter(item => item.id !== selected); selected = items[0].id; refreshPicker(); refreshEditor(); recompute(); });
    const rotate = button('旋转所选物件90°', rotateSelected), recheck = button('重新检查全部物件', () => recompute(), true);
    const loadConfig = input => { const result = makeLayout(input); roomWidth.value = result.draft.config.room.width; roomHeight.value = result.draft.config.room.height; items = result.draft.config.items.map(item => ({ ...item })); selected = items[0].id; refreshPicker(); refreshEditor(); recompute('配置已恢复，全部几何检查重新计算。'); };
    const example = button('载入100×50放入80×60示例', () => loadConfig(EXAMPLE));
    const importText = async source => { const result = await importLayout(source, { signal: operation.signal }); if (!alive) return; loadConfig(result.draft.config); };
    const importPaste = button('导入粘贴的版本1布局', async () => {
      if (busy || drag) return; const controller = new AbortController(); operation = controller; busy = true; setControls(); say('正在校验并重算布局…');
      try { await importText(pasted.value); } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; busy = false; setControls(); } }
    });
    file.addEventListener('change', async () => {
      const selectedFile = file.files?.[0]; if (!selectedFile || busy || drag) return; const controller = new AbortController(); operation = controller; busy = true; setControls(); say('正在读取UTF-8布局…');
      try { await importText(await readUTF8(selectedFile, controller.signal)); } catch (error) { say(error.message); } finally { file.value = ''; if (operation === controller) { operation = null; busy = false; setControls(); } }
    });
    const cancel = button('取消当前操作或拖动', () => { operation?.abort(); finishDrag(false); });
    const save = async format => {
      if (!report || busy || drag || !safeSave()) return; const controller = new AbortController(); operation = controller; busy = true; setControls(); say('正在生成完整副本…');
      try {
        const content = await serializeLayout(report, format, { signal: controller.signal }); if (!alive || controller.signal.aborted) return; cancel.disabled = true; say('副本已生成，请在另存对话框核对目标或取消。');
        const response = await files.saveText({ content, extension: format, defaultName: `rectangle-layout-copy.${format}`, copyOnly: true });
        if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; busy = false; setControls(); } }
    };
    const json = button('保存完整 JSON 布局副本', () => save('json')), svgSave = button('保存比例 SVG 副本', () => save('svg')), markdown = button('保存完整 Markdown 副本', () => save('md'));
    const panel = h('section', { class: 't089' }, h('style', {}, css), h('h2', {}, '尺寸摆放试算'),
      h('p', { class: 't089-muted' }, '纯本地二维静态矩形占地；不判断门口或三维搬运，不自动寻找最佳摆放。所有输入单位cm、最多一位小数；内部整数毫米。1–30物件，宽高0.1–10000cm，x/y为−20000至20000cm。'),
      h('div', { class: 't089-row' }, label('房间宽（cm）', roomWidth), label('房间高（cm）', roomHeight)), example,
      h('div', { class: 't089-row' }, label('选择物件', picker), add, remove),
      h('div', { class: 't089-row' }, label('物件名称', name), label('原始宽（cm）', width), label('原始高（cm）', height), label('左上角x（cm）', x), label('左上角y（cm）', y)),
      h('div', { class: 't089-row' }, h('label', { class: 't089-check' }, allowRotate, '允许90°旋转'), label('角度（左上角保持）', rotation), rotate, recheck, cancel),
      h('p', { class: 't089-muted' }, '拖放选择物件，Tab可聚焦图形；方向键1cm、Shift+方向键10cm、Alt+方向键0.1cm、R旋转、Esc取消。也可直接编辑坐标。原点为房间左上角，x向右、y向下。蓝色为无问题物件，橙色为出界或重叠；选中边框更深。'),
      status, svg, h('p', { class: 't089-muted' }, '平面图等比例包含房间及所有出界轮廓；拖动时视野固定，释放后重算视野。出界位置不夹紧。贴边/角接触不算重叠。'), resultHost,
      h('div', { class: 't089-row' }, json, svgSave, markdown), safeSave() ? null : h('p', { class: 't089-muted' }, '基础层缺少副本保护，导出已禁用，请使用支持copyOnly的版本。'),
      h('details', {}, h('summary', {}, '假设与限制'), ...Object.values(ASSUMPTIONS).map(value => h('p', { class: 't089-muted' }, value))),
      h('details', {}, h('summary', {}, '恢复草稿/完整JSON布局（忽略旧检查，重新计算）'), label('UTF-8版本1 T089 JSON', file), label('可选：粘贴版本1 JSON', pasted), importPaste),
      h('p', { class: 't089-muted' }, '切换具体功能会丢失未保存内容，请保存JSON布局以恢复。生成副本可取消；进入原生另存对话框后在对话框中取消。'), detail);
    root.replaceChildren(panel); refreshPicker(); refreshEditor(); recompute();
    return { activate() { if (alive) { active = true; attach(); setControls(); } }, deactivate() { active = false; operation?.abort(); finishDrag(false, false); detach(); setControls(); }, destroy() { operation?.abort(); alive = active = false; finishDrag(false, false); detach(); report = null; items = []; groups.clear(); root.replaceChildren(); } };
  }
};
