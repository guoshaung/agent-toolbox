'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const model = import('../src/renderer/features/T004/model.mjs');
const factory = url => new Worker(url, { type: 'module' });
async function extract(pattern, flags, texts, options = {}) {
  return (await model).runExtraction({ pattern, flags, samples: texts.map((text, index) => ({ name: `sample${index + 1}`, text })) }, { workerFactory: factory, ...options });
}

test('T004 acceptance: three logs yield two named rows with exact source offsets and one failure', async () => {
  const { EXAMPLE, runExtraction } = await model;
  const result = await runExtraction(EXAMPLE, { workerFactory: factory });
  assert.deepEqual(result.matches.map(row => [row.sample, row.start, row.end, row.text, row.named]), [
    [1, 8, 18, 'INFO id=42', { level: 'INFO', id: '42' }],
    [2, 8, 18, 'ERROR id=7', { level: 'ERROR', id: '7' }]
  ]);
  assert.deepEqual(result.stats, { samples: 3, matches: 2, matchedSamples: 2, failedSamples: 1 });
  assert.equal(result.samples[2].status, 'no-match');
  assert.equal(result.samples[2].text, EXAMPLE.samples[2].text);
});

test('T004: no g/y returns first match; global restarts lastIndex for each sample', async () => {
  assert.deepEqual((await extract('a', '', ['aa', 'a'])).matches.map(row => [row.sample, row.start]), [[1, 0], [2, 0]]);
  assert.deepEqual((await extract('a', 'g', ['aa', 'aa'])).matches.map(row => [row.sample, row.start]), [[1, 0], [1, 1], [2, 0], [2, 1]]);
});

test('T004: sticky scans contiguous matches from zero and stops at first gap', async () => {
  const result = await extract('a', 'y', ['aa a', ' aa']);
  assert.deepEqual(result.matches.map(row => row.start), [0, 1]);
  assert.equal(result.samples[1].status, 'no-match');
});

test('T004: empty Unicode matches advance by complete surrogate pairs, including end of string', async () => {
  assert.deepEqual((await extract('(?:)', 'gu', ['😀X', ''])).matches.map(row => [row.sample, row.start, row.end]), [[1, 0, 0], [1, 2, 2], [1, 3, 3], [2, 0, 0]]);
  assert.deepEqual((await extract('(?:)', 'g', ['😀X'])).matches.map(row => row.start), [0, 1, 2, 3]);
  assert.deepEqual((await extract('(?:)', 'gv', ['😀X'])).matches.map(row => row.start), [0, 2, 3]);
});

test('T004: lone surrogates advance one and sticky Unicode zero-length does not loop', async () => {
  assert.deepEqual((await extract('(?:)', 'gu', ['\ud800X\udc00'])).matches.map(row => row.start), [0, 1, 2, 3]);
  assert.deepEqual((await extract('(?:)', 'yu', ['😀'])).matches.map(row => row.start), [0, 2]);
});

test('T004: i/m/s flags and UTF-16 offsets preserve multiline source without normalization', async () => {
  const result = await extract('^x.+?Y$', 'gimsu', ['😀\r\nX\nY\r\n']);
  assert.deepEqual(result.matches.map(row => [row.start, row.end, row.text]), [[4, 7, 'X\nY']]);
  assert.equal(result.samples[0].text, '😀\r\nX\nY\r\n');
});

test('T004: optional captures distinguish null and empty; d includes named and numbered offsets', async () => {
  const result = await extract('(?<absent>a)?(?<empty>b*)', 'du', ['']);
  const row = result.matches[0];
  assert.deepEqual(row.captures, [null, '']);
  assert.deepEqual(row.named, { absent: null, empty: '' });
  assert.deepEqual(row.indices, [[0, 0], null, [0, 0]]);
  assert.deepEqual(row.namedIndices, { absent: null, empty: [0, 0] });
  assert.equal((await extract('(a)', '', ['a'])).matches[0].indices, null);
});

