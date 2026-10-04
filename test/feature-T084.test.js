const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T084/model.mjs');
const immediate = { yieldControl: async () => {} };
const plan = (extra = {}) => ({ id: 'S1', name: '月付', amount: '10.00', periodMonths: 1, firstPaid: '2027-01-01', discount: null, ...extra });
const config = (extra = {}) => ({ currency: 'CNY', interval: { mode: 'months', start: '2027-01-01', months: 12, end: '2028-01-01' }, plans: [plan()], ...extra });
async function compare(input) { return (await model).compareSubscriptions(input, immediate); }

test('T084: exact catalog monthly10 annual100 twelve-month acceptance and monthly reconciliation', async () => {
  const { EXAMPLE } = await model, report = await compare(EXAMPLE);
  assert.deepEqual(report.plans.map(plan => [plan.totalCents, plan.chargeCount]), [[12000, 12], [10000, 1]]);
  assert.deepEqual(report.lowestPlanIds, ['S2']); assert.equal(report.interval.end, '2028-01-01');
  assert.deepEqual(report.monthly[0].values.map(value => [value.costCents, value.cumulativeCents]), [[1000, 1000], [10000, 10000]]);
  assert.deepEqual(report.monthly.at(-1).values.map(value => value.cumulativeCents), [12000, 10000]); assert.ok(report.monthly.every(month => month.values.length === 2));
});

test('T084: integer decimal money is exact, free prices allowed, invalid lexical forms and unsafe amounts rejected', async () => {
  const { parseAmount, formatAmount } = await model;
  assert.equal(parseAmount('0.1'), 10); assert.equal(parseAmount('001.20'), 120); assert.equal(parseAmount('10000000000.00'), 1000000000000);
  assert.equal(formatAmount(101), '1.01'); assert.equal(formatAmount(1000000000000), '10000000000.00');
  for (const amount of ['', ' 1', '1 ', '-1', '+1', '.1', '1.', '1.001', '1e2', '1,000', 'NaN', 'Infinity', '10000000000.01', 1]) assert.throws(() => parseAmount(amount));
  const report = await compare(config({ plans: [plan({ amount: '0.10' }), plan({ id: 'S2', name: '免费', amount: '0' })] })); assert.equal(report.plans[0].totalCents, 120); assert.equal(report.plans[1].totalCents, 0);
});

test('T084: calendar validation leap centuries and canonical YYYY-MM-DD only', async () => {
  const { parseDate } = await model; assert.equal(parseDate('2000-02-29').monthEnd, true); assert.equal(parseDate('2024-02-29').day, 29);
  for (const date of ['1900-02-29', '2100-02-29', '2027-02-29', '2027-04-31', '2027-00-10', '2027-13-01', '2027-1-1', '1899-12-31', '2200-01-01', '2027-01-01T00:00:00Z', '2027-01-01 ']) assert.throws(() => parseDate(date));
});

