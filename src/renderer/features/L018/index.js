import { h } from '../../core/ui.js';
import { MODEL_VERSION, FIELDS, POLICY, example, createSimulation, stepSimulation, visibleValue, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L018.state';
const LABELS = { initial: '初始已提交值', t1: 'T1脚本', t2: 'T2脚本' };
export default {
  id: 'L018',
  create(root, ctx = {}) {
    root.classList.add('feature-l018');
    let draft = example(); let result = null; let selected = 0; let timer = null; let destroyed = false; let exporting = false; let restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { const state = validateStoredState(raw); draft = Object.fromEntries(FIELDS.map((field) => [field, state[field]])); restored = '已恢复输入草稿；调度、快照及结果不写入配置，请重新重放或保留导出报告。'; } }
    catch (error) { restored = `草稿未能恢复：${error.message}`; }
    const notice = h('div', { role: 'status', 'aria-live': 'polite', class: 'l018-notice' }, restored); const storage = h('div', { role: 'status', class: 'l018-notice' });
    const editor = h('div', { class: 'l018-editor' }); const output = h('div', { class: 'l018-output' });
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let state; try { state = prepareStoredState(draft); }
      catch (error) { if (!destroyed) storage.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON。`; return; }
      if (!destroyed) storage.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`草稿保存失败：${error.message} 请导出完整JSON。`, true)); }
      catch (error) { message(`草稿保存失败：${error.message} 请导出完整JSON。`, true); }
    }
    function changed() { result = null; selected = 0; renderOutput(); message('输入已改变，旧调度/轨迹已清空，请开始重放。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('示例已载入，请开始重放。'); }
    function field(key) {
      const control = h(key === 'initial' ? 'input' : 'textarea', { class: 'field', 'aria-label': LABELS[key], ...(key === 'initial' ? { type: 'text', inputmode: 'numeric', maxlength: '12' } : { rows: '7', spellcheck: 'false', maxlength: '4096' }), oninput: () => { draft[key] = control.value; changed(); } }); control.value = draft[key];
      return h('label', { class: 'l018-field' }, h('strong', {}, LABELS[key]), control);
    }
    function start() {
      try { result = createSimulation(draft); selected = 0; persist(); renderOutput(); message('已重置至原始状态；选择一个事务执行其下一条指令，两策略同时前进一步。'); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function renderEditor() {
      replace(editor, field('initial'), h('div', { class: 'l018-columns' }, field('t1'), field('t2')), h('p', {}, '每行一条，区分大小写：BEGIN、READ、WRITE 整数、COMMIT、ROLLBACK。每个事务1–24行，脚本≤4096字节；整数范围−1000000至1000000。空行、SQL和表达式均拒绝。不检查生命周期顺序，重放时显示无效状态原因。'),
        h('div', { class: 'l018-actions' }, [['nonrepeatable', '载入非重复读示例'], ['own', '载入暂存与回滚示例'], ['writes', '载入双写覆盖示例']].map(([kind, label]) => h('button', { class: 'btn', onclick: () => load(kind) }, label)), h('button', { class: 'btn primary', onclick: start }, '开始 / 重置重放')));
    }
    function step(id) {
      if (!result) return;
      try { result = stepSimulation(result, id); selected = result.steps.length - 1; renderOutput(); const row = result.steps.at(-1); message(`步骤${row.step} ${id} ${row.instruction}；RC：${row.outcomes.RC.reason}；RR：${row.outcomes.RR.reason}`, !row.outcomes.RC.ok || !row.outcomes.RR.ok); }
      catch (error) { message(error.message, true); }
    }
    function table(headers, rows, caption) { return h('div', { class: 'l018-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell) => h('td', {}, String(cell)))))))); }
    function stateView(state, policy, title) {
      return h('section', { class: 'l018-state' }, h('h3', {}, `${title} ${policy === 'RC' ? '读提交 RC' : '可重复读 RR'}`), h('p', {}, `已提交 k = ${state.committed}；版本 ${state.version}`),
        table(['事务', '状态', 'BEGIN快照', '自己的暂存写', '当前可见值', '来源'], ['T1', 'T2'].map((id) => { const tx = state.transactions[id]; const visible = visibleValue(state, policy, id); return [id, tx.status, policy === 'RR' && tx.snapshot !== null ? tx.snapshot : '—', tx.hasWrite ? tx.pending : '—', visible.value === null ? '—' : visible.value, visible.source]; }), '当前可见值是下一条READ的预测；未激活/已结束事务不能READ'),
        table(['事务', '步骤', '读值', '来源'], ['T1', 'T2'].flatMap((id) => state.transactions[id].reads.map((read) => [id, read.step, read.value, read.source])), '已实际执行的READ'),
        h('p', { class: state.anomalies.length ? 'l018-warning' : '' }, state.anomalies.length ? state.anomalies.map((row) => `${row.transaction}非重复读：步骤${row.firstStep}值${row.firstValue} → 步骤${row.secondStep}值${row.secondValue}`).join('；') : '未发现非重复读；仅检查同事务且尚无自身WRITE的相邻READ，不表示其他异常不存在。'));
    }
    function pick(index) { if (!result?.steps.length) return; selected = Math.max(0, Math.min(result.steps.length - 1, index)); renderOutput(); }
    function renderOutput() {
      const exports = h('div', { class: 'l018-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '尚无重放结果。可以编辑脚本、载入示例或导出当前草稿。'), exports); return; }
      const allDone = ['T1', 'T2'].every((id) => result.pc[id] === result.scripts[id].length);
      const pending = ['T1', 'T2'].filter((id) => result.RC.transactions[id].status === 'active');
      const controls = ['T1', 'T2'].map((id) => { const instruction = result.scripts[id][result.pc[id]]; return h('section', { class: 'l018-next' }, h('strong', {}, `${id} 下一条：${instruction?.text ?? '脚本已用尽'}`), h('p', {}, `已执行 ${result.pc[id]} / ${result.scripts[id].length}`), h('button', { class: 'btn primary', disabled: !instruction, onclick: () => step(id) }, `执行 ${id} 下一步`)); });
      const row = result.steps[selected];
      let history = null;
      if (row) {
        const selector = h('select', { class: 'field', 'aria-label': '查看重放步骤', onchange: () => pick(Number(selector.value)) }, result.steps.map((item, index) => h('option', { value: String(index) }, `步骤${item.step} ${item.transaction} ${item.instruction}`))); selector.value = String(selected);
        history = h('details', { open: true }, h('summary', {}, `历史步骤${row.step}：${row.transaction} ${row.instruction}（仅查看，不回滚当前模型）`), h('div', { class: 'l018-actions' }, selector, h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上个步骤'), h('button', { class: 'btn', disabled: selected === result.steps.length - 1, onclick: () => pick(selected + 1) }, '下个步骤')),
          table(['策略', '结果', '已提交值前→后', '说明'], ['RC', 'RR'].map((policy) => [policy, row.outcomes[policy].ok ? '有效' : '无效', `${row.before[policy].committed}→${row.after[policy].committed}`, row.outcomes[policy].reason]), '原子指令前后'),
          h('div', { class: 'l018-columns' }, stateView(row.before.RC, 'RC', '步骤前'), stateView(row.before.RR, 'RR', '步骤前')), h('div', { class: 'l018-columns' }, stateView(row.after.RC, 'RC', '步骤后'), stateView(row.after.RR, 'RR', '步骤后')));
      }
      replace(output, h('p', { class: 'l018-summary' }, `原始已提交值 ${result.initial} · 已执行 ${result.steps.length} / 48步 · ${allDone ? '调度用尽' : '等待人工调度'}`), allDone ? h('p', { class: pending.length ? 'l018-warning' : '' }, pending.length ? `脚本已用尽但${pending.join('、')}仍为active；未提交写不会自动发布。请修改脚本并重置。` : '两脚本已用尽，请检查终态：committed或rolledback代表事务结束，idle代表没有有效BEGIN。') : null,
        h('div', { class: 'l018-columns' }, controls), h('p', {}, `调度：${result.schedule.join(' → ') || '尚无步骤'}`), h('div', { class: 'l018-columns' }, stateView(result.RC, 'RC', '当前状态'), stateView(result.RR, 'RR', '当前状态')),
        table(['策略', '步骤', '事务', '是否写入', '已提交前→后', '覆盖提示'], ['RC', 'RR'].flatMap((policy) => result[policy].commits.map((commit) => [policy, commit.step, commit.transaction, commit.wrote ? '是' : '只读', `${commit.before}→${commit.after}`, commit.overwritten ? 'BEGIN之后有他人提交；后提交覆盖' : '—'])), '完整COMMIT历史；ROLLBACK与无效指令在调度轨迹中'), history, exports);
    }
    async function exportReport(extension) {
      if (exporting) return; const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L018', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L018-transactions.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新副本，包含完整输入、调度及前后状态。' : response?.canceled ? '已取消导出，输入和结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); } finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '事务隔离沙盘'), h('p', {}, '在两个事务的READ之间安排另一个事务COMMIT，用相同调度同时比较读提交与可重复读。'), notice, storage,
      h('details', {}, h('summary', {}, '抽象规则、概念来源与保存范围'), h('p', {}, POLICY), h('p', {}, 'RR的BEGIN快照是教学选择；PostgreSQL RR在首个非事务控制语句开始建立快照，且真实并发写可能等待或中止。这里无锁、无SQL/MVCC，后提交覆盖不代表真实产品策略。'), h('a', { href: 'https://www.postgresql.org/docs/current/transaction-iso.html', target: '_blank', rel: 'noopener noreferrer' }, 'PostgreSQL 官方事务隔离说明'), h('p', {}, '全局配置仅保存schemaVersion=1的输入草稿（≤64KiB UTF-8且单脚本≤4096字节）；关闭后不恢复调度/结果。每个事务只可BEGIN一次。无效指令不改变状态但消耗一条，后续指令仍可调度。没有自动运行或真实数据库连接。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { if (destroyed) return; persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l018'); } };
  },
};
