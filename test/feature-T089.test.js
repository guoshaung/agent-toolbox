const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T089/model.mjs');
const immediate = { yieldControl: async () => {} };
const item = (extra = {}) => ({ id: 'I1', name: '物件', width: '10.0', height: '10.0', x: '0.0', y: '0.0', allowRotate: true, rotation: 0, ...extra });
const config = (extra = {}) => ({ unit: 'cm', room: { width: '20.0', height: '20.0' }, items: [item()], ...extra });
async function layout(input = config()) { return (await model).makeLayout(input); }

test('T089: catalog100x50 into80x60 out-of-bounds before and after90° rotation', async () => {
  const { EXAMPLE } = await model, normal = await layout(EXAMPLE), rotated = await layout({ ...EXAMPLE, items: EXAMPLE.items.map(item => ({ ...item, rotation: 90 })) });
  assert.deepEqual(normal.outOfBounds, ['I1']); assert.equal(normal.rects[0].overflow.rightMm, 200); assert.equal(normal.rects[0].overflow.bottomMm, 0);
  assert.deepEqual([rotated.rects[0].widthMm, rotated.rects[0].heightMm], [500, 1000]); assert.equal(rotated.rects[0].overflow.bottomMm, 400); assert.equal(rotated.isValidPlacement, false);
});

test('T089: exact centimeter text to integer millimeter, fractional signed coordinates and limits', async () => {
  const { parseCm, formatCm } = await model;
  assert.equal(parseCm('0.1'), 1); assert.equal(parseCm('001.0'), 10); assert.equal(parseCm('-0.1', true), -1); assert.equal(parseCm('-0.0', true), 0); assert.equal(formatCm(-101), '-10.1');
  assert.equal(parseCm('10000.0'), 100000); assert.equal(parseCm('-20000.0', true), -200000);
  for (const value of ['', '.1', '1.', '0.01', '1.11', '1e2', ' 1', '1 ', '+1', '1,000', 'NaN', 'Infinity', '-1', '0', '10000.1', 1]) assert.throws(() => parseCm(value));
  for (const value of ['-20000.1', '20000.1', '--1']) assert.throws(() => parseCm(value, true));
});

test('T089: room boundary equality and edge/corner contact are allowed, no zero-area overlap', async () => {
  const result = await layout(config({ items: [item(), item({ id: 'I2', x: '10.0' }), item({ id: 'I3', x: '10.0', y: '10.0' })] }));
  assert.deepEqual(result.overlaps, []); assert.deepEqual(result.outOfBounds, []); assert.equal(result.isValidPlacement, true);
  const single = await layout(config({ items: [item({ width: '20', height: '20' })] })); assert.equal(single.isValidPlacement, true);
});

test('T089: one-millimeter overlap is positive exact area, no epsilon tolerance', async () => {
  const result = await layout(config({ items: [item(), item({ id: 'I2', x: '9.9' })] }));
  assert.deepEqual(result.overlaps[0].intersection, { xMm: 99, yMm: 0, widthMm: 1, heightMm: 100, areaMm2: 100 }); assert.deepEqual(result.rects.map(item => item.overlaps), [['I2'], ['I1']]);
});

test('T089: negative and positive out-of-bounds positions are preserved with all overflow sides', async () => {
  const result = await layout(config({ items: [item({ x: '-0.1', y: '-0.1', width: '21.0', height: '22.0' })] }));
  assert.deepEqual(result.rects[0].overflow, { leftMm: 1, topMm: 1, rightMm: 9, bottomMm: 19 }); assert.equal(result.draft.config.items[0].x, '-0.1'); assert.equal(result.rects[0].xMm, -1);
});

test('T089: coincident/contained rectangles detected once per pair, independent of input order', async () => {
  const items = [item({ width: '20', height: '20' }), item({ id: 'I2', width: '5', height: '5', x: '2', y: '3' }), item({ id: 'I3', width: '5', height: '5', x: '2', y: '3' })], result = await layout(config({ items }));
  assert.equal(result.overlaps.length, 3); assert.ok(result.overlaps.every(pair => pair.intersection.areaMm2 === 2500));
  const reverse = await layout(config({ items: [...items].reverse() })); assert.equal(reverse.overlaps.length, result.overlaps.length); assert.equal(reverse.rects.every(item => item.overlaps.length === 2), true);
});

