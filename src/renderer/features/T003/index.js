import { h } from '../../core/ui.js';
import { LIMITS, EXAMPLE, parseDataset, reconcile, previewRows, serializeReport, checkAbort } from './model.mjs';
const css = `.t003{display:grid;gap:14px;color:var(--text);max-width:1200px;margin:auto}.t003 label{display:grid;gap:6px}.t003 input,.t003 textarea,.t003 select{background:var(--bg-sunken);color:var(--text);padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit}.t003 textarea{font-family:monospace;resize:vertical;width:100%;box-sizing:border-box}.t003 .t003-sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.t003 .t003-side{display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:8px}.t003 .t003-row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.t003 .t003-row label{flex:1;min-width:170px}.t003 .t003-muted{color:var(--text-dim);font-size:13px;line-height:1.6}.t003 .t003-status{background:var(--bg-sunken);padding:10px;border-radius:6px;white-space:pre-wrap}.t003 .t003-scroll{overflow:auto;max-height:460px}.t003 table{border-collapse:collapse;width:100%;font-size:13px}.t003 td,.t003 th{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;white-space:pre-wrap;min-width:70px;max-width:300px;overflow-wrap:anywhere}.t003 th{position:sticky;top:0;background:var(--bg-raised)}.t003 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t003 button:disabled{opacity:.5}@media(max-width:850px){.t003 .t003-sides{grid-template-columns:1fr}}`;
const clip = (text, size = 240) => text.length > size ? text.slice(0, size) + '…' : text;
const label = (text, control) => h('label', {}, text, control);
const button = (text, action, primary = false) => h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', onclick: action }, text);
const valueText = part => part.present ? JSON.stringify(part.value) : '∅（字段不存在）';
const sourceText = source => source ? `${source.name} · 记录${source.row} · 物理行${source.line}` : '∅';
const keyText = key => key ? `${key.type}: ${JSON.stringify(key.value)}` : '无有效主键';

