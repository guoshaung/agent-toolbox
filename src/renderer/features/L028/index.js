import { h } from '../../core/ui.js';
import { MODEL_VERSION, POLICY, example, analyze, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';
const KEY = 'features.L028.state';
const valueText = observed => !observed?.exists ? '不存在' : JSON.stringify(observed.value);
const stateText = state => Object.keys(state).length ? Object.entries(state).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('；') : '{}';
const diffText = diff => diff.length ? diff.map(item => `${item.key}: ${valueText(item.before)} → ${valueText(item.after)}`).join('；') : '无';
const sourceText = source => source ? `首次来源 ${source.first.test}#${source.first.step}；最近修改 ${source.last.test}#${source.last.step}` : '无已记录修改来源';
export default {
  id: 'L028',
  create(root, ctx = {}) {
    root.classList.add('feature-l028'); let draft = example(), result = null, selection = { kind: 'shared', index: 0 }, timer = null, destroyed = false, exporting = false, restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { const state = validateStoredState(raw); draft = { order: state.order, tests: state.tests }; restored = '已恢复有界输入草稿，运行轨迹需重新分析。'; } } catch (error) { restored = `草稿未恢复：${error.message}`; }
    const notice = h('div', { class: 'l028-notice', role: 'status', 'aria-live': 'polite' }, restored), storage = h('div', { class: 'l028-notice', role: 'status' }), editor = h('div'), output = h('div');
    function replace(node, ...items) { node.replaceChildren(...items.flat(Infinity).filter(item => item !== null && item !== undefined && item !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let state; try { state = prepareStoredState(draft); } catch (error) { if (!destroyed) storage.textContent = `${error.message} 当前草稿未写入全局配置，关闭只能恢复较早草稿；请导出完整JSON。`; return; }
      if (!destroyed) storage.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch(error => message(`保存失败：${error.message}，请导出完整JSON。`, true)); } catch (error) { message(`保存失败：${error.message}，请导出完整JSON。`, true); }
    }
    function changed() { result = null; selection = { kind: 'shared', index: 0 }; renderOutput(); message('输入已改变，旧矩阵与轨迹已清空，请重新分析。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); }
    function testField(index, key, label) {
      const input = h(key === 'operations' ? 'textarea' : 'input', { class: 'field', ...(key === 'operations' ? { rows: '4', spellcheck: 'false', maxlength: '2048' } : { type: 'text', maxlength: '32' }), 'aria-label': `测试${index + 1}${label}`, oninput: () => { draft.tests[index][key] = input.value; changed(); } }); input.value = draft.tests[index][key]; return input;
    }
    function add() { if (draft.tests.length >= 6) return; let next = 1; const ids = new Set(draft.tests.map(test => test.id)); while (ids.has(`T${next}`)) next++; const id = `T${next}`; draft.tests.push({ id, operations: 'assertMissing x' }); draft.order = `${draft.order.trim()} ${id}`.trim(); changed(); renderEditor(); }
    function remove(index) { if (draft.tests.length <= 2) return; const [removed] = draft.tests.splice(index, 1); draft.order = draft.order.trim().split(/[\s,]+/).filter(id => id !== removed.id).join(' '); changed(); renderEditor(); }
    function renderEditor() {
      const order = h('input', { class: 'field', type: 'text', maxlength: '128', 'aria-label': '共享运行顺序', oninput: () => { draft.order = order.value; changed(); } }); order.value = draft.order;
      replace(editor, h('div', { class: 'l028-scroll' }, h('table', {}, h('caption', {}, '有限脚本：每行一条，不是JavaScript'), h('thead', {}, h('tr', {}, ['测试ID', 'DSL操作', '操作'].map(text => h('th', { scope: 'col' }, text)))), h('tbody', {}, draft.tests.map((test, index) => h('tr', {}, h('td', {}, testField(index, 'id', 'ID')), h('td', {}, testField(index, 'operations', '操作')), h('td', {}, h('button', { class: 'btn', disabled: draft.tests.length <= 2, onclick: () => remove(index) }, `删除测试${index + 1}`))))))),
        h('label', { class: 'l028-label' }, h('strong', {}, '共享运行顺序（空格/逗号分隔，每测试恰好一次）'), order), h('p', {}, '2–6项测试，每项1–8条。ID/key≤12位ASCII字母开头；禁止原型字段。语法：set x 1、set name "hello"、delete x、assertMissing x、assertEqual x true、reset。值仅整数(绝对值≤10亿)/true/false/JSON双引号字符串(≤64码点)，不允许null或对象。脚本文本≤2048 UTF-8字节。改ID后手动修正顺序。'),
        h('div', { class: 'l028-actions' }, h('button', { class: 'btn', disabled: draft.tests.length >= 6, onclick: add }, '增加测试'), [['default', '载入污染示例'], ['cleanup', '载入失败后清理示例'], ['ownbug', '载入独跑失败示例'], ['overwrite', '载入来源覆盖示例']].map(([kind, label]) => h('button', { class: 'btn', onclick: () => load(kind) }, label)), h('button', { class: 'btn primary', onclick: run }, '分析隔离与共享')));
    }
    function run() { try { result = analyze(draft); const first = result.shared.findIndex(row => row.earliestIntroducedFailure); selection = { kind: 'shared', index: first >= 0 ? first : 0 }; persist(); renderOutput(); message(`已完整模拟${result.summary.tests}项独跑、共享顺序与${result.summary.pairs}个有向测试对；断言失败后仍继续清理。`); } catch (error) { result = null; renderOutput(); message(error.message, true); } }
    function table(headers, rows, caption) { return h('div', { class: 'l028-scroll' }, h('table', {}, caption ? h('caption', {}, caption) : null, h('thead', {}, h('tr', {}, headers.map(text => h('th', { scope: 'col' }, text)))), h('tbody', {}, rows.map(row => h('tr', {}, row.map(value => h('td', {}, value?.nodeType ? value : String(value)))))))); }
    function pick(kind, index) { selection = { kind, index }; renderOutput(); }
    function runView(run, title) {
      return h('section', { class: 'l028-run' }, h('h3', {}, title), h('p', {}, `测试${run.id}：${run.passed ? '通过' : '失败'}，失败断言${run.failedAssertions}；${run.classification || '独立空状态开始，失败后继续执行'}`), h('p', {}, `初始 ${stateText(run.initial)} → 最终 ${stateText(run.final)}`), run.initialDiff ? h('p', {}, `相对独跑初始状态差异：${diffText(run.initialDiff)}`) : null,
        table(['步骤/全程步','指令','状态前','状态后','实际改动','断言/独跑对照','来源'], run.trace.map(step => [`${step.step}/${step.runStep}`, step.instruction, stateText(step.before), stateText(step.after), diffText(step.changes), step.assertion ? `期望${valueText(step.assertion.expected)}；实际${valueText(step.assertion.actual)}；${step.assertion.passed ? '通过' : '失败'}${step.baselineAssertion ? `；独跑实际${valueText(step.baselineAssertion.actual)} ${step.baselineAssertion.passed ? '通过' : '失败'}；全状态差异${diffText(step.inheritedDiff)}` : ''}` : '非断言', step.assertion ? sourceText(step.source) : '状态修改按当前test/step记录']), '失败断言不停止：完整展示后续delete/reset'),
        run.assertionDifferences?.length ? table(['差异断言','键','独跑实际','共享实际','来源','性质'], run.assertionDifferences.map(delta => [delta.step, delta.key, valueText(delta.isolated.actual), valueText(delta.shared.actual), sourceText(delta.source), delta.introducedFailure ? '该断言独跑通过→共享失败' : '读取差异，不能称新增失败'])) : h('p', {}, '没有断言读取差异。'));
    }
    function renderOutput() {
      const exports = h('div', { class: 'l028-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '尚无有效矩阵，请分析；也可导出当前草稿。'), exports); return; }
      const s = result.summary, first = result.earliestDifferenceFailure;
      const matrix = table(['前序↓ / 后序→', ...result.program.tests.map(test => test.id)], result.program.tests.map(source => [source.id, ...result.program.tests.map(target => {
        if (source.id === target.id) return '— 不测自身'; const index = result.pairs.findIndex(pair => pair.from === source.id && pair.to === target.id), pair = result.pairs[index];
        return h('div', {}, h('p', {}, `后序${pair.target.passed ? '通过' : '失败'} / 前序${pair.source.passed ? '通过' : '失败'}`), h('p', {}, `新增差异失败断言${pair.target.introducedFailures.length}`), h('button', { class: 'btn', onclick: () => pick('pair', index) }, `查看 ${source.id}→${target.id}`));
      })]), '全部有向测试对；每格从{}执行行测试再执行列测试，行失败仍继续后续清理');
      const detail = selection.kind === 'pair' ? [runView(result.pairs[selection.index].source, `有向对 ${result.pairs[selection.index].from}→${result.pairs[selection.index].to}：前序完整执行`), runView(result.pairs[selection.index].target, '后序继承前序最终状态')] : runView(result[selection.kind][selection.index], selection.kind === 'isolated' ? '独跑基线完整轨迹' : `共享顺序 ${result.program.order.join(' → ')}：选中测试`);
      replace(output, h('p', { class: 'l028-summary' }, `独跑失败${s.isolatedFailed}/${s.tests} · 共享失败${s.sharedFailed}/${s.tests} · 新增失败测试${s.newlyFailingTests} · 差异新失败断言${s.introducedAssertions} · 有向对${s.pairs}`),
        h('section', { class: 'l028-source' }, h('h3', {}, '共享顺序最早差异失败'), first ? h('div', {}, h('p', {}, `测试${first.test}#${first.step}，键${first.key}：独跑${valueText(first.isolated.actual)} → 共享${valueText(first.shared.actual)}`), h('p', {}, sourceText(first.source))) : h('p', {}, '没有独跑通过→共享失败的差异断言；独跑失败仍应检查自身脚本。'), h('p', {}, result.sourceScope)),
        h('h3', {}, '全部独跑基线'), table(['测试','独跑','初始→最终','查看'], result.isolated.map((row, index) => [row.id, row.passed ? '通过' : '失败', `${stateText(row.initial)} → ${stateText(row.final)}`, h('button', { class: 'btn', onclick: () => pick('isolated', index) }, `查看独跑${row.id}`)])),
        h('h3', {}, `共享顺序 ${result.program.order.join(' → ')} · 最终${stateText(result.final)}`), table(['顺序/测试','独跑→共享','状态前→后','归类','查看'], result.shared.map((row, index) => [`${index + 1}/${row.id}`, `${row.isolatedPassed ? '通过' : '失败'} → ${row.passed ? '通过' : '失败'}`, `${stateText(row.initial)} → ${stateText(row.final)}`, row.classification, h('button', { class: 'btn', onclick: () => pick('shared', index) }, `查看共享${row.id}`)])),
        h('h3', {}, '两两有向运行矩阵'), matrix, h('div', { class: 'l028-detail' }, detail), exports);
    }
    async function exportReport(extension) {
      if (exporting) return; const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; } exporting = true;
      try { const payload = { feature: 'L028', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result }; const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L028-test-pollution.${extension}`, copyOnly: true }); message(response?.ok === true ? '已导出完整新副本：全部独跑、共享顺序、有向测试对与状态轨迹。' : response?.canceled === true ? '已取消导出，当前输入和结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, response?.ok !== true && response?.canceled !== true); } catch (error) { message(`导出失败：${error.message}`, true); } finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '测试污染定位'), h('p', {}, '比较空状态独跑和前序遗留状态，查看键值差异及写入来源。'), notice, storage, h('details', {}, h('summary', {}, '执行语义、来源与保存范围'), h('p', {}, POLICY), h('p', {}, 'set覆盖键；delete不存在键为无操作；reset清空所有键。assertEqual要求键存在且同类型/同值，assertMissing只检查键不存在。断言失败不改变状态且继续后续操作，不模拟异常中止。状态初始为{}，每个有向对重建新状态，不继承其他矩阵格。'), h('p', {}, '首次来源是键最近缺失后首次set，覆盖不同值仍保留；最近修改指最后一次set/delete/reset。删除或reset后重设键会产生新首次来源。首次来源不是全局因果最小源，独跑已有失败不自动归因前序污染。两两矩阵不能替代长顺序分析，也不代表所有排列。'), h('p', {}, '配置仅保存schemaVersion=1草稿，JSON≤64KiB UTF-8且字段另有限额；结果必须重算或导出完整副本。超限不写配置，关闭只能恢复较早草稿。切走/销毁清保存计时器，无框架、网络或后台测试。')), editor, output);
    renderEditor(); renderOutput(); return { activate() {}, deactivate() { persist(); }, destroy() { if (destroyed) return; persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l028'); } };
  },
};
