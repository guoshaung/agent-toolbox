import { h } from '../../core/ui.js';
import { MODEL_VERSION, FUNCTIONS, MAX_TESTS, getFunction, runMutationTests, formatOutcome, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L022.state';
const LABEL = { killed: '已杀死', survived: '存活', equivalent: '等价排除' };
export default {
  id: 'L022',
  create(root, ctx = {}) {
    root.classList.add('feature-l022');
    let functionId = 'max'; let tests = getFunction('max').examples.weak.map((row) => ({ ...row })); let result = null;
    let timer = null; let destroyed = false; let exporting = false; let restoreNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try {
        validateStoredState(saved); getFunction(saved.functionId);
        if (!Array.isArray(saved.tests) || saved.tests.length > MAX_TESTS || !saved.tests.every((row) => row && ['a', 'b', 'expected'].every((key) => typeof row[key] === 'string'))) throw new Error('测试草稿结构无效。');
        functionId = saved.functionId; tests = saved.tests.map((row) => ({ a: row.a, b: row.b, expected: row.expected }));
        restoreNotice = '已恢复测试草稿；结果不写入全局配置，请重新运行训练或保留导出报告。';
      } catch (error) { restoreNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l022-notice', role: 'status', 'aria-live': 'polite' }, restoreNotice);
    const storageNotice = h('div', { class: 'l022-storage', role: 'status' });
    const editor = h('div', { class: 'l022-editor' }); const output = h('div', { class: 'l022-output' });
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState({ functionId, tests }); }
      catch (error) { storageNotice.textContent = `${error.message} 当前测试未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存测试失败：${error.message} 请导出记录。`, true)); }
      catch (error) { message(`保存测试失败：${error.message} 请导出记录。`, true); }
    }
    function changed() { result = null; renderOutput(); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function input(index, key, label) {
      const control = h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '24', 'aria-label': label, oninput: () => { tests[index][key] = control.value; changed(); } }); control.value = tests[index][key]; return control;
    }
    function loadExample(kind) { tests = getFunction(functionId).examples[kind].map((row) => ({ ...row })); changed(); renderEditor(); persist(); message('示例已替换当前测试；点击运行，查看杀死证据和存活项。'); }
    function run() {
      try { result = runMutationTests(functionId, tests); persist(); renderOutput(); message(result.message, result.status === 'baseline-failed'); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function table(headers, rows, caption) { return h('div', { class: 'l022-table-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function renderEditor() {
      const definition = getFunction(functionId);
      const selector = h('select', { class: 'field', 'aria-label': '内置纯函数', onchange: () => { functionId = selector.value; changed(); renderEditor(); persist(); message('已切换函数并保留测试，请确认期望值符合当前原函数。'); } }, FUNCTIONS.map((item) => h('option', { value: item.id }, item.name))); selector.value = functionId;
      replace(editor,
        h('label', { class: 'l022-field' }, h('span', {}, '内置纯函数'), selector), h('p', {}, definition.description), h('pre', { class: 'l022-code' }, h('code', {}, definition.implementation)),
        h('div', { class: 'l022-actions' }, h('button', { class: 'btn', onclick: () => loadExample('weak') }, '载入最小示例'), h('button', { class: 'btn', onclick: () => loadExample('strong') }, '载入强化示例'), h('button', { class: 'btn', disabled: tests.length >= MAX_TESTS, onclick: () => { tests.push({ a: '', b: '', expected: '' }); changed(); renderEditor(); } }, '添加测试')),
        table(['测试', '参数a', '参数b', '期望输出', '操作'], tests.map((row, index) => h('tr', {}, h('th', { scope: 'row' }, `T${index + 1}`), h('td', {}, input(index, 'a', `测试${index + 1}参数a`)), h('td', {}, input(index, 'b', `测试${index + 1}参数b`)), h('td', {}, input(index, 'expected', `测试${index + 1}期望`)), h('td', {}, h('button', { class: 'btn', onclick: () => { tests.splice(index, 1); changed(); renderEditor(); } }, `删除测试 ${index + 1}`)))), `${tests.length}/${MAX_TESTS}条测试；示例按钮替换当前测试，新增/编辑/删除后需重新运行`),
        tests.length ? null : h('p', {}, '当前没有测试；请添加测试或载入示例。空测试不生成合格得分。'),
        h('p', { class: 'l022-muted' }, 'a、b：−1000000至1000000的十进制整数；期望：±1000000000000内整数。精确比较数值，0和−0相等。没有代码输入或执行。'),
        h('button', { class: 'btn primary', onclick: run }, '运行变异训练'),
        h('details', {}, h('summary', {}, `查看${definition.mutants.length}个固定运算符变异`), definition.mutants.map((mutant) => h('div', {}, h('strong', {}, `${mutant.id}：${mutant.change}`), h('pre', { class: 'l022-code' }, h('code', {}, mutant.implementation)), mutant.equivalent ? h('p', {}, mutant.equivalenceReason) : null))),
      );
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L022', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: { functionId, tests: tests.map((row) => ({ ...row })) }, result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(result), extension, defaultName: `L022-mutation.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含基准与变异结果及明确计分口径。' : response?.canceled ? '已取消导出，测试与结果仍保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    function mutantCard(mutant) {
      const killing = mutant.observations.filter((row) => row.kills);
      return h('details', { class: `l022-mutant is-${mutant.status}`, open: true }, h('summary', {}, `${mutant.id} · ${LABEL[mutant.status]} · ${mutant.counted ? '参与计分' : '不参与计分'}`), h('p', {}, mutant.change), h('div', { class: 'l022-code-pair' }, h('div', {}, h('span', {}, '原实现'), h('pre', { class: 'l022-code' }, h('code', {}, mutant.originalImplementation))), h('div', {}, h('span', {}, '变异实现'), h('pre', { class: 'l022-code' }, h('code', {}, mutant.implementation)))),
        mutant.equivalent ? h('p', {}, mutant.equivalenceReason) : h('p', {}, mutant.status === 'survived' ? '存活只说明本次测试未发现差异，不能据此断言等价；仍计入分母。' : `杀死此变异的测试：${mutant.killedBy.join('、')}`),
        killing.length ? h('ul', {}, killing.map((row) => h('li', {}, `${row.id} 输入(${row.a},${row.b}) → 原函数/期望 ${row.expected}；变异结果 ${formatOutcome(row.actual)}，杀死此变异。`))) : null,
        mutant.observations.length ? table(['测试', '输入(a,b)', '期望', '变异结果', '杀死'], mutant.observations.map((row) => h('tr', {}, [row.id, `(${row.a},${row.b})`, row.expected, formatOutcome(row.actual), row.kills ? '是' : '否'].map((cell) => h('td', {}, String(cell))))), '所有测试对该变异的观察结果；非有限结果也属于可观察差异') : null,
      );
    }
    function renderOutput() {
      if (!result) { output.replaceChildren(h('p', {}, '编辑测试后需重新运行；先验证原函数，再检查变异。可先导出JSON草稿。'), h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON')); return; }
      const score = result.score;
      replace(output,
        h('div', { class: `l022-summary${result.status === 'baseline-failed' ? ' is-error' : ''}` }, result.status === 'empty' ? '无测试 · 变异得分未生成' : result.status === 'baseline-failed' ? '测试基准失败 · 变异得分未生成' : `变异得分 ${score.numerator}/${score.denominator}（${(score.value * 100).toFixed(2)}%）`),
        h('p', {}, result.message),
        table(['测试', '输入(a,b)', '期望', '原函数结果', '基准'], result.tests.map((row) => h('tr', { class: row.baselinePass ? '' : 'is-baseline-failed' }, [row.id, `(${row.a},${row.b})`, row.expected, formatOutcome(row.original), row.baselinePass ? '通过' : '失败'].map((cell) => h('td', {}, String(cell))))), '原函数先验证每一条测试；任一失败则不评估变异'),
        score ? h('p', { class: 'l022-score-policy' }, `生成 ${score.generated} 项 · 等价排除 ${score.excludedEquivalent} 项 · 参与分母 ${score.denominator} 项 · 杀死 ${score.numerator} 项 · 存活 ${score.survived} 项。得分按变异项计数，不按失败测试次数累计；满分不证明程序正确。`) : null,
        score ? table(['测试', ...result.mutants.filter((mutant) => mutant.counted).map((mutant) => mutant.id)], result.tests.map((row, index) => h('tr', {}, h('th', { scope: 'row' }, row.id), result.mutants.filter((mutant) => mutant.counted).map((mutant) => h('td', {}, mutant.observations[index].kills ? '杀死' : '未发现差异')))), '测试×变异矩阵；已证明等价的项不在计分矩阵中') : null,
        result.mutants.map(mutantCard),
        h('div', { class: 'l022-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出变异 Markdown')),
      );
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '变异测试训练场'), h('p', {}, '测试通过之后，再看它能否分辨比较或算术运算符中的错误。'), notice, storageNotice, h('details', {}, h('summary', {}, '计分与保存规则'), h('p', {}, '基准必须全部通过；空测试和基准失败都没有得分。max中的>=变异在声明整数域被证明等价，排除；其他存活项不会因“测试没发现”而排除。'), h('p', {}, '纯函数和变异固定于本工具，只接受输入/期望值。整数域保证原函数结果精确且有限；除法变异出现NaN或Infinity时作为可观察失败，报告存其文字而非非法JSON数值。最多64测试，最多4变异，没有真实项目执行或代码覆盖测量。'), h('p', {}, '全局配置只保存≤64KiB测试草稿，不保存结果；恢复需重新运行。JSON/Markdown保存完整结果，导出禁止覆盖已有文件。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l022'); } };
  },
};
