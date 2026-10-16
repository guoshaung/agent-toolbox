import { h } from '../../core/ui.js';
import { exampleDraft, validateDraft, parseTasks, editTask, addTask, removeTask, analyze, reportJson, reportMarkdown } from './model.mjs';
const KEY = 'features.L057.draft', channels = new WeakMap();
function channelFor(config) { if (!config || typeof config.set !== 'function') return null; if (!channels.has(config)) channels.set(config, { owner: null, pending: null, latest: null, running: false, ticket: 0 }); return channels.get(config); }
async function drain(config, channel) {
  channel.running = true;
  try { while (channel.pending) { const job = channel.pending; channel.pending = null; try { await config.set(KEY, job.value); if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(); } catch (error) { if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(error); } } }
  finally { channel.running = false; }
}
const number = value => value === null ? '不可估' : value !== 0 && Math.abs(value) < 0.000001 ? value.toExponential(6) : Number(value.toFixed(6)).toString();
export default { id: 'L057', create(root, ctx = {}) {
  root.classList.add('feature-l057');
  let draft = exampleDraft(), report = null, active = true, destroyed = false, busy = false, ticket = 0, exporting = false, armed = null, visibilitySuspended = false;
  let rowPage = 0, resultPage = 0, groupPage = 0, filter = 'all';
  const controls = new Map(), channel = channelFor(ctx.config), owner = {};
  if (channel) channel.owner = owner;
  const notice = h('div', { class: 'l057-notice', role: 'status', 'aria-live': 'polite' }), storage = h('div', { class: 'l057-storage' }), editor = h('div'), confirmation = h('div'), output = h('div');
  const live = () => active && !destroyed;
  const replace = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  function message(value, error = false) { if (live()) { notice.textContent = value; notice.classList.toggle('is-error', error); } }
  function persist() {
    if (!channel || channel.owner !== owner) return;
    const seq = ++channel.ticket; let value;
    try { value = validateDraft(draft, { forStorage: true }); } catch (error) { if (!destroyed) storage.textContent = `草稿未保存：${error.message}。`; return; }
    channel.latest = value;
    channel.pending = { value, owner, ticket: seq, done(error) { if (!destroyed) storage.textContent = error ? `草稿保存未确认：${error.message}` : 'schema1原CSV与人工来源≤64KiB已保存，不存派生系数；时长编辑可未完成，需重新回测。'; } };
    if (!channel.running) void drain(ctx.config, channel);
  }
  function changed() { ticket++; report = null; resultPage = 0; renderOutput(); persist(); }
  function update(fn, success) { if (!live()) return; try { draft = validateDraft(fn(draft)); changed(); refresh(); message(success); } catch (error) { message(`整项未完成：${error.message}`, true); refresh(); } }
  function field(label, value, change, rows = 0) {
    const node = h(rows ? 'textarea' : 'input', { class: 'field', type: rows ? undefined : 'text', rows: rows ? String(rows) : undefined, 'aria-label': label, oninput: () => update(d => change({ ...d, source: { ...d.source } }, node.value), '输入已修订，旧系数失效；主动重新回测。') });
    node.value = value; controls.set(label, node); return node;
  }
  function refresh() {
    const old = document.activeElement, label = old?.getAttribute?.('aria-label'), a = old?.selectionStart, b = old?.selectionEnd;
    renderEditor(); const next = controls.get(label); if (next) { next.focus?.(); if (Number.isInteger(a) && typeof next.setSelectionRange === 'function') next.setSelectionRange(Math.min(a, next.value.length), Math.min(b, next.value.length)); }
  }
  function pages(label, page, count, set) { return h('div', { class: 'l057-actions' }, h('button', { class: 'btn', disabled: page === 0, onclick: () => { if (!live()) return; set(page - 1); } }, `${label}上一页`), h('span', {}, `${label} ${page + 1}/${Math.max(1, count)}页`), h('button', { class: 'btn', disabled: page + 1 >= count, onclick: () => { if (!live()) return; set(page + 1); } }, `${label}下一页`)); }
  function renderEditor() {
    controls.clear(); let tasks, parseError;
    try { tasks = parseTasks(draft.csv); } catch (error) { parseError = error.message; }
    if (tasks) rowPage = Math.min(rowPage, Math.max(0, Math.ceil(tasks.length / 10) - 1));
    replace(editor,
      h('div', { class: 'l057-two' }, h('label', {}, '人工来源名，未知可空', field('估时来源名', draft.source.label, (d, value) => { d.source.label = value; return d; })), h('label', {}, '人工出处/位置，未知可空', field('估时来源位置', draft.source.location, (d, value) => { d.source.location = value; return d; }))),
      h('label', {}, '原始无引号CSV：id,task,type,estimateMinutes,actualMinutes；时长单位分钟', field('原始估时CSV', draft.csv, (d, value) => { d.csv = value; return d; }, 7)),
      h('p', {}, '原CSV及来源完整保留；无引号CSV，首尾空白修剪、支持CRLF/CR，不支持字段内逗号/引号/换行/BOM。表格编辑会规范化为LF CSV，需要保留先前原文先回测导出。'),
      h('div', { class: 'l057-actions' }, h('button', { class: 'btn primary', disabled: busy, onclick: run }, '回测估时偏差'), h('button', { class: 'btn', onclick: cancel }, '取消回测'), h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = { type: 'example' }; renderConfirm(); } }, '替换为两任务示例…')),
      tasks ? h('section', { class: 'l057-card' }, h('h3', {}, `任务记录 ${tasks.length}/500`), h('p', {}, '真实可编辑任务/类型/时长；空类型是未知，空时长不可回测，估时0排除且保留。没有计时器。每页10行仅影响显示。'),
        h('button', { class: 'btn', disabled: tasks.length >= 500, onclick: () => update(addTask, '已添加空任务；须填写明确时长，不猜0。') }, '添加任务'),
        pages('输入任务', rowPage, Math.ceil(tasks.length / 10), value => { rowPage = value; refresh(); }),
        h('div', { class: 'l057-scroll' }, h('table', { 'aria-label': '人工任务估时与实际时长编辑表' }, h('thead', {}, h('tr', {}, ['ID', '任务名', '类型（空为未知）', '事前估时/分钟', '实际用时/分钟', '操作'].map(s => h('th', {}, s)))),
          h('tbody', {}, tasks.slice(rowPage * 10, rowPage * 10 + 10).map(task => h('tr', {}, h('td', {}, task.id), ['label', 'type', 'estimate', 'actual'].map(key => h('td', {}, field(task.id + ({ label: '任务名', type: '类型', estimate: '估时', actual: '实际' }[key]), task[key], (d, value) => editTask(d, task.id, key, value)))), h('td', {}, h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = { type: 'delete', id: task.id }; renderConfirm(); } }, '删除任务' + task.id + '…'))))))),
        !tasks.length ? h('p', {}, '当前0条记录：可添加或粘贴CSV；回测后所有系数不可估。') : null) : h('p', { class: 'l057-review' }, `CSV结构未完成：${parseError}；不猜记录或时长。`));
  }
  function renderConfirm() {
    replace(confirmation, armed ? h('section', { class: 'l057-card' }, h('h3', {}, armed.type === 'example' ? '确认整体替换CSV与来源' : '确认删除任务' + armed.id), h('p', {}, '相应原始记录将移除，需保留先回测并导出完整副本。'), h('div', { class: 'l057-actions' }, h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = null; renderConfirm(); } }, '保留当前记录'), h('button', { class: 'btn', onclick: () => { if (!live()) return; const action = armed; update(d => action.type === 'example' ? exampleDraft() : removeTask(d, action.id), '已明确确认删除/替换，需要重新回测。'); rowPage = 0; armed = null; renderConfirm(); refresh(); } }, '确认记录删除或替换'))) : null);
  }
  async function run() {
    if (!live() || busy) return; const seq = ++ticket; busy = true; report = null; refresh(); renderOutput(); message('本地回测完整任务，可取消……'); const valid = () => live() && seq === ticket;
    try { const result = await analyze(draft, { canceled: () => !valid() }); if (!valid()) return; report = result; message(`完整任务${result.summary.total}，估时0排除${result.summary.excluded}；历史均值系数${number(result.summary.meanRatio)}，不保证未来准确。`); }
    catch (error) { if (valid()) message(`整份回测未完成：${error.message}`, true); }
    finally { busy = false; if (!destroyed) { refresh(); renderOutput(); } }
  }
  function cancel() { if (!live()) return; if (busy) { ticket++; report = null; renderOutput(); message('已取消，不展示部分或迟到系数。'); } else message('当前没有回测任务。'); }
  function renderOutput() {
    if (!report) { replace(output, h('p', {}, '尚无有效完整回测，输入或来源编辑后需主动重新执行。')); return; }
    const p = report, rows = filter === 'included' ? p.records.filter(r => r.included) : filter === 'excluded' ? p.records.filter(r => !r.included) : p.records;
    resultPage = Math.min(resultPage, Math.max(0, Math.ceil(rows.length / 10) - 1)); groupPage = Math.min(groupPage, Math.max(0, Math.ceil(p.groups.length / 10) - 1));
    const selector = h('select', { class: 'field', 'aria-label': '回测筛选', onchange: () => { if (!live()) return; filter = selector.value; resultPage = 0; renderOutput(); } }, h('option', { value: 'all' }, '全部记录'), h('option', { value: 'included' }, '仅纳入'), h('option', { value: 'excluded' }, '仅估时0排除')); selector.value = filter;
    replace(output, h('section', { class: 'l057-card l057-results' }, h('h3', {}, `历史均值校正系数 ${number(p.summary.meanRatio)}`),
      h('p', {}, `有效${p.summary.included}/${p.summary.total}任务；估时0排除${p.summary.excluded}（不进入偏差/系数）。总实际/总估计 ${number(p.summary.ratioOfTotals)}，与逐项比率均值独立。`),
      h('p', {}, `偏差实际−估计：低估${p.summary.underestimated}、相等${p.summary.exact}、高估${p.summary.overestimated}；均值${number(p.summary.meanSignedErrorMinutes)}分钟、平均绝对偏差${number(p.summary.meanAbsoluteErrorMinutes)}分钟；比率中位数${number(p.summary.medianRatio)}。`),
      h('p', {}, `人工来源 ${p.input.source.label || '未知'} / ${p.input.source.location || '未知'}；来源空项 ${p.sourceUnknown.join('/') || '无'}；原CSV SHA-256 ${p.sourceSha256}（只核字节，不认证事前估时或效果）。`),
      h('h4', {}, '偏差分布（固定实际/估计比率桶，仅纳入记录）'), h('div', { 'aria-label': '完整偏差分布' }, p.distribution.map(bin => h('div', { class: 'l057-bin', dataset: { bin: bin.id } }, h('span', {}, bin.label), h('div', { class: 'l057-bar-track' }, h('div', { class: 'l057-bar', style: { width: `${p.summary.included ? bin.count / p.summary.included * 100 : 0}%` } })), h('span', {}, `${bin.count}条`)))),
      h('h4', {}, '按类型的历史校正系数'), pages('类型组', groupPage, Math.ceil(p.groups.length / 10), value => { groupPage = value; renderOutput(); }),
      h('div', { class: 'l057-scroll' }, h('table', { 'aria-label': '按类型历史比率算术均值' }, h('thead', {}, h('tr', {}, ['类型', '有效/排除', '逐项比率均值系数', '总实际/总估计', '平均偏差/分钟'].map(s => h('th', {}, s)))), h('tbody', {}, p.groups.slice(groupPage * 10, groupPage * 10 + 10).map(group => h('tr', { dataset: { groupType: group.type } }, h('td', {}, group.typeUnknown ? '未知（空类型）' : group.type), h('td', {}, `${group.included}/${group.excluded}`), h('td', { dataset: { metric: 'meanRatio' } }, number(group.meanRatio)), h('td', {}, number(group.ratioOfTotals)), h('td', {}, number(group.meanSignedErrorMinutes))))))),
      h('p', {}, '表中小数最多6位；完整副本保留Number比率及整数千分分钟分子/分母，不用舍入值划分偏差桶。不保证历史系数用于下一次任务会更准确。'),
      h('label', {}, '显示筛选；完整副本不受影响', selector), pages('回测记录', resultPage, Math.ceil(rows.length / 10), value => { resultPage = value; renderOutput(); }),
      h('div', { class: 'l057-scroll' }, h('table', { 'aria-label': '全部任务偏差与排除原因' }, h('thead', {}, h('tr', {}, ['ID/任务/类型', '估计/实际分钟', '偏差/分钟', '实际/估计', '相对偏差', '统计状态'].map(s => h('th', {}, s)))), h('tbody', {}, rows.slice(resultPage * 10, resultPage * 10 + 10).map(r => h('tr', { dataset: { task: r.id, included: String(r.included) } }, h('td', {}, `${r.id} / ${r.label || '任务名未知'} / ${r.type || '类型未知（空）'}`), h('td', {}, `${r.estimate} / ${r.actual}`), h('td', {}, number(r.deltaMinutes)), h('td', { dataset: { metric: 'ratio' } }, number(r.ratio)), h('td', {}, r.relativeError === null ? '不可估' : number(r.relativeError * 100) + '%'), h('td', { class: r.included ? '' : 'l057-review' }, r.included ? '纳入；人工时长' : '估时0：整条排除，不估偏差/比率')))))), rows.length ? null : h('p', {}, '筛选无记录；完整副本保留全部记录。'),
      h('ul', {}, p.definitions.map(value => h('li', {}, value))), h('details', {}, h('summary', {}, '完整JSON预览（含全部原始任务和来源）'), h('pre', { class: 'l057-preview' }, reportJson(p))), h('details', {}, h('summary', {}, '完整Markdown预览'), h('pre', { class: 'l057-preview' }, reportMarkdown(p))),
      h('div', { class: 'l057-actions' }, h('button', { class: 'btn', onclick: () => save('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => save('md') }, '导出完整 Markdown'))));
  }
  async function save(extension) {
    if (!live() || !report || exporting) return; const files = window.toolbox?.files;
    if (files?.saveTextSupportsCopyOnly !== true) { message('桥接缺严格防覆盖能力，未保存。', true); return; }
    const seq = ticket, content = extension === 'json' ? reportJson(report) : reportMarkdown(report); exporting = true;
    try { const result = await files.saveText({ content, extension, defaultName: `L057-manual-time-backtest.${extension}`, copyOnly: true }); if (!live() || seq !== ticket) return; message(result?.ok === true ? '完整回测新副本已保存，来源文件未改写。' : result?.canceled === true ? '保存已取消。' : `导出失败：${result?.error || '未确认ok===true'}`, result?.ok !== true && result?.canceled !== true); }
    catch (error) { if (live() && seq === ticket) message(error.message, true); } finally { exporting = false; }
  }
  function leave() { if (destroyed) return; active = false; ticket++; persist(); }
  const visibility = () => { if (document.hidden) { visibilitySuspended = active; leave(); } else if (visibilitySuspended && !destroyed) { visibilitySuspended = false; active = true; refresh(); renderOutput(); message('仅恢复控件，不自动回测。'); } };
  document.addEventListener('visibilitychange', visibility);
  try { const raw = channel?.latest && (channel.running || channel.pending) ? channel.latest : ctx.config?.get?.(KEY); if (raw) { draft = validateDraft(raw, { forStorage: true }); message('已恢复schema1原始CSV/来源；派生系数需重新回测。'); } } catch (error) { message(`草稿未恢复：${error.message}；使用示例。`, true); }
  root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '时间估计回测'), h('p', {}, '人工事前估时、实际时长与类型的离线回测；没有计时器，不推断学习效果或未来准确性。'), notice, storage,
    h('details', {}, h('summary', {}, '公式、排除、未知与保存范围'), h('p', {}, '偏差=实际−估计；相对偏差=(实际−估计)/估计；每项actual/estimate算术均值是历史校正系数，各记录同权，与总实际/总估计分开展示。估时0整条排除偏差分布和系数，原记录完整保留，全排除为null不可估；实际0但估时正纳入为比率0。'), h('p', {}, '统一分钟0–100000、最多3位小数，时长/差值用整数千分分钟；最多500任务。类型空为未知组、空时长拒绝而不猜0，事前记录及来源真实性由用户核对。无引号CSV，缺列/重复ID/错误时长/超限整份拒绝。'), h('p', {}, '原CSV≤192KiB，输入≤256KiB；schema1草稿≤64KiB，超限不写配置，关闭只恢复较早合法输入；完整JSON/MD≤2MiB不截断。只存输入，不存派生系数；编辑/取消/隐藏/离开/销毁隔离迟到结果，不自动回测。副本含全部原始任务及来源，不是脱敏摘要，strictcopyOnly/ok不覆盖原文件。')), editor, confirmation, output);
  renderEditor(); renderConfirm(); renderOutput();
  return { activate() { if (destroyed) return; active = true; refresh(); renderOutput(); }, deactivate() { visibilitySuspended = false; leave(); }, destroy() { if (destroyed) return; ticket++; persist(); active = false; destroyed = true; document.removeEventListener('visibilitychange', visibility); controls.clear(); report = null; root.replaceChildren(); } };
} };
