const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const feature = path.resolve(__dirname, '../src/renderer/features/T092');
const modelPromise = import(pathToFileURL(path.join(feature, 'model.mjs')).href);
const EMAIL = 'ana@example.test'; const OTHER = 'bo@example.test';
const SAMPLE = `email,age,note\n${EMAIL},23,第一行\n${EMAIL},29,同一用户\n${OTHER},-1,另一用户\n`;
const policies = [{ type: 'pseudo' }, { type: 'bucket', width: '10' }, { type: 'delete' }];
const run = async (source = SAMPLE, format = 'csv', policy = policies, options = {}) => { const m = await modelPromise; return m.processData(m.parseSource(source, format), policy, { crypto: webcrypto, yieldTask: async () => {}, ...options }); };
const safe = result => { const text = typeof result === 'string' ? result : JSON.stringify(result); assert.equal(text.includes(EMAIL), false); assert.equal(text.includes(OTHER), false); return text; };

test('CSV quoted comma, multiline, doubled quotes, CRLF and final empty cell parse without data loss', async () => {
  const { parseSource } = await modelPromise;
  const d = parseSource('name,text,empty\r\nAda,"a,b\n""quote""",\r\n', 'csv');
  assert.deepEqual(d.columns, ['name', 'text', 'empty']); assert.deepEqual(d.rows, [['Ada', 'a,b\n"quote"', '']]);
});
test('CSV rejects duplicate/compatible/blank headers, inconsistent rows, malformed quotes and bare CR', async () => {
  const { parseSource } = await modelPromise;
  for (const text of ['a,a\n1,2', 'a,ａ\n1,2', 'a,\n1,2', ' a,b\n1,2', 'a,b\n1', 'a\n"bad', 'a\nx"y', 'a\n"x"z', 'a\r1']) assert.throws(() => parseSource(text, 'csv'));
});
test('JSON flat typed values and reordered fields survive; dangerous property names are data', async () => {
  const { parseSource } = await modelPromise;
  const d = parseSource('[{"__proto__":"v","n":0.25,"b":true,"nil":null},{"nil":null,"b":false,"n":-1,"__proto__":"w"}]', 'json');
  assert.deepEqual(d.rows, [['v', 0.25, true, null], ['w', -1, false, null]]);
  const out = await run('[{"__proto__":"v","constructor":"q"}]', 'json', [{ type: 'keep' }, { type: 'keep' }]);
  assert.deepEqual(Object.keys(JSON.parse(out.json)[0]), ['__proto__', 'constructor']); assert.equal(JSON.parse(out.json)[0].__proto__, 'v');
});
test('strict JSON detects duplicate escaped keys, nested values, inconsistent fields and invalid syntax', async () => {
  const { parseSource } = await modelPromise;
  for (const text of ['[{"a":1,"a":2}]', '[{"a":1,"\\u0061":2}]', '[{"a":{}}]', '[{"a":[]}]', '[{"a":1},{"b":2}]', '[{"a":1},{"a":2,"b":3}]', '[{}]', '[]', '{}', '[{"a":1,}]', '[{"a":1},]', '[{"a":01}]', '[{"a":NaN}]', '[{"a":truex}]', '[{"a":1}]xx', '[{"a":"\\ud800"}]']) assert.throws(() => parseSource(text, 'json'));
});
test('JSON numeric precision and exponent boundaries reject unsupported input instead of rounding silently', async () => {
  const { parseSource } = await modelPromise;
  for (const value of ['1e2', '9007199254740993', '1.0000000000000001', '0.0000001']) assert.throws(() => parseSource(`[{"n":${value}}]`, 'json'));
  assert.deepEqual(parseSource('[{"n":0.123456}]', 'json').rows, [[0.123456]]);
});
test('UTF8 byte, Unicode scalar, cell, row, column and header limits are enforced', async () => {
  const { parseSource, LIMITS } = await modelPromise;
  assert.throws(() => parseSource('a\n' + '中'.repeat(350000), 'csv'));
  assert.throws(() => parseSource('a\n\ud800', 'csv'));
  assert.throws(() => parseSource('a\n' + 'x'.repeat(LIMITS.cellChars + 1), 'csv'));
  assert.throws(() => parseSource('a\n' + 'v\n'.repeat(5001), 'csv'));
  assert.equal(parseSource('a\n' + 'v\n'.repeat(5000), 'csv').rows.length, 5000);
  assert.throws(() => parseSource(Array.from({ length: 101 }, (_, i) => `c${i}`).join(',') + '\n' + Array(101).fill('x').join(','), 'csv'));
  assert.throws(() => parseSource('x'.repeat(101) + '\nv', 'csv'));
  assert.equal(parseSource('\uFEFFa\nv', 'csv').rows[0][0], 'v');
});
test('same user repeats consistently, different users differ, reprocessing uses fresh random secret', async () => {
  const a = await run(); const b = await run();
  assert.equal(a.rows[0][0], a.rows[1][0]); assert.notEqual(a.rows[0][0], a.rows[2][0]); assert.notEqual(a.rows[0][0], b.rows[0][0]);
  assert.match(a.rows[0][0], /^p_[0-9a-f]{64}$/); assert.deepEqual(a.columns, ['email', 'age']); safe(a); safe(b);
  assert.equal(a.json.includes('第一行'), false); assert.equal(a.report.preservedColumns, 0); assert.deepEqual(a.report.columnPolicy.map(p => p.strategy), ['pseudo', 'bucket', 'delete']);
  assert.equal(Object.keys(a.report).some(k => /key|mapping|sourceText/i.test(k)), false);
});
test('HMAC uses nonextractable random 256bit key; type and field are domain separated', async () => {
  const seen = []; const crypto = { subtle: { async generateKey(...args) { seen.push(args); return webcrypto.subtle.generateKey(...args); }, sign(...args) { return webcrypto.subtle.sign(...args); } } };
  const out = await run('[{"x":1,"y":1},{"x":"1","y":1},{"x":null,"y":null},{"x":true,"y":true}]', 'json', [{ type: 'pseudo' }, { type: 'pseudo' }], { crypto });
  assert.deepEqual(seen[0], [{ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']]);
  assert.notEqual(out.rows[0][0], out.rows[1][0]); assert.notEqual(out.rows[0][0], out.rows[0][1]); assert.equal(out.rows[0][1], out.rows[1][1]); assert.notEqual(out.rows[2][0], out.rows[3][0]);
});
test('fixed-width buckets are closed-open with exact decimal and negative boundaries', async () => {
  const { bucketValue } = await modelPromise;
  for (const [value, width, expected] of [['0', '10', '[0.00, 10.00)'], ['10', '10', '[10.00, 20.00)'], ['-0.01', '10', '[-10.00, 0.00)'], ['-10', '10', '[-10.00, 0.00)'], ['-10.01', '10', '[-20.00, -10.00)'], ['0.3', '0.1', '[0.30, 0.40)'], ['1000000', '1000000', '[1000000.00, 2000000.00)']]) assert.equal(bucketValue(value, width), expected);
});
test('nonnumeric/null/empty/precision failures abort entire result, audit contains row and column only', async () => {
  const bad = `email,n\n${EMAIL},oops-secret\n${OTHER},\n${EMAIL},1.001`;
  await assert.rejects(run(bad, 'csv', [{ type: 'pseudo' }, { type: 'bucket', width: '10' }]), error => { assert.equal(error.code, 'bucketFailures'); assert.equal(error.failureCount, 3); assert.deepEqual(error.audit.map(a => [a.row, a.column]), [[1, 'C002'], [2, 'C002'], [3, 'C002']]); safe(error.audit); assert.equal(JSON.stringify(error.audit).includes('oops-secret'), false); return true; });
  const { bucketValue } = await modelPromise;
  for (const value of [null, true, '', ' ', '01', '1e2', '1.001', '1000000.01', '-1000000.01']) assert.throws(() => bucketValue(value, '10'));
  for (const width of ['0', '-1', '0.001', '1000001']) assert.throws(() => bucketValue('1', width));
});
test('failure audit caps at 100 while total count remains exact; no partial export exists', async () => {
  await assert.rejects(run('a\n' + 'secret\n'.repeat(120), 'csv', [{ type: 'bucket', width: '10' }]), error => { assert.equal(error.failureCount, 120); assert.equal(error.audit.length, 100); assert.equal(error.json, undefined); assert.equal(JSON.stringify(error.audit).includes('secret'), false); return true; });
});
test('keep/delete policies preserve chosen scalars and explicit null CSV semantics without requiring crypto', async () => {
  const out = await run('[{"a":null,"b":false,"c":3}]', 'json', [{ type: 'keep' }, { type: 'keep' }, { type: 'delete' }], { crypto: {} });
  assert.deepEqual(JSON.parse(out.json), [{ a: null, b: false }]); assert.equal(out.csv, 'a,b\r\nnull,false\r\n'); assert.equal(out.report.preservedColumns, 2); assert.match(out.report.notice, /CSV 不携带 JSON 类型/);
  await assert.rejects(run(SAMPLE, 'csv', [{ type: 'delete' }, { type: 'delete' }, { type: 'delete' }]), /至少保留/);
  await assert.rejects(run(SAMPLE, 'csv', [{ type: 'wrong' }, ...policies.slice(1)]));
  await assert.rejects(run(SAMPLE, 'csv', policies, { crypto: {} }), /WebCrypto/);
});
test('cancellation while HMAC signing is pending discards signature and returns no partial result', async () => {
  let resolve; let canceled = false; const gate = new Promise(r => { resolve = r; });
  const crypto = { subtle: { generateKey: (...a) => webcrypto.subtle.generateKey(...a), sign: async () => { await gate; return new Uint8Array(32).buffer; } } };
  const job = run(SAMPLE, 'csv', policies, { crypto, isCanceled: () => canceled });
  await new Promise(r => setTimeout(r, 10)); canceled = true; resolve(); await assert.rejects(job, e => e.code === 'canceled');
});
test('yield progress permits cancellation at a row boundary; native crypto errors hide arbitrary input strings', async () => {
  let canceled = false;
  await assert.rejects(run('a\n' + 'x\n'.repeat(100), 'csv', [{ type: 'keep' }], { isCanceled: () => canceled, onProgress: p => { assert.equal(p.processed, 50); canceled = true; } }), e => e.code === 'canceled');
  await assert.rejects(run(SAMPLE, 'csv', policies, { crypto: { subtle: { generateKey() { throw new Error(EMAIL); }, sign() {} } } }), e => { assert.equal(e.message.includes(EMAIL), false); return e.code === 'processing'; });
});
test('CSV export quotes bucket commas and roundtrips pseudonyms and intervals', async () => {
  const out = await run(); const { parseSource } = await modelPromise; assert.deepEqual(parseSource(out.csv, 'csv').rows, out.rows); safe(out.csv); safe(out.json); safe(out.report);
});
test('bounded distinct HMAC work fails before signing more than 20000 values', async () => {
  const { processData } = await modelPromise; let signs = 0; const columns = Array.from({ length: 5 }, (_, i) => `c${i}`); const rows = Array.from({ length: 4001 }, (_, i) => columns.map((_, j) => `${i}-${j}`));
  await assert.rejects(processData({ format: 'csv', columns, rows }, columns.map(() => ({ type: 'pseudo' })), { yieldTask: async () => {}, crypto: { subtle: { generateKey: async () => ({}), sign: async () => { signs++; return new Uint8Array(32).buffer; } } } }), e => e.code === 'workLimit'); assert.equal(signs, 20000);
});
test('output amplification is rejected at 8MiB instead of truncating a structured result', async () => {
  const { processData } = await modelPromise; const columns = Array.from({ length: 100 }, (_, i) => `c${i}`); const rows = Array.from({ length: 5000 }, () => columns.map(() => 'x'));
  await assert.rejects(processData({ format: 'csv', columns, rows }, columns.map(() => ({ type: 'pseudo' })), { crypto: webcrypto, yieldTask: async () => {} }), e => e.code === 'outputLimit');
});

class Element {
  constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.events = new Map(); this.style = {}; this.dataset = {}; this.value = ''; this.disabled = false; this.files = []; this._text = ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attributes[k]; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(type, fn) { const list = this.events.get(type) || []; list.push(fn); this.events.set(type, list); }
  emit(type, props = {}) { if (this.disabled) return; const e = { target: this, detail: 1, ...props }; for (const fn of this.events.get(type) || []) fn(e); }
  click(props) { this.emit('click', props); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
}
async function mount({ filesAPI = null, activate = true, processor = null } = {}) {
  const modules = await modelPromise;
  const document = { hidden: false, events: new Map(), createElement(tag) { return new Element(tag); }, createTextNode(value) { return { nodeType: 3, textContent: String(value) }; }, addEventListener(k, fn) { this.events.set(k, fn); }, removeEventListener(k) { this.events.delete(k); } };
  const root = document.createElement('main'); const context = vm.createContext({ document, window: { toolbox: { files: filesAPI } }, URL, ArrayBuffer, TextDecoder, ...modules, processData: processor || ((...args) => modules.processData(args[0], args[1], { ...args[2], crypto: webcrypto, yieldTask: async () => {} })), module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.resolve(feature, '../../core/ui.js'), 'utf8').replace(/export /g, '') + '\nmodule.exports={h};', context); context.h = context.module.exports.h;
  const source = fs.readFileSync(path.join(feature, 'index.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('export default', 'module.exports =').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path.join(feature, 'index.js')).href)); vm.runInContext(source, context);
  let configCalls = 0; const lifecycle = context.module.exports.create(root, { config: { set() { configCalls++; } } });
  const all = (node = root) => [node, ...node.children.flatMap(n => n.nodeType === 1 ? all(n) : [])];
  const button = label => all().find(e => e.tagName === 'BUTTON' && e.textContent === label);
  const field = label => all().find(e => e.getAttribute('aria-label') === label);
  const edit = (label, value, event = 'input') => { const input = field(label); input.value = value; input.emit(event); };
  function setSource(value = SAMPLE, format = 'csv') { edit('输入格式', format, 'change'); edit('源数据', value); button('解析字段').click(); }
  function setPolicy(i, type, width) { const id = `C${String(i).padStart(3, '0')}`; edit(`${id} 处理策略`, type, 'change'); if (width !== undefined) edit(`${id} 桶宽`, width); }
  async function waitDone() { for (let i = 0; i < 1000; i++) { if (button('取消处理').disabled) return; await new Promise(r => setTimeout(r, 1)); } throw new Error('timeout'); }
  async function generate() { button('生成新的处理结果').click(); await waitDone(); }
  if (activate) lifecycle.activate();
  return { root, document, lifecycle, all, field, button, edit, setSource, setPolicy, waitDone, generate, text: () => root.textContent, configCalls: () => configCalls };
}
async function demo(ui) { ui.button('填入邮箱演示').click(); ui.setPolicy(1, 'pseudo'); ui.setPolicy(2, 'bucket', '10'); ui.setPolicy(3, 'delete'); await ui.generate(); }

test('actual h-generated UI handlers parse, choose three policies, generate and preview safe JSON/CSV/report', async () => {
  const ui = await mount(); await demo(ui); assert.match(ui.text(), /已生成 3 行、2 列/); safe(ui.text());
  for (const label of ['预览 JSON 数据副本', '预览 CSV 数据副本', '预览处理报告']) { ui.button(label).click(); safe(ui.field('新副本完整预览').value); assert.match(ui.text(), /目标路径在原生/); }
  assert.equal(ui.configCalls(), 0); ui.lifecycle.destroy(); assert.equal(ui.root.children.length, 0); assert.equal(ui.document.events.size, 0);
});
test('source edits discard results, policy edits discard previews, invalid input and bucket audit stay explicit', async () => {
  const ui = await mount(); await demo(ui); ui.button('预览 JSON 数据副本').click(); ui.setPolicy(2, 'bucket', '0'); assert.equal(ui.field('新副本完整预览'), undefined); await ui.generate(); assert.match(ui.text(), /桶宽须为/);
  ui.setPolicy(2, 'bucket', '10'); ui.edit('源数据', 'a,a\n1,2'); assert.equal(ui.field('C001 处理策略'), undefined); assert.equal(ui.button('生成新的处理结果').disabled, true); ui.button('解析字段').click(); assert.match(ui.text(), /字段名重复/);
  ui.setSource('a\nnot-a-number'); ui.setPolicy(1, 'bucket', '10'); await ui.generate(); assert.match(ui.text(), /行 1 · C001 · bucketValue/); assert.equal(ui.text().includes('not-a-number'), false); assert.equal(ui.button('预览 JSON 数据副本'), undefined); ui.lifecycle.destroy();
});
test('failed bucket audit can be previewed and exported alone, never as partial data or raw input', async () => {
  const calls = []; const ui = await mount({ filesAPI: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { ok: true }; } } });
  ui.setSource('email,n\n' + EMAIL + ',oops-secret'); ui.setPolicy(1, 'pseudo'); ui.setPolicy(2, 'bucket', '10'); await ui.generate(); ui.button('预览处理报告').click(); const text = ui.field('新副本完整预览').value; const report = JSON.parse(text);
  assert.equal(report.state, 'failed'); assert.equal(report.noDataExport, true); assert.equal(report.outputColumns, 0); assert.deepEqual(report.audit, [{ row: 1, column: 'C002', reason: 'bucketValue' }]); safe(text); assert.equal(text.includes('oops-secret'), false); assert.equal(ui.button('预览 CSV 数据副本'), undefined);
  ui.button('保存当前预览新副本').click(); await new Promise(r => setImmediate(r)); assert.equal(calls[0].copyOnly, true); safe(calls[0].content); ui.lifecycle.destroy();
});
test('preview-first copyOnly export returns success only when bridge explicitly reports ok true', async () => {
  const calls = []; const ui = await mount({ filesAPI: { saveTextSupportsCopyOnly: true, async saveText(args) { calls.push(args); return { ok: true }; } } });
  await demo(ui); assert.equal(ui.button('保存当前预览新副本'), undefined);
  for (const [label, extension] of [['预览 JSON 数据副本', 'json'], ['预览 CSV 数据副本', 'csv'], ['预览处理报告', 'json']]) { ui.button(label).click(); ui.button('保存当前预览新副本').click(); await new Promise(r => setImmediate(r)); assert.equal(calls.at(-1).copyOnly, true); assert.equal(calls.at(-1).extension, extension); safe(calls.at(-1).content); assert.match(ui.text(), /已保存新副本/); }
  ui.lifecycle.destroy();
});
test('false, undefined, canceled and throwing saves preserve preview and do not expose bridge errors', async () => {
  for (const outcome of [{ ok: false, error: EMAIL }, undefined, { canceled: true }, new Error(EMAIL)]) {
    const ui = await mount({ filesAPI: { saveTextSupportsCopyOnly: true, async saveText() { if (outcome instanceof Error) throw outcome; return outcome; } } });
    await demo(ui); ui.button('预览 JSON 数据副本').click(); const before = ui.field('新副本完整预览').value; ui.button('保存当前预览新副本').click(); await new Promise(r => setImmediate(r)); assert.equal(ui.field('新副本完整预览').value, before); assert.equal(ui.text().includes('已保存新副本'), false); assert.match(ui.text(), outcome?.canceled ? /已取消保存/ : /保存失败/); safe(ui.text()); ui.lifecycle.destroy();
  }
});
test('old bridge prevents export and clearing erases source, fields, data and report without null text', async () => {
  let calls = 0; const ui = await mount({ filesAPI: { async saveText() { calls++; } } }); await demo(ui); ui.button('预览处理报告').click(); ui.button('保存当前预览新副本').click(); assert.equal(calls, 0); assert.match(ui.text(), /副本保护/);
  ui.button('清除源数据和结果').click(); assert.equal(ui.field('源数据').value, ''); assert.equal(ui.field('新副本完整预览'), undefined); assert.equal(ui.field('C001 处理策略'), undefined); assert.equal(ui.text().includes('nullnull'), false); ui.lifecycle.destroy();
});
test('cancel/edit stale asynchronous jobs cannot overwrite newer source or permit overlapping runs', async () => {
  let resolve; const gate = new Promise(r => { resolve = r; }); let calls = 0;
  const ui = await mount({ processor: async (data, p, opts) => { calls++; await gate; opts.onProgress({ processed: 1, total: 3 }); return run(SAMPLE); } }); ui.setSource(); ui.button('生成新的处理结果').click(); ui.edit('源数据', 'a\nnew'); assert.equal(ui.button('生成新的处理结果').disabled, true); ui.button('生成新的处理结果').click(); assert.equal(calls, 1); resolve(); await ui.waitDone(); assert.equal(ui.field('源数据').value, 'a\nnew'); assert.equal(ui.button('预览 JSON 数据副本'), undefined); assert.equal(ui.text().includes('已处理 1/3'), false); ui.button('解析字段').click(); assert.match(ui.text(), /已解析 1 行、1 列/); ui.lifecycle.destroy();
});
test('hidden/deactivated cancel in-flight processing; destroy removes events and ignores later callback', async () => {
  const completedResult = await run(); // Finish real crypto before testing the independently gated UI callback.
  for (const mode of ['hidden', 'deactivate', 'destroy']) {
    let resolve; const gate = new Promise(r => { resolve = r; }); const ui = await mount({ processor: async () => { await gate; return completedResult; } }); ui.setSource(); ui.button('生成新的处理结果').click();
    if (mode === 'hidden') { ui.document.hidden = true; ui.document.events.get('visibilitychange')(); } else if (mode === 'deactivate') ui.lifecycle.deactivate(); else ui.lifecycle.destroy();
    resolve(); await gate; await new Promise(resolve => setImmediate(resolve)); // Drain the released callback, without assuming crypto finishes within 10ms.
    if (mode === 'destroy') { assert.equal(ui.root.children.length, 0); assert.equal(ui.document.events.size, 0); } else { ui.document.hidden = false; ui.lifecycle.activate(); assert.equal(ui.button('预览 JSON 数据副本'), undefined); assert.equal(ui.button('生成新的处理结果').disabled, false); ui.lifecycle.destroy(); }
  }
});
test('strict File reading rejects unknown UTF8/binary/oversize; no source file path enters report', async () => {
  const ui = await mount(); const choose = async (bytes, name = 'data.csv', size = bytes.byteLength) => { const input = ui.field('读取一个 UTF-8 文件'); input.files = [{ name, size, async arrayBuffer() { return bytes.buffer; } }]; input.value = 'C:/private/source'; input.emit('change'); await ui.waitDone(); assert.equal(input.value, ''); };
  await choose(new Uint8Array([0xc3, 0x28])); assert.match(ui.text(), /不是有效 UTF-8/);
  await choose(new Uint8Array([65, 0, 66])); assert.match(ui.text(), /零字节/);
  await choose(new Uint8Array([65]), 'large.csv', 1048577); assert.match(ui.text(), /超过 1 MiB/);
  await choose(new TextEncoder().encode(SAMPLE)); ui.button('解析字段').click(); ui.setPolicy(1, 'pseudo'); ui.setPolicy(2, 'bucket', '10'); ui.setPolicy(3, 'delete'); await ui.generate(); ui.button('预览处理报告').click(); assert.equal(ui.field('新副本完整预览').value.includes('private'), false); safe(ui.field('新副本完整预览').value); ui.lifecycle.destroy();
});
test('late file-read and save callbacks after clear/destroy never restore input or report', async () => {
  let readResolve; const readGate = new Promise(r => { readResolve = r; }); const ui = await mount(); const file = ui.field('读取一个 UTF-8 文件'); file.files = [{ size: 3, name: 'x.csv', arrayBuffer: () => readGate }]; file.emit('change'); ui.button('清除源数据和结果').click(); readResolve(new Uint8Array([97, 10, 98]).buffer); await ui.waitDone(); assert.equal(ui.field('源数据').value, ''); ui.lifecycle.destroy();
  let saveResolve; const saveGate = new Promise(r => { saveResolve = r; }); const next = await mount({ filesAPI: { saveTextSupportsCopyOnly: true, saveText: () => saveGate } }); await demo(next); next.button('预览处理报告').click(); next.button('保存当前预览新副本').click(); next.button('清除源数据和结果').click(); saveResolve({ ok: true }); await new Promise(r => setImmediate(r)); assert.equal(next.text().includes('已保存新副本'), false); next.lifecycle.destroy();
});
test('inactive create and repeated click do not process; stale field events cannot change a re-parsed dataset', async () => {
  const ui = await mount({ activate: false }); ui.button('填入邮箱演示').click(); assert.equal(ui.field('源数据').value, ''); ui.lifecycle.activate(); ui.setSource(); const old = ui.field('C001 处理策略'); ui.setSource('a\nx'); old.value = 'delete'; old.emit('change'); await ui.generate(); assert.match(ui.text(), /已生成 1 行、1 列/); ui.button('清除源数据和结果').click({ detail: 2 }); assert.equal(ui.field('源数据').value, 'a\nx'); ui.lifecycle.destroy();
});
test('pause disables editable source and column controls and preserves a completed preview on resume', async () => {
  const ui = await mount(); await demo(ui); ui.button('预览 JSON 数据副本').click(); const preview = ui.field('新副本完整预览').value;
  ui.lifecycle.deactivate(); assert.equal(ui.field('源数据').disabled, true); assert.equal(ui.field('C001 处理策略').disabled, true); assert.equal(ui.field('C002 桶宽').disabled, true);
  ui.lifecycle.activate(); assert.equal(ui.field('源数据').disabled, false); assert.equal(ui.field('C001 处理策略').disabled, false); assert.equal(ui.field('C002 桶宽').disabled, false); assert.equal(ui.field('C001 桶宽').disabled, true); assert.equal(ui.field('新副本完整预览').value, preview); ui.lifecycle.destroy();
});
