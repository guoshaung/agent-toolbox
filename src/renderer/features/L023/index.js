import { h } from '../../core/ui.js';
import { MODEL_VERSION, PROGRAMS, MAX_CASES, getProgram, exploreBranches, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L023.state';
const newCase = () => ({ x: '', y: '0', enabled: false, override: false });
export default {
  id: 'L023',
  create(root, ctx = {}) {
    root.classList.add('feature-l023');
    let programId = 'simple'; let cases = getProgram(programId).examples.weak.map((row) => ({ ...row })); let result = null; let selected = 0;
    let timer = null; let destroyed = false; let exporting = false; let restoredNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try {
        validateStoredState(saved); getProgram(saved.programId);
        if (!Array.isArray(saved.cases) || saved.cases.length > MAX_CASES || !saved.cases.every((row) => row && typeof row.x === 'string' && typeof row.y === 'string' && typeof row.enabled === 'boolean' && typeof row.override === 'boolean')) throw new Error('输入草稿字段无效。');
        programId = saved.programId; cases = saved.cases.map((row) => ({ x: row.x, y: row.y, enabled: row.enabled, override: row.override }));
        restoredNotice = '已恢复输入草稿；轨迹和覆盖结果不写入配置，需要重新探索或保留导出报告。';
      } catch (error) { restoredNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l023-notice', role: 'status', 'aria-live': 'polite' }, restoredNotice);
    const storageNotice = h('div', { class: 'l023-storage', role: 'status' });
    const editor = h('div', { class: 'l023-editor' }); const output = h('div', { class: 'l023-output' });
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState({ programId, cases }); }
      catch (error) { storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存输入失败：${error.message} 请导出记录。`, true)); }
      catch (error) { message(`保存输入失败：${error.message} 请导出记录。`, true); }
    }
    function changed() { result = null; selected = 0; renderOutput(); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function table(headers, rows, caption) { return h('div', { class: 'l023-table-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function field(index, variable) {
      const label = `输入${index + 1}的${variable.name}`; let control;
      if (variable.type === 'boolean') {
        control = h('select', { class: 'field', 'aria-label': label, onchange: () => { cases[index][variable.name] = control.value === 'true'; changed(); } }, h('option', { value: 'false' }, 'false'), h('option', { value: 'true' }, 'true')); control.value = String(cases[index][variable.name]);
      } else {
        control = h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '24', 'aria-label': label, oninput: () => { cases[index][variable.name] = control.value; changed(); } }); control.value = cases[index][variable.name];
      }
      return control;
    }
    function example(kind) { cases = getProgram(programId).examples[kind].map((row) => ({ ...row })); changed(); renderEditor(); persist(); message('示例已替换输入集合，请运行探索。'); }
    function renderEditor() {
      const program = getProgram(programId);
      const selector = h('select', { class: 'field', 'aria-label': '内置条件程序', onchange: () => { programId = selector.value; changed(); renderEditor(); persist(); message('已切换程序并保留输入；仅当前程序声明的变量参与执行。'); } }, PROGRAMS.map((program) => h('option', { value: program.id }, program.name))); selector.value = programId;
      replace(editor,
        h('label', { class: 'l023-field' }, h('span', {}, '内置条件程序'), selector), h('pre', { class: 'l023-code' }, h('code', {}, program.source)),
        h('div', { class: 'l023-actions' }, h('button', { class: 'btn', onclick: () => example('weak') }, '载入单输入示例'), h('button', { class: 'btn', onclick: () => example('strong') }, '载入多输入示例'), h('button', { class: 'btn', disabled: cases.length >= MAX_CASES, onclick: () => { cases.push(newCase()); changed(); renderEditor(); } }, '添加输入')),
        table(['输入', ...program.variables.map((variable) => `${variable.name}（${variable.type === 'integer' ? '整数' : '布尔'}）`), '操作'], cases.map((row, index) => h('tr', {}, h('th', { scope: 'row' }, `T${index + 1}`), program.variables.map((variable) => h('td', {}, field(index, variable))), h('td', {}, h('button', { class: 'btn', onclick: () => { cases.splice(index, 1); changed(); renderEditor(); } }, `删除输入 ${index + 1}`)))), `${cases.length}/${MAX_CASES}条输入；整数在±1000000内，布尔只选true/false；编辑后需重新运行`),
        cases.length ? null : h('p', {}, '尚无输入；没有输入不生成覆盖率。'),
        h('button', { class: 'btn primary', onclick: run }, '运行分支探索'),
      );
    }
    function run() {
      try { result = exploreBranches(programId, cases); selected = 0; persist(); renderOutput(); message(result.status === 'empty' ? '没有输入，覆盖率未生成。' : `已探索${result.executions.length}条输入；分母固定为${result.coverage.denominator}条true/false边，短路原子不计入分母。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function pick(index) { if (!result || !result.executions.length || !Number.isInteger(index)) return; selected = Math.max(0, Math.min(result.executions.length - 1, index)); renderOutput(); }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L023', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: { programId, cases: cases.map((row) => ({ ...row })) }, result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(result), extension, defaultName: `L023-branches.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含固定分母、每次执行路径及未覆盖边。' : response?.canceled ? '已取消导出，输入与结果仍保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    function pathView(run, selector) {
      return h('div', { class: 'l023-path' },
        h('div', { class: 'l023-actions' }, selector,
          h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上个输入'),
          h('button', { class: 'btn', disabled: selected === result.executions.length - 1, onclick: () => pick(selected + 1) }, '下个输入')),
        h('strong', {}, `${run.id}：${run.path.map((entry) => entry.edge).join(' → ')} → 返回「${run.output}」`),
        run.decisions.map((node) => h('div', { class: `l023-step${node.executed ? '' : ' is-skipped'}` },
          h('strong', {}, `${node.id} ${node.label}：${node.executed ? String(node.outcome) : '未执行（没有命中任一边）'}`),
          h('ul', {}, node.atoms.map((atom) => h('li', {}, `${atom.id} ${atom.label}：${atom.status === 'evaluated' ? String(atom.value) : `未执行（${atom.reason}），不是false`}`))))),
        h('p', { class: 'l023-muted' }, '原子求值明细只用于解释短路。未执行不是false；本表不生成条件覆盖百分比。'));
    }
    function renderOutput() {
      if (!result) { replace(output, h('p', {}, '请运行当前输入集合；先查看每条决策的true/false边，再回看每次路径。可先导出JSON草稿。'), h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON')); return; }
      const run = result.executions[selected];
      const selector = run ? h('select', { class: 'field', 'aria-label': '查看输入路径', onchange: () => pick(Number(selector.value)) }, result.executions.map((row, index) => h('option', { value: String(index) }, `${row.id} ${JSON.stringify(row.input)}`))) : null;
      if (selector) selector.value = String(selected);
      replace(output,
        h('div', { class: 'l023-summary' }, result.coverage.value === null ? '无输入 · 覆盖率未生成' : `分支覆盖 ${result.coverage.numerator}/${result.coverage.denominator}（${(result.coverage.value * 100).toFixed(2)}%）`),
        h('p', {}, result.policy),
        h('div', { class: 'l023-decisions' }, result.decisionCounts.map((node) => h('div', { class: 'l023-decision' }, h('strong', {}, node.id), h('p', {}, result.edges.find((edge) => edge.decisionId === node.id).condition), h('span', { class: node.trueCount ? 'is-covered' : 'is-missing' }, `true边：${node.trueCount}次`), h('span', { class: node.falseCount ? 'is-covered' : 'is-missing' }, `false边：${node.falseCount}次`), h('small', {}, `条件未执行：${node.skippedCount}次`)))),
        table(['边', '次数', '命中输入', '状态'], result.edges.map((edge) => h('tr', { class: edge.covered ? 'is-covered' : 'is-missing' }, [edge.id, edge.count, edge.tests.join('、') || '无', edge.covered ? '已覆盖' : edge.knownUnreachable ? '未覆盖；已证明不可达，仍计分母' : '未覆盖；不能自动认定不可达'].map((cell) => h('td', {}, String(cell))))), '全部静态决策边：每条if两边；重复输入增加次数而不增加分母'),
        h('h3', {}, '未覆盖边提示'), result.uncovered.length ? h('ul', {}, result.uncovered.map((edge) => h('li', {}, `${edge.id}（${edge.condition}）：${edge.proof || edge.hint}`))) : h('p', {}, '当前全部决策边已覆盖；不代表条件覆盖或所有路径组合均覆盖。'),
        table(['查看', '输入', '实际路径', '输出'], result.executions.map((row, index) => h('tr', {}, h('td', {}, h('button', { class: 'btn', onclick: () => pick(index) }, `查看${row.id}`)), [JSON.stringify(row.input), row.path.map((entry) => entry.edge).join(' → '), row.output].map((cell) => h('td', {}, String(cell))))), '每次执行的路径；不执行的条件没有true/false边命中'),
        run ? pathView(run, selector) : null,
        h('div', { class: 'l023-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出路径 Markdown')),
      );
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '分支覆盖探索'), h('p', {}, '把输入数量、实际路径和分支边命中分开看，补上没有走到的决策。'), notice, storageNotice, h('details', {}, h('summary', {}, '解释器、覆盖定义与保存规则'), h('p', {}, '内置AST只解释整数比较、布尔变量、&&/||/!和if/return；没有任意JS或通用语言解析。最多64输入，整数±1000000、条件深度8/32节点、程序16语句。'), h('p', {}, '分支分母是静态if决策数×2，包含所有true/false边。逻辑原子短路未执行只标记skipped，不虚构真假命中，不把分支覆盖混成条件覆盖。不可达边按给定证明标注仍计分母；一般未命中不自动认定不可达。'), h('p', {}, '仅保存≤64KiB输入草稿，结果需重新运行；JSON/Markdown导出完整边计数与每次路径，禁止覆盖已有文件。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l023'); } };
  },
};
