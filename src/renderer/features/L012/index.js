import { h } from '../../core/ui.js';
import { MODEL_VERSION, POLICY, simulate, compareSameCapacity, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L012.state';
const EXAMPLES = [
  { title: '同块三次示例', source: '0, 1, 3', blockSize: 4, setCount: 2, ways: 1 },
  { title: '直接映射冲突示例', source: '0, 8, 0', blockSize: 4, setCount: 2, ways: 1 },
  { title: 'LRU 替换示例', source: '0, 8, 0, 16, 8', blockSize: 4, setCount: 2, ways: 2 },
  { title: '相同容量比较示例', source: '0, 16, 0, 32, 16', blockSize: 4, setCount: 2, ways: 2 },
];
const rate = (result) => `${result.hits}/${result.total}（${(result.hitRate * 100).toFixed(2)}%）`;
export default {
  id: 'L012',
  create(root, ctx = {}) {
    root.classList.add('feature-l012');
    let draft = { ...EXAMPLES[0] }; let result = null; let comparison = null; let cursor = 0; let before = false;
    let interval = null; let saveTimer = null; let destroyed = false; let exporting = false; let restoredNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try {
        validateStoredState(saved);
        if (typeof saved.source !== 'string' || ![saved.blockSize, saved.setCount, saved.ways].every((value) => typeof value === 'number')) throw new Error('保存输入结构无效。');
        draft = { source: saved.source, blockSize: saved.blockSize, setCount: saved.setCount, ways: saved.ways }; before = saved.before === true;
        if (saved.computed) { result = simulate(draft.source, draft); cursor = Number.isInteger(saved.cursor) ? Math.max(0, Math.min(result.total - 1, saved.cursor)) : 0; if (saved.compared) comparison = compareSameCapacity(draft.source, draft); }
        restoredNotice = '已恢复输入；已计算实验按 read-cache-lru-v1 从冷缓存重新生成轨迹。';
      } catch (error) { restoredNotice = `保存状态未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { role: 'status', 'aria-live': 'polite', class: 'l012-notice' }, restoredNotice);
    const storageNotice = h('div', { role: 'status', class: 'l012-storage' });
    const editor = h('div', { class: 'l012-editor' }); const output = h('div', { class: 'l012-output' });
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function pause() { if (interval !== null) clearInterval(interval); interval = null; }
    function persist() {
      if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState({ source: draft.source, blockSize: draft.blockSize, setCount: draft.setCount, ways: draft.ways, cursor, before, computed: !!result, compared: !!comparison }); }
      catch (error) { storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早输入；请导出完整JSON，切走不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存输入失败：${error.message} 请导出记录。`, true)); }
      catch (error) { message(`保存输入失败：${error.message} 请导出记录。`, true); }
    }
    function changed() { pause(); result = null; comparison = null; cursor = 0; renderOutput(); if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
    function select(label, value, values, update) {
      const control = h('select', { class: 'field', 'aria-label': label, onchange: () => { update(Number(control.value)); changed(); } }, values.map((option) => h('option', { value: String(option.value) }, option.label)));
      control.value = String(value); return h('label', { class: 'l012-field' }, h('span', {}, label), control);
    }
    function renderEditor() {
      const source = h('textarea', { class: 'field', rows: '4', maxlength: '10000', 'aria-label': '读取地址序列', oninput: () => { draft.source = source.value; changed(); } }); source.value = draft.source;
      editor.replaceChildren(
        h('div', { class: 'l012-actions' }, EXAMPLES.map((example) => h('button', { class: 'btn', onclick: () => { pause(); draft = { ...example }; cursor = 0; before = false; comparison = null; renderEditor(); calculate(); if (example === EXAMPLES[3]) compare(); } }, example.title))),
        h('label', { class: 'l012-field' }, h('span', {}, '读取地址序列（1–256次）'), source),
        h('p', { class: 'l012-muted' }, '十进制或0x十六进制无符号字节地址，使用空格、换行或逗号分隔；#、//后为注释。只读取，不模拟写策略。'),
        h('div', { class: 'l012-parameters' },
          select('块大小（字节）', draft.blockSize, [1, 2, 4, 8, 16, 32, 64, 128, 256].map((value) => ({ value, label: `${value} B` })), (value) => { draft.blockSize = value; }),
          select('组数', draft.setCount, [1, 2, 4, 8, 16, 32, 64].map((value) => ({ value, label: String(value) })), (value) => { draft.setCount = value; }),
          select('映射方式', draft.ways, [{ value: 1, label: '直接映射（1路）' }, { value: 2, label: '两路组相联（LRU）' }], (value) => { draft.ways = value; }),
        ),
        h('p', { class: 'l012-muted' }, '容量=块大小×组数×路数；最多64行，两路时组数最多32。每次计算均从空缓存开始。'),
        h('button', { class: 'btn primary', onclick: calculate }, '从冷缓存计算'),
      );
    }
    function calculate() {
      pause(); comparison = null;
      try { result = simulate(draft.source, draft); cursor = 0; persist(); renderOutput(); message(`已计算${result.total}次读取；命中率 ${rate(result)}。`); }
      catch (error) { result = null; renderOutput(); message(error.message, true); }
    }
    function compare() {
      pause();
      try { if (!result) throw new Error('请先成功计算当前输入。'); comparison = compareSameCapacity(draft.source, draft); persist(); renderOutput(); message('两种映射均从冷缓存开始，块大小和容量完全一致。'); }
      catch (error) { message(error.message, true); }
    }
    function move(next) { if (!result) return; cursor = Math.max(0, Math.min(result.total - 1, next)); persist(); renderOutput(); }
    function play() {
      if (interval !== null) { pause(); renderOutput(); return; }
      if (!result) return; if (cursor === result.total - 1) cursor = 0;
      interval = setInterval(() => { if (destroyed || !result) { pause(); return; } move(cursor + 1); if (cursor === result.total - 1) { pause(); renderOutput(); } }, 700); renderOutput();
    }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      exporting = true;
      try {
        const payload = { feature: 'L012', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: { source: draft.source, blockSize: draft.blockSize, setCount: draft.setCount, ways: draft.ways }, result, comparison };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(result, comparison), extension, defaultName: `L012-cache.${extension}`, copyOnly: true });
        message(response?.ok ? '已导出新文件，包含完整逐步缓存记录。' : response?.canceled ? '已取消导出，实验仍保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    function table(headers, rows, caption) { return h('div', { class: 'l012-table-scroll' }, h('table', {}, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map((header) => h('th', { scope: 'col' }, header)))), h('tbody', {}, rows))); }
    function renderOutput() {
      if (!result) { output.replaceChildren(h('p', {}, '请重新计算当前输入；JSON可先导出草稿，轨迹需计算成功后生成。'), h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON')); return; }
      const frame = result.frames[cursor];
      const range = h('input', { type: 'range', min: '1', max: String(result.total), step: '1', 'aria-label': '查看访问次序', oninput: () => { pause(); move(Number(range.value) - 1); } }); range.value = String(cursor + 1);
      const showBefore = h('input', { type: 'checkbox', 'aria-label': '显示访问前缓存', onchange: () => { before = showBefore.checked; persist(); renderOutput(); } }); showBefore.checked = before;
      const snapshot = before ? frame.before : frame.after;
      const rows = snapshot.flatMap((ways, set) => {
        const order = ways.map((line, way) => ({ line, way })).filter(({ line }) => line.valid).sort((a, b) => a.line.lastAccess - b.line.lastAccess).map(({ way }) => way);
        return ways.map((line, way) => h('tr', { class: set === frame.set && way === frame.way ? 'is-current' : '' }, [set, way, line.valid ? '有效' : '空', line.tag ?? '·', line.block ?? '·', line.valid ? `${line.block * result.config.blockSize}–${line.block * result.config.blockSize + result.config.blockSize - 1}` : '·', line.lastAccess ?? '·', line.valid ? order.length === 1 ? '唯一有效路' : way === order[0] ? 'LRU' : 'MRU' : '·'].map((cell) => h('td', {}, String(cell)))));
      });
      output.replaceChildren(
        h('div', { class: 'l012-summary' }, `${result.config.setCount}组×${result.config.ways}路 · 块${result.config.blockSize}B · 容量${result.config.capacityBytes}B · 命中 ${rate(result)}`),
        h('div', { class: 'l012-actions' }, h('button', { class: 'btn', disabled: cursor === 0, onclick: () => { pause(); move(cursor - 1); } }, '上一次访问'), h('button', { class: 'btn', onclick: play }, interval === null ? '自动播放' : '暂停'), h('button', { class: 'btn', disabled: cursor === result.total - 1, onclick: () => { pause(); move(cursor + 1); } }, '下一次访问'), range),
        h('div', { class: `l012-access ${frame.hit ? 'is-hit' : 'is-miss'}` }, h('strong', {}, `第${frame.step}次：地址${frame.address} → ${frame.hit ? 'hit 命中' : 'miss 未命中'}`), h('p', {}, `块${frame.block}（字节${frame.blockRange[0]}–${frame.blockRange[1]}） → 组${frame.set} · 标签${frame.tag} · 偏移${frame.offset} · 路${frame.way}`), h('p', {}, frame.reason), h('p', {}, `截至本次：命中${frame.hits}/${frame.step}，未命中${frame.misses}；${frame.evicted ? `替换块${frame.evicted.block}，其上次访问是第${frame.evicted.lastAccess}次` : '本次没有替换有效块'}`)),
        h('label', { class: 'l012-toggle' }, showBefore, '显示访问前缓存（默认显示访问后）'),
        table(['组', '路', '有效位', '标签', '块号', '字节范围', '上次访问', '访问次序'], rows, `第${frame.step}次访问${before ? '前' : '后'}的全缓存；描边为本次选中的路，LRU是本组最久未访问的有效路`),
        table(['跳转', '字节地址', '块', '组', '标签', '偏移', '路', '命中', '替换块'], result.frames.map((row) => h('tr', { class: row.step === frame.step ? 'is-current' : '' }, h('td', {}, h('button', { onclick: () => { pause(); move(row.step - 1); }, 'aria-label': `跳转第${row.step}次` }, String(row.step))), [row.address, row.block, row.set, row.tag, row.offset, row.way, row.hit ? 'hit' : 'miss', row.evicted?.block ?? '无'].map((cell) => h('td', {}, String(cell))))), '完整访问轨迹：点击次序可以复核填充和替换'),
        h('button', { class: 'btn', onclick: compare }, '比较相同容量的两种映射'),
        comparison ? table(['方式', '组×路', '容量', '命中', '未命中'], [comparison.direct, comparison.twoWay].map((row) => h('tr', {}, [row.config.ways === 1 ? '直接映射' : '两路LRU', `${row.config.setCount}×${row.config.ways}`, `${row.config.capacityBytes}B`, rate(row), row.misses].map((cell) => h('td', {}, String(cell))))), '相同块大小、相同总行数/容量、相同地址序列、各自冷缓存；命中差异不保证对所有序列成立') : document.createDocumentFragment(),
        h('div', { class: 'l012-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出轨迹 Markdown')),
      );
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '缓存命中实验'), h('p', {}, '把字节地址映射到缓存块，观察一次命中如何改变下一次LRU替换。'), notice, storageNotice, h('details', {}, h('summary', {}, '模型规则与保存范围'), Object.values(POLICY).map((rule) => h('p', {}, rule)), h('p', {}, '全局配置只保存≤64KiB的输入和查看位置，不保存轨迹；恢复重新计算。JSON导出完整前后状态和比较结果。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { pause(); persist(); if (!destroyed) renderOutput(); }, destroy() { pause(); persist(); destroyed = true; root.replaceChildren(); root.classList.remove('feature-l012'); } };
  },
};
