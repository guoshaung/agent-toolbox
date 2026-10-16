import { h } from '../../core/ui.js';
import { LIMITS, parseDelimited, cleanTable, serializeTable, serializeReport } from './model.mjs';

const EXAMPLE = '姓名,城市,备注\r\n 张三,北京,首次报名\r\n李四 ,上海,"喜欢咖啡,茶"\r\n王五,广州,\r\n赵六,深圳,已核对\r\n钱七,杭州,已核对\r\n';
const CSS = `
.t002{height:100%;overflow:auto;padding:24px;max-width:1440px;margin:auto;color:var(--text)}
.t002 h2,.t002 h3{margin:0 0 10px}.t002 p{line-height:1.65}.t002__intro{color:var(--text-dim);margin:0 0 20px}
.t002__grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(280px,1fr);gap:20px}.t002__section{padding:18px 0;border-top:1px solid var(--line)}
.t002__row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}.t002__field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:140px}
.t002 textarea{width:100%;resize:vertical;min-height:220px;font-family:var(--mono);line-height:1.5}.t002 .field{background:var(--bg-sunken);border:1px solid var(--line);padding:9px;border-radius:6px}
.t002__check{display:flex;align-items:center;gap:7px;line-height:1.5}.t002__columns{display:flex;flex-wrap:wrap;gap:10px;max-height:150px;overflow:auto;padding:10px;background:var(--bg-sunken)}
.t002__note{color:var(--text-dim);font-size:12px}.t002__status{min-height:26px;margin:12px 0;color:var(--text-dim)}.t002__status[data-error=true]{color:var(--bad)}
.t002__stats{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0}.t002__stat strong{display:block;font-size:24px}.t002__stat span{font-size:12px;color:var(--text-dim)}
.t002__scroll{max-height:480px;overflow:auto;border:1px solid var(--line)}.t002 table{border-collapse:collapse;width:100%;font-size:12px}
.t002 th,.t002 td{text-align:left;vertical-align:top;padding:9px;max-width:240px;min-width:100px;border-bottom:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.t002 th{position:sticky;top:0;background:var(--bg-raised);z-index:1}.t002 td[data-changed=true]{background:var(--accent-soft)}.t002__empty{padding:18px;color:var(--text-dim)}
.t002__value{max-height:120px;overflow:auto;white-space:pre-wrap;font-family:var(--mono)}.t002 button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:820px){.t002__grid{grid-template-columns:1fr}.t002{padding:16px}}
`;
const prettyValue = value => value === '' ? '（空值）' : JSON.stringify(value);

