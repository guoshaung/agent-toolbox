import { h } from '../../core/ui.js';
import { LIMITS, EXAMPLE, EXAMPLE_CONFIG, POLICY, parseJSON, predictFlatten, executeFlatten, serializeFlatten, checkAbort } from './model.mjs';
const css = `.t010{display:grid;gap:12px;color:var(--text);max-width:1200px;margin:auto}.t010 label{display:grid;gap:6px}.t010 input,.t010 textarea,.t010 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.t010 textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace}.t010 .t010-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.t010 .t010-row>label{flex:1;min-width:160px}.t010 .t010-card{padding:12px;border:1px solid var(--line);border-radius:8px;display:grid;gap:8px}.t010 .t010-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t010 .t010-status{padding:10px;background:var(--bg-sunken);white-space:pre-wrap}.t010 .t010-scroll{overflow:auto;max-height:420px}.t010 td,.t010 th{padding:8px;border-bottom:1px solid var(--line);min-width:100px;max-width:350px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;vertical-align:top}.t010 table{border-collapse:collapse;width:100%;font-size:13px}.t010 th{position:sticky;top:0;background:var(--bg-raised)}.t010 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t010 button:disabled{opacity:.5}`;
const label = (title, element) => h('label', {}, title, element);
const button = (title, action, primary = false) => h('button', { class: primary ? 'btn btn--primary' : 'btn', type: 'button', onclick: action }, title);
const clip = (value, size = 200) => value.length > size ? value.slice(0, size) + '…' : value;
async function readUTF8(file, signal) {
  if (file.size > LIMITS.bytes) throw new Error('文件超过2 MiB。');
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader(), clean = () => signal.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    reader.onload = () => { clean(); resolve(reader.result); }; reader.onerror = () => { clean(); reject(new Error('文件读取失败。')); }; reader.onabort = () => { clean(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
  checkAbort(signal); try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw new Error('文件不是有效UTF-8，当前输入未替换。'); }
}
export default {
  id: 'T010',
  create(root) {
    let mappings = [{ column: 'parent_id', scope: 'parent', path: '/id' }, { column: 'item_value', scope: 'element', path: '' }], raw = null, prediction = null, report = null, page = 0, alive = true, busy = false, operation = null;
    const name = h('input', { 'aria-label': 'JSON来源名称', value: '层级数据', maxlength: 120 });
    const file = h('input', { type: 'file', accept: '.json,.txt', 'aria-label': '选择层级JSON文件' });
    const text = h('textarea', { 'aria-label': '层级JSON内容', rows: 8, placeholder: '[{"id":"P1","items":["A","B"]}]' });
    const parentPath = h('input', { 'aria-label': '父记录JSON Pointer', value: '', maxlength: 512, placeholder: '根数组留空；例如 /records' });
    const arrayPath = h('input', { 'aria-label': '父内数组JSON Pointer', value: '/items', maxlength: 512 });
    const strategy = h('select', { 'aria-label': '数组处理策略' }, h('option', { value: 'expand' }, '单数组展开：一元素一行'), h('option', { value: 'preserve' }, '保留：一父记录一行，数组为JSON列'));
    const arrayColumn = h('input', { 'aria-label': '保留数组输出列名', value: 'items_json', maxlength: 80 });
    const configHost = h('div'), predicted = h('div'), output = h('div'), detail = h('div');
    const status = h('div', { class: 't010-status', role: 'status', 'aria-live': 'polite' }, '配置父记录路径、单个数组路径与字段映射，再预测行数并执行。');
    const files = window.toolbox?.files, safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = value => { if (alive) status.textContent = value; };
    const setBusy = value => {
      busy = value; if (!alive) return;
      for (const control of panel.querySelectorAll('input,textarea,select,button')) control.disabled = value;
      cancel.disabled = !value;
      if (!value) {
        execute.disabled = !prediction; json.disabled = csv.disabled = audit.disabled = !report || !safeSave();
        arrayColumn.disabled = strategy.value !== 'preserve'; add.disabled = mappings.length >= LIMITS.mappings;
        for (const control of panel.querySelectorAll('[data-page-disabled]')) control.disabled = control.dataset.pageDisabled === 'true';
      }
    };
    const clearReport = () => { report = null; page = 0; output.replaceChildren(); detail.replaceChildren(); };
    const invalidate = () => { prediction = null; clearReport(); predicted.replaceChildren(); setBusy(false); say('输入或映射已改变，旧预测与报告已废弃，请重新预测。'); };
    name.addEventListener('input', invalidate); text.addEventListener('input', () => { raw = null; invalidate(); });
    for (const control of [parentPath, arrayPath, arrayColumn]) control.addEventListener('input', invalidate);
    strategy.addEventListener('change', invalidate);
    const renderConfig = () => {
      configHost.replaceChildren(...mappings.map((mapping, index) => {
        const column = h('input', { 'aria-label': `映射${index + 1}输出列名`, value: mapping.column, maxlength: 80, oninput: event => { mapping.column = event.currentTarget.value; invalidate(); } });
        const scope = h('select', { 'aria-label': `映射${index + 1}范围`, onchange: event => { mapping.scope = event.currentTarget.value; invalidate(); } }, h('option', { value: 'parent' }, '父记录'), h('option', { value: 'element' }, '当前数组元素')); scope.value = mapping.scope;
        const path = h('input', { 'aria-label': `映射${index + 1}JSON Pointer`, value: mapping.path, maxlength: 512, placeholder: '留空表示整个当前范围', oninput: event => { mapping.path = event.currentTarget.value; invalidate(); } });
        return h('div', { class: 't010-card' }, h('div', { class: 't010-row' }, label('输出列名（唯一）', column), label('字段范围', scope), label('相对范围的JSON Pointer', path)), button(`移除映射${index + 1}`, () => { mappings.splice(index, 1); invalidate(); renderConfig(); }));
      })); setBusy(busy);
    };
    const add = button('添加映射列', () => {
      if (mappings.length >= LIMITS.mappings) return;
      let index = 1; while (mappings.some(mapping => mapping.column === `column_${index}`) || arrayColumn.value === `column_${index}`) index++;
      mappings.push({ column: `column_${index}`, scope: 'parent', path: '/id' }); invalidate(); renderConfig();
    });
    const example = button('载入两父记录三元素示例', () => {
      raw = null; name.value = 'flatten-example.json'; text.value = EXAMPLE; parentPath.value = EXAMPLE_CONFIG.parentPath; arrayPath.value = EXAMPLE_CONFIG.arrayPath; strategy.value = EXAMPLE_CONFIG.strategy; arrayColumn.value = EXAMPLE_CONFIG.arrayColumn;
      mappings = EXAMPLE_CONFIG.mappings.map(mapping => ({ ...mapping })); invalidate(); renderConfig(); say('示例：P1含A、B，P2含C；预计3行，每行保留parent_id与tags_json。');
    });
    const config = () => ({ parentPath: parentPath.value, arrayPath: arrayPath.value, strategy: strategy.value, arrayColumn: arrayColumn.value, mappings: mappings.map(mapping => ({ ...mapping })) });
    const predict = button('预测输出与风险', async () => {
      if (busy) return; invalidate(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在严格解析并预测输出与丢弃风险…');
      try {
        const parsed = await parseJSON({ name: name.value, text: raw ?? text.value }, { signal: controller.signal });
        const result = await predictFlatten(parsed, config(), { signal: controller.signal }); if (!alive) return;
        prediction = result;
        predicted.replaceChildren(h('h3', {}, `预测：${result.parentCount}父记录 → ${result.rowCount}输出行`), h('p', {}, `未映射叶路径${result.audit.discardedLeafPaths}个（含父路径之外）；不会自动保留未选字段。`),
          h('p', { class: 't010-muted' }, '请核对预测后按下执行。缺失/null/空数组各保留一条有标记父行；只展开已选单数组。保留策略必须手动移除或改为父范围的元素映射。'),
          h('ul', {}, ...result.audit.parents.slice(0, 20).map(parent => h('li', {}, `父${parent.parentIndex} · 物理行${parent.parentLine} · ${parent.arrayState} · 数组长${parent.arrayLength} → ${parent.predictedRows}行；未映射父路径：${parent.discardedParentPaths.slice(0, 8).join('、') || '无'}${parent.discardedParentPaths.length > 8 ? '…' : ''}`))),
          button('查看完整预测审计', () => detail.replaceChildren(h('h3', {}, '完整预测审计'), h('pre', {}, JSON.stringify(prediction.audit, null, 2)))));
        say(`预测完成：${result.rowCount}行，丢弃${result.audit.discardedLeafPaths}个未映射叶路径。请核对后执行。`);
      } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const renderResult = () => {
      const pages = Math.max(1, Math.ceil(report.rows.length / 25)); page = Math.max(0, Math.min(page, pages - 1));
      const back = button('上一页', () => { page--; renderResult(); setBusy(false); }), next = button('下一页', () => { page++; renderResult(); setBusy(false); });
      back.dataset.pageDisabled = String(page === 0); next.dataset.pageDisabled = String(page >= pages - 1);
      const valueText = (row, column) => {
        if (row.missingColumns.includes(column)) return '∅ missing'; const value = row.values[column];
        return (row.jsonLiteralColumns.includes(column) ? 'JSON字面量：' : '') + (typeof value === 'string' ? JSON.stringify(clip(value)) : JSON.stringify(value));
      };
      const tableRows = report.rows.slice(page * 25, page * 25 + 25).map((row, index) => h('tr', {},
        h('td', {}, `${row.source.name} · 父${row.source.parentIndex}/物理行${row.source.parentLine} · 元素${row.source.arrayIndex ?? '∅'}/行${row.source.elementLine ?? '∅'}`),
        h('td', {}, `${row.source.arrayState} · 元素存在=${row.source.elementPresent}`), ...report.columns.map(column => h('td', {}, valueText(row, column.column))),
        h('td', {}, button(`查看输出行${page * 25 + index + 1}`, () => detail.replaceChildren(h('h3', {}, '完整输出行'), h('pre', {}, JSON.stringify(row, null, 2)))))));
      output.replaceChildren(h('h3', {}, `已执行：${report.rowCount}行 · 与预测一致`),
        h('div', { class: 't010-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['父来源与元素序号', '数组状态', ...report.columns.map(column => column.column), '完整行'].map(title => h('th', {}, title)))), h('tbody', {}, ...tableRows))),
        h('div', { class: 't010-row' }, back, h('span', {}, `第${page + 1}/${pages}页，每页25行；显示值最多200单位，副本完整。`), next));
    };
    const execute = button('按预测执行扁平化', async () => {
      if (!prediction || busy) return; clearReport(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在按已核对的映射执行…');
      try { const result = await executeFlatten(prediction, { signal: controller.signal }); if (!alive) return; report = result; renderResult(); say('执行完成。完整JSON含映射与丢弃审计；CSV为扁平表，请同时保存审计JSON。'); }
      catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const save = async format => {
      if (!report || busy || !safeSave()) return; const controller = new AbortController(); operation = controller; setBusy(true); say('正在生成完整副本…');
      try {
        const content = await serializeFlatten(report, format, { signal: controller.signal }); if (!alive || controller.signal.aborted) return;
        const extension = format === 'csv' ? 'csv' : 'json', defaultName = format === 'audit' ? 'flatten-audit-copy.json' : `flatten-table-copy.${extension}`;
        cancel.disabled = true; say('已生成副本，正在等待另存对话框；请在对话框中确认目标或取消。');
        const response = await files.saveText({ content, extension, defaultName, copyOnly: true });
        if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = button('保存完整 JSON 副本', () => save('json')), csv = button('保存扁平 CSV 副本', () => save('csv')), audit = button('保存完整审计 JSON 副本', () => save('audit'));
    const cancel = button('取消当前操作', () => operation?.abort());
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected || busy) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say(`正在读取${selected.name}…`);
      try { const imported = await readUTF8(selected, controller.signal); if (!alive) return; if (selected.name.length > 120) throw new Error('文件名超过120字符。'); raw = imported; text.value = imported; name.value = selected.name; invalidate(); say('文件已导入，请重新预测；原始换行保留用于来源追溯。'); }
      catch (error) { say(error.message); } finally { file.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
    });
    const panel = h('section', { class: 't010' }, h('style', {}, css), h('h2', {}, '层级数据扁平化映射'),
      h('p', { class: 't010-muted' }, '完全本地处理，不上传、不改原文件。输入最多2 MiB、5000父记录、30映射列、10000输出行/100000单元格；超限整批拒绝，不截断。切换具体功能会丢失未保存内容。'),
      h('div', { class: 't010-row' }, label('来源名称', name), label('UTF-8 JSON文件', file)), label('嵌套JSON内容', text), example,
      h('div', { class: 't010-row' }, label('父记录路径（必须为对象数组）', parentPath), label('相对父记录的单数组路径', arrayPath)),
      h('div', { class: 't010-row' }, label('展开/保留策略', strategy), label('保留策略额外数组列名', arrayColumn)),
      h('p', { class: 't010-muted' }, 'JSON Pointer：/a/b；属性名中的 / 用~1，~用~0。映射空路径表示当前范围根值；数组索引0基固定，不会和展开序号联动。列名唯一且至少有一列来自父记录。'),
      h('h3', {}, '输出映射'), configHost, add, h('div', { class: 't010-row' }, predict, execute, cancel), status, predicted, output,
      h('p', { class: 't010-muted' }, Object.values(POLICY).join('。')),
      h('p', { class: 't010-muted' }, 'CSV包含9个来源/类型标记列。数据单元格内容为JSON编码：缺失是对象{"present":false}，字符串加JSON双引号，null保持null，对象/数组是带标记的JSON字面量字符串。CSV请配套保存完整审计JSON；完整JSON已包含两者。'),
      h('div', { class: 't010-row' }, json, csv, audit), safeSave() ? null : h('p', { class: 't010-muted' }, '当前基础层缺少副本保护，导出已禁用，请使用支持copyOnly的版本。'), detail);
    root.replaceChildren(panel); renderConfig(); setBusy(false);
    return { activate() { if (alive && !operation) setBusy(false); }, deactivate() { operation?.abort(); }, destroy() { operation?.abort(); alive = false; prediction = report = raw = null; mappings = []; root.replaceChildren(); } };
  }
};
