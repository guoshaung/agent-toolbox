import { h } from '../../core/ui.js';
import { exampleDraft, validateDraft, parseMatrix, editCell, addAxis, removeAxis, analyze, reportJson, reportMarkdown } from './model.mjs';
const KEY = 'features.L056.draft', channels = new WeakMap();
function channelFor(config) { if (!config || typeof config.set !== 'function') return null; if (!channels.has(config)) channels.set(config, { owner: null, pending: null, latest: null, running: false, ticket: 0 }); return channels.get(config); }
async function drain(config, channel) {
  channel.running = true;
  try { while (channel.pending) { const job = channel.pending; channel.pending = null; try { await config.set(KEY, job.value); if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(); } catch (error) { if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(error); } } }
  finally { channel.running = false; }
}
const FLAGS = { 'all-correct': '全对', 'all-incorrect': '全错', 'zero-discrimination': '区分度恰0', 'negative-discrimination': '区分度负值' };
const number = value => value === null ? '不可估' : Number(value.toFixed(6)).toString();
export default { id: 'L056', create(root, ctx = {}) {
  root.classList.add('feature-l056');
  let draft = exampleDraft(), report = null, active = true, destroyed = false, busy = false, ticket = 0, exporting = false, armed = null, visibilitySuspended = false;
  let rowPage = 0, columnPage = 0, resultPage = 0, filter = 'all';
  const controls = new Map(), channel = channelFor(ctx.config), owner = {};
  if (channel) channel.owner = owner;
  const notice = h('div', { class: 'l056-notice', role: 'status', 'aria-live': 'polite' }), storage = h('div', { class: 'l056-storage' }), editor = h('div'), confirmation = h('div'), output = h('div');
  const live = () => active && !destroyed;
  const replace = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  function message(value, error = false) { if (live()) { notice.textContent = value; notice.classList.toggle('is-error', error); } }
  function persist() {
    if (!channel || channel.owner !== owner) return;
    const seq = ++channel.ticket; let value;
    try { value = validateDraft(draft, { forStorage: true }); } catch (error) { if (!destroyed) storage.textContent = `草稿未保存：${error.message}。`; return; }
    channel.latest = value;
    channel.pending = { value, owner, ticket: seq, done(error) { if (!destroyed) storage.textContent = error ? `草稿保存未确认：${error.message}` : 'schema1原CSV与人工来源≤64KiB已保存，不存派生指标；CSV语法可未完成，需重新统计。'; } };
    if (!channel.running) void drain(ctx.config, channel);
  }
  function changed() { ticket++; report = null; resultPage = 0; renderOutput(); persist(); }
  function update(fn, success) { if (!live()) return; try { draft = validateDraft(fn(draft)); changed(); refresh(); message(success); } catch (error) { message(`整项未完成：${error.message}`, true); refresh(); } }
  function field(label, value, change, rows = 0) {
    const node = h(rows ? 'textarea' : 'input', { class: 'field', type: rows ? undefined : 'text', rows: rows ? String(rows) : undefined, 'aria-label': label, oninput: () => update(d => change({ ...d, source: { ...d.source } }, node.value), '输入已修订，旧指标失效；主动重新统计。') });
    node.value = value; controls.set(label, node); return node;
  }
  function refresh() {
    const old = document.activeElement, label = old?.getAttribute?.('aria-label'), a = old?.selectionStart, b = old?.selectionEnd;
    renderEditor(); const next = controls.get(label); if (next) { next.focus?.(); if (Number.isInteger(a) && typeof next.setSelectionRange === 'function') next.setSelectionRange(Math.min(a, next.value.length), Math.min(b, next.value.length)); }
  }
  function pages(label, page, count, set) { return h('div', { class: 'l056-actions' }, h('button', { class: 'btn', disabled: page === 0, onclick: () => { if (!live()) return; set(page - 1); } }, `${label}上一页`), h('span', {}, `${label} ${page + 1}/${Math.max(1, count)}页`), h('button', { class: 'btn', disabled: page + 1 >= count, onclick: () => { if (!live()) return; set(page + 1); } }, `${label}下一页`)); }
  function renderEditor() {
    controls.clear(); let matrix, parseError;
    try { matrix = parseMatrix(draft.matrixText); } catch (error) { parseError = error.message; }
    if (matrix) { rowPage = Math.min(rowPage, Math.floor((matrix.people.length - 1) / 10)); columnPage = Math.min(columnPage, Math.floor((matrix.items.length - 1) / 10)); }
    replace(editor,
      h('div', { class: 'l056-two' }, h('label', {}, '人工来源名，未知可空', field('矩阵来源名', draft.source.label, (d, value) => { d.source.label = value; return d; })), h('label', {}, '人工出处/位置，未知可空', field('矩阵来源位置', draft.source.location, (d, value) => { d.source.location = value; return d; }))),
      h('label', {}, '原始无引号CSV：首格participant，题目名称表头，每人一行，作答仅0/1', field('原始作答CSV', draft.matrixText, (d, value) => { d.matrixText = value; return d; }, 9)),
      h('p', {}, '保留原CSV及人工来源；CRLF/CR可解析，字段首尾空白修剪。无引号CSV，不支持字段内逗号/引号/换行、缺答或BOM。表格点击会规范化为LF逗号CSV，改动前原报告需自行导出。'),
      h('div', { class: 'l056-actions' }, h('button', { class: 'btn primary', disabled: busy, onclick: run }, '统计题目指标'), h('button', { class: 'btn', onclick: cancel }, '取消统计'), h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = 'example'; renderConfirm(); } }, '替换为十人十题示例…')),
      matrix ? h('section', { class: 'l056-card' }, h('h3', {}, `可编辑矩阵 ${matrix.people.length}人×${matrix.items.length}题`), h('p', {}, '单元格点击0↔1；姓名/题名可在CSV编辑，必须各自唯一。每页10人×10题仅影响显示，统计/副本包含全部矩阵。'),
        h('div', { class: 'l056-actions' }, h('button', { class: 'btn', disabled: matrix.people.length >= 200, onclick: () => update(d => addAxis(d, 'person'), '新增人全题为0，须人工确认。') }, '添加作答者'), h('button', { class: 'btn', disabled: matrix.items.length >= 100, onclick: () => update(d => addAxis(d, 'item'), '新增题全人为0，须人工确认。') }, '添加题目'), h('button', { class: 'btn', disabled: matrix.people.length <= 1, onclick: () => { if (!live()) return; armed = 'person'; renderConfirm(); } }, '删除末位作答者…'), h('button', { class: 'btn', disabled: matrix.items.length <= 1, onclick: () => { if (!live()) return; armed = 'item'; renderConfirm(); } }, '删除末题…')),
        pages('作答者', rowPage, Math.ceil(matrix.people.length / 10), value => { rowPage = value; refresh(); }), pages('题目', columnPage, Math.ceil(matrix.items.length / 10), value => { columnPage = value; refresh(); }),
        h('div', { class: 'l056-scroll' }, h('table', { 'aria-label': '原始0/1可编辑矩阵' }, h('thead', {}, h('tr', {}, h('th', {}, '作答者'), matrix.items.slice(columnPage * 10, columnPage * 10 + 10).map(item => h('th', {}, item)))), h('tbody', {}, matrix.people.slice(rowPage * 10, rowPage * 10 + 10).map((person, ri) => h('tr', {}, h('th', {}, person.id), person.responses.slice(columnPage * 10, columnPage * 10 + 10).map((value, ci) => h('td', {}, h('button', { class: 'l056-cell', 'aria-label': `作答${person.id}/${matrix.items[columnPage * 10 + ci]}`, onclick: () => update(d => editCell(d, rowPage * 10 + ri, columnPage * 10 + ci), '单元格已切换，旧指标失效。') }, String(value)))))))))) : h('p', { class: 'l056-review' }, `CSV尚不可解析：${parseError}；不估计、不猜缺答。`));
  }
  function renderConfirm() {
    replace(confirmation, armed ? h('section', { class: 'l056-card' }, h('h3', {}, armed === 'example' ? '确认整体替换CSV和来源' : armed === 'person' ? '确认删除末位作答者' : '确认删除末题'), h('p', {}, '将移除当前相应原始数据；需要保留先统计并导出完整副本。'), h('div', { class: 'l056-actions' }, h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = null; renderConfirm(); } }, '保留当前矩阵'), h('button', { class: 'btn', onclick: () => { if (!live()) return; const action = armed; update(d => action === 'example' ? exampleDraft() : removeAxis(d, action), '已明确确认替换/删除；需重新统计。'); rowPage = columnPage = 0; armed = null; renderConfirm(); refresh(); } }, '确认矩阵替换或删除'))) : null);
  }
  async function run() {
    if (!live() || busy) return; const seq = ++ticket; busy = true; report = null; refresh(); renderOutput(); message('本地统计完整矩阵，可取消……'); const valid = () => live() && seq === ticket;
    try { const result = await analyze(draft, { canceled: () => !valid() }); if (!valid()) return; report = result; message(result.sample.estimable ? `完整${result.sample.people}人×${result.sample.items}题，仅题目指标，异常不推荐删题。` : '样本不足，题目指标不可估；原始计数已保留，不给考试结论。'); }
    catch (error) { if (valid()) message(`整份统计未完成：${error.message}`, true); }
    finally { busy = false; if (!destroyed) { refresh(); renderOutput(); } }
  }
  function cancel() { if (!live()) return; if (busy) { ticket++; report = null; renderOutput(); message('已取消，不展示部分或迟到指标。'); } else message('当前没有统计任务。'); }
  function renderOutput() {
    if (!report) { replace(output, h('p', {}, '尚无有效完整统计，编辑后需主动重新执行。')); return; }
    const p = report, rows = filter === 'anomalies' ? p.items.filter(item => item.flags.length) : p.items;
    resultPage = Math.min(resultPage, Math.max(0, Math.ceil(rows.length / 10) - 1));
    const selector = h('select', { class: 'field', 'aria-label': '结果筛选', onchange: () => { if (!live()) return; filter = selector.value; resultPage = 0; renderOutput(); } }, h('option', { value: 'all' }, '全部题目'), h('option', { value: 'anomalies' }, '仅字面异常')); selector.value = filter;
    replace(output, h('section', { class: 'l056-card l056-results' }, h('h3', {}, `${p.sample.people}人×${p.sample.items}题 · ${p.sample.estimable ? '题目指标' : '不可估'}`), h('p', {}, p.sample.estimable ? `上下组各${p.grouping.groupSize}人；p=答对比例，D=上组正确率−下组正确率；异常题${p.anomalies.length}，不推荐考试结论。` : p.sample.reason),
      h('p', {}, `人工来源 ${p.input.source.label || '未知'} / ${p.input.source.location || '未知'}；来源空项 ${p.sourceUnknown.join('/') || '无'}；原CSV SHA-256 ${p.sourceSha256}（只核字节，不证真实性）。`),
      p.grouping.boundaryTies && (p.grouping.boundaryTies.upper || p.grouping.boundaryTies.lower) ? h('p', { class: 'l056-review' }, '上下组边界存在同分；按输入行序任意打破，D可能依赖顺序，请人工复核。') : null,
      h('div', { class: 'l056-two' }, h('div', {}, h('h4', {}, '上组（总分）'), h('p', {}, p.grouping.upper.map(person => `${person.id}(${person.total})`).join('、') || '不可估，不划组')), h('div', {}, h('h4', {}, '下组（总分）'), h('p', {}, p.grouping.lower.map(person => `${person.id}(${person.total})`).join('、') || '不可估，不划组'))),
      h('p', {}, '表中小数最多6位；完整副本保留Number值及计数分子/分母，不能据舍入值判异常。'), h('label', {}, '显示筛选；完整副本不受影响', selector), pages('结果', resultPage, Math.ceil(rows.length / 10), value => { resultPage = value; renderOutput(); }),
      h('div', { class: 'l056-scroll' }, h('table', { 'aria-label': '题目正确率与上下组区分度' }, h('thead', {}, h('tr', {}, ['题目', '答对/总人数', '难度指标p（越高越易）', '上/下组答对', '区分度D', '字面异常'].map(value => h('th', {}, value)))), h('tbody', {}, rows.slice(resultPage * 10, resultPage * 10 + 10).map(item => h('tr', { dataset: { item: item.id } }, h('td', {}, item.id), h('td', {}, `${item.correct}/${p.sample.people}`), h('td', { dataset: { metric: 'difficulty' } }, number(item.difficulty)), h('td', {}, item.estimable ? `${item.upperCorrect}/${item.lowerCorrect}（各${p.grouping.groupSize}）` : '不可估'), h('td', { dataset: { metric: 'discrimination' } }, number(item.discrimination)), h('td', {}, item.estimable ? item.flags.map(flag => FLAGS[flag]).join('、') || '无上述规则标记' : '不可估，不标异常')))))),
      rows.length ? null : h('p', {}, '筛选无题目；完整原始矩阵与全部题目仍包含于副本。'),
      h('details', {}, h('summary', {}, '完整总分排名与中间组'), h('pre', { class: 'l056-preview' }, JSON.stringify(p.grouping, null, 2))), h('ul', {}, p.definitions.map(value => h('li', {}, value))),
      h('details', {}, h('summary', {}, '完整JSON预览（包含所有人作答与人工来源）'), h('pre', { class: 'l056-preview' }, reportJson(p))), h('details', {}, h('summary', {}, '完整Markdown预览'), h('pre', { class: 'l056-preview' }, reportMarkdown(p))),
      h('div', { class: 'l056-actions' }, h('button', { class: 'btn', onclick: () => save('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => save('md') }, '导出完整 Markdown'))));
  }
  async function save(extension) {
    if (!live() || !report || exporting) return; const files = window.toolbox?.files;
    if (files?.saveTextSupportsCopyOnly !== true) { message('桥接缺严格防覆盖能力，未保存。', true); return; }
    const seq = ticket, content = extension === 'json' ? reportJson(report) : reportMarkdown(report); exporting = true;
    try { const result = await files.saveText({ content, extension, defaultName: `L056-offline-item-statistics.${extension}`, copyOnly: true }); if (!live() || seq !== ticket) return; message(result?.ok === true ? '完整统计新副本已保存，原始来源文件未改写。' : result?.canceled === true ? '保存已取消。' : `导出失败：${result?.error || '未确认ok===true'}`, result?.ok !== true && result?.canceled !== true); }
    catch (error) { if (live() && seq === ticket) message(error.message, true); } finally { exporting = false; }
  }
  function leave() { if (destroyed) return; active = false; ticket++; persist(); }
  const visibility = () => { if (document.hidden) { visibilitySuspended = active; leave(); } else if (visibilitySuspended && !destroyed) { visibilitySuspended = false; active = true; refresh(); renderOutput(); message('仅恢复控件，不自动统计。'); } };
  document.addEventListener('visibilitychange', visibility);
  try { const raw = channel?.latest && (channel.running || channel.pending) ? channel.latest : ctx.config?.get?.(KEY); if (raw) { draft = validateDraft(raw, { forStorage: true }); message('已恢复schema1原始输入；派生指标需重新统计。'); } } catch (error) { message(`草稿未恢复：${error.message}；使用示例。`, true); }
  root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '试卷测量质量检查'), h('p', {}, '离线0/1矩阵：只统计题目正确率与上下组区分度，不推荐考试结论，不评价个人能力或学习效果。'), notice, storage,
    h('details', {}, h('summary', {}, '公式、同分、容量及保存范围'), h('p', {}, '至少10人且10题才估；1–200人×1–100题可编辑，较小样本只保留原始计数。p=正确数/N，D=(上组正确数−下组正确数)/floor(N×27%)，每组人数相同。按含该题整卷总分降序，同分按输入行序，边界同分需人工复核，不排除题目或自动选择别的分组。'), h('p', {}, '全对/全错/零D/负D仅规则标记，不代表信度、效度或建议删除。所有原始数据与人工来源完整预览/导出，可能含作答者记录，不是脱敏报告。'), h('p', {}, '仅无引号CSV，缺答/重复名字/超限整份拒绝。CSV≤192KiB，完整输入≤256KiB；schema1草稿≤64KiB，超过不写配置，关闭只恢复较早合法输入；报告≤2MiB，不截断。编辑、取消、隐藏、离开或销毁隔离迟到结果，重载不恢复派生指标。严格copyOnly/ok副本，不改来源。')), editor, confirmation, output);
  renderEditor(); renderConfirm(); renderOutput();
  return { activate() { if (destroyed) return; active = true; refresh(); renderOutput(); }, deactivate() { visibilitySuspended = false; leave(); }, destroy() { if (destroyed) return; ticket++; persist(); active = false; destroyed = true; document.removeEventListener('visibilitychange', visibility); controls.clear(); report = null; root.replaceChildren(); } };
} };