export default {
  id: 'T002',
  create(root, _ctx) {
    let table = null, result = null, previewPage = 0, changesPage = 0, busy = false, destroyed = false;
    let controller = null, reader = null, sourceName = '表格';
    const pageSize = 25;
    const wrapper = h('div', { class: 't002' });
    const status = h('div', { class: 't002__status', role: 'status', 'aria-live': 'polite' });
    const source = h('textarea', { class: 'field', 'aria-label': 'CSV 或 TSV 原始内容', spellcheck: 'false', placeholder: '粘贴表格文本，或选择一个 UTF-8 的 CSV / TSV 文件。', oninput: () => { sourceName = '表格'; invalidate(true); } });
    const delimiter = h('select', { class: 'field', 'aria-label': '分隔符', onchange: () => invalidate(true) }, h('option', { value: ',' }, 'CSV：逗号'), h('option', { value: '\t' }, 'TSV：制表符'));
    const header = h('input', { type: 'checkbox', checked: true, onchange: () => invalidate(true) });
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain', 'aria-label': '选择表格文件', onchange: () => loadFile(file.files?.[0]) });
    const columnBox = h('div', { class: 't002__columns' }, '先解析表格，再选择需要清洗的列。');
    const columnInputs = [];
    const trim = h('input', { type: 'checkbox', checked: true, onchange: () => invalidate() });
    const collapse = h('input', { type: 'checkbox', onchange: () => invalidate() });
    const nfkc = h('input', { type: 'checkbox', onchange: () => invalidate() });
    const letterCase = h('select', { class: 'field', 'aria-label': '大小写规则', onchange: () => invalidate() }, ...[['preserve', '保持大小写'], ['lower', '转为小写'], ['upper', '转为大写']].map(([value, label]) => h('option', { value }, label)));
    const fill = h('input', { type: 'checkbox', onchange: () => { fillValue.disabled = !fill.checked; invalidate(); } });
    const fillValue = h('input', { class: 'field', type: 'text', maxlength: 1000, disabled: true, 'aria-label': '空值替换文本', placeholder: '例如：未填写', oninput: () => invalidate() });
    const blankRows = h('select', { class: 'field', 'aria-label': '空行规则', onchange: () => invalidate() }, h('option', { value: 'keep' }, '整行空值：保留'), h('option', { value: 'drop' }, '整行空值：移除'));
    const duplicateRows = h('select', { class: 'field', 'aria-label': '重复行规则', onchange: () => invalidate() }, h('option', { value: 'keep' }, '完全重复行：保留'), h('option', { value: 'drop' }, '完全重复行：保留首次，移除后续'));
    const includeLine = h('input', { type: 'checkbox', checked: true });
    const bom = h('input', { type: 'checkbox', checked: true });
    const outputName = h('input', { class: 'field', type: 'text', maxlength: 120, value: '表格.cleaned.csv', 'aria-label': '副本文件名' });
    const previewHost = h('div');
    const changeHost = h('div');
    const statsHost = h('div', { class: 't002__stats' });
    const cancelButton = h('button', { class: 'btn', hidden: true, onclick: () => cancel() }, '取消处理');
    const parseButton = h('button', { class: 'btn', onclick: () => parseInput() }, '1. 解析并选择列');
    const previewButton = h('button', { class: 'btn btn--primary', disabled: true, onclick: () => preview() }, '2. 生成清洗预览');
    const saveButton = h('button', { class: 'btn btn--primary', disabled: true, onclick: () => saveCopy(false) }, '3. 保存结果副本');
    const reportButton = h('button', { class: 'btn', disabled: true, onclick: () => saveCopy(true) }, '保存变更清单');
    const sampleButton = h('button', { class: 'btn btn--sm', onclick: () => { source.value = EXAMPLE; sourceName = '示例'; delimiter.value = ','; header.checked = true; file.value = ''; invalidate(true); setStatus('示例含 5 条数据、2 个首尾空白单元格。解析后用默认规则预览。'); } }, '载入五行示例');
    const selectAll = h('button', { class: 'btn btn--sm', onclick: () => selectColumns(true) }, '全选');
    const selectNone = h('button', { class: 'btn btn--sm', onclick: () => selectColumns(false) }, '清空选择');
    const check = (input, label) => h('label', { class: 't002__check' }, input, label);
    const field = (label, element) => h('label', { class: 't002__field' }, h('span', {}, label), element);
    wrapper.append(
      h('style', {}, CSS),
      h('h2', {}, '表格脏数据清洗'),
      h('p', { class: 't002__intro' }, '选择列、核对变化，再保存副本。数据留在本机；默认只去首尾空白，不删除任何数据行。'),
      h('div', { class: 't002__grid' },
        h('section', { class: 't002__section' }, h('h3', {}, '原始表格'), file, h('div', { class: 't002__row' }, field('分隔符', delimiter), check(header, '首行为表头'), sampleButton), source, h('p', { class: 't002__note' }, 'UTF-8，可带 BOM；支持引号内逗号、双引号转义和多行字段。最多 5 MiB、10,000 条数据、100 列、100,000 个单元格。'), h('div', { class: 't002__row' }, parseButton)),
        h('section', { class: 't002__section' }, h('h3', {}, '清洗规则'), h('div', { class: 't002__row' }, h('span', {}, '只处理选中的列'), selectAll, selectNone), columnBox, h('div', { class: 't002__row' }, check(trim, '去首尾空白'), check(collapse, '连续空白合并成一个空格'), check(nfkc, '兼容字符规范化（如全角Ａ → A）')), letterCase, h('div', { class: 't002__row' }, check(fill, '将空值替换为'), fillValue), h('div', { class: 't002__row' }, field('整行空值', blankRows), field('完全重复行', duplicateRows)), h('p', { class: 't002__note' }, '规则顺序：首尾空白 → 连续空白 → 字符规范化 → 大小写 → 空值替换。空值是空字符串，NULL / null / 0 都不自动当空值。空行与重复按清洗后整行判断，先移除空行。表头保持原样。'), h('div', { class: 't002__row' }, previewButton))),
      h('div', { class: 't002__row' }, cancelButton), status,
      h('section', { class: 't002__section' }, h('h3', {}, '结果预览'), statsHost, previewHost),
      h('section', { class: 't002__section' }, h('h3', {}, '逐格变更与移除记录'), changeHost),
      h('section', { class: 't002__section' }, h('h3', {}, '导出副本'), h('div', { class: 't002__row' }, field('默认文件名（保存对话框中选择目录）', outputName), check(includeLine, '附加原始物理行号列'), check(bom, 'UTF-8 BOM（便于 Excel 打开）')), h('div', { class: 't002__row' }, saveButton, reportButton), h('p', { class: 't002__note' }, '保存前核对上方结果，保存对话框展示最终路径。副本保护会拒绝任何已存在的目标；原文件不写入。变更清单包含原值和新值，请按原始数据的私密程度保管。'))
    );
    root.replaceChildren(wrapper);
    renderResult(); syncControls();

    function setStatus(message, error = false) { if (destroyed) return; status.textContent = message; status.dataset.error = String(error); }
    function canSave() { return window.toolbox?.files?.saveTextSupportsCopyOnly === true && typeof window.toolbox?.files?.saveText === 'function'; }
    function syncControls() {
      for (const control of wrapper.querySelectorAll('input,textarea,select,button')) control.disabled = busy;
      for (const control of wrapper.querySelectorAll('[data-page-disabled]')) control.disabled = busy || control.dataset.pageDisabled === 'true';
      cancelButton.disabled = false; cancelButton.hidden = !busy;
      fillValue.disabled = busy || !fill.checked;
      previewButton.disabled = busy || !table;
      saveButton.disabled = busy || !result || (!result.header && !result.rows.length) || !canSave();
      reportButton.disabled = busy || !result || !canSave();
      selectAll.disabled = selectNone.disabled = busy || !table;
    }
    function invalidate(reparse = false) {
      result = null; previewPage = changesPage = 0;
      if (reparse) { table = null; columnInputs.length = 0; columnBox.replaceChildren('输入已更新，请重新解析并选择列。'); }
      setStatus(reparse ? '请先解析当前输入。' : '规则已更新，请重新生成预览。');
      renderResult(); syncControls();
    }
    function selectColumns(value) { for (const input of columnInputs) input.checked = value; invalidate(); }
    function cancel() { if (!controller && !reader) return; controller?.abort(); reader?.abort(); setStatus('已取消当前处理，已保存的副本不受影响。'); }
    async function run(message, action) {
      if (busy || destroyed) return;
      const job = new AbortController(); controller = job; busy = true; syncControls(); setStatus(message);
      try { return await action(job.signal); }
      catch (error) { setStatus(error.name === 'AbortError' ? '已取消当前处理，原始表格未改动。' : error.message || String(error), error.name !== 'AbortError'); return null; }
      finally { if (controller === job) { controller = null; reader = null; busy = false; if (!destroyed) syncControls(); } }
    }
    async function loadFile(selected) {
      if (!selected) return;
      if (selected.size > LIMITS.bytes) { file.value = ''; setStatus('文件超过 5 MiB，请拆分后导入。', true); return; }
      await run('正在读取本地文件…', async signal => {
        const buffer = await new Promise((resolve, reject) => {
          reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('文件读取失败，请检查访问权限。'));
          reader.onabort = () => { const error = new Error('已取消读取。'); error.name = 'AbortError'; reject(error); };
          reader.readAsArrayBuffer(selected);
        });
        if (signal.aborted || destroyed) return;
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
        catch { throw new Error('文件不是有效 UTF-8，请用编辑器另存为 UTF-8 后导入；不会猜测或损坏原文件。'); }
        source.value = text; sourceName = selected.name.replace(/\.[^.]+$/u, '') || '表格';
        if (/\.tsv$/iu.test(selected.name)) delimiter.value = '\t';
        else if (/\.csv$/iu.test(selected.name)) delimiter.value = ',';
        invalidate(true); setStatus(`已读取 ${selected.name}，请解析并选择列。`);
      });
    }
    async function parseInput() {
      table = result = null; renderResult();
      await run('正在解析表格…', async signal => {
        const parsed = await parseDelimited(source.value, { delimiter: delimiter.value, header: header.checked }, { signal, onProgress: value => setStatus(`正在解析表格… ${Math.round(value * 100)}%`) });
        if (signal.aborted || destroyed) return;
        table = parsed; columnInputs.length = 0;
        outputName.value = `${sourceName}.cleaned.${parsed.delimiter === '\t' ? 'tsv' : 'csv'}`;
        columnBox.replaceChildren(...table.columns.map(column => {
          const input = h('input', { type: 'checkbox', checked: true, onchange: () => invalidate() });
          columnInputs.push(input);
          return check(input, `${column.index + 1}. ${column.label}`);
        }));
        setStatus(`已解析 ${table.records.length} 条数据、${table.columns.length} 列。选择规则后生成预览。`);
      });
    }
    function rules() {
      return { columns: columnInputs.flatMap((input, index) => input.checked ? [index] : []), trim: trim.checked, collapseWhitespace: collapse.checked, nfkc: nfkc.checked, letterCase: letterCase.value, fillEmpty: fill.checked, fillValue: fillValue.value, blankRows: blankRows.value, duplicateRows: duplicateRows.value };
    }
    async function preview() {
      if (!table) return;
      result = null; renderResult();
      await run('正在生成预览…', async signal => {
        const cleaned = await cleanTable(table, rules(), { signal, onProgress: value => setStatus(`正在生成预览… ${Math.round(value * 100)}%`) });
        if (signal.aborted || destroyed) return;
        result = cleaned; previewPage = changesPage = 0; renderResult();
        setStatus(canSave() ? '预览已更新，核对结果后可保存副本。' : '预览已更新；当前应用缺少副本保护保存接口，请更新基础工作台后导出。', !canSave());
      });
    }
    function pager(total, page, onPage) {
      const pages = Math.max(1, Math.ceil(total / pageSize));
      return h('div', { class: 't002__row' }, h('button', { class: 'btn btn--sm', disabled: page === 0, dataset: { pageDisabled: String(page === 0) }, onclick: () => onPage(Math.max(0, page - 1)) }, '上一页'), h('span', { class: 't002__note' }, `第 ${page + 1} / ${pages} 页，共 ${total} 条；每页 ${pageSize} 条`), h('button', { class: 'btn btn--sm', disabled: page + 1 >= pages, dataset: { pageDisabled: String(page + 1 >= pages) }, onclick: () => onPage(Math.min(pages - 1, page + 1)) }, '下一页'));
    }
    function renderResult() {
      statsHost.replaceChildren(); previewHost.replaceChildren(); changeHost.replaceChildren();
      if (!result) { previewHost.append(h('p', { class: 't002__empty' }, '生成预览后，这里展示清洗结果；蓝色单元格表示值发生变化。')); changeHost.append(h('p', { class: 't002__empty' }, '每项记录保留源文件物理行号、列位置、原值和新值。')); return; }
      for (const [key, label] of [['inputRows', '原始数据行'], ['outputRows', '保留数据行'], ['changedCells', '变化单元格'], ['changedRows', '变化数据行'], ['removedBlankRows', '移除空行'], ['removedDuplicateRows', '移除重复行']]) statsHost.append(h('div', { class: 't002__stat' }, h('strong', {}, result.stats[key]), h('span', {}, label)));
      const changed = new Set(result.changes.map(change => `${change.sourceLine}:${change.columnIndex - 1}`));
      const tableView = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '源物理行'), ...result.columns.map((column, index) => h('th', {}, `${index + 1}. ${column.label}`)))), h('tbody', {}, ...result.rows.slice(previewPage * pageSize, (previewPage + 1) * pageSize).map(row => h('tr', {}, h('td', {}, row.sourceLine), ...row.cells.map((cell, index) => h('td', { 'data-changed': String(changed.has(`${row.sourceLine}:${index}`)) }, h('div', { class: 't002__value', title: prettyValue(cell) }, cell === '' ? '（空值）' : cell)))))));
      previewHost.append(h('div', { class: 't002__scroll' }, tableView), pager(result.rows.length, previewPage, page => { previewPage = page; renderResult(); }));
      const audit = [...result.changes.map(change => ({ ...change, kind: '修改' })), ...result.removed.map(change => ({ ...change, kind: '移除' }))];
      if (!audit.length) changeHost.append(h('p', { class: 't002__empty' }, '没有单元格变化，也没有移除数据行。'));
      else changeHost.append(h('div', { class: 't002__scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['类型 / 源物理行', '位置 / 原因', '原值', '新值 / 保留源行'].map(title => h('th', {}, title)))), h('tbody', {}, ...audit.slice(changesPage * pageSize, (changesPage + 1) * pageSize).map(change => h('tr', {}, h('td', {}, `${change.kind} / ${change.sourceLine}`), h('td', {}, change.kind === '修改' ? `第 ${change.columnIndex} 列 ${change.column}\n${change.reasons.join('、')}` : change.reason), h('td', {}, h('div', { class: 't002__value' }, change.kind === '修改' ? prettyValue(change.before) : '整行')), h('td', {}, h('div', { class: 't002__value' }, change.kind === '修改' ? prettyValue(change.after) : change.duplicateOf ? `保留源行 ${change.duplicateOf}` : '—'))))))), pager(audit.length, changesPage, page => { changesPage = page; renderResult(); }));
    }
    async function saveCopy(audit) {
      if (!result || !canSave()) return;
      await run('正在准备副本…', async signal => {
        const extension = audit ? 'json' : result.delimiter === '\t' ? 'tsv' : 'csv';
        const suggested = `${sourceName}.cleaned.${extension}`;
        let name = audit ? `${sourceName}.changes.json` : (outputName.value.trim() || suggested);
        if (/[\\/:*?"<>|\r\n]/u.test(name) || name === '.' || name === '..') throw new Error('副本文件名不能包含路径或文件名保留字符，请使用单独文件名。');
        if (!name.toLowerCase().endsWith(`.${extension}`)) name += `.${extension}`;
        const content = audit ? await serializeReport(result, { sourceName, rules: rules() }, { signal }) : await serializeTable(result, { includeSourceLine: includeLine.checked, bom: bom.checked }, { signal });
        if (new TextEncoder().encode(content).length > LIMITS.outputBytes) throw new Error('导出超过 12 MiB 上限，请拆分数据。');
        if (signal.aborted || destroyed) return;
        // copyOnly is enforced by the main-process writer, never a UI-only promise.
        cancelButton.hidden = true;
        setStatus('请在保存对话框中选择新的副本路径；选择取消可停止保存。');
        const saved = await window.toolbox.files.saveText({ content, extension, defaultName: name, copyOnly: true });
        if (destroyed) return;
        if (saved?.ok) setStatus(`副本已保存：${saved.path}`);
        else if (saved?.canceled) setStatus('已取消保存，未写入文件。');
        else throw new Error(saved?.error || '保存失败，未确认副本写入成功。');
      });
    }
    return {
      activate() { if (!destroyed) syncControls(); },
      deactivate() { cancel(); },
      destroy() { cancel(); destroyed = true; source.value = ''; table = result = null; root.replaceChildren(); },
    };
  },
};
