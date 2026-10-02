import { h } from '../../core/ui.js';
import { MODEL_VERSION, initialState, rule, revise, submit, reveal, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';
const KEY = 'features.L027.state';
const clone = value => JSON.parse(JSON.stringify(value));
export default {
  id: 'L027',
  create(root, ctx = {}) {
    root.classList.add('feature-l027');
    let session = initialState(), selected = null, timer = null, destroyed = false, exporting = false, restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { session = validateStoredState(raw); restored = '已恢复≤64KiB完整会话：规则修订、锁定轮次和已揭示结果均保留。'; } } catch (error) { restored = `旧会话未恢复：${error.message}`; }
    const notice = h('div', { class: 'l027-notice', role: 'status', 'aria-live': 'polite' }, restored);
    const storage = h('div', { class: 'l027-notice', role: 'status' });
    const editor = h('div'), output = h('div'), history = h('div');
    function replace(node, ...items) { node.replaceChildren(...items.flat(Infinity).filter(item => item !== null && item !== undefined && item !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null;
      if (!ctx.config?.set) return;
      let state; try { state = prepareStoredState(session); } catch (error) { if (!destroyed) storage.textContent = `${error.message} 当前会话未写入全局配置，请导出完整JSON；关闭只能恢复较早状态。`; return; }
      if (!destroyed) storage.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch(error => message(`保存失败：${error.message}，请导出完整会话。`, true)); } catch (error) { message(`保存失败：${error.message}，请导出完整会话。`, true); }
    }
    function updateDraft(change) {
      const next = clone(session); change(next.draft);
      try { prepareStoredState(next); session = next; selected = null; renderOutput(); renderHistory(); message('草稿已改变，当前观察已清空；历史快照保留。未揭示轮次仍可从历史揭示。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); return true; }
      catch (error) { message(`${error.message} 编辑未应用；请导出后开始新会话。`, true); return false; }
    }
    function transition(operation, text) {
      try { session = prepareStoredState(operation(session)); selected = session.rounds.at(-1)?.id ?? null; renderEditor(); renderOutput(); renderHistory(); persist(); message(text); }
      catch (error) { message(error.message, true); }
    }
    function field(index, key, label, type = 'text', disabled = false) {
      const input = h('input', { class: 'field', type, maxlength: '32', disabled, 'aria-label': `规则${index + 1}${label}`, [type === 'checkbox' ? 'onchange' : 'oninput']: () => {
        const accepted = updateDraft(draft => { draft.rules[index][key] = type === 'checkbox' ? input.checked : input.value; });
        if (!accepted) { input.value = session.draft.rules[index][key]; input.checked = session.draft.rules[index][key] === true; }
      } });
      if (type === 'checkbox') input.checked = session.draft.rules[index][key]; else input.value = session.draft.rules[index][key];
      return input;
    }
    function renderEditor() {
      const rows = session.draft.rules.map((row, index) => {
        const type = h('select', { class: 'field', 'aria-label': `规则${index + 1}类型`, onchange: () => { updateDraft(draft => { draft.rules[index].type = type.value; }); renderEditor(); } }, ['number', 'string', 'array', 'boolean'].map(value => h('option', { value }, value))); type.value = row.type;
        return h('tr', {}, h('td', {}, field(index, 'field', '字段')), h('td', {}, type), h('td', {}, field(index, 'required', '必填', 'checkbox')), h('td', {}, field(index, 'min', '最小值', 'text', row.type !== 'number')), h('td', {}, field(index, 'max', '最大值', 'text', row.type !== 'number')), h('td', {}, field(index, 'minLength', '最短长度', 'text', !['string', 'array'].includes(row.type))), h('td', {}, field(index, 'maxLength', '最长长度', 'text', !['string', 'array'].includes(row.type))), h('td', {}, h('button', { class: 'btn', disabled: session.draft.rules.length === 1, onclick: () => { if (updateDraft(draft => draft.rules.splice(index, 1))) renderEditor(); } }, `删除规则${index + 1}`)));
      });
      const sample = h('textarea', { class: 'field l027-sample', rows: '5', maxlength: '4096', spellcheck: 'false', 'aria-label': 'JSON样例', oninput: () => { if (!updateDraft(draft => { draft.sample = sample.value; })) sample.value = session.draft.sample; } }); sample.value = session.draft.sample;
      const prediction = h('select', { class: 'field', 'aria-label': '本轮预测', onchange: () => { if (!updateDraft(draft => { draft.prediction = prediction.value; })) prediction.value = session.draft.prediction; } }, h('option', { value: 'pass' }, '预测通过'), h('option', { value: 'fail' }, '预测失败')); prediction.value = session.draft.prediction;
      replace(editor, h('h3', {}, `编辑契约 · 当前应用修订${session.revisions.at(-1).id}`), h('div', { class: 'l027-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['顶层字段', '类型', '必填', '最小值', '最大值', '最短长度', '最长长度', '操作'].map(text => h('th', { scope: 'col' }, text)))), h('tbody', {}, rows))),
        h('div', { class: 'l027-actions' }, h('button', { class: 'btn', disabled: session.draft.rules.length >= 8, onclick: () => { if (updateDraft(draft => { draft.rules.push(rule(`field${draft.rules.length + 1}`, 'string', false, '', '')); })) renderEditor(); } }, '增加规则'), h('button', { class: 'btn', onclick: () => transition(revise, '已应用规则；发生变化时新增修订，旧轮结论与预测未覆盖。规则合理性仍由你判断。') }, '应用规则修订')),
        h('p', {}, '字段1–20位英文字母开头，最多8条。上下界含等号；留空表示不限制。只有number使用数值范围，string/array使用长度；boolean只有类型/必填。切换类型后无关栏不参与判定。'),
        h('label', { class: 'l027-label' }, h('strong', {}, 'JSON样例（顶层对象）'), sample),
        h('div', { class: 'l027-actions' }, [['{"age":130}', '载入超界130'], ['{}', '载入缺字段'], ['{"age":null}', '载入null'], ['{"age":"20"}', '载入错类型'], ['{"age":0}', '载入下界0'], ['{"age":120}', '载入上界120']].map(([value, label]) => h('button', { class: 'btn', onclick: () => { if (updateDraft(draft => { draft.sample = value; })) renderEditor(); } }, label))),
        h('div', { class: 'l027-actions' }, prediction, h('button', { class: 'btn primary', onclick: () => transition(submit, '预测已提交并锁定，规则与样例快照不可覆盖；现在可揭示该轮结论。') }, '提交预测并锁定')));
    }
    function revealRound(id) { transition(state => reveal(state, id), '已揭示锁定样例的全部违反项；历史误判按轮次计算，不按错误数量计算。'); selected = id; renderOutput(); }
    function renderOutput() {
      const row = session.rounds.find(item => item.id === selected);
      if (!row) { replace(output, h('p', {}, '当前没有观察结果。先提交预测，再揭示；或查看历史快照。')); return; }
      replace(output, h('section', { class: 'l027-observation' }, h('h3', {}, `轮次${row.id} · 锁定修订${row.revision}`), h('p', {}, `锁定预测：${row.prediction === 'pass' ? '通过' : '失败'}`), h('pre', {}, row.sample), h('details', {}, h('summary', {}, '锁定规则'), h('pre', {}, JSON.stringify(row.rules, null, 2))),
        row.result ? h('div', {}, h('p', { class: row.result.misjudged ? 'l027-error' : '' }, `真实结论：${row.result.passed ? '通过' : '失败'} · ${row.result.misjudged ? '误判1条' : '本轮无误判'}`), row.result.violations.length ? h('ul', {}, row.result.violations.map(item => h('li', {}, `${item.path} · ${item.kind} · ${item.message}`))) : h('p', {}, '没有违反当前有限契约。')) : h('div', {}, h('p', {}, '已锁定，尚未揭示；当前草稿编辑不会改变这条记录。'), h('button', { class: 'btn primary', onclick: () => revealRound(row.id) }, '揭示锁定轮次'))));
    }
    function renderHistory() {
      const judged = session.rounds.filter(row => row.result !== null);
      replace(history, h('h3', {}, `历史 ${session.rounds.length}/24轮 · 修订 ${session.revisions.length}/24条`), h('p', { class: 'l027-total' }, `已揭示${judged.length}轮 · 误判${judged.filter(row => row.result.misjudged).length}条`),
        h('div', { class: 'l027-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['轮次/修订', '原预测', '揭示结论', '误判', '操作'].map(text => h('th', {}, text)))), h('tbody', {}, session.rounds.map(row => h('tr', {}, h('td', {}, `${row.id} / ${row.revision}`), h('td', {}, row.prediction === 'pass' ? '通过' : '失败'), h('td', {}, row.result === null ? '未揭示' : row.result.passed ? '通过' : '失败'), h('td', {}, row.result === null ? '待揭示' : row.result.misjudged ? '是' : '否'), h('td', {}, h('button', { class: 'btn', onclick: () => { selected = row.id; renderOutput(); } }, `查看轮次${row.id}`))))))),
        h('details', {}, h('summary', {}, '规则修订记录'), session.revisions.map(row => h('div', {}, h('strong', {}, `修订${row.id}`), h('pre', {}, JSON.stringify(row.rules, null, 2))))),
        h('div', { class: 'l027-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown')));
    }
    async function exportReport(extension) {
      if (exporting) return; const files = window.toolbox?.files;
      if (files?.saveTextSupportsCopyOnly !== true) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try { const payload = { feature: 'L027', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), session: clone(session) }; const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L027-contract-training.${extension}`, copyOnly: true }); message(response?.ok === true ? '已导出完整新副本，含全部规则修订与原预测快照。' : response?.canceled === true ? '已取消导出，会话保留。' : `导出失败：${response?.error || '未确认保存成功'}`, response?.ok !== true && response?.canceled !== true); }
      catch (error) { message(`导出失败：${error.message}`, true); } finally { exporting = false; }
    }
    const restartCheck = h('input', { type: 'checkbox', 'aria-label': '已导出或同意清空历史' });
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '数据契约反例训练'), h('p', {}, '先预测，再看路径；修改规则后开启新轮，保留旧判断作为学习证据。'), notice, storage,
      h('details', {}, h('summary', {}, '有限模型、Unicode与保存边界'), h('p', {}, '只校验顶层字段，额外字段忽略。null不是缺字段，必填null仍要检查类型。字符串长度按Unicode码点计，不按UTF-16单元或用户感知字符；例如😀长1，e+组合重音长2。数组仅计元素，不检查元素类型。缺必填或错类型时不继续该字段范围检查。'), h('p', {}, 'JSON≤4096 UTF-8字节，深度≤4，值≤128，对象≤16字段，数组≤32元素，字符串≤512码点，数字有限且绝对值≤10亿；重复解码键、__proto__/prototype/constructor和孤立代理项拒绝。只接受标准JSON，无JS、正则、引用或完整Schema。'), h('p', {}, 'schemaVersion=1完整会话≤64KiB UTF-8，轮次与修订各≤24；达到容量会拒绝新增，不截断。提交时为揭示结果预留容量。超限先导出并明确清空后开始新会话，配置失败时只能恢复较早状态。规则修正是否符合业务意图仍需人判断。')),
      editor, output, history, h('details', {}, h('summary', {}, '开始新会话（清空历史）'), h('label', {}, restartCheck, '我已导出或同意清空本会话历史'), h('button', { class: 'btn', onclick: () => { if (!restartCheck.checked) { message('先勾选已导出或同意清空历史，旧记录不会自动截断。', true); return; } session = initialState(); selected = null; restartCheck.checked = false; renderEditor(); renderOutput(); renderHistory(); persist(); message('已开始新会话，原历史已清空。'); } }, '开始新会话')));
    renderEditor(); renderOutput(); renderHistory();
    return { activate() {}, deactivate() { persist(); }, destroy() { if (destroyed) return; persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l027'); } };
  },
};