test('T004: lookbehind capture offsets can precede match and prototype-like named fields remain data', async () => {
  const result = await extract('(?<=(?<__proto__>a))(?<constructor>b)', 'd', ['ab']);
  assert.equal(result.matches[0].start, 1);
  assert.deepEqual(Object.keys(result.matches[0].named), ['__proto__', 'constructor']);
  assert.equal(result.matches[0].named.__proto__, 'a');
  assert.deepEqual(result.matches[0].namedIndices.__proto__, [0, 1]);
});

test('T004: invalid syntax is compiled only in Worker and fails each affected sample', async () => {
  await assert.rejects(extract('(', 'g', ['x', 'y']), error => error.code === 'syntax' && error.failures.length === 2 && error.failures.every(row => row.status === '未完成'));
  const previous = global.RegExp;
  global.RegExp = class { constructor() { throw new Error('renderer must not execute regular expressions'); } };
  try { assert.equal((await extract('a', 'g', ['a'])).matches.length, 1); }
  finally { global.RegExp = previous; }
});

test('T004: malformed flags and all character/sample/name bounds fail before starting a Worker', async () => {
  const { validateJob, LIMITS, runExtraction } = await model;
  const job = { pattern: 'a', flags: 'g', samples: [{ name: 'a', text: 'a' }] };
  for (const flags of ['gg', 'uv', 'z', 'G']) assert.throws(() => validateJob({ ...job, flags }), /flags/u);
  assert.throws(() => validateJob({ ...job, pattern: 'x'.repeat(LIMITS.patternChars + 1) }), /2048/u);
  assert.throws(() => validateJob({ ...job, samples: [] }), /1至12/u);
  assert.throws(() => validateJob({ ...job, samples: Array(13).fill(job.samples[0]) }), /1至12/u);
  assert.throws(() => validateJob({ ...job, samples: [{ name: ' ', text: 'x' }] }), /名称/u);
  assert.throws(() => validateJob({ ...job, samples: [{ name: 'a'.repeat(121), text: 'x' }] }), /120/u);
  assert.throws(() => validateJob({ ...job, samples: [{ name: 'a', text: 'x'.repeat(100001) }] }), /100000/u);
  assert.throws(() => validateJob({ ...job, samples: Array(5).fill({ name: 'a', text: 'x'.repeat(100000) }) }), /400000/u);
  assert.throws(() => runExtraction(job, { timeoutMs: 49 }), /50至10000/u);
});

test('T004: exactly 1000 matches accepted, excess and >64 captures fail whole job', async () => {
  assert.equal((await extract('a', 'g', ['a'.repeat(1000)])).matches.length, 1000);
  await assert.rejects(extract('a', 'g', ['a'.repeat(1001)]), error => error.code === 'limit' && /1000/u.test(error.message));
  await assert.rejects(extract('()'.repeat(65), '', ['']), error => error.code === 'limit' && /64/u.test(error.message));
});

test('T004: repeated large capture content is bounded in Worker before crossing report allowance', async () => {
  await assert.rejects(extract('('.repeat(40) + 'a*' + ')'.repeat(40), '', ['a'.repeat(100000)]), error => error.code === 'limit');
});

test('T004: catastrophic real-worker regex times out, terminates, and a new run recovers', async () => {
  const { runExtraction } = await model;
  let terminated = 0, termination;
  const tracked = url => {
    const worker = factory(url), terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminated++; termination = terminate(); return termination; };
    return worker;
  };
  const started = Date.now();
  await assert.rejects(runExtraction({ pattern: '^(a+)+$', flags: '', samples: [{ name: 'explosive', text: 'a'.repeat(40) + '!' }] }, { workerFactory: tracked, timeoutMs: 250 }), error => error.code === 'timeout' && error.failures[0].status === '未完成');
  assert.equal(terminated, 1); await termination;
  assert.ok(Date.now() - started < 3000, 'main timer must remain responsive despite worker backtracking');
  assert.equal((await extract('id=(?<id>\\d+)', 'g', ['id=42'])).matches[0].named.id, '42');
});

