import { h } from '../../core/ui.js';
import { STAGES, POLICY, parseMemory, simulate, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L011.state';
const EXAMPLES = {
  load: { label: 'LOAD→ADD 示例', program: 'LOAD R1, [R0]\nADD R2, R1, R3', registers: ['0', '0', '0', '2', '0', '0', '0', '0'], memory: '0=10' },
  independent: { label: '独立 ADD 示例', program: 'LOAD R1, [R0]\nADD R2, R3, R4', registers: ['0', '0', '0', '2', '3', '0', '0', '0'], memory: '0=10' },
  store: { label: 'STORE 数据转发示例', program: 'LOAD R1, [R0]\nSTORE R1, [R0+1]\nLOAD R2, [R0+1]', registers: Array(8).fill('0'), memory: '0=10' },
  newest: { label: '最新生产者示例', program: 'ADD R1, R2, R3\nLOAD R1, [R0]\nADD R4, R1, R1', registers: ['0', '0', '2', '3', '0', '0', '0', '0'], memory: '0=10' },
};
export default {
  id: 'L011',
  create(root, ctx = {}) {
    root.classList.add('feature-l011');
    let draft = { ...EXAMPLES.load, registers: [...EXAMPLES.load.registers], forwarding: true };
    let result = null; let cursor = 0; let interval = null; let saveTimer = null; let destroyed = false; let exporting = false;
    let restoreNotice = '';
    const stored = ctx.config?.get(KEY);
    if (stored) {
      try {
        validateStoredState(stored);
        if (typeof stored.program !== 'string' || typeof stored.memory !== 'string' || typeof stored.forwarding !== 'boolean' || !Array.isArray(stored.registers) || stored.registers.length !== 8 || !stored.registers.every((value) => typeof value === 'string')) throw new Error('输入结构无效。');
        draft = { program: stored.program, memory: stored.memory, forwarding: stored.forwarding, registers: [...stored.registers] };
        if (stored.computed) { result = simulate(draft.program, { forwarding: draft.forwarding, registers: draft.registers, memory: parseMemory(draft.memory) }); cursor = Number.isInteger(stored.cursor) ? Math.max(0, Math.min(result.totalCycles - 1, stored.cursor)) : 0; }
        restoreNotice = '已恢复上次输入；周期结果按模型 five-stage-v1 重新计算。';
      } catch (error) { restoreNotice = `保存状态未能恢复：${error.message} 请重新输入，旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { role: 'status', 'aria-live': 'polite', class: 'l011-notice' }, restoreNotice);
    const storageNotice = h('div', { role: 'status', class: 'l011-storage' });
    const editor = h('div', { class: 'l011-editor' }); const display = h('div', { class: 'l011-output' });
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function pause() { if (interval !== null) clearInterval(interval); interval = null; }
    function persist() {
      if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState({ program: draft.program, memory: draft.memory, forwarding: draft.forwarding, registers: draft.registers, cursor, computed: !!result }); }
      catch (error) { storageNotice.textContent = `${error.message} 当前输入未写入全局配置；关闭后只能恢复较早输入。请导出完整 JSON；切走不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存输入失败：${error.message} 请导出记录。`, true)); }
      catch (error) { message(`保存输入失败：${error.message} 请导出记录。`, true); }
    }
    function changed() { pause(); result = null; cursor = 0; renderOutput(); if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
    function field(label, value, update, multiline = false, max = 30) {
      const input = h(multiline ? 'textarea' : 'input', { class: 'field', type: multiline ? null : 'text', rows: multiline ? '5' : null, maxlength: String(max), 'aria-label': label, oninput: () => { update(input.value); changed(); } });
      input.value = value;
      return h('label', { class: 'l011-field' }, h('span', {}, label), input);
    }
    function calculate() {
      pause();
      try { result = simulate(draft.program, { forwarding: draft.forwarding, registers: draft.registers, memory: parseMemory(draft.memory) }); cursor = 0; persist(); renderOutput(); message(`已计算 ${result.totalCycles} 周期，数据冒险停顿 ${result.stallCount} 次。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function renderEditor() {
      const forwarding = h('input', { type: 'checkbox', 'aria-label': '开启转发', onchange: () => { draft.forwarding = forwarding.checked; changed(); } }); forwarding.checked = draft.forwarding;
      editor.replaceChildren(
        h('div', { class: 'l011-actions' }, Object.values(EXAMPLES).map((example) => h('button', { class: 'btn', onclick: () => { pause(); draft = { program: example.program, memory: example.memory, registers: [...example.registers], forwarding: draft.forwarding }; result = null; cursor = 0; renderEditor(); calculate(); } }, example.label))),
        field('指令序列（最多40条）', draft.program, (value) => { draft.program = value; }, true, 10000),
        h('p', { class: 'l011-muted' }, 'ADD Rd,Rs,Rt · LOAD Rd,[Rb+偏移] · STORE Rs,[Rb+偏移]。R0–R7；偏移为十进制整数，可省略。# 或 // 为注释。'),
        h('div', { class: 'l011-register-inputs' }, h('span', {}, 'R0 = 0（恒零）'), draft.registers.slice(1).map((value, index) => field(`R${index + 1} 初值`, value, (next) => { draft.registers[index + 1] = next; }))),
        field('内存初值（每行 地址=整数）', draft.memory, (value) => { draft.memory = value; }, true, 5000),
        h('p', { class: 'l011-muted' }, '地址为0–255的字索引，未定义的字为0。数值使用安全整数，无32位回绕。'),
        h('div', { class: 'l011-actions' }, h('label', { class: 'l011-toggle' }, forwarding, '开启转发'), h('button', { class: 'btn primary', onclick: calculate }, '计算流水线')),
      );
    }
    function move(next) { if (!result) return; cursor = Math.max(0, Math.min(result.totalCycles - 1, next)); persist(); renderOutput(); }
    function togglePlay() {
      if (interval !== null) { pause(); renderOutput(); return; }
      if (!result) return;
      if (cursor === result.totalCycles - 1) cursor = 0;
      interval = setInterval(() => { if (destroyed || !result) { pause(); return; } if (cursor >= result.totalCycles - 1) { pause(); renderOutput(); return; } move(cursor + 1); if (cursor === result.totalCycles - 1) { pause(); renderOutput(); } }, 700);
      renderOutput();
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      const payload = { feature: 'L011', schemaVersion: 1, modelVersion: 'five-stage-v1', exportedAt: new Date().toISOString(), draft: { program: draft.program, registers: [...draft.registers], memory: draft.memory, forwarding: draft.forwarding }, result };
      try {
        const saved = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(result), extension, defaultName: `L011-pipeline.${extension}`, copyOnly: true });
        message(saved?.ok ? '已导出新文件；输入、初值、模型规则与完整周期记录可供复核。' : saved?.canceled ? '已取消导出，当前输入仍保留。' : `导出失败：${saved?.error || '未确认保存成功'}`, !saved?.ok && !saved?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    function renderOutput() {
      if (!result) { display.replaceChildren(h('p', {}, '编辑后请重新计算；JSON 可导出当前输入，周期记录需计算成功后生成。'), h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON')); return; }
      const frame = result.frames[cursor];
      const range = h('input', { type: 'range', min: '1', max: String(result.totalCycles), step: '1', 'aria-label': '查看周期', oninput: () => { pause(); move(Number(range.value) - 1); } }); range.value = String(cursor + 1);
      display.replaceChildren(
        h('div', { class: 'l011-summary' }, `转发${result.forwarding ? '开启' : '关闭'} · 总周期 ${result.totalCycles} · 停顿 ${result.stallCount} 次 · 当前 C${frame.cycle}`),
        h('div', { class: 'l011-actions' }, h('button', { class: 'btn', disabled: cursor === 0, onclick: () => { pause(); move(cursor - 1); } }, '上一周期'), h('button', { class: 'btn', onclick: togglePlay }, interval === null ? '自动播放' : '暂停'), h('button', { class: 'btn', disabled: cursor === result.totalCycles - 1, onclick: () => { pause(); move(cursor + 1); } }, '下一周期'), range),
        h('div', { class: 'l011-pipeline', 'aria-label': '当前周期五级状态' }, STAGES.map((stage) => h('div', { class: `l011-stage${stage === 'ID' && frame.stall ? ' is-stalled' : ''}` }, h('strong', {}, stage), h('span', {}, frame.stages[stage]?.id || '空泡'), h('small', {}, frame.stages[stage]?.text || '本周期无指令')))),
        h('div', { class: frame.stall ? 'l011-cause is-stalled' : 'l011-cause' }, frame.stall ? `停顿：${frame.stall.consumer} 的 ${frame.stall.register} 等待 ${frame.stall.producer}。${frame.stall.reason}` : '本周期无数据冒险停顿。'),
        h('ul', { class: 'l011-events' }, frame.events.map((event) => h('li', {}, event))),
        h('p', {}, `周期末寄存器：${frame.registers.map((value, index) => `R${index}=${value}`).join(' · ')}`),
        h('p', {}, `周期末内存：${Object.entries(frame.memory).map(([address, value]) => `M[${address}]=${value}`).join(' · ') || '全部未初始化字为0'}`),
        h('div', { class: 'l011-matrix-scroll' }, h('table', { class: 'l011-matrix' }, h('caption', {}, '完整时序矩阵：ID* 为停顿，IF同时冻结；点击周期表头跳转'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '指令'), result.frames.map((row) => h('th', { scope: 'col', class: row.cycle === frame.cycle ? 'is-current' : '' }, h('button', { onclick: () => { pause(); move(row.cycle - 1); }, 'aria-label': `跳转C${row.cycle}` }, `C${row.cycle}`))))), h('tbody', {}, result.matrix.map((row) => h('tr', {}, h('th', { scope: 'row' }, `${row.id} ${row.text}`), row.cells.map((cell, index) => h('td', { class: `${index === cursor ? 'is-current ' : ''}${cell === 'ID*' ? 'is-stalled' : ''}` }, cell || '·'))))))),
        h('p', {}, `最终结果：${result.final.registers.map((value, index) => `R${index}=${value}`).join(' · ')}；内存 ${Object.entries(result.final.memory).map(([address, value]) => `M[${address}]=${value}`).join(' · ') || '未初始化'}`),
        h('div', { class: 'l011-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出时序报告 Markdown')),
      );
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '指令流水线实验'), h('p', {}, '用一次可复现的五级实验，解释结果何时可用、为何插入空泡。'), notice, storageNotice, h('details', {}, h('summary', {}, '查看模型规则与保存范围'), Object.values(POLICY).map((rule) => h('p', {}, rule)), h('p', {}, '本机只保存不超过64KiB的输入与查看位置，恢复时重新计算；完整周期轨迹保存在导出文件中。播放不会在切走后继续。')), editor, display);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { pause(); persist(); if (!destroyed) renderOutput(); }, destroy() { pause(); persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l011'); } };
  },
};