test('T089: rotation swaps original dimensions, keeps exact top-left and does not auto-fit', async () => {
  const result = await layout(config({ items: [item({ width: '12.3', height: '4.5', x: '9.8', y: '-0.1', rotation: 90 })] }));
  assert.deepEqual([result.rects[0].originalWidthMm, result.rects[0].originalHeightMm, result.rects[0].widthMm, result.rects[0].heightMm, result.rects[0].xMm, result.rects[0].yMm], [123, 45, 45, 123, 98, -1]);
  assert.equal(result.rects[0].outOfBounds, true);
});

test('T089: exact rotation permission, unique IDs/names, strict rectangular schema and item count', async () => {
  for (const extra of [{ unit: 'mm' }, { items: [] }, { items: Array(31).fill(item()) }, { items: [item(), item()] }, { items: [item({ id: 'I31' })] }, { items: [item({ name: '' })] }, { items: [item({ name: ' x ' })] }, { items: [item({ name: '\n' })] }, { items: [item({ name: '\ud800' })] }, { items: [item({ name: '\uffff' })] }, { items: [item({ shape: 'circle' })] }, { items: [item({ rotation: 180 })] }, { items: [item({ allowRotate: false, rotation: 90 })] }, { items: [item({ allowRotate: 'yes' })] }, { room: { width: '0', height: '20' } }]) await assert.rejects(layout(config(extra)));
  assert.equal((await layout(config({ items: [item({ allowRotate: false })] }))).isValidPlacement, true);
});

test('T089: view contains every rectangle/room including distant positive and negative outliers', async () => {
  const result = await layout(config({ items: [item({ x: '-20000', y: '-20000' }), item({ id: 'I2', x: '20000', y: '20000', width: '10000', height: '10000' })] }));
  assert.ok(result.view.minX < -200000 && result.view.minY < -200000); assert.ok(result.view.minX + result.view.width > 300000 && result.view.minY + result.view.height > 300000);
  assert.equal(result.rects[1].xMm, 200000); assert.equal(result.rects[1].widthMm, 100000);
});

test('T089: smallest1mm geometry and maximum30 rectangles keep bounded exact checks', async () => {
  const tiny = await layout(config({ room: { width: '0.1', height: '0.1' }, items: [item({ width: '0.1', height: '0.1' })] })); assert.equal(tiny.isValidPlacement, true);
  const large = await layout(config({ room: { width: '10000', height: '10000' }, items: Array.from({ length: 30 }, (_, index) => item({ id: 'I' + (index + 1), width: '10000', height: '10000' })) }));
  assert.equal(large.overlaps.length, 435); assert.ok(large.overlaps.every(pair => pair.intersection.areaMm2 === 10000000000 && Number.isSafeInteger(pair.intersection.areaMm2)));
});

test('T089: largest dense30-item JSON export fits import caps and recovers all435 overlap pairs', async () => {
  const { serializeLayout, importLayout, LIMITS } = await model, report = await layout(config({ room: { width: '10000', height: '10000' }, items: Array.from({ length: 30 }, (_, index) => item({ id: 'I' + (index + 1), name: '中'.repeat(80), x: '-20000', y: '-20000', width: '10000', height: '10000' })) }));
  const saved = await serializeLayout(report, 'json', immediate); assert.ok(new TextEncoder().encode(saved).length < LIMITS.importBytes); assert.equal((await importLayout(saved, immediate)).overlaps.length, 435);
});

test('T089: versioned layout/draft import ignores forged checks/positions and recomputes geometry', async () => {
  const { importLayout, EXAMPLE } = await model, original = await layout(EXAMPLE); original.isValidPlacement = true; original.outOfBounds = []; original.rects[0].xMm = 12345; original.overlaps = [{ leftId: 'fake' }];
  const restored = await importLayout(JSON.stringify(original), immediate); assert.equal(restored.isValidPlacement, false); assert.deepEqual(restored.outOfBounds, ['I1']); assert.equal(restored.rects[0].xMm, 0); assert.deepEqual(restored.overlaps, []);
  assert.deepEqual(await importLayout(JSON.stringify(restored.draft), immediate), restored);
});