test('T004: cancellation really terminates busy Worker; already-aborted input creates no Worker', async () => {
  const { runExtraction } = await model;
  const controller = new AbortController(); let worker, termination, count = 0;
  const running = runExtraction({ pattern: '^(a+)+$', flags: '', samples: [{ name: 'a', text: 'a'.repeat(40) + '!' }] }, {
    signal: controller.signal, workerFactory: url => {
      worker = factory(url); const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { count++; termination = terminate(); return termination; }; return worker;
    }
  });
  await once(worker, 'online'); controller.abort();
  await assert.rejects(running, { name: 'AbortError', code: 'aborted' });
  assert.equal(count, 1); await termination;
  await assert.rejects(runExtraction({ pattern: 'a', flags: '', samples: [{ name: 'a', text: '' }] }, { signal: controller.signal, workerFactory: () => assert.fail('must not spawn') }), { name: 'AbortError' });
});

test('T004: normal completion terminates worker; postMessage and constructor failures do not leak', async () => {
  const { runExtraction } = await model;
  const job = { pattern: 'a', flags: '', samples: [{ name: 'a', text: 'a' }] };
  let terminated = 0, termination;
  await runExtraction(job, { workerFactory: url => { const worker = factory(url), terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; termination = terminate(); return termination; }; return worker; } });
  assert.equal(terminated, 1); await termination;
  await assert.rejects(runExtraction(job, { workerFactory: () => { throw new Error('blocked by CSP'); } }), /CSP/u);
  let stopped = false;
  await assert.rejects(runExtraction(job, { workerFactory: () => ({ on() {}, off() {}, postMessage() { throw new Error('clone failure'); }, terminate() { stopped = true; } }) }), /clone failure/u);
  assert.equal(stopped, true);
});

test('T004: export JSON preserves original failed samples and captures, CSV uses JSON strings', async () => {
  const { serializeReport } = await model;
  const result = await extract('(?<absent>a)?(?<value>.*)', '', ['=1+1', '']);
  result.samples[0].name = result.matches[0].name = 'file,"name"';
  const json = JSON.parse(await serializeReport(result, 'json'));
  assert.equal(json.feature, 'T004'); assert.equal(json.offsetUnit, 'UTF-16');
  assert.equal(json.matches[0].named.value, '=1+1'); assert.equal(json.matches[0].named.absent, null);
  const csv = await serializeReport(result, 'csv');
  assert.ok(csv.startsWith('\uFEFFsample_index,sample_name_json,start_utf16,end_utf16,match_json'));
  assert.ok(csv.includes('""=1+1""')); assert.ok(csv.includes('"null"')); assert.ok(csv.includes('named:value'));
  const failed = await extract('never', '', ['original\r\ntext']);
  assert.equal(JSON.parse(await serializeReport(failed, 'json')).samples[0].status, 'no-match');
});

test('T004: export has cancellation, exact format and output expansion bounds', async () => {
  const { serializeReport, LIMITS } = await model;
  const result = await extract('a', '', ['a']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(serializeReport(result, 'json', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(serializeReport(result, 'xml'), /只支持/u);
  const oversized = { ...result, samples: [{ text: 'x'.repeat(LIMITS.reportChars + 1) }] };
  await assert.rejects(serializeReport(oversized, 'json'), /超过6/u);
});

// Minimal DOM fixture verifies interface contracts only, not live Electron QA.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) { for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) }); if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; if (this.tagName === 'textarea') this.value = this.textContent; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) { return descendants(this).filter(child => selector === '[data-page-disabled]' ? child.dataset.pageDisabled !== undefined : selector.split(',').includes(child.tagName)); }
  async fire(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ currentTarget: this }); }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(element => element.tagName === 'button' && element.textContent === title); }
