import { h } from '../../core/ui.js';
import { exampleDraft, validateDraft, KINDS, LABELS, safeName, nameKey, makeAsset, validateAssets, changeRule, addRule, removeRule, analyze, bundlePayload, reportJson, reportMarkdown } from './model.mjs';
const KEY = 'features.L058.draft', channels = new WeakMap();
function channelFor(config) { if (!config || typeof config.set !== 'function') return null; if (!channels.has(config)) channels.set(config, { owner: null, pending: null, latest: null, running: false, ticket: 0 }); return channels.get(config); }
async function drain(config, channel) {
  channel.running = true;
  try { while (channel.pending) { const job = channel.pending; channel.pending = null; try { await config.set(KEY, job.value); if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(); } catch (error) { if (!channel.pending && channel.owner === job.owner && channel.ticket === job.ticket) job.done(error); } } }
  finally { channel.running = false; }
}
const STATUS = { pass:'通过', fail:'失败', error:'解析错误', unknown:'未知/待补' };
export default { id: 'L058', create(root, ctx = {}) {
  root.classList.add('feature-l058');
  let draft = exampleDraft(), report = null, active = true, destroyed = false, busy = false, ticket = 0, exporting = false, armed = null, visibilitySuspended = false;
  let resultPage = 0, filter = 'all', assets = [], loading = false, loadTicket = 0;
  const controls = new Map(), channel = channelFor(ctx.config), owner = {};
  if (channel) channel.owner = owner;
  const notice = h('div', { class: 'l058-notice', role: 'status', 'aria-live': 'polite' }), storage = h('div', { class: 'l058-storage' }), editor = h('div'), confirmation = h('div'), output = h('div'), fileHost = h('div');
  const live = () => active && !destroyed;
  const replace = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  function message(value, error = false) { if (live()) { notice.textContent = value; notice.classList.toggle('is-error', error); } }
  function persist() {
    if (!channel || channel.owner !== owner) return;
    const seq = ++channel.ticket; let value;
    try { value = validateDraft(draft, { forStorage: true }); } catch (error) { if (!destroyed) storage.textContent = `草稿未保存：${error.message}。`; return; }
    channel.latest = value;
    channel.pending = { value, owner, ticket: seq, done(error) { if (!destroyed) storage.textContent = error ? `草稿保存未确认：${error.message}` : 'schema1任务/来源/量规≤64KiB已保存，不存文件字节/派生报告；重载需重选产物和附件。'; } };
    if (!channel.running) void drain(ctx.config, channel);
  }
  function changed() { ticket++; report = null; resultPage = 0; renderOutput(); persist(); }
  function update(fn, success) { if (!live()) return; try { draft = validateDraft(fn(draft)); changed(); refresh(); message(success); } catch (error) { message(`整项未完成：${error.message}`, true); refresh(); } }
  function field(label, value, change, rows = 0) {
    const node = h(rows ? 'textarea' : 'input', { class: 'field', type: rows ? undefined : 'text', rows: rows ? String(rows) : undefined, 'aria-label': label, oninput: () => update(d => change({ ...d, source: { ...d.source } }, node.value), '输入已修订，旧验收报告失效；需要重新执行。') });
    node.value = value; controls.set(label, node); return node;
  }
  function refresh() {
    const old = document.activeElement, label = old?.getAttribute?.('aria-label'), a = old?.selectionStart, b = old?.selectionEnd;
    renderEditor(); const next = controls.get(label); if (next) { next.focus?.(); if (Number.isInteger(a) && typeof next.setSelectionRange === 'function') next.setSelectionRange(Math.min(a, next.value.length), Math.min(b, next.value.length)); }
  }
  function pages(label, page, count, set) { return h('div', { class: 'l058-actions' }, h('button', { class: 'btn', disabled: page === 0, onclick: () => { if (!live()) return; set(page - 1); } }, `${label}上一页`), h('span', {}, `${label} ${page + 1}/${Math.max(1, count)}页`), h('button', { class: 'btn', disabled: page + 1 >= count, onclick: () => { if (!live()) return; set(page + 1); } }, `${label}下一页`)); }
  function renderEditor() {
    controls.clear();
    replace(editor, h('label', {}, '真实作业任务，人工填写', field('真实任务描述', draft.task, (d, value) => { d.task = value; return d; }, 3)),
      h('div', { class: 'l058-two' }, h('label', {}, '人工量规来源，未知可空', field('量规来源名', draft.source.label, (d, value) => { d.source.label = value; return d; })), h('label', {}, '人工出处/位置，未知可空', field('量规来源位置', draft.source.location, (d, value) => { d.source.location = value; return d; }))),
      h('p', {}, `本地量规版本 ${draft.rubricVersion}；规则编辑/增删递增，报告保存版本及摘要，不是不可篡改认证。`),
      h('div', { class: 'l058-actions' }, h('button', { class: 'btn primary', disabled: busy || loading, onclick: run }, '执行四类验收'), h('button', { class: 'btn', onclick: cancel }, '取消读取或验收'), h('button', { class: 'btn', disabled: loading, onclick: teaching }, '载入教学产物（缺result）'), h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = { type: 'example' }; renderConfirm(); } }, '替换为四类示例量规…'), h('button', { class: 'btn', disabled: draft.rules.length >= 40, onclick: () => update(addRule, '已添加文件存在量规，填写明确目标后再执行。') }, '添加量规')),
      draft.rules.map(rule => {
        const kind = h('select', { class: 'field', 'aria-label': rule.id + '类别', onchange: () => update(d => changeRule(d, rule.id, 'kind', kind.value), '量规类别修订，旧报告失效。') }, KINDS.map(k => h('option', { value: k }, LABELS[k]))); kind.value = rule.kind;
        const edit = (label, key, rows = 0) => h('label', {}, label, field(rule.id + label, rule[key], (d, value) => changeRule(d, rule.id, key, value), rows));
        return h('section', { class: 'l058-card', dataset: { rule: rule.id } }, h('h3', {}, `${rule.id} · ${LABELS[rule.kind]}`), h('label', {}, '有限类别', kind), edit('规则说明', 'label', 2),
          rule.kind !== 'manual' ? edit('目标产物文件名', 'target') : null,
          rule.kind === 'json-field' ? edit('顶层字段名', 'field') : null,
          rule.kind === 'count' ? h('div', { class: 'l058-two' }, edit('最小字数', 'min'), edit('最大字数', 'max')) : null,
          rule.kind === 'manual' ? h('div', {}, edit('人工证据说明', 'note', 3), h('label', {}, '指定附件名，每行一个，最多8；只验提交不核真', field(rule.id + '附件名', rule.evidence.join('\n'), (d, value) => changeRule(d, rule.id, 'evidence', value.split(/\r\n|\r|\n/).map(s => s.trim()).filter(Boolean)), 3))) : null,
          h('button', { class: 'btn', disabled: draft.rules.length <= 1, onclick: () => { if (!live()) return; armed = { type: 'delete', id: rule.id }; renderConfirm(); } }, '删除量规' + rule.id + '…'));
      }));
  }
  function renderFiles() {
    replace(fileHost, h('h3', {}, '本次用户选定文件集合（不扫描目录）'), ['product', 'attachment'].map(role => {
      const label = role === 'product' ? '产物' : '证据附件', current = assets.filter(a => a.role === role);
      const input = h('input', { class: 'field', type: 'file', multiple: true, disabled: loading || busy, 'aria-label': '选择' + label + '文件', onchange: () => loadFiles(role, [...(input.files || [])]) });
      return h('section', { class: 'l058-card' }, h('h4', {}, `${label} ${current.length}/8 · 单文件${role === 'product' ? '256' : '128'}KiB`), input,
        h('p', {}, '选择会替换该角色本次集合，原文件只读取；多文件中有一份超限/重名则整批拒绝，保留先前文件集合。'),
        current.length ? h('ul', {}, current.map(a => h('li', {}, `${a.name} · ${a.byteLength}字节 · ${a.origin === 'teaching' ? '自编教学字节' : '选定文件原字节'} · SHA256 ${a.sha256}`))) : h('p', {}, '尚未选择该类文件；重载不会恢复文件字节。'),
        h('button', { class: 'btn', disabled: loading || !current.length, onclick: () => { if (!live()) return; assets = assets.filter(a => a.role !== role); changed(); renderFiles(); message('已清除本次' + label + '选择，没有删除来源文件。'); } }, '清除本次' + label + '选择'));
    }));
  }
  async function loadFiles(role, files) {
    if (!live() || loading || busy || !files.length) return;
    const seq = ++loadTicket, inputTicket = ++ticket; report = null; loading = true; refresh(); renderFiles(); renderOutput(); message('读取本次选定原字节并计算摘要，可取消……'); const valid = () => live() && seq === loadTicket && ticket === inputTicket;
    try {
      if (files.length > 8) throw Error('每角色最多8文件'); const names = new Set();
      for (const file of files) { safeName(file.name); if (!Number.isInteger(file.size) || file.size < 0 || file.size > (role === 'product' ? 262144 : 131072)) throw Error('文件字节大小超限'); if (names.has(nameKey(file.name))) throw Error('本批文件NFC/大小写重名'); names.add(nameKey(file.name)); }
      const candidate = [];
      for (const file of files) { const data = await file.arrayBuffer(); if (!valid()) return; if (data.byteLength !== file.size) throw Error('读取长度与文件大小不符'); const asset = await makeAsset(file.name, role, data); if (!valid()) return; candidate.push(asset); }
      const combined = validateAssets(assets.filter(a => a.role !== role).concat(candidate)); if (!valid()) return; assets = combined; changed(); message('原文件只读载入，没有验收/执行/改写；需主动执行量规。');
    } catch (error) { if (valid()) message(`本批整份未载入：${error.message}；保留先前已载入集合，见完整文件名。`, true); }
    finally { loading = false; if (!destroyed) { refresh(); renderFiles(); } }
  }
  async function teaching() {
    if (!live() || loading || busy) return; const seq = ++loadTicket, inputTicket = ++ticket; report = null; loading = true; refresh(); renderFiles(); renderOutput(); const valid = () => live() && seq === loadTicket && ticket === inputTicket;
    try { const sample = [['report.md', 'product', '# 综合作业\n学习笔记与数据解释。'], ['data.json', 'product', '{"value":1}'], ['proof.txt', 'attachment', '用户声明已核对产物出处；不是能力证明。']], loaded = [];
      for (const [name, role, text] of sample) { loaded.push(await makeAsset(name, role, new TextEncoder().encode(text), { origin: 'teaching' })); if (!valid()) return; }
      assets = validateAssets(loaded); changed(); message('已载入自编教学字节，data.json故意缺result；没有读取用户来源文件。');
    } catch (error) { if (valid()) message(error.message, true); }
    finally { loading = false; if (!destroyed) { refresh(); renderFiles(); } }
  }
  function renderConfirm() {
    replace(confirmation, armed ? h('section', { class: 'l058-card' }, h('h3', {}, armed.type === 'example' ? '确认整体替换任务与量规' : '确认删除量规' + armed.id), h('p', {}, '需保留当前量规先验收并导出报告；本次文件选择不改写。'), h('div', { class: 'l058-actions' }, h('button', { class: 'btn', onclick: () => { if (!live()) return; armed = null; renderConfirm(); } }, '保留当前量规'), h('button', { class: 'btn', onclick: () => { if (!live()) return; const action = armed; update(d => action.type === 'example' ? exampleDraft() : removeRule(d, action.id), '已明确确认量规替换/删除，旧报告失效。'); armed = null; renderConfirm(); refresh(); } }, '确认量规删除或替换'))) : null);
  }
  async function run() {
    if (!live() || busy || loading) return; const seq = ++ticket; busy = true; report = null; refresh(); renderFiles(); renderOutput(); message('本地独立核对所有量规，可取消……'); const valid = () => live() && seq === ticket;
    try { const result = await analyze(draft, assets, { canceled: () => !valid() }); if (!valid()) return; report = result; message(`通过${result.summary.pass}、失败${result.summary.fail}、错误${result.summary.error}、未知${result.summary.unknown}；只验有限条件，不认定能力。`); }
    catch (error) { if (valid()) message(`整份验收未完成：${error.message}`, true); }
    finally { busy = false; if (!destroyed) { refresh(); renderFiles(); renderOutput(); } }
  }
  function cancel() { if (!live()) return; if (busy || loading || exporting) { ticket++; loadTicket++; report = null; renderOutput(); message('已取消；待完成读取/摘要丢弃，不展示部分或迟到结果；已开始的写盘不能撤回。'); } else message('当前没有验收任务。'); }
  function renderOutput() {
    if (!report) { replace(output, h('p', {}, '尚无有效完整验收报告；来源/量规/文件改变后须主动重验。')); return; }
    const p = report, rows = filter === 'all' ? p.results : p.results.filter(r => r.status === filter); resultPage = Math.min(resultPage, Math.max(0, Math.ceil(rows.length / 10) - 1));
    const selector = h('select', { class: 'field', 'aria-label': '验收结果筛选', onchange: () => { if (!live()) return; filter = selector.value; resultPage = 0; renderOutput(); } }, ['all', 'pass', 'fail', 'error', 'unknown'].map(value => h('option', { value }, value === 'all' ? '全部条目' : STATUS[value]))); selector.value = filter;
    replace(output, h('section', { class: 'l058-card l058-results' }, h('h3', {}, `验收：通过${p.summary.pass} / 失败${p.summary.fail} / 错误${p.summary.error} / 未知${p.summary.unknown}`),
      h('p', {}, `量规版本${p.input.rubricVersion} · SHA256 ${p.rubricHash}；失败ID ${p.failedRuleIds.join('、') || '无'}。只报告四类条件，不自动认定能力。`), h('p', {}, `人工来源 ${p.input.source.label || '未知'} / ${p.input.source.location || '未知'}；空项 ${p.sourceUnknown.join('/') || '无'}。`),
      h('h4', {}, '完整验收包文件清单'), h('ul', {}, p.files.map(a => h('li', {}, `${a.packagePath} · ${a.byteLength}字节 · SHA256 ${a.sha256} · ${a.origin === 'teaching' ? '自编教学' : '选定原字节'}`)), h('li', {}, 'report.json / report.md：完整量规、原文件摘要与逐条结果；原字节另在整包的products/attachments中。')),
      h('label', {}, '显示筛选，完整报告与整包不受影响', selector), pages('验收结果', resultPage, Math.ceil(rows.length / 10), value => { resultPage = value; renderOutput(); }),
      h('div', { class: 'l058-scroll' }, h('table', { 'aria-label': '逐条四类验收结果' }, h('thead', {}, h('tr', {}, ['ID/规则', '状态', '原因', '原文件/细节'].map(s => h('th', {}, s)))), h('tbody', {}, rows.slice(resultPage * 10, resultPage * 10 + 10).map(r => h('tr', { dataset: { resultRule: r.id, resultStatus: r.status } }, h('td', {}, `${r.id} · ${LABELS[r.kind]} · ${r.label || '说明未知'}`), h('td', { class: r.status === 'pass' ? '' : 'l058-review' }, STATUS[r.status]), h('td', {}, r.reason), h('td', {}, r.artifact ? `${r.artifact.name} / SHA256 ${r.artifact.sha256}` : '', r.details ? h('pre', { class: 'l058-small' }, JSON.stringify(r.details, null, 2)) : null)))))), rows.length ? null : h('p', {}, '筛选无条目；副本完整保留所有量规结果。'),
      h('ul', {}, p.definitions.map(value => h('li', {}, value))), h('details', {}, h('summary', {}, '完整JSON报告预览（不含原文件字节，整包另导出）'), h('pre', { class: 'l058-preview' }, reportJson(p))), h('details', {}, h('summary', {}, '完整Markdown报告预览'), h('pre', { class: 'l058-preview' }, reportMarkdown(p))),
      h('div', { class: 'l058-actions' }, h('button', { class: 'btn', onclick: () => save('json') }, '导出报告 JSON'), h('button', { class: 'btn', onclick: () => save('md') }, '导出报告 Markdown'), h('button', { class: 'btn primary', onclick: saveBundle }, '导出完整验收包（新目录）'))));
  }
  async function save(extension) {
    if (!live() || !report || exporting) return; const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true) { message('桥接缺严格防覆盖报告能力，未保存。', true); return; }
    const seq = ticket, content = extension === 'json' ? reportJson(report) : reportMarkdown(report); exporting = true;
    try { const result = await files.saveText({ content, extension, defaultName: `L058-acceptance-report.${extension}`, copyOnly: true }); if (!live() || seq !== ticket) return; message(result?.ok === true ? '完整报告新副本已保存；原字节需另导出完整验收包。' : result?.canceled === true ? '报告保存已取消。' : `报告导出失败：${result?.error || '未确认ok===true'}`, result?.ok !== true && result?.canceled !== true); }
    catch (error) { if (live() && seq === ticket) message(error.message, true); } finally { exporting = false; }
  }
  async function saveBundle() {
    if (!live() || !report || exporting) return; const files = window.toolbox?.files; if (files?.exportBundleSupportsCopyOnly !== true) { message('桥接缺整包防覆盖新目录能力，未保存。', true); return; }
    const seq = ticket, snapshot = report, originalAssets = assets; exporting = true; const valid = () => live() && seq === ticket;
    try { const payload = await bundlePayload(snapshot, originalAssets, { canceled: () => !valid() }); if (!valid()) return; const result = await files.exportBundle(payload); if (!valid()) return; message(result?.ok === true ? '完整验收包新目录已保存，含报告与全部原始产物/附件，不覆盖来源。' : result?.canceled === true ? '整包保存已取消。' : `整包导出失败：${result?.error || '未确认ok===true'}`, result?.ok !== true && result?.canceled !== true); }
    catch (error) { if (valid()) message(error.message, true); } finally { exporting = false; }
  }
  function leave() { if (destroyed) return; active = false; ticket++; loadTicket++; persist(); }
  const visibility = () => { if (document.hidden) { visibilitySuspended = active; leave(); } else if (visibilitySuspended && !destroyed) { visibilitySuspended = false; active = true; refresh(); renderFiles(); renderOutput(); message('仅恢复控件，不自动读取/验收。'); } };
  document.addEventListener('visibilitychange', visibility);
  try { const raw = channel?.latest && (channel.running || channel.pending) ? channel.latest : ctx.config?.get?.(KEY); if (raw) { draft = validateDraft(raw, { forStorage: true }); message('已恢复schema1任务/量规；原文件字节不保存，需重新选产物和附件。'); } } catch (error) { message(`草稿未恢复：${error.message}；使用示例。`, true); }
  root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '综合作业验收包'), h('p', {}, '单次作业的四类有限条件；人工来源与证据保留，不执行脚本、不自动认定能力。'), notice, storage,
    h('details', {}, h('summary', {}, '有限规则、文件预算与恢复范围'), h('p', {}, '文件存在只指选定集合；名称NFC/大小写匹配。JSON只查顶层自有字段存在，null/false/0算存在；重复JSON键按JSON.parse后项覆盖，不检查值。JSON顶层对象、深度≤32/节点≤20000，UTF8/解析失败只该条error，其它pass保留。'), h('p', {}, '字数=Unicode码点去ECMAScript空白，标点/emoji计1，非分词或质量评分；人工证据只验非空说明与指定附件提交，未补为unknown，不认证内容。'), h('p', {}, '≤40量规，本地版本1–1000000；原输入≤256KiB，schema1草稿≤64KiB，不含文件字节；超限不写配置，关闭只恢复较早合法输入。每角色≤8文件，产物单份≤256KiB/附件≤128KiB/总≤3MiB；完整报告各≤2MiB，超限拒绝，不截断。完整包为新目录，含原字节产物/附件和报告，禁止覆盖。'), h('p', {}, '读取可取消，编辑/隐藏/离开/销毁隔离迟到结果，销毁释放原字节。重载必须重选文件，不自动恢复或验收。原文件只读；没有目录扫描、网络、AI或任意脚本。')), editor, fileHost, confirmation, output);
  renderEditor(); renderFiles(); renderConfirm(); renderOutput();
  return { activate() { if (destroyed) return; active = true; refresh(); renderFiles(); renderOutput(); }, deactivate() { visibilitySuspended = false; leave(); }, destroy() { if (destroyed) return; ticket++; loadTicket++; persist(); active = false; destroyed = true; document.removeEventListener('visibilitychange', visibility); controls.clear(); assets = []; report = null; root.replaceChildren(); } };
} };