test('T084: original month-end anchor never drifts after February for monthly and quarterly', async () => {
  const input = config({ interval: { mode: 'months', start: '2024-01-31', months: 5 }, plans: [plan({ firstPaid: '2024-01-31' }), plan({ id: 'S2', name: '季付', firstPaid: '2024-04-30', periodMonths: 3 })] }), report = await compare(input);
  assert.deepEqual(report.plans[0].events.map(event => event.date), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31']); assert.equal(report.interval.end, '2024-06-30');
  assert.equal(report.plans[1].nextCharge.date, '2024-07-31');
});

test('T084: non-month-end original day clamps temporarily, not permanent February drift', async () => {
  const report = await compare(config({ interval: { mode: 'months', start: '2027-01-30', months: 3 }, plans: [plan({ firstPaid: '2027-01-30' })] }));
  assert.deepEqual(report.plans[0].events.map(event => event.date), ['2027-01-30', '2027-02-28', '2027-03-30']); assert.equal(report.plans[0].nextCharge.date, '2027-04-30'); assert.equal(report.plans[0].anchor.monthEnd, false);
});

test('T084: leap-day annual plan preserves month-end anchor across four years', async () => {
  const report = await compare(config({ interval: { mode: 'months', start: '2024-02-29', months: 60 }, plans: [plan({ firstPaid: '2024-02-29', periodMonths: 12 })] }));
  assert.deepEqual(report.plans[0].events.map(event => event.date), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']); assert.equal(report.plans[0].nextCharge.date, '2029-02-28');
});

test('T084: interval left-closed right-open, exact end charge appears only as nextCharge', async () => {
  const report = await compare(config({ interval: { mode: 'dates', start: '2027-02-01', end: '2027-04-01' } }));
  assert.deepEqual(report.plans[0].events.map(event => [event.date, event.cycleIndex, event.kind]), [['2027-02-01', 1, 'renewal'], ['2027-03-01', 2, 'renewal']]); assert.equal(report.plans[0].nextCharge.date, '2027-04-01');
  const one = await compare(config({ interval: { mode: 'dates', start: '2027-01-01', end: '2027-01-02' } })); assert.equal(one.plans[0].totalCents, 1000);
});

test('T084: complete annual fee never amortized; pre-window annual fee is excluded with no-fee warning', async () => {
  const report = await compare(config({ interval: { mode: 'dates', start: '2027-01-01', end: '2027-01-02' }, plans: [plan({ amount: '100.00', periodMonths: 12 })] })); assert.equal(report.plans[0].totalCents, 10000);
  const alreadyPaid = await compare(config({ interval: { mode: 'dates', start: '2027-02-01', end: '2027-12-31' }, plans: [plan({ amount: '100.00', periodMonths: 12 })] })); assert.equal(alreadyPaid.plans[0].totalCents, 0); assert.match(alreadyPaid.plans[0].warning, /开始前付费/u);
});

test('T084: first payment after the comparison yields no invented charges and transparent future next date', async () => {
  const report = await compare(config({ plans: [plan({ firstPaid: '2029-01-01' })] })); assert.equal(report.plans[0].chargeCount, 0); assert.equal(report.plans[0].nextCharge.date, '2029-01-01'); assert.equal(report.plans[0].nextCharge.kind, 'initial'); assert.ok(report.monthly.every(month => month.values[0].costCents === 0));
});

test('T084: discount uses charging date strictly before expiry; expiry day regular price', async () => {
  const report = await compare(config({ plans: [plan({ discount: { amount: '5.00', until: '2027-04-01' } })] }));
  assert.equal(report.plans[0].totalCents, 10500); assert.equal(report.plans[0].discountedCount, 3); assert.equal(report.plans[0].events[2].discountApplied, true); assert.equal(report.plans[0].events[3].discountApplied, false); assert.equal(report.plans[0].events[3].amountCents, 1000);
  const expired = await compare(config({ plans: [plan({ discount: { amount: '0', until: '2027-01-01' } })] })); assert.equal(expired.plans[0].totalCents, 12000); assert.equal(expired.plans[0].discountedCount, 0);
});

test('T084: discount covering only first yearly charge applies whole fee, not split at expiry', async () => {
  const report = await compare(config({ interval: { mode: 'months', start: '2027-01-01', months: 24 }, plans: [plan({ amount: '100', periodMonths: 12, discount: { amount: '0', until: '2027-01-02' } })] }));
  assert.deepEqual(report.plans[0].events.map(event => [event.amountCents, event.discountApplied]), [[0, true], [10000, false]]); assert.equal(report.plans[0].totalCents, 10000);
});

test('T084: all discount values/date boundaries explicit, higher-than-regular discounts rejected', async () => {
  for (const discount of [{ amount: '11', until: '2027-02-01' }, { amount: '1', until: '' }, { amount: '1.111', until: '2027-02-01' }, { amount: '-1', until: '2027-02-01' }]) await assert.rejects(compare(config({ plans: [plan({ discount })] })));
  const equal = await compare(config({ plans: [plan({ discount: { amount: '10', until: '2028-01-01' } })] })); assert.equal(equal.plans[0].discountedCount, 12); assert.equal(equal.plans[0].totalCents, 12000);
});

test('T084: partial calendar month buckets retain interval boundaries and consistent accumulated totals', async () => {
  const report = await compare(config({ interval: { mode: 'months', start: '2027-01-31', months: 12 }, plans: [plan({ firstPaid: '2027-01-31' })] }));
  assert.equal(report.monthly.length, 13); assert.deepEqual([report.monthly[0].start, report.monthly[0].end], ['2027-01-31', '2027-02-01']); assert.deepEqual([report.monthly.at(-1).start, report.monthly.at(-1).end], ['2028-01-01', '2028-01-31']);
  assert.equal(report.monthly.at(-1).values[0].costCents, 0); assert.equal(report.monthly.at(-1).values[0].cumulativeCents, 12000);
});

test('T084: month/date/plan limits, same-currency contract and strict config IDs', async () => {
  const { validateConfig } = await model;
  for (const extra of [{ currency: 'JPY' }, { plans: [] }, { plans: Array(11).fill(plan()) }, { plans: [plan(), plan()] }, { plans: [plan({ id: 'bad' })] }, { plans: [plan({ periodMonths: 2 })] }, { plans: [plan({ currency: 'USD' })] }, { plans: [plan({ name: ' x ' })] }, { plans: [plan({ name: 'x\ny' })] }, { interval: { mode: 'months', start: '2027-01-01', months: 0 } }, { interval: { mode: 'months', start: '2027-01-01', months: 121 } }, { interval: { mode: 'months', start: '2027-01-01', months: 1.5 } }, { interval: { mode: 'dates', start: '2027-01-01', end: '2037-01-02' } }, { interval: { mode: 'dates', start: '2027-01-01', end: '2027-01-01' } }, { interval: { mode: 'months', start: '2199-12-31', months: 1 } }]) assert.throws(() => validateConfig(config(extra)));
});

test('T084: dates cap uses10-year anniversary, months mode keeps its separately stated month-end anchor', async () => {
  const input = config({ interval: { mode: 'dates', start: '2022-02-28', end: '2032-02-28' }, plans: [plan({ firstPaid: '2022-02-28' })] });
  assert.equal((await compare(input)).interval.end, '2032-02-28'); await assert.rejects(compare({ ...input, interval: { ...input.interval, end: '2032-02-29' } }), /10年/u);
  assert.equal((await compare({ ...input, interval: { mode: 'months', start: '2022-02-28', months: 120 } })).interval.end, '2032-02-29');
});

test('T084: maximum ten-plan ten-year amount remains an exact safe integer and importable report', async () => {
  const { serializeResult, importDraft } = await model, input = config({ interval: { mode: 'months', start: '2027-01-01', months: 120 }, plans: Array.from({ length: 10 }, (_, index) => plan({ id: 'S' + (index + 1), name: '方案' + index, amount: '10000000000.00' })) });
  const report = await compare(input); assert.ok(report.plans.every(plan => plan.totalCents === 120000000000000 && plan.chargeCount === 120)); assert.equal(report.lowestPlanIds.length, 10); assert.ok(Number.isSafeInteger(report.lowestCents));
  const saved = await serializeResult(report, 'json', immediate); assert.ok(new TextEncoder().encode(saved).length < 1048576); const restored = await importDraft(saved, immediate); assert.equal((await compare(restored)).lowestCents, report.lowestCents);
});

test('T084: pure calendar result does not vary with local timezone, even historical payment anchors', async () => {
  const previous = process.env.TZ, input = config({ plans: [plan({ firstPaid: '1900-01-31' })] });
  try { process.env.TZ = 'UTC'; const utc = await compare(input); process.env.TZ = 'Asia/Shanghai'; assert.deepEqual(await compare(input), utc); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('T084: versioned draft/report import recalculates instead of trusting imported results', async () => {
  const { makeDraft, importDraft, EXAMPLE } = await model; const draft = makeDraft(EXAMPLE), normalized = await importDraft(JSON.stringify(draft), immediate); assert.equal(normalized.plans[0].amount, '10.00');
  const report = await compare(EXAMPLE); report.plans[0].totalCents = 999; const restored = await compare(await importDraft(JSON.stringify(report), immediate)); assert.equal(restored.plans[0].totalCents, 12000);
  for (const envelope of [{ ...draft, version: 2 }, { ...draft, feature: 'T085' }, { ...draft, kind: 'script' }, { ...draft, extra: true }, { feature: 'T084', version: 1, kind: 'report' }]) await assert.rejects(importDraft(JSON.stringify(envelope), immediate));
});

test('T084: bounded strict JSON import rejects duplicate keys and corrupted fields atomically', async () => {
  const { importDraft, makeDraft, LIMITS } = await model;
  await assert.rejects(importDraft('{"feature":"T084","feature":"T084"}', immediate), /重复属性/u);
  await assert.rejects(importDraft('x'.repeat(LIMITS.importBytes + 1), immediate), /1 MiB/u);
  await assert.rejects(importDraft('['.repeat(14) + '0' + ']'.repeat(14), immediate), /12/u);
  const draft = makeDraft(config()); draft.config.plans[0].amount = 10; await assert.rejects(importDraft(JSON.stringify(draft), immediate), /十进制文本/u);
});

test('T084: full JSON/CSV/Markdown preserve assumptions, next renewals, all monthly and fee events', async () => {
  const { serializeResult, EXAMPLE } = await model, report = await compare(EXAMPLE);
  const json = JSON.parse(await serializeResult(report, 'json', immediate)); assert.equal(json.plans[0].events.length, 12); assert.ok(json.assumptions.interval); assert.equal(json.draft.kind, 'draft');
  const csv = await serializeResult(report, 'csv', immediate); assert.ok(csv.startsWith('\uFEFFsection,plan_id,detail_json')); assert.equal((csv.match(/^"charge",/gmu) || []).length, 13); assert.equal((csv.match(/^"month",/gmu) || []).length, 12); assert.ok(csv.includes('nextCharge'));
  const md = await serializeResult(report, 'md', immediate); assert.match(md, /120\.00/u); assert.match(md, /100\.00/u); assert.match(md, /2027-12-01/u); assert.match(md, /版本1可恢复方案/u);
  const escaped = await serializeResult(await compare(config({ plans: [plan({ name: '<b>|*x*`' })] })), 'md', immediate); assert.ok(escaped.includes('&lt;b&gt;\\|\\*x\\*\\`')); assert.ok(!escaped.split('```json')[0].includes('<b>'));
});

test('T084: cancellation of comparison/import/export permits recovery and output format/cap checked', async () => {
  const { compareSubscriptions, importDraft, makeDraft, serializeResult, LIMITS } = await model, controller = new AbortController(), aborting = { signal: controller.signal, yieldControl: async () => controller.abort() };
  await assert.rejects(compareSubscriptions(config(), aborting), { name: 'AbortError' }); await assert.rejects(importDraft(JSON.stringify(makeDraft(config())), { signal: controller.signal }), { name: 'AbortError' });
  const report = await compare(config()); await assert.rejects(serializeResult(report, 'json', { signal: controller.signal }), { name: 'AbortError' }); await assert.rejects(serializeResult(report, 'txt', immediate), /只支持/u);
  report.assumptions.extra = 'x'.repeat(LIMITS.outputBytes); await assert.rejects(serializeResult(report, 'json', immediate), /2 MiB/u);
});

// Minimal DOM fixture plus simulated export bridge; not native Electron verification.
class Element {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false; this.checked = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'disabled') this.disabled = true; if (key === 'checked') this.checked = true; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  append(...children) { for (const child of children) this.children.push(child.nodeType ? child : { nodeType: 3, textContent: String(child) }); if (this.tagName === 'select' && !this.value) this.value = this.children[0]?.value || ''; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  querySelectorAll(selector) { return descendants(this).filter(child => selector === '[data-page-disabled]' ? child.dataset.pageDisabled !== undefined : selector.split(',').includes(child.tagName)); }
  async fire(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ currentTarget: this }); }
}
function descendants(element) { return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
function button(root, title) { return descendants(root).find(element => element.tagName === 'button' && element.textContent === title); }
function control(root, title) { return descendants(root).find(element => element.attributes['aria-label'] === title); }
async function withUI(files, callback) {
  const previous = { document: global.document, window: global.window, FileReader: global.FileReader };
  global.document = { createElement: tag => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: String(text) }) }; global.window = { toolbox: { files } };
  global.FileReader = class { readAsArrayBuffer(file) { this.result = file.buffer; this.onload(); } abort() { this.onabort?.(); } };
  const root = new Element('main'), lifecycle = (await import('../src/renderer/features/T084/index.js')).default.create(root, {});
  try { await callback(root, lifecycle); } finally { lifecycle.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
}
const safeFiles = saved => ({ saveTextSupportsCopyOnly: true, saveText: async payload => { saved.push(payload); return { ok: true, path: 'copy' }; } });

test('T084 UI: catalog120/100 example, all result/draft protected exports and edit invalidation', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true); await button(root, '载入月10与年100示例').fire('click'); await button(root, '比较订阅成本').fire('click');
    assert.match(root.textContent, /120\.00 CNY/u); assert.match(root.textContent, /100\.00 CNY/u); assert.match(root.textContent, /2027-12-01/u);
    for (const title of ['保存完整 JSON 结果副本', '保存完整 CSV 结果副本', '保存完整 Markdown 结果副本', '保存版本1方案草稿副本']) await button(root, title).fire('click');
    assert.deepEqual(saved.map(payload => [payload.extension, payload.copyOnly]), [['json', true], ['csv', true], ['md', true], ['json', true]]);
    assert.equal(JSON.parse(saved[0].content).plans[0].totalCents, 12000); assert.equal(JSON.parse(saved[3].content).kind, 'draft');
    control(root, 'S1周期原价').value = '11.00'; await control(root, 'S1周期原价').fire('input'); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true); assert.match(root.textContent, /旧结果已废弃/u);
  });
});