test('T089: import versions/structures/duplicates/precision/caps validated before replacing config', async () => {
  const { importLayout } = await model, original = await layout();
  for (const envelope of [{ ...original.draft, version: 2 }, { ...original.draft, feature: 'T084' }, { ...original.draft, kind: 'script' }, { ...original.draft, extra: true }, { feature: 'T089', version: 1, kind: 'layout' }]) await assert.rejects(importLayout(JSON.stringify(envelope), immediate));
  await assert.rejects(importLayout('{"feature":"T089","feature":"T089"}', immediate), /重复属性/u); await assert.rejects(importLayout('x'.repeat(262145), immediate), /256 KiB/u);
  const wrong = structuredClone(original.draft); wrong.config.items[0].width = 10; await assert.rejects(importLayout(JSON.stringify(wrong), immediate), /十进制文本/u);
  await assert.rejects(importLayout('[9007199254740993]', immediate), /不安全整数/u);
});

test('T089: SVG is self-contained XML-escaped data without scripts/external references and complete metadata', async () => {
  const { layoutSVG } = await model, report = await layout(config({ items: [item({ name: '\"</metadata><script>&\'' })] })), output = layoutSVG(report);
  assert.ok(output.startsWith('<?xml')); assert.ok(output.includes('xmlns="http://www.w3.org/2000/svg"')); assert.ok(output.includes('preserveAspectRatio="xMidYMid meet"')); assert.ok(output.includes('&lt;script&gt;')); assert.ok(output.includes('&quot;')); assert.ok(output.includes('&apos;')); assert.ok(!output.includes('<script>')); assert.ok(!output.includes('href=') && !output.includes('onload=') && !output.includes('<!DOCTYPE'));
  assert.ok(output.includes('<metadata>')); assert.ok(output.includes('outOfBounds')); assert.ok(output.includes('width="100"'));
});

test('T089: complete JSON/Markdown exports retain exact source dimensions, risk pairs and recoverable draft', async () => {
  const { serializeLayout } = await model, report = await layout(config({ items: [item(), item({ id: 'I2', name: '<b>|*x*`', x: '9.9', y: '-0.1' })] }));
  const json = JSON.parse(await serializeLayout(report, 'json', immediate)); assert.equal(json.rects[1].xMm, 99); assert.equal(json.overlaps.length, 1); assert.equal(json.draft.config.items[1].y, '-0.1'); assert.ok(json.assumptions.scope);
  const md = await serializeLayout(report, 'md', immediate); assert.ok(md.includes('I1/I2')); assert.ok(md.includes('版本1恢复草稿')); assert.ok(md.includes('&lt;b&gt;\\|\\*x\\*\\`'));
});

test('T089: canceled import/export leave no partial data; unsupported output/cap reject safely', async () => {
  const { importLayout, serializeLayout, LIMITS } = await model, report = await layout(), controller = new AbortController(), aborting = { signal: controller.signal, yieldControl: async () => controller.abort() };
  await assert.rejects(importLayout(JSON.stringify(report.draft), aborting), { name: 'AbortError' }); await assert.rejects(serializeLayout(report, 'json', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(serializeLayout(report, 'csv', immediate), /只支持/u); report.assumptions.extra = 'x'.repeat(LIMITS.outputBytes); await assert.rejects(serializeLayout(report, 'json', immediate), /512 KiB/u);
});

// DOM fixture with capture and full letterboxed SVG CTM math, not native browser/IPC QA.
class Element {
  constructor(tag, namespace = 'html') { this.tagName = tag; this.namespaceURI = namespace; this.nodeType = 1; this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; this.checked = false; this.captured = new Set(); this.box = { x: 100, y: 200, width: 1200, height: 800 }; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; if (key === 'checked') this.checked = true; if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/gu, (_, char) => char.toUpperCase())] = String(value); }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  removeEventListener(name, action) { this.listeners[name] = (this.listeners[name] || []).filter(other => other !== action); }
  append(...children) { for (const child of children) { const node = child.nodeType ? child : { nodeType: 3, textContent: String(child) }; node.parentNode = this; this.children.push(node); } if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) { return descendants(this).filter(child => selector.split(',').includes(child.tagName)); }
  focus() { document.activeElement = this; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  getScreenCTM() { const [minX, minY, width, height] = this.attributes.viewBox.split(' ').map(Number), scale = Math.min(this.box.width / width, this.box.height / height), e = this.box.x + (this.box.width - width * scale) / 2 - minX * scale, f = this.box.y + (this.box.height - height * scale) / 2 - minY * scale; return { a: scale, b: 0, c: 0, d: scale, e, f, inverse() { return { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: -e / scale, f: -f / scale }; } }; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform(matrix) { return { x: matrix.a * this.x + matrix.c * this.y + matrix.e, y: matrix.b * this.x + matrix.d * this.y + matrix.f }; } }; }
  async fire(type, extra = {}) { if (this.disabled) return; const event = { button: 0, isPrimary: true, pointerId: 1, key: '', ...extra, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, path = []; for (let node = this; node; node = node.parentNode) path.push(node); for (const node of path) { event.currentTarget = node; for (const action of node.listeners?.[type] || []) await action(event); if (event.stopped || extra.bubbles === false) break; } return event; }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(element => element.tagName === 'button' && element.textContent === title); }
function control(root, title) { return descendants(root).find(element => element.attributes['aria-label'] === title); }
function graphic(root, id = 'I1') { return descendants(root).find(element => element.attributes['data-item-id'] === id); }
function screen(svg, x, y) { const matrix = svg.getScreenCTM(); return { clientX: matrix.a * x + matrix.e, clientY: matrix.d * y + matrix.f }; }
const safeFiles = saved => ({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } });
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createElementNS: (namespace, tag) => new Element(tag, namespace), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T089/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T089 UI: namespace SVG, catalog out-of-bounds both orientations and3 copyOnly exports', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    const svg = control(root, '矩形摆放比例平面图'); assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg'); await button(root, '载入100×50放入80×60示例').fire('click'); assert.match(root.textContent, /出界1物件/u); assert.match(root.textContent, /右20\.0/u);
    await button(root, '旋转所选物件90°').fire('click'); assert.match(root.textContent, /下40\.0/u); assert.equal(control(root, '所选物件旋转角度').value, '90');
    for (const title of ['保存完整 JSON 布局副本', '保存比例 SVG 副本', '保存完整 Markdown 副本']) await button(root, title).fire('click'); assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['svg', true], ['md', true]]);
    const result = JSON.parse(saved[0].content); assert.equal(result.isValidPlacement, false); assert.equal(result.rects[0].xMm, 0); assert.ok(saved[1].content.includes('<metadata>'));
  });
});

