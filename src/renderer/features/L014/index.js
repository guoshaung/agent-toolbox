import { h } from '../../core/ui.js';
import { MODEL_VERSION, MAX_TASKS, MAX_TIME, MAX_SEGMENTS, POLICIES, example, compareSchedules, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L014.state';
export default {
  id: 'L014',
  create(root, ctx = {}) {
    root.classList.add('feature-l014');
    let draft = example(); let result = null; let selected = {}; let timer = null; let destroyed = false; let exporting = false; let restoreNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try { const state = validateStoredState(saved); draft = { quantum: state.quantum, tasks: state.tasks }; restoreNotice = '已恢复输入草稿；时间轴和结果不写入配置，请重新运行或保留导出报告。'; }
      catch (error) { restoreNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l014-notice', role: 'status', 'aria-live': 'polite' }, restoreNotice);
    const storageNotice = h('div', { class: 'l014-storage', role: 'status' });
    const editor = h('div', { class: 'l014-editor' }); const output = h('div', { class: 'l014-output' });
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState(draft); }
      catch (error) { if (!destroyed) storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      if (!destroyed) storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存输入失败：${error.message} 请导出完整JSON。`, true)); }
      catch (error) { message(`保存输入失败：${error.message} 请导出完整JSON。`, true); }
    }
    function changed() { result = null; selected = {}; renderOutput(); message('输入已改变，旧时间轴与指标已清空，请重新运行。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function table(headers, rows, caption) { return h('div', { class: 'l014-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function field(row, key, label, length) {
      const control = h('input', { class: 'field', type: 'text', inputmode: key === 'id' ? 'text' : 'numeric', maxlength: String(length), 'aria-label': label, oninput: () => { row[key] = control.value; changed(); } }); control.value = row[key]; return control;
    }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('示例已载入，请运行三策略对照。'); }
    function renderEditor() {
      const quantum = field(draft, 'quantum', 'RR时间片', 6);
      replace(editor,
        h('div', { class: 'l014-actions' }, h('label', {}, 'RR时间片 ', quantum), h('span', {}, '到达时间允许0；运行时长与时间片必须>0；时间单位为整数tick')),
        h('div', { class: 'l014-actions' }, h('button', { class: 'btn', onclick: () => load('core') }, '载入基础示例'), h('button', { class: 'btn', onclick: () => load('boundary') }, '载入边界入队示例'), h('button', { class: 'btn', onclick: () => load('idle') }, '载入空闲示例')),
        table(['输入顺序', '任务名称', '到达时间', '运行时长', '操作'], draft.tasks.map((row, index) => h('tr', {}, h('th', { scope: 'row' }, String(index + 1)), h('td', {}, field(row, 'id', `任务${index + 1}名称`, 24)), h('td', {}, field(row, 'arrival', `任务${index + 1}到达时间`, 6)), h('td', {}, field(row, 'burst', `任务${index + 1}运行时长`, 6)), h('td', {}, h('button', { class: 'btn', onclick: () => { draft.tasks.splice(index, 1); changed(); renderEditor(); } }, `删除任务 ${index + 1}`)))), `${draft.tasks.length}/${MAX_TASKS}个任务；同到达按输入行顺序；名称唯一。到达0–99999，时长/时间片1–100000。最多模拟至${MAX_TIME}，每策略最多${MAX_SEGMENTS}片段。`),
        h('div', { class: 'l014-actions' }, h('button', { class: 'btn', disabled: draft.tasks.length >= MAX_TASKS, onclick: () => { draft.tasks.push({ id: '', arrival: '0', burst: '' }); changed(); renderEditor(); } }, '添加任务'), h('button', { class: 'btn primary', onclick: run }, '运行三策略对照')),
      );
    }
    function run() {
      try { result = compareSchedules(draft); selected = Object.fromEntries(result.strategies.map((strategy) => [strategy.id, { task: 0, segment: 0 }])); persist(); renderOutput(); message(`已用相同${result.input.tasks.length}个任务计算三策略。平均由所有任务计算；超限时整轮拒绝，不截断。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function pick(strategy, key, index) {
      if (!result || !Number.isInteger(index)) return;
      const maximum = key === 'segment' ? strategy.segments.length - 1 : strategy.tasks.length - 1;
      selected[strategy.id][key] = Math.max(0, Math.min(maximum, index)); renderOutput();
    }
    const intervals = (rows) => rows.map((row) => `[${row.start}, ${row.end})`).join('、') || '无';
    function strategyView(strategy) {
      const selection = selected[strategy.id]; const segment = strategy.segments[selection.segment]; const task = strategy.tasks[selection.task];
      const segmentSelect = h('select', { class: 'field', 'aria-label': `${strategy.id}查看时间片段`, onchange: () => pick(strategy, 'segment', Number(segmentSelect.value)) }, strategy.segments.map((row, index) => h('option', { value: String(index) }, `${index + 1}：${row.taskId ?? 'CPU空闲'} [${row.start},${row.end})`))); segmentSelect.value = String(selection.segment);
      const taskSelect = h('select', { class: 'field', 'aria-label': `${strategy.id}查看任务详情`, onchange: () => pick(strategy, 'task', Number(taskSelect.value)) }, strategy.tasks.map((row, index) => h('option', { value: String(index) }, row.id))); taskSelect.value = String(selection.task);
      return h('section', { class: 'l014-strategy' }, h('h3', {}, strategy.name), h('p', {}, strategy.policy),
        h('div', { class: 'l014-summary' }, `总完成时间 ${strategy.makespan} · CPU运行 ${strategy.busy} · 空闲 ${strategy.idle} · 利用率 ${(strategy.utilization * 100).toFixed(2)}%`),
        h('p', {}, `平均等待 ${strategy.averages.waiting.toFixed(2)} · 平均周转 ${strategy.averages.turnaround.toFixed(2)} · 平均响应 ${strategy.averages.response.toFixed(2)}`),
        h('div', { class: 'l014-gantt-scroll' }, h('div', { class: 'l014-gantt', role: 'group', 'aria-label': `${strategy.id}按比例甘特图` }, strategy.segments.map((row, index) => {
          const taskIndex = result.input.tasks.findIndex((task) => task.id === row.taskId); const label = `${strategy.id}片段${index + 1}：${row.taskId ?? 'CPU空闲'}，${row.start}至${row.end}，时长${row.duration}`;
          return h('button', { class: `l014-bar${row.taskId === null ? ' is-idle' : ''}${index === selection.segment ? ' is-selected' : ''}`, style: { flex: `0 0 ${row.duration / strategy.makespan * 100}%`, backgroundColor: row.taskId === null ? '' : `hsl(${(taskIndex * 67 + 205) % 360} 52% 42%)` }, title: label, 'aria-label': label, onclick: () => pick(strategy, 'segment', index) }, row.taskId ?? '空闲');
        })), h('div', { class: 'l014-axis' }, h('span', {}, '0'), h('span', {}, String(strategy.makespan)))),
        h('small', {}, '时间轴从0开始，宽度按实际时长比例；窄片段可用选择器查看，RR相邻同任务片段保留时间片边界。'),
        h('div', { class: 'l014-actions' }, segmentSelect, h('button', { class: 'btn', disabled: selection.segment === 0, onclick: () => pick(strategy, 'segment', selection.segment - 1) }, `${strategy.id}上个片段`), h('button', { class: 'btn', disabled: selection.segment === strategy.segments.length - 1, onclick: () => pick(strategy, 'segment', selection.segment + 1) }, `${strategy.id}下个片段`)),
        h('div', { class: 'l014-detail' }, h('strong', {}, `${strategy.id}片段${selection.segment + 1}：${segment.taskId ?? 'CPU空闲'} [${segment.start}, ${segment.end})，时长${segment.duration}`), h('p', {}, `${segment.reason}${segment.remaining === undefined ? '' : `；剩余时长${segment.remaining}`}`), h('p', {}, `调度前候选顺序：${segment.readyBefore.join(' → ') || '无'}；结束后候选顺序：${segment.readyAfter.join(' → ') || '无'}`)),
        table(['任务', '到达', '时长', '首次运行', '完成', '等待', '周转', '响应', '详情'], strategy.tasks.map((row, index) => h('tr', {}, [row.id, row.arrival, row.burst, row.firstStart, row.completion, row.waiting, row.turnaround, row.response].map((cell) => h('td', {}, String(cell))), h('td', {}, h('button', { class: 'btn', onclick: () => pick(strategy, 'task', index) }, `${strategy.id}查看任务${row.id}`)))), `${strategy.id}逐任务指标；保持原输入顺序，不以平均数代替个别任务`),
        h('div', { class: 'l014-detail' }, h('label', {}, '任务详情 ', taskSelect), h('h4', {}, `${strategy.id}任务${task.id}`), h('p', {}, `运行区间：${intervals(task.runs)}`), h('p', {}, `等待区间：${intervals(task.waits)}`), h('p', {}, `等待 = 完成−到达−时长 = ${task.completion}−${task.arrival}−${task.burst} = ${task.waiting}`), h('p', {}, `周转 = 完成−到达 = ${task.completion}−${task.arrival} = ${task.turnaround}`), h('p', {}, `响应 = 首次运行−到达 = ${task.firstStart}−${task.arrival} = ${task.response}`)),
      );
    }
    function renderOutput() {
      const exports = h('div', { class: 'l014-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '请运行当前输入，生成同输入三策略时间轴及逐任务指标。可先导出完整草稿。'), exports); return; }
      replace(output, table(['策略', '总完成时间', '平均等待', '平均周转', '平均响应', '空闲'], result.strategies.map((row) => h('tr', {}, [row.name, row.makespan, row.averages.waiting.toFixed(2), row.averages.turnaround.toFixed(2), row.averages.response.toFixed(2), row.idle].map((cell) => h('td', {}, String(cell))))), '三策略统一口径：总完成时间从0到最后完成；平均按全部任务计算'), result.strategies.map(strategyView), exports);
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L014', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L014-scheduling.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含完整草稿、三策略时间轴及逐任务指标。' : response?.canceled ? '已取消导出，输入与结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '调度策略对照'), h('p', {}, '同一组任务、三种调度规则。沿时间轴查看谁运行、谁等待，再核对逐任务完成、等待、周转与响应。'), notice, storageNotice,
      h('details', {}, h('summary', {}, '调度、指标与保存规则'), h('p', {}, '单CPU、无I/O、无优先级，切换开销为0。到达时间≥0，运行时长和RR时间片>0，均为整数。时间轴从0开始，idle显式显示；到达前的时间不是任务等待。'), Object.entries(POLICIES).map(([id, text]) => h('p', {}, `${id}：${text}`)), h('p', {}, '完成=最后一次运行结束时刻；周转=完成−到达；等待=周转−运行时长；响应=首次运行−到达。RR响应只指第一次，不等于总等待。区间为[开始,结束)。'), h('p', {}, `1–${MAX_TASKS}任务，时间上限${MAX_TIME}，每策略片段上限${MAX_SEGMENTS}；超过任一上限报错，不提供截断结果。只保存≤64KiB版本化输入草稿，结果重算；JSON/Markdown导出完整副本并拒绝覆盖已有文件。切走不留后台模拟。`)), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l014'); } };
  },
};