test('T084 UI: checkbox actual discount controls, exact expiration, period/date inputs and disabled unsafe writer', async () => {
  await withUI({ saveText: async () => assert.fail('unsafe writer') }, async root => {
    assert.equal(control(root, 'S1优惠期每次金额').disabled, true); control(root, 'S1启用限时优惠').checked = true; await control(root, 'S1启用限时优惠').fire('change');
    control(root, 'S1优惠期每次金额').value = '5.00'; await control(root, 'S1优惠期每次金额').fire('input'); control(root, 'S1优惠到期日期').value = '2027-04-01'; await control(root, 'S1优惠到期日期').fire('input');
    await button(root, '比较订阅成本').fire('click'); assert.match(root.textContent, /105\.00 CNY/u); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true); assert.match(root.textContent, /缺少副本保护/u);
    control(root, '比较区间模式').value = 'dates'; await control(root, '比较区间模式').fire('change'); assert.equal(control(root, '比较月份数').disabled, true); assert.equal(control(root, '比较结束日期').disabled, false);
    control(root, '比较结束日期').value = '2027-04-01'; await control(root, '比较结束日期').fire('input'); await button(root, '比较订阅成本').fire('click'); assert.match(root.textContent, /15\.00 CNY/u);
    control(root, 'S1收费周期').value = '3'; await control(root, 'S1收费周期').fire('change'); await button(root, '比较订阅成本').fire('click'); assert.match(root.textContent, /5\.00 CNY/u);
  });
});

