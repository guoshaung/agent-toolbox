import { h } from '../../core/ui.js';
import { DataError, LIMITS, parseSource, processData } from './model.mjs';

export default {
  id: 'T092',
  create(root) {
    let active = false; let destroyed = false; let generation = 0; let pending = false; let exporting = false;
    let parsed = null; let policy = []; let columnControls = []; let result = null; let failureReport = null; let preview = null;
    const style = h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href });
    const status = h('p', { role: 'status', 'aria-live': 'polite', class: 't092-status' });
    const source = h('textarea', { rows: '9', 'aria-label': '源数据', placeholder: '粘贴 CSV 或扁平 JSON 记录数组', oninput: () => changedSource() });
    const format = h('select', { 'aria-label': '输入格式', onchange: () => changedSource() }, h('option', { value: 'csv' }, 'CSV'), h('option', { value: 'json' }, 'JSON')); format.value = 'csv';
    const file = h('input', { type: 'file', accept: '.csv,.json,.txt', 'aria-label': '读取一个 UTF-8 文件', onchange: e => readFile(e.target) });
    const parseButton = button('解析字段', parse);
    const runButton = button('生成新的处理结果', run);
    const cancelButton = button('取消处理', () => invalidate(false, '已取消处理，未保留部分结果。'));
    const columnsHost = h('div', { class: 't092-columns' });
    const resultHost = h('section', { class: 't092-result' });
    const previewHost = h('section', { class: 't092-preview' });
    const shell = h('section', { class: 'feature-t092', 'aria-label': '结构数据匿名化' },
      h('h2', {}, '结构数据匿名化'), h('p', {}, '选字段、看结果，再保存新副本。原输入仅留在当前面板内存；不会上传或写入配置。'),
      h('div', { class: 't092-inputs' }, field('输入格式', format), field('从文件读取，严格 UTF-8', file)), source,
      h('p', { class: 't092-muted' }, '输入 1 MiB、5000 行、100 列；JSON 只接受字段齐全的扁平记录数组。JSON 数值不接受指数写法，最多 15 位有效数字和 6 位小数。CSV 所有输入值均为字符串，表头不能重复或含首尾空白。'),
      h('div', { class: 't092-actions' }, parseButton, button('填入邮箱演示', example), button('清除源数据和结果', clear)),
      status, columnsHost,
      h('p', { class: 't092-rule' }, '保留列及字段名会原样进入副本，请逐列确认。伪名仅在本次处理内关联，再次生成会改变；没有映射或密钥导出。伪名和分桶仍可能重新识别个人，不能保证全表匿名。'),
      h('p', { class: 't092-muted' }, '分桶以零为边界，区间左闭右开；桶宽 0.01–1000000，值 -1000000–1000000，最多两位小数。空值、空白、非数值或更多小数将使整次处理失败并按行列编号列出，原值不进入审计。'),
      h('div', { class: 't092-actions' }, runButton, cancelButton), resultHost, previewHost,
      h('p', { class: 't092-muted' }, '仅本地处理，无 AI、账号或网络依赖。每次最多 20000 个不同伪名输入，结果每种格式最多 8 MiB。切换功能会清除当前内存；隐藏或暂停会取消处理，不自动重启。'));
    root.append(style, shell); update();
    function field(label, input) { return h('label', {}, h('span', {}, label), input); }
    function button(label, fn) { return h('button', { type: 'button', onclick: e => { if (!active || destroyed || document.hidden || e.detail > 1) return; fn(); } }, label); }
    function message(text) { if (!destroyed) status.textContent = text; }
    function invalidate(dropParsed, text = '') {
      generation++; result = null; failureReport = null; preview = null; resultHost.replaceChildren(); previewHost.replaceChildren();
      if (dropParsed) { parsed = null; policy = []; columnControls = []; columnsHost.replaceChildren(); }
      update(); if (text) message(pending ? `${text} 等待此前异步任务结束。` : text);
    }
    function changedSource() { if (!active || destroyed) return; invalidate(true, '源数据或格式已修改，请重新解析。'); }
    function update() { if (destroyed) return; source.disabled = !active; format.disabled = !active; file.disabled = !active || pending; parseButton.disabled = !active || pending; runButton.disabled = !active || pending || !parsed; cancelButton.disabled = !active || !pending; columnControls.forEach(({ choice, width, index }) => { choice.disabled = !active; width.disabled = !active || policy[index].type !== 'bucket'; }); }
    function parse() {
      if (pending) return; invalidate(true);
      try { parsed = parseSource(source.value, format.value); policy = parsed.columns.map(() => ({ type: 'keep', width: '10' })); renderColumns(); message(`已解析 ${parsed.rows.length} 行、${parsed.columns.length} 列。默认保留，请选择需要处理的列。`); }
      catch (error) { message(error instanceof DataError ? error.message : '解析失败，未生成字段或结果。'); }
      update();
    }
    function renderColumns() {
      columnsHost.replaceChildren(); columnControls = []; if (!parsed) return; const owner = parsed;
      const table = h('table', {}, h('thead', {}, h('tr', {}, ['审计编号', '字段', '策略', '桶宽'].map(t => h('th', {}, t)))));
      const body = h('tbody', {});
      parsed.columns.forEach((name, i) => {
        const id = `C${String(i + 1).padStart(3, '0')}`;
        const choice = h('select', { 'aria-label': `${id} 处理策略`, onchange: e => {
          if (!active || destroyed || parsed !== owner) return; policy[i].type = e.target.value; width.disabled = policy[i].type !== 'bucket'; invalidate(false, '列策略已修改，旧结果已废弃。');
        } }, [['keep', '保留原值'], ['delete', '删除字段'], ['bucket', '固定宽度分桶'], ['pseudo', '本次一致伪名']].map(([value, title]) => h('option', { value }, title))); choice.value = policy[i].type;
        const width = h('input', { type: 'text', inputmode: 'decimal', maxlength: '12', value: policy[i].width, 'aria-label': `${id} 桶宽`, oninput: e => {
          if (!active || destroyed || parsed !== owner) return; policy[i].width = e.target.value; invalidate(false, '桶宽已修改，旧结果已废弃。');
        } }); width.disabled = policy[i].type !== 'bucket';
        columnControls.push({ choice, width, index: i }); body.append(h('tr', {}, h('td', {}, id), h('td', {}, name), h('td', {}, choice), h('td', {}, width)));
      }); table.append(body); columnsHost.append(h('h3', {}, '逐列策略'), table);
    }
    async function run() {
      if (!parsed || pending) return; invalidate(false); const ticket = generation; const input = parsed; const policies = policy.map(p => ({ ...p })); pending = true; update(); message('本地处理中，可以取消；本次使用新随机密钥。');
      try {
        const next = await processData(input, policies, { isCanceled: () => destroyed || ticket !== generation || !active || document.hidden, onProgress: progress => { if (ticket === generation && !destroyed) message(`已处理 ${progress.processed}/${progress.total} 行。`); } });
        if (ticket !== generation || destroyed) return; result = next; renderResult(); message(`已生成 ${next.rows.length} 行、${next.columns.length} 列；尚未保存。请查看预览。`);
      } catch (error) {
        if (ticket !== generation || destroyed) return;
        message(error instanceof DataError ? error.message : '处理失败，未生成副本。');
        if (error instanceof DataError && error.audit.length) {
          failureReport = error.report;
          resultHost.append(h('h3', {}, '未匹配审计（无原值）'), h('ul', {}, error.audit.map(item => h('li', {}, `行 ${item.row} · ${item.column} · ${item.reason}`))));
          if (failureReport) resultHost.append(button('预览处理报告', () => makePreview('report')));
        }
      } finally { if (!destroyed) { pending = false; update(); } }
    }
    function renderResult() {
      resultHost.replaceChildren(); if (!result) return;
      const table = h('table', {}, h('thead', {}, h('tr', {}, result.columns.map(name => h('th', {}, name)))), h('tbody', {}, result.rows.slice(0, 20).map(row => h('tr', {}, row.map(value => h('td', {}, value === null ? 'null（JSON 空值）' : String(value)))))));
      resultHost.append(h('h3', {}, '处理后数据预览'), h('p', {}, `共 ${result.rows.length} 行，只在表格展示前 20 行。保留原值的列：${result.report.preservedColumns}。完整内容请使用下方文本预览。`), h('div', { class: 't092-scroll' }, table),
        h('div', { class: 't092-actions' }, button('预览 JSON 数据副本', () => makePreview('json')), button('预览 CSV 数据副本', () => makePreview('csv')), button('预览处理报告', () => makePreview('report'))));
    }
    function makePreview(kind) {
      if (pending || (!result && !(kind === 'report' && failureReport))) return;
      preview = { content: kind === 'report' ? JSON.stringify(result?.report || failureReport, null, 2) : result[kind], extension: kind === 'csv' ? 'csv' : 'json', defaultName: kind === 'report' ? 'T092-processing-report.json' : `T092-processed.${kind}` };
      renderPreview(); message('已准备完整副本预览；请确认内容后保存，目标路径在原生对话框选择。');
    }
    function renderPreview() {
      previewHost.replaceChildren(); if (!preview) return;
      const text = h('textarea', { rows: '12', readonly: true, 'aria-label': '新副本完整预览' }); text.value = preview.content;
      const save = button(exporting ? '正在保存…' : '保存当前预览新副本', savePreview); save.disabled = exporting;
      previewHost.append(h('h3', {}, '完整导出预览'), h('p', {}, `拟创建：${preview.defaultName}。实际目标路径在原生保存对话框确认；已存在的文件不会被覆盖。`), text, save);
    }
    async function savePreview() {
      if (!preview || pending || exporting) return;
      const files = window.toolbox?.files;
      if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') { message('当前宿主缺少支持副本保护的文本保存接口，已阻止导出。'); return; }
      const selected = preview; const ticket = generation; exporting = true; renderPreview();
      try {
        const saved = await files.saveText({ ...selected, copyOnly: true });
        if (destroyed || ticket !== generation || preview !== selected) return;
        if (saved?.ok === true) message('已保存新副本，源输入保留在当前内存。');
        else if (saved?.canceled === true) message('已取消保存；预览和结果保留。');
        else message('保存失败；预览和结果保留，可重试。');
      } catch { if (!destroyed && ticket === generation && preview === selected) message('保存失败；预览和结果保留，可重试。'); }
      finally { if (!destroyed) { exporting = false; renderPreview(); } }
    }
    async function readFile(input) {
      const selected = input.files?.[0]; input.value = ''; if (!active || destroyed || document.hidden || !selected || pending) return;
      invalidate(true); const ticket = generation; pending = true; update(); message('读取本次选择的文件；可取消，不保存原路径。');
      try {
        if (!Number.isSafeInteger(selected.size) || selected.size < 0 || selected.size > LIMITS.inputBytes) throw new DataError('fileSize', '文件超过 1 MiB 或大小无效，未读取。');
        if (typeof selected.arrayBuffer !== 'function') throw new DataError('fileAPI', '当前环境缺少 File.arrayBuffer，请粘贴 UTF-8 文本。');
        const buffer = await selected.arrayBuffer(); if (destroyed || ticket !== generation || !active || document.hidden) return;
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== selected.size) throw new DataError('fileSize', '读取字节数与文件声明不一致，未导入。');
        let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new DataError('utf8', '文件不是有效 UTF-8，未导入；不会尝试猜测编码。'); }
        if (/\x00/.test(text)) throw new DataError('binary', '文件含零字节，按非文本处理，未导入。');
        source.value = text; if (/\.json$/i.test(selected.name || '')) format.value = 'json'; else if (/\.csv$/i.test(selected.name || '')) format.value = 'csv'; message('已读入内存。请确认格式并解析字段。');
      } catch (error) { if (!destroyed && ticket === generation) message(error instanceof DataError ? error.message : '文件读取失败，未导入。'); }
      finally { if (!destroyed) { pending = false; update(); } }
    }
    function clear() { source.value = ''; file.value = ''; invalidate(true, '源数据、字段策略和结果已清除。'); }
    function example() { invalidate(true); format.value = 'csv'; source.value = 'email,age,note\nana@example.test,23,第一行\nana@example.test,29,同一用户\nbo@example.test,-1,另一用户\n'; parse(); }
    function hide() { if (document.hidden && !destroyed) { if (pending) invalidate(false, '面板隐藏，处理已取消；返回后请重新生成。'); else generation++; } }
    document.addEventListener('visibilitychange', hide);
    return {
      activate() { if (destroyed) return; active = true; update(); },
      deactivate() { active = false; if (pending) invalidate(false, '面板已暂停，处理已取消。'); else { generation++; update(); } },
      destroy() { if (destroyed) return; destroyed = true; active = false; generation++; source.value = ''; file.value = ''; parsed = null; policy = []; columnControls = []; result = null; failureReport = null; preview = null; document.removeEventListener('visibilitychange', hide); root.replaceChildren(); }
    };
  }
};
