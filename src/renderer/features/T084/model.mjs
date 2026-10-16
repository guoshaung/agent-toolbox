import { parseJSON, checkAbort } from './json.mjs';
export { checkAbort };
export const LIMITS = Object.freeze({ plans: 10, months: 120, events: 1500, amountCents: 1000000000000, importBytes: 1024 * 1024, outputBytes: 2 * 1024 * 1024 });
export const CURRENCIES = Object.freeze(['CNY', 'USD', 'EUR', 'GBP']);
export const ASSUMPTIONS = Object.freeze({ currency: '所有方案为同一币种，支持CNY/USD/EUR/GBP，每主单位100分；不换汇、不自动查询价格', interval: '比较区间左闭右开[start,end)，收费日期等于开始计入，等于结束不计入；仅按区间内实际收费累计', charging: '月/季/年周期每次完整收费，不摊销、不退款；开始前已付的费用不计入，即使服务仍在覆盖期；方案作为互斥选项独立比较', anchor: '每次日期从原始首付锚点计算：首付是月末则目标月也取月末，否则保留原日号，短月夹至月末但不改变原日号', discount: '优惠仅在收费日期严格早于到期日时适用；到期当天恢复原价；0金额优惠允许，不按服务期分摊', months: '月份模式的结束日为开始日按相同锚点向后加1–120个月；按月表按公历月份分桶，首尾部分月只计区间内收费', dates: '输入仅1900–2199年公历日期，不使用本地时间戳、时区、小时或夏令时；日期模式最多到开始日的10年周年，闰日周年夹至2月末', totals: '金额转为整数分后累加，先验证安全整数；数值只按输入假设计算，不调用付款/取消服务，不包含税费、涨价、停订或失败重试', recovery: '导入草稿或完整结果只读取版本1方案配置，旧统计丢弃后重新计算；切换具体功能会丢失未导出的内容' });
export const EXAMPLE = Object.freeze({ currency: 'CNY', interval: { mode: 'months', start: '2027-01-01', months: 12, end: '2028-01-01' }, plans: [ { id: 'S1', name: '月付', amount: '10.00', periodMonths: 1, firstPaid: '2027-01-01', discount: null }, { id: 'S2', name: '年付', amount: '100.00', periodMonths: 12, firstPaid: '2027-01-01', discount: null } ] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label}结构不合法或包含未知字段。`); }
export const daysInMonth = (year, month) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('日期必须为YYYY-MM-DD。');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new Error('日期不合法或不在1900–2199年。');
  return { year, month, day, monthEnd: day === daysInMonth(year, month) };
}
const dateString = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
export function addMonths(date, offset) {
  const anchor = typeof date === 'string' ? parseDate(date) : date;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('月份偏移必须为非负安全整数。');
  const monthIndex = anchor.year * 12 + anchor.month - 1 + offset, year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
  return dateString(year, month, anchor.monthEnd ? daysInMonth(year, month) : Math.min(anchor.day, daysInMonth(year, month)));
}
export function parseAmount(value) {
  if (typeof value !== 'string' || value.length > 20 || !/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error('金额须为非负十进制文本，最多两位小数，不接受空白、指数、逗号或符号。');
  const [whole, fraction = ''] = value.split('.'), cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(LIMITS.amountCents)) throw new Error('单次金额超过10000000000.00。'); return Number(cents);
}
export function formatAmount(cents) { if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('金额不是非负安全整数分。'); const value = BigInt(cents); return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
export function validateConfig(input) {
  exactKeys(input, ['currency', 'interval', 'plans'], '方案配置'); if (!CURRENCIES.includes(input.currency)) throw new Error('请选择CNY/USD/EUR/GBP同币种比较。');
  exactKeys(input.interval, ['mode', 'start', 'months', 'end'], '比较区间'); const interval = input.interval, start = parseDate(interval.start);
  if (!['months', 'dates'].includes(interval.mode)) throw new Error('区间模式须为months或dates。');
  let end;
  if (interval.mode === 'months') { if (!Number.isInteger(interval.months) || interval.months < 1 || interval.months > LIMITS.months) throw new Error('比较月份必须为1–120整数。'); end = addMonths(start, interval.months); }
  else { parseDate(interval.end); end = interval.end; const anniversary = dateString(start.year + 10, start.month, Math.min(start.day, daysInMonth(start.year + 10, start.month))); if (end > anniversary) throw new Error('日期区间最多10年（截至开始日的10年周年）。'); }
  parseDate(end); if (end <= interval.start) throw new Error('结束日期须晚于开始日期。');
  if (!Array.isArray(input.plans) || !input.plans.length || input.plans.length > LIMITS.plans) throw new Error('请配置1–10个方案。');
  const ids = new Set(), plans = input.plans.map((plan, index) => {
    exactKeys(plan, ['id', 'name', 'amount', 'periodMonths', 'firstPaid', 'discount'], `方案${index + 1}`);
    if (typeof plan.id !== 'string' || !/^S(?:[1-9]|10)$/u.test(plan.id) || ids.has(plan.id)) throw new Error('方案ID须为唯一S1–S10。'); ids.add(plan.id);
    if (typeof plan.name !== 'string' || !plan.name.trim() || plan.name !== plan.name.trim() || plan.name.length > 80 || /[\r\n\u0000-\u001f\u007f]/u.test(plan.name)) throw new Error('方案名须为1–80单位，无首尾空白/控制字符。');
    if (![1, 3, 12].includes(plan.periodMonths)) throw new Error('仅支持月/季/年周期1、3、12个月。');
    const anchor = parseDate(plan.firstPaid), amountCents = parseAmount(plan.amount); let discount = null;
    if (plan.discount !== null) { exactKeys(plan.discount, ['amount', 'until'], '优惠配置'); const discountCents = parseAmount(plan.discount.amount); parseDate(plan.discount.until); if (discountCents > amountCents) throw new Error('优惠金额不能高于原价。'); discount = { amount: formatAmount(discountCents), amountCents: discountCents, until: plan.discount.until }; }
    return { id: plan.id, name: plan.name, amount: formatAmount(amountCents), amountCents, periodMonths: plan.periodMonths, firstPaid: plan.firstPaid, anchor, discount };
  });
  const config = { currency: input.currency, interval: { mode: interval.mode, start: interval.start, months: interval.mode === 'months' ? interval.months : null, end }, plans: plans.map(({ id, name, amount, periodMonths, firstPaid, discount }) => ({ id, name, amount, periodMonths, firstPaid, discount: discount ? { amount: discount.amount, until: discount.until } : null })) };
  return { config, plans, start, end };
}
export function makeDraft(config) { return { feature: 'T084', version: 1, kind: 'draft', config: validateConfig(config).config }; }
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
export async function importDraft(text, hooks = {}) {
  const envelope = (await parseJSON({ name: 'subscription-import.json', text }, hooks)).root;
  if (!object(envelope) || envelope.feature !== 'T084' || envelope.version !== 1 || !['draft', 'report'].includes(envelope.kind)) throw new Error('仅接受T084版本1草稿或完整JSON报告。');
  const draft = envelope.kind === 'report' ? envelope.draft : envelope;
  exactKeys(draft, ['feature', 'version', 'kind', 'config'], '草稿'); if (draft.feature !== 'T084' || draft.version !== 1 || draft.kind !== 'draft') throw new Error('草稿版本或类型不合法。');
  checkAbort(hooks.signal); return makeDraft(draft.config).config;
}
const safeSum = (left, right) => { const sum = left + right; if (!Number.isSafeInteger(sum)) throw new Error('累计分超出安全整数范围，整批拒绝。'); return sum; };
function charge(plan, cycleIndex) {
  const date = addMonths(plan.anchor, cycleIndex * plan.periodMonths), discountApplied = !!plan.discount && date < plan.discount.until;
  return { cycleIndex, kind: cycleIndex === 0 ? 'initial' : 'renewal', date, amountCents: discountApplied ? plan.discount.amountCents : plan.amountCents, regularAmountCents: plan.amountCents, discountApplied };
}
export async function compareSubscriptions(input, hooks = {}) {
  await checkpoint(hooks); const validated = validateConfig(input), { config, plans, start, end } = validated; let eventCount = 0; const reports = [];
  for (const plan of plans) {
    await checkpoint(hooks);
    const monthGap = (start.year - plan.anchor.year) * 12 + start.month - plan.anchor.month;
    let cycleIndex = Math.max(0, Math.floor(monthGap / plan.periodMonths) - 1), event = charge(plan, cycleIndex);
    while (event.date < config.interval.start) { cycleIndex++; event = charge(plan, cycleIndex); }
    const events = []; let totalCents = 0, discountedCount = 0;
    while (event.date < end) {
      if (++eventCount > LIMITS.events) throw new Error('收费事件超过1500，整批拒绝。'); if (eventCount % 32 === 0) await checkpoint(hooks);
      totalCents = safeSum(totalCents, event.amountCents); if (event.discountApplied) discountedCount++;
      events.push({ ...event, cumulativeCents: totalCents }); cycleIndex++; event = charge(plan, cycleIndex);
    }
    reports.push({ id: plan.id, name: plan.name, periodMonths: plan.periodMonths, firstPaid: plan.firstPaid, anchor: { day: plan.anchor.day, monthEnd: plan.anchor.monthEnd }, totalCents, chargeCount: events.length, discountedCount, events, nextCharge: event, warning: !events.length ? '区间内无收费；不代表服务未使用或永久免费，开始前付费不计入本区间。' : null });
  }
  const monthly = [], cumulatives = new Map(reports.map(plan => [plan.id, 0])), indexes = new Map(reports.map(plan => [plan.id, 0]));
  let monthIndex = start.year * 12 + start.month - 1;
  while (true) {
    await checkpoint(hooks); const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1, bucketStart = dateString(year, month, 1); if (bucketStart >= end) break;
    const nextIndex = monthIndex + 1, nextStart = dateString(Math.floor(nextIndex / 12), nextIndex % 12 + 1, 1), actualStart = bucketStart < config.interval.start ? config.interval.start : bucketStart, actualEnd = nextStart > end ? end : nextStart;
    const values = reports.map(plan => {
      let costCents = 0, chargeCount = 0, discountedCount = 0, index = indexes.get(plan.id);
      while (index < plan.events.length && plan.events[index].date < actualEnd) { const event = plan.events[index++]; costCents = safeSum(costCents, event.amountCents); chargeCount++; if (event.discountApplied) discountedCount++; }
      indexes.set(plan.id, index); const cumulativeCents = safeSum(cumulatives.get(plan.id), costCents); cumulatives.set(plan.id, cumulativeCents); return { planId: plan.id, costCents, cumulativeCents, chargeCount, discountedCount };
    });
    monthly.push({ month: bucketStart.slice(0, 7), start: actualStart, end: actualEnd, values }); monthIndex++;
    if (monthly.length > 121) throw new Error('公历月份分桶超过121，整批拒绝。');
  }
  for (const plan of reports) if (cumulatives.get(plan.id) !== plan.totalCents) throw new Error('月表累计校验失败，结果不可导出。');
  const lowestCents = Math.min(...reports.map(plan => plan.totalCents)); checkAbort(hooks.signal);
  return { feature: 'T084', version: 1, kind: 'report', draft: { feature: 'T084', version: 1, kind: 'draft', config }, assumptions: { ...ASSUMPTIONS }, currency: config.currency, interval: { ...config.interval, endExclusive: true }, plans: reports, monthly, lowestCents, lowestPlanIds: reports.filter(plan => plan.totalCents === lowestCents).map(plan => plan.id) };
}
export async function serializeResult(report, format, hooks = {}) {
  if (!['json', 'csv', 'md'].includes(format)) throw new Error('只支持JSON/CSV/Markdown。'); await checkpoint(hooks);
  const chunks = [], encoder = new TextEncoder(); let bytes = 0;
  const append = value => { bytes += encoder.encode(value).length; if (bytes > LIMITS.outputBytes) throw new Error('导出超过2 MiB。'); chunks.push(value); };
  if (format === 'json') append(JSON.stringify(report, null, 2) + '\n');
  else if (format === 'csv') {
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    append('\uFEFFsection,plan_id,detail_json\r\n'); const row = (kind, id, value) => append([kind, id, JSON.stringify(value)].map(quote).join(',') + '\r\n');
    row('metadata', '', { feature: report.feature, version: report.version, kind: report.kind, currency: report.currency, interval: report.interval, assumptions: report.assumptions, draft: report.draft, lowestCents: report.lowestCents, lowestPlanIds: report.lowestPlanIds });
    for (const plan of report.plans) { await checkpoint(hooks); row('summary', plan.id, { ...plan, events: undefined }); for (let index = 0; index < plan.events.length; index++) { if (index % 32 === 0) await checkpoint(hooks); row('charge', plan.id, plan.events[index]); } }
    for (const month of report.monthly) { await checkpoint(hooks); row('month', '', month); }
  } else {
    const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('*', '\\*').replaceAll('_', '\\_').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('[', '\\[').replaceAll(']', '\\]');
    append(`# 订阅续费成本比较\n\n币种 ${report.currency}，区间 [${report.interval.start}, ${report.interval.end})。所有金额单位为该币种主单位。\n\n`);
    for (const [key, value] of Object.entries(report.assumptions)) append(`- ${key}: ${value}\n`);
    append('\n| 方案 | 总成本 | 收费次数 | 优惠次数 | 下一次收费（区间外） |\n| --- | ---: | ---: | ---: | --- |\n');
    for (const plan of report.plans) append(`| ${escape(plan.id + ' ' + plan.name)} | ${formatAmount(plan.totalCents)} | ${plan.chargeCount} | ${plan.discountedCount} | ${plan.nextCharge.date}: ${formatAmount(plan.nextCharge.amountCents)} |\n`);
    append('\n## 按公历月累计\n\n| 月份/有效区间 | 方案 | 当月成本 | 累计成本 | 收费次数 |\n| --- | --- | ---: | ---: | ---: |\n');
    for (const month of report.monthly) { await checkpoint(hooks); for (const value of month.values) append(`| ${month.month} [${month.start},${month.end}) | ${value.planId} | ${formatAmount(value.costCents)} | ${formatAmount(value.cumulativeCents)} | ${value.chargeCount} |\n`); }
    for (const plan of report.plans) {
      await checkpoint(hooks); append(`\n## ${escape(plan.id + ' ' + plan.name)}：逐次收费\n\n锚点日号${plan.anchor.day}，月末锚点${plan.anchor.monthEnd}。${plan.warning || ''}\n\n| 首付/续费 | 日期 | 金额 | 优惠适用 | 累计 |\n| --- | --- | ---: | --- | ---: |\n`);
      for (let index = 0; index < plan.events.length; index++) { if (index % 32 === 0) await checkpoint(hooks); const event = plan.events[index]; append(`| ${event.kind === 'initial' ? '首付' : '续费'}(${event.cycleIndex}) | ${event.date} | ${formatAmount(event.amountCents)} | ${event.discountApplied ? '是' : '否'} | ${formatAmount(event.cumulativeCents)} |\n`); }
    }
    append('\n## 版本1可恢复方案（复制此JSON导入，重新计算）\n\n```json\n' + JSON.stringify(report.draft, null, 2) + '\n```\n');
  }
  checkAbort(hooks.signal); return chunks.join('');
}