test('T084 UI: add/remove/name/currency controls and max10 schemes without accidental deletion of last', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    assert.equal(button(root, '移除方案S1').disabled, true); await button(root, '添加订阅方案').fire('click'); control(root, 'S2方案名称').value = '新方案'; await control(root, 'S2方案名称').fire('input');
    control(root, '比较币种').value = 'USD'; await control(root, '比较币种').fire('change'); await button(root, '比较订阅成本').fire('click'); assert.match(root.textContent, /USD/u); assert.match(root.textContent, /新方案/u);
    await button(root, '移除方案S1').fire('click'); assert.equal(control(root, 'S1周期原价'), undefined); assert.equal(button(root, '移除方案S2').disabled, true);
    for (let index = 1; index < 10; index++) await button(root, '添加订阅方案').fire('click'); assert.equal(button(root, '添加订阅方案').disabled, true); await button(root, '保存版本1方案草稿副本').fire('click'); assert.equal(JSON.parse(saved[0].content).config.plans.length, 10);
  });
});

test('T084 UI: versioned paste import restores controls atomically, invalid import preserves old result', async () => {
  const { makeDraft } = await model, saved = [];
  await withUI(safeFiles(saved), async root => {
    await button(root, '比较订阅成本').fire('click'); control(root, '待导入T084草稿JSON').value = '{"feature":"T084","version":2}'; await button(root, '导入粘贴的版本1方案').fire('click'); assert.match(root.textContent, /版本1/u); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, false);
    control(root, '待导入T084草稿JSON').value = JSON.stringify(makeDraft(config({ currency: 'EUR', interval: { mode: 'dates', start: '2027-02-01', end: '2027-03-01' }, plans: [plan({ name: '恢复方案', amount: '0.10' })] })));
    await button(root, '导入粘贴的版本1方案').fire('click'); assert.equal(control(root, '比较币种').value, 'EUR'); assert.equal(control(root, 'S1方案名称').value, '恢复方案'); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true);
    await button(root, '比较订阅成本').fire('click'); await button(root, '保存完整 JSON 结果副本').fire('click'); assert.equal(JSON.parse(saved[0].content).plans[0].totalCents, 10);
  });
});