test('T089 UI: item picker/name/dimensions/x/y updates selected item, overlap report and no clamping', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    await button(root, '添加矩形物件').fire('click'); assert.match(root.textContent, /重叠1对/u); control(root, '所选物件名称').value = '第二物件'; await control(root, '所选物件名称').fire('input');
    control(root, '所选物件x厘米').value = '200.0'; await control(root, '所选物件x厘米').fire('input'); assert.match(root.textContent, /重叠0对/u);
    control(root, '选择摆放物件').value = 'I1'; await control(root, '选择摆放物件').fire('change'); control(root, '所选物件原始宽厘米').value = '90.1'; await control(root, '所选物件原始宽厘米').fire('input'); control(root, '所选物件y厘米').value = '-0.1'; await control(root, '所选物件y厘米').fire('input');
    await button(root, '保存完整 JSON 布局副本').fire('click'); const report = JSON.parse(saved[0].content); assert.equal(report.rects[0].yMm, -1); assert.equal(report.rects[0].widthMm, 901); assert.equal(report.rects[1].xMm, 2000); assert.equal(report.rects[1].name, '第二物件');
  });
});

test('T089 UI: invalid fractional input discards old geometry/export then recovers', async () => {
  await withUI(safeFiles([]), async root => {
    control(root, '所选物件x厘米').value = '0.01'; await control(root, '所选物件x厘米').fire('input'); assert.equal(button(root, '保存完整 JSON 布局副本').disabled, true); assert.equal(graphic(root), undefined); assert.match(root.textContent, /旧检查已废弃/u);
    control(root, '所选物件x厘米').value = '0.1'; await control(root, '所选物件x厘米').fire('input'); assert.ok(graphic(root)); assert.equal(button(root, '保存完整 JSON 布局副本').disabled, false);
  });
});