function control(root, label) { return descendants(root).find(element => element.attributes['aria-label'] === label); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader, Worker: global.Worker };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) };
  global.window = { toolbox: { files } }; global.Worker = Worker;
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'); const lifecycle = (await import('../src/renderer/features/T004/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); }
  finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}

test('T004 UI: example verifies named capture table, failure list, full original and protected exports', async () => {
  const saved = [];
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: '/copy/' + payload.defaultName }; } }, async root => {
    assert.equal(button(root, '验证并抽取').disabled, true);
    await button(root, '载入三条日志示例').fire('click'); await button(root, '验证并抽取').fire('click');
    assert.match(root.textContent, /3份样本 · 2条匹配 · 1份未匹配/u);
    assert.match(root.textContent, /#3 日志3：未匹配/u); assert.match(root.textContent, /named:id/u);
    await button(root, '完整原文与捕获').fire('click');
    assert.equal(control(root, '选中匹配完整原文').value, 'INFO id=42');
    assert.ok(button(root, '上一页').disabled); assert.ok(button(root, '下一页').disabled);
    await button(root, '保存匹配 CSV 副本').fire('click'); await button(root, '保存完整 JSON 副本').fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['csv', true], ['json', true]]);
    assert.equal(JSON.parse(saved[1].content).matches[0].start, 8);
    control(root, '正则flags').value = 'u'; await control(root, '正则flags').fire('input');
    assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
  });
});

test('T004 UI: paste, UTF-8 multiple-file atomic import, preserved BOM/CRLF, and old writer export block', async () => {
  let wrote = false;
  await withUI({ saveText: async () => { wrote = true; } }, async root => {
    const input = control(root, '选择多份样本文件');
    const bytes = new TextEncoder().encode('\uFEFFa\r\nb');
    input.files = [{ name: 'good.log', size: bytes.length, buffer: bytes.buffer }, { name: 'bad.log', size: 1, buffer: new Uint8Array([255]).buffer }];
    await input.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u); assert.equal(button(root, '验证并抽取').disabled, true);
    input.files = [{ name: 'good.log', size: bytes.length, buffer: bytes.buffer }]; await input.fire('change');
    assert.equal(control(root, '样本1内容').value, '\uFEFFa\r\nb');
    control(root, '粘贴样本名称').value = 'second'; control(root, '粘贴样本内容').value = 'a'; await button(root, '添加粘贴样本').fire('click');
    assert.equal(control(root, '粘贴样本内容').value, '');
    control(root, '正则表达式').value = 'a'; await control(root, '正则表达式').fire('input');
    await button(root, '验证并抽取').fire('click'); assert.match(root.textContent, /2份样本 · 2条匹配/u);
    assert.match(root.textContent, /缺少副本保护/u); assert.equal(button(root, '保存匹配 CSV 副本').disabled, true); assert.equal(wrote, false);
  });
});

test('T004 UI: cancel and lifecycle termination leave no export, re-run after deactivate recovers', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async (root, lifecycle) => {
    await button(root, '载入三条日志示例').fire('click');
    control(root, '正则表达式').value = '^(a+)+$'; await control(root, '正则表达式').fire('input');
    control(root, '样本1内容').value = 'a'.repeat(40) + '!'; await control(root, '样本1内容').fire('input');
    const running = button(root, '验证并抽取').fire('click'); assert.equal(button(root, '取消当前操作').disabled, false);
    lifecycle.deactivate(); await running; assert.match(root.textContent, /已取消/u); assert.equal(button(root, '保存完整 JSON 副本').disabled, true);
    lifecycle.activate(); await button(root, '载入三条日志示例').fire('click'); await button(root, '验证并抽取').fire('click');
    assert.match(root.textContent, /2条匹配/u); assert.equal(button(root, '取消当前操作').disabled, true);
  });
});