test('T084 UI: file UTF8/caps/invalid data atomic import and full-report recomputation', async () => {
  const { EXAMPLE } = await model, original = await compare(EXAMPLE); original.plans[0].totalCents = 1; const saved = [];
  await withUI(safeFiles(saved), async root => {
    const file = control(root, '导入T084方案JSON文件'), bytes = new TextEncoder().encode('\uFEFF' + JSON.stringify(original)); file.files = [{ name: 'report.json', size: bytes.length, buffer: bytes.buffer }]; await file.fire('change');
    assert.equal(control(root, 'S2周期原价').value, '100.00'); await button(root, '比较订阅成本').fire('click');
    file.files = [{ name: 'bad.json', size: 1, buffer: new Uint8Array([255]).buffer }]; await file.fire('change'); assert.match(root.textContent, /不是有效UTF-8/u); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, false);
    file.files = [{ name: 'large.json', size: 1048577 }]; await file.fire('change'); assert.match(root.textContent, /超过1 MiB/u); await button(root, '保存完整 JSON 结果副本').fire('click'); assert.equal(JSON.parse(saved[0].content).plans[0].totalCents, 12000);
  });
});

test('T084 UI: deactivate/cancel recovery no partial result and save cancellation does not claim success', async () => {
  await withUI({ saveTextSupportsCopyOnly: true, saveText: async () => ({ canceled: true }) }, async (root, lifecycle) => {
    const running = button(root, '比较订阅成本').fire('click'); lifecycle.deactivate(); await running; assert.match(root.textContent, /已取消/u); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true);
    lifecycle.activate(); await button(root, '比较订阅成本').fire('click'); await button(root, '保存完整 JSON 结果副本').fire('click'); assert.match(root.textContent, /已取消另存/u); assert.equal(button(root, '取消当前操作').disabled, true);
  });
});