test('T089 UI: bubbling keyboard arrows move once, modifier steps, R rotate and explicit rotation permission', async () => {
  await withUI(safeFiles([]), async root => {
    await graphic(root).fire('keydown', { key: 'ArrowRight' }); assert.equal(control(root, '所选物件x厘米').value, '1.0'); assert.equal(document.activeElement, graphic(root));
    await graphic(root).fire('keydown', { key: 'ArrowDown', shiftKey: true }); assert.equal(control(root, '所选物件y厘米').value, '10.0'); await graphic(root).fire('keydown', { key: 'ArrowLeft', altKey: true }); assert.equal(control(root, '所选物件x厘米').value, '0.9');
    await graphic(root).fire('keydown', { key: 'r' }); assert.equal(control(root, '所选物件旋转角度').value, '90'); const allowed = control(root, '所选物件允许90度旋转'); allowed.checked = false; await allowed.fire('change'); assert.equal(allowed.checked, true);
    control(root, '所选物件旋转角度').value = '0'; await control(root, '所选物件旋转角度').fire('change'); allowed.checked = false; await allowed.fire('change'); assert.equal(button(root, '旋转所选物件90°').disabled, true);
    await graphic(root).fire('keydown', { key: 'r' }); assert.equal(control(root, '所选物件旋转角度').value, '0'); assert.equal(document.activeElement, graphic(root));
  });
});

test('T089 UI: actual letterboxed inverse CTM drag/capture, ignored second pointer, up coordinates and fit outliers', async () => {
  await withUI(safeFiles([]), async root => {
    const svg = control(root, '矩形摆放比例平面图'), originalView = svg.attributes.viewBox, down = screen(svg, 50, 20);
    await graphic(root).fire('pointerdown', { pointerId: 7, ...down }); assert.ok(svg.hasPointerCapture(7)); assert.equal(control(root, '房间宽厘米').disabled, true);
    await svg.fire('pointermove', { pointerId: 8, ...screen(svg, 150, 20) }); assert.equal(control(root, '所选物件x厘米').value, '0.0');
    await svg.fire('pointermove', { pointerId: 7, ...screen(svg, 65, 14) }); assert.equal(control(root, '所选物件x厘米').value, '1.5'); assert.equal(control(root, '所选物件y厘米').value, '-0.6'); assert.equal(svg.attributes.viewBox, originalView); assert.equal(document.activeElement, graphic(root));
    await svg.fire('pointerup', { pointerId: 7, ...screen(svg, 76, 9) }); assert.equal(control(root, '所选物件x厘米').value, '2.6'); assert.equal(control(root, '所选物件y厘米').value, '-1.1'); assert.equal(svg.hasPointerCapture(7), false); assert.notEqual(svg.attributes.viewBox, originalView); assert.match(root.textContent, /上1\.1/u);
  });
});

test('T089 UI: graphic drag selects second item and preserves its original nonzero grab offset', async () => {
  await withUI(safeFiles([]), async root => {
    await button(root, '添加矩形物件').fire('click'); control(root, '所选物件x厘米').value = '100.0'; await control(root, '所选物件x厘米').fire('input'); control(root, '所选物件y厘米').value = '100.0'; await control(root, '所选物件y厘米').fire('input');
    control(root, '选择摆放物件').value = 'I1'; await control(root, '选择摆放物件').fire('change'); const svg = control(root, '矩形摆放比例平面图');
    await graphic(root, 'I2').fire('pointerdown', { pointerId: 6, ...screen(svg, 1005, 1005) }); assert.equal(control(root, '选择摆放物件').value, 'I2');
    await svg.fire('pointermove', { pointerId: 6, ...screen(svg, 1030, 1055) }); await svg.fire('pointerup', { pointerId: 6 });
    assert.equal(control(root, '所选物件x厘米').value, '102.5'); assert.equal(control(root, '所选物件y厘米').value, '105.0');
  });
});

test('T089 UI: unavailable capture gracefully leaves numeric and keyboard alternatives operable', async () => {
  await withUI(safeFiles([]), async root => {
    const svg = control(root, '矩形摆放比例平面图'); svg.setPointerCapture = () => { throw new Error('capture unavailable'); };
    await graphic(root).fire('pointerdown', { pointerId: 1, ...screen(svg, 5, 5) }); assert.match(root.textContent, /无法开始拖动/u); assert.equal(control(root, '所选物件x厘米').disabled, false);
    await graphic(root).fire('keydown', { key: 'ArrowRight' }); assert.equal(control(root, '所选物件x厘米').value, '1.0');
  });
});

