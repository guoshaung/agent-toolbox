import { h } from '../../core/ui.js';
import { LIMITS, CURRENCIES, ASSUMPTIONS, EXAMPLE, checkAbort, validateConfig, makeDraft, importDraft, compareSubscriptions, serializeResult, formatAmount } from './model.mjs';
const css = `.t084{display:grid;gap:12px;color:var(--text);max-width:1200px;margin:auto}.t084 label{display:grid;gap:6px}.t084 input,.t084 textarea,.t084 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.t084 textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace}.t084 .t084-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.t084 .t084-row>label{flex:1;min-width:155px}.t084 .t084-card{padding:12px;border:1px solid var(--line);border-radius:8px;display:grid;gap:8px}.t084 .t084-check{display:flex;align-items:center;gap:8px}.t084 .t084-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t084 .t084-status{padding:10px;background:var(--bg-sunken);white-space:pre-wrap}.t084 .t084-scroll{overflow:auto;max-height:420px}.t084 td,.t084 th{padding:8px;border-bottom:1px solid var(--line);min-width:100px;max-width:350px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;vertical-align:top}.t084 table{border-collapse:collapse;width:100%;font-size:13px}.t084 th{position:sticky;top:0;background:var(--bg-raised)}.t084 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t084 button:disabled{opacity:.5}`;
const label = (title, input) => h('label', {}, title, input);
const button = (title, action, primary = false) => h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', onclick: action }, title);
const dateInput = (title, value) => h('input', { type: 'date', min: '1900-01-01', max: '2199-12-31', 'aria-label': title, value });
const amountInput = (title, value) => h('input', { type: 'text', inputmode: 'decimal', maxlength: 20, 'aria-label': title, value });
function table(headers, rows) { return h('div', { class: 't084-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...headers.map(value => h('th', {}, value)))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(value => h('td', {}, value))))))); }
async function readUTF8(file, signal) {
  if (file.size > LIMITS.importBytes) throw new Error('导入文件超过1 MiB。');
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader(), clean = () => signal.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    reader.onload = () => { clean(); resolve(reader.result); }; reader.onerror = () => { clean(); reject(new Error('文件读取失败。')); }; reader.onabort = () => { clean(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
  checkAbort(signal); try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw new Error('文件不是有效UTF-8，当前方案未替换。'); }
}
export default {
  id: 'T084',
  create(root) {
    let plans = [{ ...EXAMPLE.plans[0] }], report = null, busy = false, alive = true, operation = null, monthPage = 0, eventPage = 0, discountControls = [], removeControls = [];
    const currency = h('select', { 'aria-label': '比较币种' }, ...CURRENCIES.map(code => h('option', { value: code }, code)));
    const mode = h('select', { 'aria-label': '比较区间模式' }, h('option', { value: 'months' }, '按月份（1–120个月）'), h('option', { value: 'dates' }, '按日期（最多10年）'));
    const start = dateInput('比较开始日期', '2027-01-01'), end = dateInput('比较结束日期', '2028-01-01');
    const months = h('input', { type: 'number', min: 1, max: 120, step: 1, 'aria-label': '比较月份数', value: 12 });
    const configHost = h('div'), summaryHost = h('div'), monthHost = h('div'), eventHost = h('div'), detail = h('div');
    const planPicker = h('select', { 'aria-label': '续费清单方案' });
    const file = h('input', { type: 'file', accept: '.json', 'aria-label': '导入T084方案JSON文件' }), pasted = h('textarea', { rows: 4, 'aria-label': '待导入T084草稿JSON', placeholder: '仅导入版本1 T084草稿/完整结果；当前可视方案仍是计算输入。' });
    const status = h('div', { class: 't084-status', role: 'status', 'aria-live': 'polite' }, '填写1–10方案并比较。同币种完整收费，不摊销或调用付款/取消服务。');
    const files = window.toolbox?.files, safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = value => { if (alive) status.textContent = value; };
    const setBusy = value => {
      busy = value; if (!alive) return;
      for (const control of panel.querySelectorAll('input,textarea,select,button')) control.disabled = value;
      cancel.disabled = !value;
      if (!value) {
        months.disabled = mode.value !== 'months'; end.disabled = mode.value !== 'dates'; add.disabled = plans.length >= LIMITS.plans;
        for (const { plan, amount, until } of discountControls) amount.disabled = until.disabled = !plan.discount;
        for (const control of removeControls) control.disabled = plans.length <= 1;
        json.disabled = csv.disabled = markdown.disabled = !report || !safeSave(); draft.disabled = !safeSave(); planPicker.disabled = !report;
        for (const control of panel.querySelectorAll('[data-page-disabled]')) control.disabled = control.dataset.pageDisabled === 'true';
      }
    };
    const invalidate = () => { report = null; monthPage = eventPage = 0; summaryHost.replaceChildren(); monthHost.replaceChildren(); eventHost.replaceChildren(); detail.replaceChildren(); planPicker.replaceChildren(); setBusy(false); say('方案或区间已改变，旧结果已废弃，请重新比较。'); };
    currency.addEventListener('change', invalidate); mode.addEventListener('change', invalidate); start.addEventListener('input', invalidate); end.addEventListener('input', invalidate); months.addEventListener('input', invalidate);
    const renderConfig = () => {
      discountControls = []; removeControls = [];
      configHost.replaceChildren(...plans.map(plan => {
        const name = h('input', { value: plan.name, maxlength: 80, 'aria-label': `${plan.id}方案名称`, oninput: event => { plan.name = event.currentTarget.value; invalidate(); } });
        const amount = amountInput(`${plan.id}周期原价`, plan.amount); amount.addEventListener('input', event => { plan.amount = event.currentTarget.value; invalidate(); });
        const period = h('select', { 'aria-label': `${plan.id}收费周期`, onchange: event => { plan.periodMonths = Number(event.currentTarget.value); invalidate(); } }, h('option', { value: 1 }, '每月'), h('option', { value: 3 }, '每季（3个月）'), h('option', { value: 12 }, '每年（12个月）')); period.value = String(plan.periodMonths);
        const first = dateInput(`${plan.id}首次付费日期`, plan.firstPaid); first.addEventListener('input', event => { plan.firstPaid = event.currentTarget.value; invalidate(); });
        const discounted = h('input', { type: 'checkbox', checked: !!plan.discount, 'aria-label': `${plan.id}启用限时优惠`, onchange: event => { plan.discount = event.currentTarget.checked ? { amount: '0.00', until: start.value } : null; invalidate(); renderConfig(); } });
        const discountAmount = amountInput(`${plan.id}优惠期每次金额`, plan.discount?.amount || '0.00'); discountAmount.addEventListener('input', event => { if (plan.discount) plan.discount.amount = event.currentTarget.value; invalidate(); });
        const until = dateInput(`${plan.id}优惠到期日期`, plan.discount?.until || start.value); until.addEventListener('input', event => { if (plan.discount) plan.discount.until = event.currentTarget.value; invalidate(); });
        discountControls.push({ plan, amount: discountAmount, until }); const remove = button(`移除方案${plan.id}`, () => { if (plans.length <= 1) return; plans = plans.filter(other => other !== plan); invalidate(); renderConfig(); }); removeControls.push(remove);
        return h('div', { class: 't084-card' }, h('strong', {}, plan.id), h('div', { class: 't084-row' }, label('方案名称', name), label('每周期原价（主单位）', amount), label('自动续费周期', period), label('原始首次付费日期', first)),
          h('label', { class: 't084-check' }, discounted, '限时优惠（到期当天恢复原价）'), h('div', { class: 't084-row' }, label('优惠期每次金额（可为0）', discountAmount), label('优惠结束日（该日不优惠）', until)), remove);
      })); setBusy(busy);
    };
    const config = () => ({ currency: currency.value, interval: { mode: mode.value, start: start.value, months: Number(months.value), end: end.value }, plans: plans.map(plan => ({ ...plan, discount: plan.discount ? { ...plan.discount } : null })) });
    const loadConfig = input => {
      const valid = validateConfig(input).config;
      currency.value = valid.currency; mode.value = valid.interval.mode; start.value = valid.interval.start; end.value = valid.interval.end; months.value = String(valid.interval.months || 12); plans = valid.plans.map(plan => ({ ...plan, discount: plan.discount ? { ...plan.discount } : null }));
      invalidate(); renderConfig();
    };
    const add = button('添加订阅方案', () => {
      if (plans.length >= LIMITS.plans) return; const id = Array.from({ length: LIMITS.plans }, (_, index) => 'S' + (index + 1)).find(id => !plans.some(plan => plan.id === id));
      plans.push({ id, name: `方案${id}`, amount: '0.00', periodMonths: 1, firstPaid: start.value, discount: null }); invalidate(); renderConfig();
    });
    const example = button('载入月10与年100示例', () => { loadConfig(EXAMPLE); say('示例已载入：2027-01-01起12个月，月付10.00/年付100.00，同为CNY，无优惠。点击比较。'); });
    const pager = (current, pages, change) => {
      const back = button('上一页', () => change(current - 1)), next = button('下一页', () => change(current + 1)); back.dataset.pageDisabled = String(current === 0); next.dataset.pageDisabled = String(current >= pages - 1);
      return h('div', { class: 't084-row' }, back, h('span', {}, `第${current + 1}/${pages}页`), next);
    };
    const renderMonths = () => {
      const pages = Math.max(1, Math.ceil(report.monthly.length / 12)); monthPage = Math.max(0, Math.min(monthPage, pages - 1));
      monthHost.replaceChildren(h('h3', {}, '按公历月的费用与累计'), h('p', { class: 't084-muted' }, '首尾部分月只计有效区间内收费。10年窗口最多出现121个公历月，不等同于按周期均摊。'),
        table(['月份/有效区间', ...report.plans.map(plan => `${plan.id} ${plan.name}：本月/累计`)], report.monthly.slice(monthPage * 12, monthPage * 12 + 12).map(month => [`${month.month} [${month.start},${month.end})`, ...month.values.map(value => `${formatAmount(value.costCents)} / ${formatAmount(value.cumulativeCents)}（${value.chargeCount}次）`)])),
        pager(monthPage, pages, next => { monthPage = next; renderMonths(); setBusy(false); }));
    };
    const renderEvents = () => {
      const plan = report.plans.find(plan => plan.id === planPicker.value) || report.plans[0], pages = Math.max(1, Math.ceil(plan.events.length / 25)); eventPage = Math.max(0, Math.min(eventPage, pages - 1));
      eventHost.replaceChildren(h('h3', {}, `${plan.id} ${plan.name}：逐次首付/续费`), h('p', {}, `首付${plan.firstPaid} · 原始日号${plan.anchor.day} · 月末锚点=${plan.anchor.monthEnd} · 区间内${plan.events.length}次`), ...(plan.warning ? [h('p', {}, plan.warning)] : []),
        table(['类型/周期序号', '实际收费日期', `金额(${report.currency})`, '优惠适用', '累计'], plan.events.slice(eventPage * 25, eventPage * 25 + 25).map(event => [`${event.kind === 'initial' ? '首付' : '续费'} / ${event.cycleIndex}`, event.date, formatAmount(event.amountCents), event.discountApplied ? '是' : '否', formatAmount(event.cumulativeCents)])),
        pager(eventPage, pages, next => { eventPage = next; renderEvents(); setBusy(false); }));
    };
    planPicker.addEventListener('change', () => { if (!report) return; eventPage = 0; renderEvents(); setBusy(false); });
    const renderResults = () => {
      summaryHost.replaceChildren(h('h3', {}, `比较区间 [${report.interval.start}, ${report.interval.end}) · ${report.currency}`),
        h('p', {}, `最低区间收费：${report.lowestPlanIds.join('、')}，${formatAmount(report.lowestCents)} ${report.currency}；只比较输入费用，不代表服务等价。`),
        table(['方案', '总成本', '收费/优惠次数', '下一次收费（区间外）'], report.plans.map(plan => [`${plan.id} ${plan.name}`, `${formatAmount(plan.totalCents)} ${report.currency}`, `${plan.chargeCount} / ${plan.discountedCount}`, `${plan.nextCharge.date} · ${formatAmount(plan.nextCharge.amountCents)} · 优惠${plan.nextCharge.discountApplied ? '是' : '否'}`])));
      planPicker.replaceChildren(...report.plans.map(plan => h('option', { value: plan.id }, `${plan.id} ${plan.name}`))); planPicker.value = report.plans[0].id; renderMonths(); renderEvents();
    };
    const calculate = button('比较订阅成本', async () => {
      if (busy) return; invalidate(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在按收费日期精确累计…');
      try { const result = await compareSubscriptions(config(), { signal: controller.signal }); if (!alive) return; report = result; renderResults(); say('比较完成，请核对原始首付日期、区间与优惠边界后保存副本。'); }
      catch (error) { if (alive) { invalidate(); say(error.message); } } finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const importText = async source => { const valid = await importDraft(source, { signal: operation.signal }); if (!alive) return; loadConfig(valid); say('版本1方案已恢复，旧统计未采用，请重新比较。'); };
    const importPaste = button('导入粘贴的版本1方案', async () => {
      if (busy) return; const controller = new AbortController(); operation = controller; setBusy(true); say('正在校验草稿…');
      try { await importText(pasted.value); } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    });
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected || busy) return; const controller = new AbortController(); operation = controller; setBusy(true); say('正在读取版本化方案…');
      try { const content = await readUTF8(selected, controller.signal); await importText(content); } catch (error) { say(error.message); } finally { file.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
    });
    const cancel = button('取消当前操作', () => operation?.abort());
    const save = async kind => {
      if (busy || !safeSave() || (kind !== 'draft' && !report)) return; const controller = new AbortController(); operation = controller; setBusy(true); say('正在生成副本…');
      try {
        const content = kind === 'draft' ? JSON.stringify(makeDraft(config()), null, 2) + '\n' : await serializeResult(report, kind, { signal: controller.signal }); checkAbort(controller.signal); if (!alive) return;
        const extension = kind === 'draft' ? 'json' : kind; cancel.disabled = true; say('副本已生成，请在另存对话框核对目标或取消。');
        const response = await files.saveText({ content, extension, defaultName: kind === 'draft' ? 'subscription-draft-copy.json' : `subscription-comparison-copy.${extension}`, copyOnly: true });
        if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = button('保存完整 JSON 结果副本', () => save('json')), csv = button('保存完整 CSV 结果副本', () => save('csv')), markdown = button('保存完整 Markdown 结果副本', () => save('md')), draft = button('保存版本1方案草稿副本', () => save('draft'));
    const panel = h('section', { class: 't084' }, h('style', {}, css), h('h2', {}, '订阅续费成本比较'),
      h('p', { class: 't084-muted' }, '纯本地测算：不付款、不停订、不上传。统一币种，整数分累计；每周期完整收费，开始前付费不计入，结束当天收费不计入。切换具体功能会丢失未保存内容，请保存方案草稿。'),
      h('div', { class: 't084-row' }, label('统一币种（100分/主单位）', currency), label('比较区间模式', mode), label('开始日期（包含）', start), label('月份数', months), label('结束日期（不包含）', end)),
      h('p', { class: 't084-muted' }, '月份模式自动推算结束日。首付在月末，则以后周期目标月取月末；否则保持原始日号，短月暂夹至月末。优惠到期日当天恢复原价。'), example,
      h('h3', {}, '订阅方案（1–10）'), configHost, add, h('div', { class: 't084-row' }, calculate, cancel), status, summaryHost, monthHost, label('查看一个方案的完整收费清单', planPicker), eventHost,
      h('div', { class: 't084-row' }, json, csv, markdown, draft), safeSave() ? null : h('p', { class: 't084-muted' }, '基础层缺少副本保护，导出已禁用，请使用支持copyOnly的版本。'),
      h('details', {}, h('summary', {}, '计算假设与边界'), ...Object.values(ASSUMPTIONS).map(value => h('p', { class: 't084-muted' }, value))),
      h('details', {}, h('summary', {}, '恢复草稿 / 完整JSON结果（只读取方案，重新计算）'), label('UTF-8 T084 JSON文件', file), label('可选：粘贴T084版本1 JSON', pasted), importPaste), detail);
    root.replaceChildren(panel); renderConfig(); setBusy(false);
    return { activate() { if (alive && !operation) setBusy(false); }, deactivate() { operation?.abort(); }, destroy() { operation?.abort(); alive = false; plans = []; discountControls = removeControls = []; report = null; root.replaceChildren(); } };
  }
};
