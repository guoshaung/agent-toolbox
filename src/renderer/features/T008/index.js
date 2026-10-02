import { h } from '../../core/ui.js';
import { LIMITS, EXAMPLE, BASIS, parseDataset, buildDictionary, formatRate, setDescription, serializeDictionary, checkAbort } from './model.mjs';
const css = `.t008{display:grid;gap:14px;max-width:1200px;margin:auto;color:var(--text)}.t008 label{display:grid;gap:6px}.t008 input,.t008 textarea,.t008 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.t008 textarea{width:100%;box-sizing:border-box;resize:vertical}.t008 .t008-data{font-family:monospace}.t008 .t008-row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.t008 .t008-row label{flex:1;min-width:170px}.t008 .t008-muted{font-size:13px;color:var(--text-dim);line-height:1.6}.t008 .t008-status{padding:10px;border-radius:6px;background:var(--bg-sunken);white-space:pre-wrap}.t008 .t008-scroll{overflow:auto;max-height:600px}.t008 table{border-collapse:collapse;width:100%;font-size:13px}.t008 th,.t008 td{padding:10px;border-bottom:1px solid var(--line);min-width:110px;max-width:350px;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.t008 th{position:sticky;top:0;background:var(--bg-raised)}.t008 .t008-description{min-width:180px;font-size:13px}.t008 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t008 button:disabled{opacity:.5}`;
const clip = (text, length = 240) => text.length > length ? text.slice(0, length) + '…' : text;
const label = (title, control) => h('label', {}, title, control);
const button = (title, action, primary = false) => h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', onclick: action }, title);

