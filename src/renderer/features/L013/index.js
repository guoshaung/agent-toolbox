import { h } from '../../core/ui.js';
import { MODEL_VERSION, PAGE_SIZES, MAX_PAGES, MAX_ACCESSES, POLICY, STATUS_LABELS, example, translate, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L013.state';
export default {
  id: 'L013',
  create(root, ctx = {}) {
    root.classList.add('feature-l013');
    let draft = example(); let result = null; let selected = 0; let timer = null; let destroyed = false; let exporting = false; let restoreNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try { const state = validateStoredState(saved); draft = { pageSize: state.pageSize, pages: state.pages, accesses: state.accesses }; restoreNotice = '已恢复输入草稿；TLB与轨迹不写入配置，请重新运行或保留导出报告。'; }
      catch (error) { restoreNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l013-notice', role: 'status', 'aria-live': 'polite' }, restoreNotice);
    const storageNotice = h('div', { class: 'l013-storage', role: 'status' });
    const editor = h('div', { class: 'l013-editor' }); const output = h('div', { class: 'l013-output' });
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
    function changed() { result = null; selected = 0; renderOutput(); message('输入已改变：TLB及旧轨迹已清空，请重新运行。'); if (timer !== null) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function table(headers, rows, caption) { return h('div', { class: 'l013-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, rows))); }
    function numeric(row, key, label) {
      const control = h('input', { class: 'field', type: 'text', inputmode: 'text', maxlength: '24', 'aria-label': label, oninput: () => { row[key] = control.value; changed(); } }); control.value = row[key]; return control;
    }
    function boolean(row, key, label) {
      const control = h('input', { type: 'checkbox', 'aria-label': label, onchange: () => { row[key] = control.checked; changed(); } }); control.checked = row[key]; return control;
    }
    function load(kind) { draft = example(kind); changed(); renderEditor(); persist(); message('示例已载入，请运行地址翻译。'); }
    function renderEditor() {
      const size = h('select', { class: 'field', 'aria-label': '页大小', onchange: () => { draft.pageSize = size.value; changed(); } }, PAGE_SIZES.map((value) => h('option', { value: String(value) }, `${value}字节`))); size.value = draft.pageSize;
      replace(editor,
        h('div', { class: 'l013-actions' }, h('label', {}, '页大小 ', size), h('span', {}, '固定TLB：4项 · 全相联 · LRU')),
        h('div', { class: 'l013-actions' }, h('button', { class: 'btn', onclick: () => load('core') }, '载入公式示例'), h('button', { class: 'btn', onclick: () => load('faults') }, '载入异常示例'), h('button', { class: 'btn', onclick: () => load('lru') }, '载入 LRU 示例')),
        h('h3', {}, '单级页表'),
        table(['虚页号', '物理页号', '驻留 present', '可读', '可写', '操作'], draft.pages.map((row, index) => h('tr', {}, h('td', {}, numeric(row, 'virtualPage', `页表${index + 1}虚页号`)), h('td', {}, numeric(row, 'physicalPage', `页表${index + 1}物理页号`)), h('td', {}, boolean(row, 'present', `页表${index + 1}驻留`)), h('td', {}, boolean(row, 'read', `页表${index + 1}可读`)), h('td', {}, boolean(row, 'write', `页表${index + 1}可写`)), h('td', {}, h('button', { class: 'btn', onclick: () => { draft.pages.splice(index, 1); changed(); renderEditor(); } }, `删除页表 ${index + 1}`)))), `${draft.pages.length}/${MAX_PAGES}行；缺少行=未映射，有行但不驻留=缺页；页号由32位地址域和当前页大小限定`),
        h('button', { class: 'btn', disabled: draft.pages.length >= MAX_PAGES, onclick: () => { draft.pages.push({ virtualPage: '', physicalPage: '', present: true, read: true, write: true }); changed(); renderEditor(); } }, '添加映射'),
        h('h3', {}, '按顺序访问'),
        table(['顺序', '虚拟字节地址', '权限请求', '操作'], draft.accesses.map((row, index) => {
          const mode = h('select', { class: 'field', 'aria-label': `访问${index + 1}操作`, onchange: () => { row.mode = mode.value; changed(); } }, h('option', { value: 'read' }, '读 read'), h('option', { value: 'write' }, '写 write')); mode.value = row.mode;
          return h('tr', {}, h('th', { scope: 'row' }, String(index + 1)), h('td', {}, numeric(row, 'address', `访问${index + 1}地址`)), h('td', {}, mode), h('td', {}, h('button', { class: 'btn', onclick: () => { draft.accesses.splice(index, 1); changed(); renderEditor(); } }, `删除访问 ${index + 1}`)));
        }), `${draft.accesses.length}/${MAX_ACCESSES}次；地址支持十进制与0x十六进制；安全整数中的负数和大于4294967295数值展示越界异常`),
        h('div', { class: 'l013-actions' }, h('button', { class: 'btn', disabled: draft.accesses.length >= MAX_ACCESSES, onclick: () => { draft.accesses.push({ address: '', mode: 'read' }); changed(); renderEditor(); } }, '添加访问'), h('button', { class: 'btn primary', onclick: run }, '运行地址翻译')),
      );
    }
    function run() {
      try { result = translate(draft); selected = 0; persist(); renderOutput(); message(result.trace.length ? `已计算${result.trace.length}次访问，每轮TLB从空开始。逐步查看不会重新执行或改变结果。` : '没有访问；TLB为空，命中率未生成。'); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function pick(index) { if (!result?.trace.length || !Number.isInteger(index)) return; selected = Math.max(0, Math.min(result.trace.length - 1, index)); renderOutput(); }
    function tlbTable(entries, caption) {
      return table(['LRU顺序', '虚页', '物理页', '可读', '可写'], entries.length ? entries.map((row, index) => h('tr', {}, [index === 0 ? '最旧' : index === entries.length - 1 ? '最新' : String(index + 1), row.virtualPage, row.physicalPage, row.read ? '是' : '否', row.write ? '是' : '否'].map((cell) => h('td', {}, String(cell))))) : [h('tr', {}, h('td', { colspan: '5' }, 'TLB为空'))], caption);
    }
    function renderOutput() {
      const exports = h('div', { class: 'l013-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出完整 Markdown'));
      if (!result) { replace(output, h('p', {}, '当前没有有效轨迹，TLB为空；运行后逐步查看。可导出当前草稿。'), exports); return; }
      const frame = result.trace[selected]; const stats = result.stats;
      const selector = frame ? h('select', { class: 'field', 'aria-label': '查看访问步骤', onchange: () => pick(Number(selector.value)) }, result.trace.map((row, index) => h('option', { value: String(index) }, `第${row.step}次：${row.address} ${row.mode}`))) : null;
      if (selector) selector.value = String(selected);
      replace(output,
        h('div', { class: 'l013-summary' }, `成功 ${stats.translated} · 异常 ${stats.faults} · TLB命中 ${stats.hits}/${stats.lookups}（${stats.hitRate === null ? '无查询' : `${(stats.hitRate * 100).toFixed(2)}%`}）`),
        h('p', {}, '命中率只计算有效32位地址的查询，包括权限拒绝；越界不查询。异常数量包括所有拒绝访问，不代表同一种缺页。'),
        table(['查看', '虚地址', '操作', '虚页 / 偏移', '物理地址', '结果', 'TLB'], result.trace.map((row, index) => h('tr', { class: row.status === 'translated' ? 'is-ok' : 'is-fault' }, h('td', {}, h('button', { class: 'btn', onclick: () => pick(index) }, `查看第${row.step}次`)), [row.address, row.mode, row.virtualPage === null ? '未拆分' : `${row.virtualPage} / ${row.offset}`, row.physicalAddress ?? '无', STATUS_LABELS[row.status], row.lookup].map((cell) => h('td', {}, String(cell))))), '每次访问结果；无物理地址时明确显示“无”'),
        frame ? h('section', { class: 'l013-step' },
          h('div', { class: 'l013-actions' }, selector, h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上一步'), h('button', { class: 'btn', disabled: selected === result.trace.length - 1, onclick: () => pick(selected + 1) }, '下一步')),
          h('h3', {}, `第${frame.step}次 · ${STATUS_LABELS[frame.status]}`), h('ol', {}, frame.path.map((text) => h('li', {}, text))),
          h('p', {}, `TLB操作：${frame.action}${frame.evicted ? `；被替换虚页${frame.evicted.virtualPage}→物理页${frame.evicted.physicalPage}` : ''}`),
          h('div', { class: 'l013-tlb-pair' }, tlbTable(frame.before, '访问之前：最旧→最新'), tlbTable(frame.after, '访问之后：最旧→最新')),
        ) : h('p', {}, '没有访问，未生成命中率。'), exports,
      );
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L013', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)), result };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(payload), extension, defaultName: `L013-address-translation.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含完整草稿及当前轨迹。' : response?.canceled ? '已取消导出，输入与结果保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '页表地址翻译'), h('p', {}, '把地址拆分、页表异常与TLB缓存分开看。修改映射或访问后，从冷TLB重新计算。'), notice, storageNotice,
      h('details', {}, h('summary', {}, '教学规则、输入与保存范围'), h('p', {}, POLICY), h('p', {}, '单级页表；32位无符号字节地址。虚页=向下取整(地址/页大小)，偏移=余数，物理地址=物理页×页大小+偏移。只用精确安全整数算术，避免有符号位运算。'), h('p', {}, '检查顺序：地址范围→TLB/页表→是否映射→是否驻留→本次读写权限→翻译。缺页不触发OS调页；无多级页表、ASID、页替换或真实程序执行。'), h('p', {}, '最多64映射、128访问。只把≤64KiB版本化草稿写入配置；TLB、轨迹不持久化。切走无后台运行；JSON/Markdown导出完整副本并拒绝覆盖已有文件。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { persist(); }, destroy() { persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l013'); } };
  },
};
