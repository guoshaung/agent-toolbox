import { h } from '../../core/ui.js';
import { MODEL_VERSION, countValue, firstBadValue, randomFirstBad, createGame, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';
const KEY = 'features.L029.settings';
export default {
  id: 'L029',
  create(root, ctx = {}) {
    root.classList.add('feature-l029'); let settings = { count: '16', mode: 'demo' }, customAnswer = '', game = null, choice = '', timer = null, destroyed = false, exporting = false, restored = '';
    try { const raw = ctx.config?.get(KEY); if (raw) { const state = validateStoredState(raw); settings = { count: state.count, mode: state.mode }; restored = '已恢复设置；运行局、已测轨迹与隐藏答案不保存，请新开局。'; } } catch (error) { restored = `设置未恢复：${error.message}`; }
    const notice = h('div', { class: 'l029-notice', role: 'status', 'aria-live': 'polite' }, restored), storage = h('div', { class: 'l029-notice', role: 'status' }), editor = h('div'), output = h('div');
    function replace(node, ...items) { node.replaceChildren(...items.flat(Infinity).filter(item => item !== null && item !== undefined && item !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let state; try { state = prepareStoredState(settings); } catch (error) { if (!destroyed) storage.textContent = `${error.message} 当前设置未写入配置，关闭只能恢复较早设置。`; return; }
      if (!destroyed) storage.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch(error => message(`设置保存失败：${error.message}，局和轨迹本来就不持久化，请导出已知记录。`, true)); } catch (error) { message(`设置保存失败：${error.message}`, true); }
    }
    function changed() { game = null; customAnswer = ''; choice = ''; renderOutput(); message('设置已改变，旧局/轨迹清空；自定义答案不保存。请重新开始。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function renderEditor() {
      const mode = h('select', { class: 'field', 'aria-label': '教学模式', onchange: () => { settings.mode = mode.value; if (settings.mode === 'demo') settings.count = '16'; changed(); renderEditor(); } }, [['demo', '固定演示'], ['random', '本地随机局'], ['custom', '自定义单调序列（作者已知答案）']].map(([value, label]) => h('option', { value }, label))); mode.value = settings.mode;
      const count = h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '4', disabled: settings.mode === 'demo', 'aria-label': '提交数量', oninput: () => { const hadGame = game !== null; settings.count = count.value; changed(); if (hadGame) renderEditor(); else if (answer) answer.value = ''; } }); count.value = settings.count;
      const answer = settings.mode === 'custom' && !game ? h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '3', 'aria-label': '自定义首坏编号', oninput: event => { customAnswer = event.target.value; } }) : null; if (answer) answer.value = customAnswer;
      replace(editor, h('div', { class: 'l029-settings' }, h('label', {}, h('strong', {}, '教学模式'), mode), h('label', {}, h('strong', {}, '提交数量（2–256）'), count), answer ? h('label', {}, h('strong', {}, '首坏编号（2至提交数，不保存）'), answer) : null),
        settings.mode === 'demo' ? h('p', { class: 'l029-demo' }, '固定演示明确已知：16个提交，首坏9。它是操作示范，不是未知答案挑战。') : settings.mode === 'random' ? h('p', {}, 'crypto.getRandomValues在[2,N]选首坏，未定位前不显示答案。仅本地教学：开发者工具/内存可查，非隐藏安全。') : h('p', {}, '自定义输入者知道首坏；用N与首坏构造good…bad单调序列，不列完整好坏表。开局清除答案输入，运行面板只显示已测结果。'),
        h('div', { class: 'l029-actions' }, h('button', { class: 'btn primary', onclick: start }, settings.mode === 'custom' && game ? '重置自定义局并输入新答案' : '开始新局（重置轨迹）')));
    }
    function start() {
      if (settings.mode === 'custom' && game) { game = null; customAnswer = ''; choice = ''; renderEditor(); renderOutput(); message('旧自定义局已重置，请输入新首坏编号，再开始。'); return; }
      try { const count = settings.mode === 'demo' ? 16 : countValue(settings.count); const firstBad = settings.mode === 'demo' ? 9 : settings.mode === 'random' ? randomFirstBad(count) : firstBadValue(customAnswer, count); game = createGame({ count, firstBad, mode: settings.mode }); customAnswer = ''; choice = ''; renderEditor(); renderOutput(); persist(); message(game.view().completed ? '两个端点已唯一锁定首坏，无需额外检查。' : '已开局，只有首端good/末端bad已知；选择严格区间内未测提交。'); }
      catch (error) { message(error.message, true); }
    }
    function inspect(value) {
      if (!game) return;
      try { const commit = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : value; game.test(commit); choice = ''; renderOutput(); const view = game.view(); message(view.completed ? `已锁定首坏提交${view.firstBad}；额外检查${view.checks}次。` : '结果已记录，候选区间已更新；仅当前区间内未测提交可继续检查。'); }
      catch (error) { message(error.message, true); }
    }
    function table(headers, rows) { return h('div', { class: 'l029-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, headers.map(text => h('th', { scope: 'col' }, text)))), h('tbody', {}, rows.map(row => h('tr', {}, row.map(value => h('td', {}, String(value)))))))); }
    function renderOutput() {
      const exports = h('div', { class: 'l029-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出已知 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出已知 Markdown'));
      if (!game) { replace(output, h('p', {}, '尚未开局。设置只定义本地教学序列，不操作真实Git。'), exports); return; }
      const view = game.view(), known = new Map(view.known.map(row => [row.commit, row.status]));
      const input = h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '3', disabled: view.completed, 'aria-label': '选择提交编号', oninput: () => { choice = input.value; } }); input.value = choice;
      const grid = Array.from({ length: view.count }, (_, index) => {
        const commit = index + 1, status = known.get(commit), eligible = !view.completed && commit > view.interval.good && commit < view.interval.bad && !status;
        return h('button', { class: `btn l029-commit ${status ? `is-${status}` : eligible ? 'is-candidate' : 'is-excluded'}`, disabled: !eligible, onclick: () => inspect(commit), 'aria-label': `测试提交${commit}` }, `#${commit} ${status || (eligible ? '未测' : '区间外未测')}`);
      });
      replace(output, h('section', { class: 'l029-interval' }, h('h3', {}, view.completed ? `首坏提交：${view.firstBad}` : '首坏尚未揭晓'), h('p', { class: 'l029-summary' }, `已知边界 good=${view.interval.good} / bad=${view.interval.bad}；首坏候选[${view.interval.candidatesFrom},${view.interval.candidatesTo}]，${view.interval.size}个`), h('p', {}, `额外检查 ${view.checks} · 初始最优最坏界 ${view.optimalWorstCase} · 当前剩余最坏界 ${view.remainingWorstCase} · 采用建议 ${view.followedSuggestions}次`), h('p', {}, view.completed ? `超过初始最优最坏界的检查数：${view.excessOverOptimalWorstCase}` : `建议中点 ${view.suggestion} = floor((good+bad)/2)`), h('p', {}, '理论界是最坏情况的额外检查界，不是每个首坏位置的必需次数。端点、重复、区间外选择均不计新检查。')),
        h('div', { class: 'l029-actions' }, input, h('button', { class: 'btn', disabled: view.completed, onclick: () => inspect(choice) }, '测试所选提交'), h('button', { class: 'btn primary', disabled: view.completed, onclick: () => inspect(view.suggestion) }, '测试建议中点')),
        h('h3', {}, '提交带（只标已测good/bad，区间外未测不猜状态）'), h('div', { class: 'l029-grid' }, grid), h('h3', {}, '全部已知结果'), table(['提交','状态','来源'], view.known.map(row => [row.commit, row.status, row.commit === 1 || row.commit === view.count ? '开局已知端点，不计检查' : '本局检查'])), h('h3', {}, '额外检查轨迹'), table(['第几次','选择/结果','检查前good/bad','检查后good/bad','剩余候选','当时建议/是否采用'], view.trace.map(step => [step.step, `${step.commit} / ${step.status}`, `${step.before.good} / ${step.before.bad}`, `${step.after.good} / ${step.after.bad}`, step.remainingCandidates, `${step.suggested} / ${step.wasSuggested ? '是' : '否'}`])), exports);
    }
    async function exportReport(extension) {
      if (exporting) return; const files = window.toolbox?.files; if (files?.saveTextSupportsCopyOnly !== true) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; } exporting = true;
      try { const payload = { feature: 'L029', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), settings: prepareStoredState(settings), round: game?.view() ?? null }; const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L029-known-bisect.${extension}`, copyOnly: true }); message(response?.ok === true ? '已导出已知记录新副本；未完成局不含隐藏答案，完成局含首坏与完整检查轨迹。' : response?.canceled === true ? '已取消导出，当前局保留。' : `导出失败：${response?.error || '未确认保存成功'}`, response?.ok !== true && response?.canceled !== true); }
      catch (error) { message(`导出失败：${error.message}`, true); } finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '二分回归定位演练'), h('p', {}, '从已知good/bad端点缩小首坏区间，比较二分和任意检查位置。'), notice, storage, h('details', {}, h('summary', {}, '模型、理论界与保存范围'), h('p', {}, '仅2–256个虚拟提交，编号递增且good在前、bad在后，首坏存在且第1个good/第N个bad已知。每次检查严格区间内未测编号；假定结果可靠，无skip、非单调、波动或构建错误。'), h('p', {}, '首坏候选为(good,bad]，候选数bad-good；中点floor((good+bad)/2)。候选只剩1个即由邻接已知边界锁定，未必测试该首坏（如首坏为末端已知bad）。ceil(log2(候选数))是最优最坏情况检查界。'), h('p', {}, 'schemaVersion=1配置只存模式与提交数，UTF-8 JSON≤64KiB；不保存正在运行的局、选择、答案或已测轨迹。切走暂停保存计时器，当前挂载局保留；关闭/销毁后需新开局，请导出已知/结束报告。局内答案保存在JS内存，不是隐藏安全；固定演示预先说明答案，自定义作者知道输入。无真实Git、命令、代码、仓库扫描或网络。')), editor, output);
    renderEditor(); renderOutput(); return { activate() {}, deactivate() { persist(); }, destroy() { if (destroyed) return; persist(); destroyed = true; game = null; customAnswer = ''; root.replaceChildren(); root.classList.remove('feature-l029'); } };
  },
};