async function readUTF8(file, signal) {
  if (file.size > LIMITS.bytes) throw new Error('文件超过2 MiB。');
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    const clean = () => signal.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    reader.onload = () => { clean(); resolve(reader.result); };
    reader.onerror = () => { clean(); reject(new Error('文件读取失败。')); };
    reader.onabort = () => { clean(); reject(Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' })); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
  checkAbort(signal);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { throw new Error('文件不是有效UTF-8，当前输入未被替换。'); }
}

export default {
  id: 'T008',
  create(root) {
    let report = null, page = 0, raw = null, alive = true, busy = false, operation = null;
    const name = h('input', { 'aria-label': '数据来源名称', value: '数据样本', maxlength: 120 });
    const format = h('select', { 'aria-label': '数据格式' }, h('option', { value: 'json' }, 'JSON对象数组'), h('option', { value: 'csv' }, 'CSV（首行为标题）'));
    const file = h('input', { 'aria-label': '选择数据文件', type: 'file', accept: '.csv,.json,.txt' });
    const text = h('textarea', { 'aria-label': '数据内容', class: 't008-data', rows: 9, placeholder: '粘贴CSV或JSON对象数组，也可导入UTF-8文件。' });
    const status = h('div', { class: 't008-status', role: 'status', 'aria-live': 'polite' }, '添加数据或载入10行示例，生成字段字典后编辑说明。');
    const output = h('div'), detail = h('div');
    const files = window.toolbox?.files;
    const safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = value => { if (alive) status.textContent = value; };
    const setBusy = value => {
      busy = value; if (!alive) return;
      for (const element of panel.querySelectorAll('input,textarea,select,button')) element.disabled = value;
      cancel.disabled = !value;
      if (!value) { json.disabled = markdown.disabled = !report || !safeSave(); for (const element of panel.querySelectorAll('[data-page-disabled]')) element.disabled = element.dataset.pageDisabled === 'true'; }
    };
    const invalidate = () => { report = null; page = 0; output.replaceChildren(); detail.replaceChildren(); setBusy(false); say('输入已改变，旧统计与说明已废弃，请重新生成字典。'); };
    name.addEventListener('input', invalidate); format.addEventListener('change', invalidate);
    text.addEventListener('input', () => { raw = null; invalidate(); });
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected || busy) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say(`正在读取${selected.name}…`);
      try {
        const imported = await readUTF8(selected, controller.signal); if (!alive) return;
        if (selected.name.length > 120) throw new Error('文件名超过120字符，请缩短名称。');
        raw = imported; text.value = imported; name.value = selected.name;
        if (/\.csv$/iu.test(selected.name)) format.value = 'csv'; else if (/\.json$/iu.test(selected.name)) format.value = 'json';
        invalidate(); say('已导入UTF-8数据，保留原始换行；请核对格式后生成。');
      } catch (error) { say(error.message); }
      finally { file.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
    });
    const example = button('载入10行20%空值示例', () => { raw = null; name.value = 'scores.json'; format.value = 'json'; text.value = EXAMPLE; invalidate(); say('示例10行：score有8个数字、2个null，合并空值率应为20%。'); });
    const render = () => {
      if (!report) return;
      const pages = Math.max(1, Math.ceil(report.fields.length / 10)); page = Math.max(0, Math.min(page, pages - 1));
      const back = button('上一页', () => { page--; render(); setBusy(false); }), next = button('下一页', () => { page++; render(); setBusy(false); });
      back.dataset.pageDisabled = String(page === 0); next.dataset.pageDisabled = String(page >= pages - 1); back.disabled = page === 0; next.disabled = page >= pages - 1;
      output.replaceChildren(h('h3', {}, `字段字典：${report.sampleCount}条样本 · ${report.fieldCount}个顶层字段`),
        h('p', { class: 't008-muted' }, '仅统计已加载的全部样本，不推断总体分布或数据库约束。空值率以记录数为分母；混合类型是观察提示。'),
        h('div', { class: 't008-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['字段 / 路径', '类型分布 / 混合', '空值数 / 空值率', '数值与字符串值域', '非空示例', '人工字段说明'].map(title => h('th', {}, title)))),
          h('tbody', {}, ...report.fields.slice(page * 10, page * 10 + 10).map((field, localIndex) => {
            const index = page * 10 + localIndex;
            const description = h('textarea', { 'aria-label': `字段${index + 1}说明`, class: 't008-description', rows: 3, maxlength: LIMITS.descriptionChars, placeholder: '例如：业务含义、单位、来源或允许取值', oninput: event => {
              try { setDescription(report, index, event.currentTarget.value); detail.replaceChildren(); say(`字段${clip(field.name, 80)}说明已更新，导出将包含当前编辑。`); } catch (error) { say(error.message); }
            } }, field.description);
            const numeric = field.numericDomain.count ? `${field.numericDomain.min}～${field.numericDomain.max}（${field.numericDomain.distinctCount}个不同数值）` : '无数值';
            const strings = field.stringDomain.count ? `字符串长度${field.stringDomain.minLengthUTF16}～${field.stringDomain.maxLengthUTF16} UTF-16单位；${field.stringDomain.distinctCount}种值；字典序${clip(JSON.stringify(field.stringDomain.lexicalMin), 80)}～${clip(JSON.stringify(field.stringDomain.lexicalMax), 80)}` : '无字符串';
            return h('tr', {}, h('td', {}, clip(field.name), '\n' + clip(field.path)), h('td', {}, Object.entries(field.typeCounts).filter(([, count]) => count).map(([type, count]) => `${type}: ${count}`).join('\n') || '无观测', `\n混合类型：${field.mixedTypes ? '是（' + field.nonNullTypes.join('/') + '）' : '否'}`),
              h('td', {}, `分母${field.sampleCount}\n缺失${field.empty.missing} / null ${field.empty.null} / 空字符串${field.empty.emptyString}\n合计${field.empty.count} · 空值率${formatRate(field.empty.rate)}`),
              h('td', {}, numeric + '\n' + strings, button('完整值域与统计', () => detail.replaceChildren(h('h3', {}, '完整字段统计与当前说明'), h('pre', {}, JSON.stringify(field, null, 2))))),
              h('td', {}, ...field.examples.map(sample => h('p', {}, `${sample.type}：${clip(JSON.stringify(sample.value), 140)}\n${sample.source.name} · 记录${sample.source.row} · 物理行${sample.source.line}`)), !field.examples.length ? '无非空示例' : null), h('td', {}, description));
          })))), h('div', { class: 't008-row' }, back, h('span', {}, `第${page + 1}/${pages}页，每页10字段`), next));
    };
    const generate = button('生成字段字典', async () => {
      if (busy) return;
      invalidate(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在严格解析样本…');
      try {
        const dataset = await parseDataset({ name: name.value, format: format.value, text: raw ?? text.value }, { signal: controller.signal });
        say(`正在统计${dataset.records.length}条样本的顶层字段…`);
        const dictionary = await buildDictionary(dataset, new Map(), { signal: controller.signal }); if (!alive) return;
        report = dictionary; render(); say(`完成：${report.sampleCount}条样本、${report.fieldCount}个字段。请逐字段填写说明并核对统计。`);
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const cancel = button('取消当前操作', () => operation?.abort());
    const save = async extension => {
      if (!report || busy || !safeSave()) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say('正在生成字典副本…');
      try {
        const content = await serializeDictionary(report, extension, { signal: controller.signal }); if (!alive || controller.signal.aborted) return;
        const response = await files.saveText({ content, extension, defaultName: `data-dictionary-copy.${extension}`, copyOnly: true });
        if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存字典副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = button('保存 JSON 字典副本', () => save('json')), markdown = button('保存 Markdown 字典副本', () => save('md'));
    const panel = h('section', { class: 't008' }, h('style', {}, css), h('h2', {}, '数据字段字典生成'),
      h('p', { class: 't008-muted' }, '本地统计CSV或JSON对象数组，人工填写字段含义，导出共享字典。不上传数据，不覆盖原文件。输入改变会废弃旧统计及说明；切换功能会丢失未保存内容。'), example,
      h('div', { class: 't008-row' }, label('来源名称', name), label('明确数据格式', format), label('UTF-8文件导入', file)), label('粘贴或编辑数据', text),
      h('details', {}, h('summary', {}, '统计口径与限额（生成和导出均保留）'), h('ul', {}, ...Object.values(BASIS).map(value => h('li', {}, value))),
        h('p', {}, '输入2 MiB、5000行/100字段；字符串50000 UTF-16单位；JSON深度32/100000节点；CSV100000单元格；说明2000单位/字段；副本12 MiB。JSON拒绝重复属性、不安全整数、改变十进制含义的数值舍入和非对象记录；不猜测列错位或数字类型。')),
      h('div', { class: 't008-row' }, generate, cancel), status, output, detail, h('div', { class: 't008-row' }, json, markdown),
      h('p', { class: 't008-muted' }, '先核对统计及说明，再在原生保存对话框确认新文件路径；已有目标会被拒绝。JSON保留结构化统计，Markdown供阅读共享。文件导入保留原始换行，编辑后采用文本框值。保存对话框打开后用其取消按钮关闭。'), !safeSave() ? h('p', { class: 't008-muted' }, '当前环境缺少副本保护接口，导出已禁用。') : null);
    root.replaceChildren(panel); setBusy(false);
    return { activate() {}, deactivate() { operation?.abort(); }, destroy() { alive = false; operation?.abort(); operation = null; root.replaceChildren(); } };
  }
};