test('T084 UI: monthly/event pagination and scheme selector expose full results without export truncation', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    await button(root, '载入月10与年100示例').fire('click'); control(root, '比较月份数').value = '36'; await control(root, '比较月份数').fire('input'); await button(root, '比较订阅成本').fire('click');
    const forward = () => descendants(root).filter(element => element.tagName === 'button' && element.textContent === '下一页' && !element.disabled);
    assert.equal(forward().length, 2); await forward()[1].fire('click'); assert.match(root.textContent, /2029-12-01/u); await forward()[0].fire('click'); assert.match(root.textContent, /2028-12/u);
    control(root, '续费清单方案').value = 'S2'; await control(root, '续费清单方案').fire('change'); assert.match(root.textContent, /S2 年付：逐次首付\/续费/u);
    await button(root, '保存完整 JSON 结果副本').fire('click'); const report = JSON.parse(saved[0].content); assert.equal(report.plans[0].events.length, 36); assert.equal(report.monthly.length, 36);
  });
});

test('T084 UI: changing first-paid/start date anchors prevents temporary February clamp drift', async () => {
  const saved = [];
  await withUI(safeFiles(saved), async root => {
    control(root, '比较开始日期').value = '2027-01-30'; await control(root, '比较开始日期').fire('input');
    control(root, 'S1首次付费日期').value = '2027-01-30'; await control(root, 'S1首次付费日期').fire('input'); control(root, '比较月份数').value = '3'; await control(root, '比较月份数').fire('input');
    await button(root, '比较订阅成本').fire('click'); await button(root, '保存完整 JSON 结果副本').fire('click');
    assert.deepEqual(JSON.parse(saved[0].content).plans[0].events.map(event => event.date), ['2027-01-30', '2027-02-28', '2027-03-30']);
    control(root, 'S1首次付费日期').value = '2027-01-31'; await control(root, 'S1首次付费日期').fire('input'); assert.equal(button(root, '保存完整 JSON 结果副本').disabled, true);
  });
});