async function readUTF8(file, signal) {
  if (file.size > LIMITS.bytes) throw new Error('每份文件最多2 MiB。');
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.onload = () => { cleanup(); resolve(reader.result); };
    reader.onerror = () => { cleanup(); reject(new Error('文件读取失败。')); };
    reader.onabort = () => { cleanup(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
  checkAbort(signal);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { throw new Error('文件不是有效UTF-8，未替换当前输入；请先转换编码。'); }
}

export default {
  id: 'T003',
  create(root) {
    let alive = true, busy = false, operation = null, parsed = null, report = null, rows = [], page = 0, conflictPage = 0;
    const inputs = ['旧数据', '新数据'].map(title => ({
      name: h('input', { 'aria-label': `${title}名称`, value: title, maxlength: 120 }),
      format: h('select', { 'aria-label': `${title}格式` }, h('option', { value: 'json' }, 'JSON对象数组'), h('option', { value: 'csv' }, 'CSV（逗号）'), h('option', { value: 'tsv' }, 'TSV（制表符）')),
      text: h('textarea', { 'aria-label': `${title}内容`, rows: 10, placeholder: '粘贴记录，或从UTF-8文件导入。' }),
      file: h('input', { 'aria-label': `${title}文件`, type: 'file', accept: '.json,.csv,.tsv,.txt' }), raw: null
    }));
    const key = h('input', { 'aria-label': '顶层主键字段', value: 'id', maxlength: LIMITS.stringChars });
    const suggested = h('select', { 'aria-label': '已解析字段候选' }, h('option', { value: '' }, '解析两侧后选择字段'));
    const status = h('div', { role: 'status', 'aria-live': 'polite', class: 't003-status' }, '载入示例或两份数据，先解析，再选择主键对账。');
    const sourcePreview = h('div'), resultHost = h('div'), conflictHost = h('div'), detailsHost = h('div');
    const files = window.toolbox?.files;
    const safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = text => { if (alive) status.textContent = text; };
    const setBusy = value => {
      busy = value; if (!alive) return;
      for (const element of panel.querySelectorAll('input,textarea,select,button')) element.disabled = value;
      cancel.disabled = !value;
      if (!value) {
        compare.disabled = !parsed;
        json.disabled = csv.disabled = !report || !safeSave();
        suggested.disabled = !parsed;
        for (const element of panel.querySelectorAll('[data-page-disabled]')) element.disabled = element.dataset.pageDisabled === 'true';
      }
    };
    const clearReport = () => { report = null; rows = []; page = conflictPage = 0; resultHost.replaceChildren(); conflictHost.replaceChildren(); detailsHost.replaceChildren(); setBusy(false); };
    const invalidate = () => {
      parsed = null; clearReport(); sourcePreview.replaceChildren(); suggested.replaceChildren(h('option', { value: '' }, '解析两侧后选择字段')); suggested.value = ''; setBusy(false); say('输入已改变，请重新解析两侧。');
    };
    for (const input of inputs) {
      input.name.addEventListener('input', invalidate); input.format.addEventListener('change', invalidate); input.text.addEventListener('input', () => { input.raw = null; invalidate(); });
      input.file.addEventListener('change', async () => {
        const file = input.file.files?.[0]; if (!file || busy) return;
        const controller = new AbortController(); operation = controller; setBusy(true); say(`正在读取${file.name}…`);
        try {
          const text = await readUTF8(file, controller.signal); if (!alive) return;
          if (file.name.length > 120) throw new Error('文件名超过120字符，请缩短文件名。');
          input.text.value = text; input.raw = text; input.name.value = file.name;
          if (/\.csv$/iu.test(file.name)) input.format.value = 'csv'; else if (/\.tsv$/iu.test(file.name)) input.format.value = 'tsv'; else if (/\.json$/iu.test(file.name)) input.format.value = 'json';
          invalidate(); say(`已载入${file.name}，请核对格式并解析。`);
        } catch (error) { say(error.message); }
        finally { input.file.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
      });
    }
    key.addEventListener('input', () => { clearReport(); say('主键已改变，请重新对账。'); });
    suggested.addEventListener('change', () => { if (suggested.value) { key.value = suggested.value; clearReport(); say('已选择主键，请对账。'); } });
    const example = button('载入增删改示例', () => {
      inputs[0].text.value = EXAMPLE.old; inputs[1].text.value = EXAMPLE.new;
      inputs.forEach((input, index) => { input.raw = null; input.name.value = index ? 'new.json' : 'old.json'; input.format.value = 'json'; });
      key.value = 'id'; invalidate(); say('示例：旧键1/2，新键2/3；预计移除1、新增3、修改2。');
    });
    const parse = button('解析两侧数据', async () => {
      if (busy) return;
      invalidate(); const controller = new AbortController(); operation = controller; setBusy(true);
      try {
        const datasets = [];
        for (const [index, input] of inputs.entries()) { say(`正在解析${index ? '新' : '旧'}数据…`); datasets.push(await parseDataset({ name: input.name.value, format: input.format.value, text: input.raw ?? input.text.value }, { signal: controller.signal })); }
        if (!alive) return; parsed = datasets;
        const fields = [...new Set(datasets.flatMap(dataset => dataset.fields))].sort();
        suggested.replaceChildren(h('option', { value: '' }, '选择候选字段（也可手动输入）'), ...fields.map(name => h('option', { value: name }, clip(name, 100)))); suggested.value = '';
        sourcePreview.replaceChildren(...datasets.map((dataset, index) => h('div', {}, h('h3', {}, `${index ? '新' : '旧'}数据已解析：${dataset.name}`),
          h('p', { class: 't003-muted' }, `${dataset.records.length}条记录；字段 ${dataset.fields.map(name => clip(name, 80)).join('、') || '无'}。前3条来源预览：`),
          ...dataset.records.slice(0, 3).map(record => h('p', {}, `${sourceText(record.source)}：${clip(JSON.stringify(record.value), 400)}`)))));
        say('两侧解析完成。核对字段，选择顶层主键后执行对账。');
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const inspect = row => detailsHost.replaceChildren(h('h3', {}, '完整字段差异'), h('pre', {}, JSON.stringify(row, null, 2)));
    const pager = (current, total, action) => {
      const back = button('上一页', () => action(current - 1)), next = button('下一页', () => action(current + 1));
      back.dataset.pageDisabled = String(current === 0); next.dataset.pageDisabled = String(current >= total - 1);
      back.disabled = current === 0; next.disabled = current >= total - 1;
      return h('div', { class: 't003-row' }, back, h('span', {}, `第${current + 1}/${total}页`), next);
    };
    const renderConflicts = () => {
      const pages = Math.max(1, Math.ceil(report.conflicts.length / 10)); conflictPage = Math.max(0, Math.min(conflictPage, pages - 1));
      conflictHost.replaceChildren(h('h3', {}, '主键冲突（排除于正常对账）'), report.conflicts.length ? h('div', {},
        ...report.conflicts.slice(conflictPage * 10, conflictPage * 10 + 10).map(conflict => h('div', { class: 't003-side' }, h('strong', {}, `${conflict.kind} · ${clip(keyText(conflict.key))}`), h('p', {}, conflict.reason),
          ...['old', 'new'].map(side => h('p', {}, `${side === 'old' ? '旧侧' : '新侧'} ${conflict[side].length}行：${conflict[side].slice(0, 20).map(record => `${sourceText(record.source)} ${clip(JSON.stringify(record.value), 160)}`).join('\n')}${conflict[side].length > 20 ? '\n…更多冲突行保留在完整详情和导出中' : ''}`)),
          button('完整冲突记录', () => detailsHost.replaceChildren(h('h3', {}, '完整冲突记录（未挑选任何一行参与比较）'), h('pre', {}, JSON.stringify(conflict, null, 2)))))),
        pager(conflictPage, pages, next => { conflictPage = next; renderConflicts(); setBusy(false); })) : h('p', { class: 't003-muted' }, '无冲突。'));
    };
    const renderResults = () => {
      const pages = Math.max(1, Math.ceil(rows.length / 25)); page = Math.max(0, Math.min(page, pages - 1)); const stats = report.stats;
      resultHost.replaceChildren(h('h3', {}, '对账结果'), h('p', {}, `新增${stats.added} · 移除${stats.removed} · 修改${stats.modified} · 未变${stats.unchanged} · 冲突${stats.conflictGroups}组（旧${stats.conflictOldRows}行/新${stats.conflictNewRows}行）`),
        h('div', { class: 't003-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['类别', '主键及类型', '旧来源', '新来源', '字段路径', '之前', '之后', '详情'].map(title => h('th', {}, title)))),
          h('tbody', {}, ...rows.slice(page * 25, page * 25 + 25).map(row => h('tr', {}, h('td', {}, ({ added: '新增', removed: '移除', modified: '修改' })[row.kind]), h('td', {}, clip(keyText(row.key))),
            h('td', {}, sourceText(row.oldSource)), h('td', {}, sourceText(row.newSource)), h('td', {}, clip(row.path || '根路径（整条记录）')), h('td', {}, clip(valueText(row.before))), h('td', {}, clip(valueText(row.after))), h('td', {}, button('完整差异', () => inspect(row)))))))),
        pager(page, pages, next => { page = next; renderResults(); setBusy(false); }));
      renderConflicts();
    };
    const compare = button('按主键对账', async () => {
      if (!parsed || busy) return;
      clearReport(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在按主键建立索引并比较字段…');
      try {
        const compared = await reconcile(parsed[0], parsed[1], key.value, { signal: controller.signal }); if (!alive) return;
        report = compared; rows = previewRows(report); renderResults(); say('对账完成。冲突行未参与增删改；请核对预览后保存报告副本。');
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const cancel = button('取消当前操作', () => operation?.abort());
    const save = async format => {
      if (!report || busy || !safeSave()) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say('正在生成报告副本…');
      try {
        const content = await serializeReport(report, format, { signal: controller.signal }); if (!alive || controller.signal.aborted) return;
        const response = await files.saveText({ content, extension: format, defaultName: `dataset-reconciliation-copy.${format}`, copyOnly: true });
        if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存报告副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = button('保存完整 JSON 副本', () => save('json')), csv = button('保存差异与冲突 CSV 副本', () => save('csv'));
    const panel = h('section', { class: 't003' }, h('style', {}, css), h('h2', {}, '两份数据集对账'),
      h('p', { class: 't003-muted' }, '按业务主键比较，记录顺序不影响结果。全部处理在本机完成，不上传或覆盖原文件。每侧最多2 MiB/5000条记录。文件导入保留原始换行；手动编辑后使用文本框返回的换行。'), example,
      h('div', { class: 't003-sides' }, ...inputs.map((input, index) => h('div', { class: 't003-side' }, h('h3', {}, index ? '新数据' : '旧数据'), label('来源名称', input.name), label('明确输入格式', input.format), label('UTF-8文件导入', input.file), label('粘贴或编辑记录', input.text)))),
      parse, sourcePreview, h('div', { class: 't003-row' }, label('主键字段（仅单个顶层字段，大小写敏感）', key), label('候选字段', suggested)),
      h('p', { class: 't003-muted' }, '严格比较类型：JSON数字1与字符串"1"是不同主键；CSV/TSV每格均为字符串，不推断数字。主键可为非空字符串、数字或布尔值，缺失/null/纯空白/对象/数组为冲突。重复键的两侧全部记录都隔离；不挑选其中一行。字符串不修剪、不转大小写；对象属性顺序忽略、数组顺序保留；字段缺失与null不同，空字符串与null也不同。'),
      h('div', { class: 't003-row' }, compare, cancel), status, resultHost, conflictHost, detailsHost,
      h('div', { class: 't003-row' }, json, csv), h('p', { class: 't003-muted' }, '字段路径采用JSON Pointer（/转为~1，~转为~0），空路径为整条记录。CSV包含每个字段差异及每条冲突记录；字符串以JSON字面量转义，缺失由present=false表示。先核对预览，再在保存对话框选择新路径；不能覆盖已有文件。系统保存对话框打开后用其取消按钮关闭。'),
      !safeSave() ? h('p', { class: 't003-muted' }, '当前环境缺少副本保护接口，导出已禁用。') : null);
    root.replaceChildren(panel); setBusy(false);
    return { activate() {}, deactivate() { operation?.abort(); }, destroy() { alive = false; operation?.abort(); operation = null; root.replaceChildren(); } };
  }
};