test('T089 UI: pointer cancel/lostcapture/Escape and pause restore drag baseline, destroy removes listeners', async () => {
  await withUI(safeFiles([]), async (root, lifecycle) => {
    const svg = control(root, '矩形摆放比例平面图');
    for (const kind of ['pointercancel', 'lostpointercapture', 'escape', 'pause']) {
      await graphic(root).fire('pointerdown', { pointerId: 3, ...screen(svg, 5, 5) }); await svg.fire('pointermove', { pointerId: 3, ...screen(svg, 105, 5) }); assert.equal(control(root, '所选物件x厘米').value, '10.0');
      if (kind === 'escape') await graphic(root).fire('keydown', { key: 'Escape' }); else if (kind === 'pause') lifecycle.deactivate(); else await svg.fire(kind, { pointerId: 3 });
      assert.equal(control(root, '所选物件x厘米').value, '0.0'); assert.equal(svg.hasPointerCapture(3), false);
      if (kind === 'pause') { assert.equal(svg.listeners.pointermove.length, 0); await graphic(root).fire('keydown', { key: 'ArrowRight' }); await graphic(root).fire('pointerdown', { pointerId: 10, ...screen(svg, 5, 5) }); assert.equal(control(root, '所选物件x厘米').value, '0.0'); assert.equal(svg.hasPointerCapture(10), false); }
      lifecycle.activate(); assert.equal(svg.listeners.pointermove.length, 1);
    }
    const oldGroup = graphic(root); await oldGroup.fire('pointerdown', { pointerId: 9, ...screen(svg, 5, 5) }); lifecycle.destroy();
    assert.equal(svg.hasPointerCapture(9), false); assert.ok(['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'keydown'].every(type => svg.listeners[type].length === 0)); await oldGroup.fire('keydown', { key: 'ArrowRight' }); await svg.fire('pointermove', { pointerId: 9, ...screen(svg, 105, 5) }); assert.equal(root.children.length, 0);
  });
});

test('T089 UI: drag rounds to1mm, hard-coordinate overflow rejected without room clamping', async () => {
  await withUI(safeFiles([]), async root => {
    const svg = control(root, '矩形摆放比例平面图'); await graphic(root).fire('pointerdown', { pointerId: 4, ...screen(svg, 5, 5) }); await svg.fire('pointermove', { pointerId: 4, ...screen(svg, 15.6, 5) }); assert.equal(control(root, '所选物件x厘米').value, '1.1');
    await svg.fire('pointermove', { pointerId: 4, ...screen(svg, 300000, 5) }); assert.equal(control(root, '所选物件x厘米').value, '1.1'); assert.match(root.textContent, /拒绝此次更新/u); await svg.fire('pointerup', { pointerId: 4 }); assert.equal(control(root, '所选物件x厘米').value, '1.1');
  });
});

test('T089 UI: valid/forged JSON import recalculates and invalid UTF8/version/cap retains current result', async () => {
  const report = await layout(config({ items: [item(), item({ id: 'I2', x: '9.9' })] })); report.overlaps = []; report.isValidPlacement = true; const saved = [];
  await withUI(safeFiles(saved), async root => {
    const file = control(root, '导入T089布局JSON文件'), bytes = new TextEncoder().encode('\uFEFF' + JSON.stringify(report)); file.files = [{ name: 'layout.json', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change'); assert.match(root.textContent, /重叠1对/u);
    file.files = [{ name: 'bad.json', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u); file.files = [{ name: 'large.json', size: 262145 }]; await file.fire('change'); assert.match(root.textContent, /超过256 KiB/u);
    control(root, '待导入T089布局JSON').value = '{"feature":"T089","version":2}'; await button(root, '导入粘贴的版本1布局').fire('click'); assert.equal(button(root, '保存完整 JSON 布局副本').disabled, false); await button(root, '保存完整 JSON 布局副本').fire('click'); assert.equal(JSON.parse(saved[0].content).overlaps.length, 1);
    control(root, '待导入T089布局JSON').value = JSON.stringify(report.draft); await button(root, '导入粘贴的版本1布局').fire('click'); assert.match(root.textContent, /重叠1对/u);
  });
});

test('T089 UI: limits add/remove safeguards, unprotected exports disabled and native cancel truthful', async () => {
  await withUI({ saveText: async () => assert.fail('unsafe writer') }, async root => {
    assert.equal(button(root, '移除所选物件').disabled, true); assert.equal(button(root, '保存比例 SVG 副本').disabled, true); assert.match(root.textContent, /缺少副本保护/u);
    for (let index = 1; index < 30; index++) await button(root, '添加矩形物件').fire('click'); assert.equal(button(root, '添加矩形物件').disabled, true); await button(root, '移除所选物件').fire('click'); assert.equal(button(root, '添加矩形物件').disabled, false);
  });
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async root => { await button(root, '保存完整 JSON 布局副本').fire('click'); assert.match(root.textContent, /已取消另存/u); });
});
