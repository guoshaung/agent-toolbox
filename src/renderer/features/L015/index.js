import { h } from '../../core/ui.js';
import { MODEL_VERSION, MAX_INSTRUCTIONS, MAX_STEPS, RULES, STATUS_LABELS, example, createReplay, stepReplay, summarize, threadStatus, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L015.state';
export default {
  id: 'L015',
  create(root, ctx = {}) {
    root.classList.add('feature-l015');
    let draft = example(); let state = null; let selected = 0; let timer = null; let destroyed = false; let exporting = false; let restoredNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try { const restored = validateStoredState(saved); draft = { initial: restored.initial, scripts: restored.scripts }; restoredNotice = '已恢复脚本草稿；调度、寄存器和轨迹未写入配置，需重新开始重放或保留导出报告。'; }
      catch (error) { restoredNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l015-notice', role: 'status', 'aria-live': 'polite' }, restoredNotice); const storageNotice = h('div', { class: 'l015-storage', role: 'status' });
    const editor = h('div', { class: 'l015-editor' }); const output = h('div', { class: 'l015-output' });
    function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)); }
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer !== null) clearTimeout(timer); timer = null; if (!ctx.config?.set) return;
      let stored;
      try { stored = prepareStoredState(draft); }
      catch (error) { if (!destroyed) storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      if (!destroyed) storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, stored)).catch((error) => message(`保存草稿失败：${error.message} 请导出完整JSON。`, true)); }
      catch (error) { message(`保存草稿失败：${error.message} 请导出完整JSON。`, true); }
    }
    function changed() { state = null; selected = 0; renderOutput(); message('脚本或初始值已改变，旧状态和轨迹已清空；请重新开始重放。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function table(headers, rows, caption) { return h('div', { class: 'l015-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('模板已载入，请开始重放后逐次选择线程。'); }
    function renderEditor() {
      const initial = h('input', { class: 'field', type: 'text', inputmode: 'numeric', maxlength: '9', 'aria-label': '初始共享计数器', oninput: () => { draft.initial = initial.value; changed(); } }); initial.value = draft.initial;
      replace(editor, h('div', { class: 'l015-actions' }, h('label', {}, '初始共享计数器 ', initial), h('button', { class: 'btn', onclick: () => load('unlocked') }, '载入无锁模板'), h('button', { class: 'btn', onclick: () => load('locked') }, '载入互斥模板')),
        h('p', {}, '每行一条指令，忽略空行，不分大小写。READ：共享→R；WRITE：R+1→共享；LOCK/UNLOCK：取得/释放同一个非重入锁。'),
        h('div', { class: 'l015-columns' }, draft.scripts.map((source, index) => {
          const input = h('textarea', { class: 'field l015-script', rows: '6', maxlength: '4096', spellcheck: 'false', 'aria-label': `T${index + 1}指令脚本`, oninput: () => { draft.scripts[index] = input.value; changed(); } }); input.value = source;
          return h('label', {}, h('strong', {}, `T${index + 1}脚本`), input);
        })), h('p', {}, `固定两个线程；每线程1–${MAX_INSTRUCTIONS}条指令，脚本≤4096 UTF-8字节；最多${MAX_STEPS}次尝试（包含阻塞/失效）。`), h('button', { class: 'btn primary', onclick: reset }, '开始 / 重置重放'));
    }
    function reset() {
      try { state = createReplay(draft); selected = 0; persist(); renderOutput(); message('已从初始值重置；选择T1或T2执行一条指令，不会自动运行。'); }
      catch (error) { state = null; renderOutput(); message(error.message, true); }
    }
    function step(index) {
      try { state = stepReplay(state, index); selected = state.trace.length - 1; renderOutput(); const frame = state.trace[selected]; message(`步骤${frame.step} T${index + 1} ${frame.op}：${frame.reason}`, frame.outcome === 'fault'); }
      catch (error) { message(error.message, true); }
    }
    function pick(index) { if (!state?.trace.length || !Number.isInteger(index)) return; selected = Math.max(0, Math.min(state.trace.length - 1, index)); renderOutput(); }
    const owner = (value) => value === null ? '无' : `T${value + 1}`;
    const register = (value) => value === null ? '未初始化' : String(value);
    function snapshotView(snapshot, caption) {
      return h('div', {}, h('strong', {}, `${caption}：共享${snapshot.shared} · 版本${snapshot.revision} · 锁所有者${owner(snapshot.lockOwner)}`), table(['线程', 'PC', '寄存器R', '状态'], snapshot.threads.map((thread, index) => h('tr', {}, [`T${index + 1}`, thread.pc + 1, register(thread.register), STATUS_LABELS[thread.status]].map((cell) => h('td', {}, String(cell))))), `${caption}的线程快照；PC从1开始，超过脚本长度表示完成`));
    }
    function renderOutput() {
      const exports = h('div', { class: 'l015-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!state) { replace(output, h('p', {}, '点击“开始 / 重置重放”建立状态，再人工选择线程。默认丢失更新顺序：T1 READ → T2 READ → T1 WRITE → T2 WRITE。'), exports); return; }
      const summary = summarize(state); const frame = state.trace[selected];
      const selector = frame ? h('select', { class: 'field', 'aria-label': '查看历史步骤', onchange: () => pick(Number(selector.value)) }, state.trace.map((row, index) => h('option', { value: String(index) }, `${row.step}：T${row.thread + 1} ${row.op} ${row.outcome}`))) : null;
      if (selector) selector.value = String(selected);
      replace(output,
        h('div', { class: 'l015-summary' }, `当前共享计数器 ${state.shared} · 锁所有者 ${owner(state.lockOwner)} · 步骤 ${state.trace.length}/${MAX_STEPS}`),
        h('p', {}, `串行理想 ${state.serialReference.counter ?? '未生成'}：${state.serialReference.description}`),
        summary.completed ? h('p', { class: summary.lostUpdate ? 'l015-warning' : '' }, `两线程已完成，最终值 ${state.shared}；${summary.difference === null ? '没有有效串行基准。' : summary.lostUpdate ? `串行理想 ${state.serialReference.counter}，丢失更新差 ${summary.difference}。` : `与串行值差 ${summary.difference}。`}`) : h('p', {}, '重放尚未完成，当前共享值不是最终结果。'),
        summary.lockLeak ? h('p', { class: 'l015-warning' }, '锁所有者已完成或失效但未解锁；模型不自动释放锁，其他LOCK可能无法推进。') : null,
        summary.stopped ? h('p', { class: 'l015-warning' }, '当前无可推进线程，需重置或修改脚本；阻塞尝试仍可记录原因。') : null,
        h('div', { class: 'l015-columns' }, state.threads.map((thread, index) => {
          const status = threadStatus(state, index); const instructions = state.input.programs[index];
          return h('section', { class: 'l015-thread' }, h('h3', {}, `T${index + 1} · ${STATUS_LABELS[status]}`), h('p', {}, `R=${register(thread.register)}；READ版本=${thread.readRevision ?? '无'}；下一指令=${instructions[thread.pc]?.op ?? '无'}`), h('ol', {}, instructions.map((instruction, pc) => h('li', { class: pc === thread.pc ? 'is-current' : pc < thread.pc ? 'is-completed' : '' }, `${instruction.op}${pc === thread.pc ? ' ← 当前PC' : ''}`))), thread.fault ? h('p', { class: 'l015-warning' }, thread.fault) : null,
            h('button', { class: 'btn', disabled: ['done', 'fault'].includes(status) || state.trace.length >= MAX_STEPS, onclick: () => step(index) }, `T${index + 1} 执行下一条`));
        })),
        h('p', { class: summary.conflicts ? 'l015-warning' : '' }, `未保护冲突 ${summary.conflicts}对 · 陈旧写入 ${summary.staleWrites}次。冲突提示不等同于已发生丢失更新，串行无锁也可能提示。`),
        state.trace.length >= MAX_STEPS ? h('p', { class: 'l015-warning' }, '已达到尝试步数上限，旧记录完整保留；请导出或重置。') : null,
        table(['查看', '线程', '指令', '结果', '共享前→后', '锁前→后'], state.trace.map((row, index) => h('tr', {}, h('td', {}, h('button', { class: 'btn', onclick: () => pick(index) }, `查看步骤${row.step}`)), [`T${row.thread + 1}`, row.op, row.outcome === 'executed' ? '执行成功' : row.outcome === 'blocked' ? '锁阻塞' : '指令失效', `${row.before.shared}→${row.after.shared}`, `${owner(row.before.lockOwner)}→${owner(row.after.lockOwner)}`].map((cell) => h('td', {}, String(cell))))), '人工调度轨迹；阻塞/失效保留PC及共享状态；历史选择只查看，不回滚当前重放'),
        frame ? h('section', { class: 'l015-step' }, h('div', { class: 'l015-actions' }, selector, h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '历史上一步'), h('button', { class: 'btn', disabled: selected === state.trace.length - 1, onclick: () => pick(selected + 1) }, '历史下一步')), h('h3', {}, `步骤${frame.step} · T${frame.thread + 1} ${frame.op}`), h('p', {}, frame.reason),
          frame.protected === null ? null : h('p', {}, frame.protected ? '本次共享访问持有互斥锁。' : '本次共享访问未持有互斥锁。'),
          frame.conflictPairs.length ? h('ul', {}, frame.conflictPairs.map((pair) => h('li', {}, `未保护冲突：步骤${pair.earlierStep} T${pair.earlierThread + 1} ${pair.earlierOp} ↔ 步骤${pair.laterStep} T${pair.laterThread + 1} ${pair.laterOp}`))) : h('p', {}, '本步骤没有新增未保护冲突对。'),
          frame.staleWrite ? h('p', { class: 'l015-warning' }, `陈旧写入：步骤${frame.staleWrite.readStep}读取${frame.staleWrite.readValue}（版本${frame.staleWrite.readRevision}），当前版本${frame.staleWrite.currentRevision}、共享${frame.staleWrite.overwrittenValue}，写回${frame.staleWrite.writtenValue}；相对当前值加一的增量缺口${frame.staleWrite.incrementGap}。`) : null,
          h('div', { class: 'l015-columns' }, snapshotView(frame.before, '之前'), snapshotView(frame.after, '之后')),
        ) : h('p', {}, '尚无步骤记录；线程按钮每次只执行一条。'), exports,
      );
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L015', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result: state };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L015-race-replay.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含完整脚本、人工调度和前后状态。' : response?.canceled ? '已取消导出，输入与重放保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '锁与竞态重放'), h('p', {}, '选择下一个执行线程，观察两个本地读值如何写回同一个共享计数器。'), notice, storageNotice,
      h('details', {}, h('summary', {}, '抽象模型、冲突提示与保存规则'), h('p', {}, RULES), h('p', {}, '每条指令原子执行，没有真实线程、JS执行或硬件内存模型。WRITE前必须READ；重复LOCK或非所有者UNLOCK为失效指令，线程停在原PC直到重置；阻塞LOCK不推进PC，可在所有者UNLOCK后重试。结束不自动解锁。'), h('p', {}, '串行基准固定T1全部执行后T2全部执行，使用同一脚本语义；无法正常结束时不生成理想值。未保护冲突：轨迹中跨线程、至少一个WRITE、至少一次未持锁的读写对，只是保护缺失提示，不是对真实语言数据竞态的判定。陈旧写入：READ后共享写版本已改变；最终丢失更新按完成后与串行基准比较。'), h('p', {}, '初始计数器±1000000；两线程各1–16指令，最多128次尝试（含阻塞）。只保存≤64KiB版本化脚本草稿，重放状态/轨迹需导出；切走无后台运行。JSON/Markdown创建新副本并拒绝覆盖已有文件。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l015'); } };
  },
};
