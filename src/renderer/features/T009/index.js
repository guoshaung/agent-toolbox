import { h } from '../../core/ui.js';
import { LIMITS, EXAMPLE, EXAMPLE_QUESTIONS, BASIS, parseDataset, summarizeSurvey, serializeSurvey, formatRate, checkAbort } from './model.mjs';
const css = `.t009{display:grid;gap:14px;color:var(--text);max-width:1200px;margin:auto}.t009 label{display:grid;gap:6px}.t009 input,.t009 textarea,.t009 select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text)}.t009 textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace}.t009 .t009-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.t009 .t009-row>label{flex:1;min-width:150px}.t009 .t009-check{display:flex;align-items:center;gap:8px}.t009 .t009-card{padding:12px;border:1px solid var(--line);border-radius:8px;display:grid;gap:8px;margin:10px 0}.t009 .t009-muted{font-size:13px;line-height:1.6;color:var(--text-dim)}.t009 .t009-status{padding:10px;background:var(--bg-sunken);border-radius:6px;white-space:pre-wrap}.t009 .t009-scroll{overflow:auto;max-height:430px}.t009 td,.t009 th{padding:8px;border-bottom:1px solid var(--line);min-width:90px;max-width:350px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}.t009 table{border-collapse:collapse;width:100%;font-size:13px}.t009 th{position:sticky;top:0;background:var(--bg-raised)}.t009 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t009 button:disabled{opacity:.5}`;
const clip = (value, size = 240) => value.length > size ? value.slice(0, size) + '…' : value;
const label = (title, element) => h('label', {}, title, element);
const button = (title, action, primary = false) => h('button', { class: primary ? 'btn btn--primary' : 'btn', type: 'button', onclick: action }, title);
const typeSelect = props => h('select', props, h('option', { value: 'single' }, '单选'), h('option', { value: 'multiple' }, '多选（分隔文本）'), h('option', { value: 'numeric' }, '数值'));
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
  id: 'T009',
  create(root) {
    let dataset = null, questions = [], report = null, raw = null, busy = false, alive = true, operation = null, questionPage = 0, crossPage = 0; const frequencyPages = new Map();
    const name = h('input', { 'aria-label': '问卷来源名称', value: '问卷数据', maxlength: 120 });
    const format = h('select', { 'aria-label': '问卷输入格式' }, h('option', { value: 'csv' }, 'CSV（首行为字段标题）'), h('option', { value: 'json' }, 'JSON对象数组'));
    const file = h('input', { 'aria-label': '选择问卷数据文件', type: 'file', accept: '.csv,.json,.txt' });
    const text = h('textarea', { 'aria-label': '问卷数据内容', rows: 8, placeholder: '粘贴表格或导入UTF-8文件。' });
    const field = h('select', { 'aria-label': '新增题目字段' }), addType = typeSelect({ 'aria-label': '新增题目类型' });
    const configHost = h('div'), output = h('div'), crossOutput = h('div'), detail = h('div');
    const crossEnabled = h('input', { type: 'checkbox', 'aria-label': '启用单选交叉统计' });
    const left = h('select', { 'aria-label': '交叉左题' }), right = h('select', { 'aria-label': '交叉右题' });
    const status = h('div', { class: 't009-status', role: 'status', 'aria-live': 'polite' }, '先解析答卷，再逐题选择字段和题型。不会自动推断题目含义。');
    const files = window.toolbox?.files;
    const safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const say = value => { if (alive) status.textContent = value; };
    const eligible = () => questions.filter(question => question.type === 'single');
    const setBusy = value => {
      busy = value; if (!alive) return;
      for (const control of panel.querySelectorAll('input,textarea,select,button')) control.disabled = value;
      cancel.disabled = !value;
      if (!value) {
        field.disabled = addType.disabled = add.disabled = !dataset;
        summarize.disabled = !dataset || !questions.length;
        json.disabled = csv.disabled = !report || !safeSave();
        crossEnabled.disabled = eligible().length < 2;
        left.disabled = right.disabled = !crossEnabled.checked || eligible().length < 2;
        for (const control of panel.querySelectorAll('[data-page-disabled]')) control.disabled = control.dataset.pageDisabled === 'true';
      }
    };
    const clearReport = () => { report = null; questionPage = crossPage = 0; frequencyPages.clear(); output.replaceChildren(); crossOutput.replaceChildren(); detail.replaceChildren(); setBusy(false); };
    const invalidate = () => { dataset = null; questions = []; clearReport(); configHost.replaceChildren(); field.replaceChildren(); left.replaceChildren(); right.replaceChildren(); crossEnabled.checked = false; setBusy(false); say('数据输入已改变，旧题目配置与报告已废弃，请重新解析。'); };
    const configChanged = () => { clearReport(); say('题目/交叉配置已改变，请重新汇总。'); };
    name.addEventListener('input', invalidate); format.addEventListener('change', invalidate); text.addEventListener('input', () => { raw = null; invalidate(); });
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected || busy) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say(`正在读取${selected.name}…`);
      try {
        const imported = await readUTF8(selected, controller.signal); if (!alive) return;
        if (selected.name.length > 120) throw new Error('文件名超过120字符。'); raw = imported; text.value = imported; name.value = selected.name;
        if (/\.json$/iu.test(selected.name)) format.value = 'json'; else if (/\.csv$/iu.test(selected.name)) format.value = 'csv'; invalidate(); say('已导入文件，请核对格式后解析。');
      } catch (error) { say(error.message); }
      finally { file.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
    });
    const refreshCross = () => {
      const singles = eligible(), oldLeft = left.value, oldRight = right.value;
      left.replaceChildren(...singles.map(question => h('option', { value: question.id }, `${question.id} ${clip(question.title, 80)}`)));
      right.replaceChildren(...singles.map(question => h('option', { value: question.id }, `${question.id} ${clip(question.title, 80)}`)));
      left.value = singles.some(question => question.id === oldLeft) ? oldLeft : singles[0]?.id || '';
      right.value = singles.some(question => question.id === oldRight && question.id !== left.value) ? oldRight : singles.find(question => question.id !== left.value)?.id || '';
      if (singles.length < 2) crossEnabled.checked = false; setBusy(busy);
    };
    const renderConfig = () => {
      configHost.replaceChildren(...questions.map(question => {
        const selectField = h('select', { 'aria-label': `${question.id}字段`, onchange: event => { question.field = event.currentTarget.value; configChanged(); } }, ...dataset.fields.map(name => h('option', { value: name }, clip(name) || '（空字段名）'))); selectField.value = question.field;
        const selectType = typeSelect({ 'aria-label': `${question.id}类型`, onchange: event => { question.type = event.currentTarget.value; configChanged(); renderConfig(); } }); selectType.value = question.type;
        const title = h('input', { 'aria-label': `${question.id}题名`, value: question.title, maxlength: LIMITS.labelChars, oninput: event => { question.title = event.currentTarget.value; configChanged(); refreshCross(); } });
        const trim = h('input', { type: 'checkbox', 'aria-label': `${question.id}修剪首尾空白`, checked: question.trim, onchange: event => { question.trim = event.currentTarget.checked; configChanged(); } });
        const separator = h('input', { 'aria-label': `${question.id}自定义多选分隔符`, value: question.separator || ';', maxlength: 10, oninput: event => { question.separator = event.currentTarget.value; presets.value = 'custom'; configChanged(); } });
        const presets = h('select', { 'aria-label': `${question.id}多选分隔符预设`, onchange: event => { if (event.currentTarget.value !== 'custom') { question.separator = event.currentTarget.value; separator.value = question.separator; } configChanged(); } },
          h('option', { value: ';' }, '分号 ;'), h('option', { value: ',' }, '逗号 ,'), h('option', { value: '|' }, '竖线 |'), h('option', { value: '\n' }, '换行 LF'), h('option', { value: 'custom' }, '自定义字面文本'));
        presets.value = [';', ',', '|', '\n'].includes(question.separator) ? question.separator : 'custom';
        return h('div', { class: 't009-card' }, h('strong', {}, question.id), h('div', { class: 't009-row' }, label('字段', selectField), label('题型', selectType), label('题名', title)),
          h('label', { class: 't009-check' }, trim, '显式修剪字符串/多选项首尾空白（不改原文件）'),
          question.type === 'multiple' ? h('div', { class: 't009-row' }, label('多选分隔符（不是正则）', presets), label('当前字面分隔符', separator)) : null,
          button('移除此题', () => { questions = questions.filter(other => other !== question); configChanged(); renderConfig(); }));
      })); refreshCross();
    };
    const add = button('添加此字段为题目', () => {
      if (!dataset) return;
      if (!dataset.fields.includes(field.value) || questions.some(question => question.field === field.value)) { say('请选择未重复配置的字段。'); return; }
      if (questions.length >= LIMITS.questions) { say('最多20题。'); return; }
      const id = Array.from({ length: LIMITS.questions }, (_, index) => 'Q' + (index + 1)).find(id => !questions.some(question => question.id === id));
      const title = field.value ? field.value.slice(0, LIMITS.labelChars) : '（空字段名）';
      questions.push({ id, field: field.value, title, type: addType.value, trim: true, separator: ';' }); configChanged(); renderConfig();
      field.value = dataset.fields.find(name => !questions.some(question => question.field === name)) || '';
    });
    const parse = button('解析问卷数据', async () => {
      if (busy) return;
      invalidate(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在严格解析答卷…');
      try {
        const parsed = await parseDataset({ name: name.value, format: format.value, text: raw ?? text.value }, { signal: controller.signal }); if (!alive) return;
        dataset = parsed; field.replaceChildren(...dataset.fields.map(name => h('option', { value: name }, clip(name) || '（空字段名）'))); field.value = dataset.fields[0] || '';
        say(`已解析${dataset.records.length}份答卷、${dataset.fields.length}个字段。请选择字段与题型添加题目。`);
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const example = button('载入四份答卷示例及配置', async () => {
      raw = null; name.value = 'survey.csv'; format.value = 'csv'; text.value = EXAMPLE;
      // Use the same parse path explicitly rather than guessing question types.
      invalidate(); const controller = new AbortController(); operation = controller; setBusy(true);
      try {
        dataset = await parseDataset({ name: name.value, format: format.value, text: EXAMPLE }, { signal: controller.signal }); if (!alive) return;
        questions = EXAMPLE_QUESTIONS.map(question => ({ ...question })); field.replaceChildren(...dataset.fields.map(name => h('option', { value: name }, name))); field.value = 'choice';
        renderConfig(); crossEnabled.checked = true; left.value = 'Q1'; right.value = 'Q2'; say('已载入4份答卷及明确题型；单选有效3/缺答1，多选比例合计超过100%，交叉有效成对3。');
      } catch (error) { say(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    });
    crossEnabled.addEventListener('change', configChanged); left.addEventListener('change', configChanged); right.addEventListener('change', configChanged);
    const pager = (current, pages, callback) => { const back = button('上一页', () => callback(current - 1)), next = button('下一页', () => callback(current + 1)); back.dataset.pageDisabled = String(current === 0); next.dataset.pageDisabled = String(current >= pages - 1); back.disabled = current === 0; next.disabled = current >= pages - 1; return h('div', { class: 't009-row' }, back, h('span', {}, `第${current + 1}/${pages}页`), next); };
    const renderCross = () => {
      if (!report.cross) { crossOutput.replaceChildren(h('p', { class: 't009-muted' }, '未启用交叉统计。')); return; }
      const cross = report.cross, pages = Math.max(1, Math.ceil(cross.cells.length / 25)); crossPage = Math.max(0, Math.min(crossPage, pages - 1));
      crossOutput.replaceChildren(h('h3', {}, `单选交叉 ${cross.config.left} × ${cross.config.right}`), h('p', {}, `全部${cross.total} · 有效成对${cross.validPairs} · 排除${cross.excludedPairs} · 比例分母${cross.denominator}`),
        h('p', { class: 't009-muted' }, cross.statusCounts.map(row => `${row.left}/${row.right}: ${row.count}`).join('；') + '。仅列观测组合，未出现组合为0。'),
        h('div', { class: 't009-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['左题选项', '右题选项', '频数', '成对分母', '成对比例'].map(title => h('th', {}, title)))), h('tbody', {}, ...cross.cells.slice(crossPage * 25, crossPage * 25 + 25).map(cell => h('tr', {}, h('td', {}, clip(`${cell.left.type}: ${JSON.stringify(cell.left.value)}`)), h('td', {}, clip(`${cell.right.type}: ${JSON.stringify(cell.right.value)}`)), h('td', {}, cell.count), h('td', {}, cell.denominator), h('td', {}, formatRate(cell.rate))))))),
        pager(crossPage, pages, next => { crossPage = next; renderCross(); setBusy(false); }));
    };
    const renderResults = () => {
      const pages = Math.max(1, Math.ceil(report.questions.length / 5)); questionPage = Math.max(0, Math.min(questionPage, pages - 1));
      output.replaceChildren(h('h3', {}, `汇总${report.sampleCount}份答卷 · ${report.questions.length}题`), ...report.questions.slice(questionPage * 5, questionPage * 5 + 5).map(question => {
        const pages = Math.max(1, Math.ceil(question.frequencies.length / 25)), page = Math.max(0, Math.min(frequencyPages.get(question.config.id) || 0, pages - 1));
        return h('div', { class: 't009-card' }, h('h4', {}, `${question.config.id} ${clip(question.config.title)}（${question.config.type}）`),
          h('p', {}, `总样本${question.total} · 有效${question.valid} · 缺答${question.missing} · 非法${question.invalid} · 比例分母${question.denominator}`),
          question.config.type === 'multiple' ? h('p', {}, `分隔符${JSON.stringify(question.config.separator)} · 已去重${question.duplicateSelectionsRemoved}个重复选择 · 忽略${question.ignoredEmptyTokens}个空项 · 选择总数${question.selections}；比例合计可超过100%。`) : null,
          question.numeric ? h('p', {}, `数值范围${JSON.stringify(question.numeric.min)}～${JSON.stringify(question.numeric.max)} · 近似均值${JSON.stringify(question.numeric.mean)}`) : null,
          h('div', { class: 't009-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['选项/值及类型', '频数', '有效答卷分母', '比例'].map(title => h('th', {}, title)))), h('tbody', {}, ...question.frequencies.slice(page * 25, page * 25 + 25).map(row => h('tr', {}, h('td', {}, clip(`${row.type}: ${JSON.stringify(row.value)}`)), h('td', {}, row.count), h('td', {}, row.denominator), h('td', {}, formatRate(row.rate))))))),
          pager(page, pages, next => { frequencyPages.set(question.config.id, next); renderResults(); setBusy(false); }),
          h('p', { class: 't009-muted' }, `缺答/非法来源预览（前20，共${question.issues.length}）：`), h('ul', {}, ...question.issues.slice(0, 20).map(issue => h('li', {}, `${issue.status} ${issue.source.name} · 记录${issue.source.row} · 物理行${issue.source.line}：${issue.reason}；${clip(JSON.stringify(issue.input), 180)}`))),
          button('完整题目统计与失败答卷', () => detail.replaceChildren(h('h3', {}, '完整题目报告'), h('pre', {}, JSON.stringify(question, null, 2)))));
      }), pager(questionPage, pages, next => { questionPage = next; renderResults(); setBusy(false); })); renderCross();
    };
    const summarize = button('按配置汇总问卷', async () => {
      if (!dataset || !questions.length || busy) return;
      clearReport(); const controller = new AbortController(); operation = controller; setBusy(true); say('正在统计有效答卷、缺答与非法值…');
      try { const result = await summarizeSurvey(dataset, questions, crossEnabled.checked ? { left: left.value, right: right.value } : null, { signal: controller.signal }); if (!alive) return; report = result; renderResults(); say('汇总完成，请核对有效分母、缺答、非法值和交叉口径后另存副本。'); }
      catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const cancel = button('取消当前操作', () => operation?.abort());
    const save = async extension => {
      if (!report || busy || !safeSave()) return;
      const controller = new AbortController(); operation = controller; setBusy(true); say('正在生成完整报告副本…');
      try { const content = await serializeSurvey(report, extension, { signal: controller.signal }); if (!alive || controller.signal.aborted) return; const response = await files.saveText({ content, extension, defaultName: `survey-summary-copy.${extension}`, copyOnly: true }); if (alive) say(response?.canceled ? '已取消另存。' : response?.ok ? `已保存报告副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`); }
      catch (error) { say(error.message); } finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = button('保存完整 JSON 副本', () => save('json')), csv = button('保存完整 CSV 副本', () => save('csv'));
    const panel = h('section', { class: 't009' }, h('style', {}, css), h('h2', {}, '问卷结果汇总'), h('p', { class: 't009-muted' }, '本地描述性统计。题型、修剪和分隔符由你配置，不自动推断含义。数据修改废弃旧配置/报告，配置修改废弃旧报告；切换功能丢失未保存内容。'), example,
      h('div', { class: 't009-row' }, label('来源名称', name), label('明确格式', format), label('UTF-8文件', file)), label('粘贴或编辑答卷', text), parse,
      h('div', { class: 't009-row' }, label('字段', field), label('题型', addType), add), configHost, h('label', { class: 't009-check' }, crossEnabled, '计算单选×单选交叉表（至少配置两道单选题）'), h('div', { class: 't009-row' }, label('左题', left), label('右题', right)),
      h('details', {}, h('summary', {}, '统计口径与限制'), h('ul', {}, ...Object.values(BASIS).map(basis => h('li', {}, basis))), h('p', {}, '数据2 MiB/5000答卷/100字段，20题，每题200类别，每答卷多选拆分最多100项，输出12 MiB。所有超限明确中止，不偷偷选取前N条。JSON保持类型并拒绝重复属性/精度丢失；CSV原本均为字符串，只有配置为数值题才明确解析。')),
      h('div', { class: 't009-row' }, summarize, cancel), status, output, crossOutput, detail, h('div', { class: 't009-row' }, json, csv), h('p', { class: 't009-muted' }, 'CSV报告按metadata/question/frequency/answer-missing/answer-invalid/cross-summary/cross-cell记录类型导出，含全部口径、配置和失败来源；字符串/对象单元格用JSON字面量编码，保留类型并防止公式解释。核对预览后在原生对话框选择新路径，拒绝已有目标。对话框打开后用其取消按钮关闭。'), !safeSave() ? h('p', { class: 't009-muted' }, '当前环境缺少副本保护接口，导出已禁用。') : null);
    root.replaceChildren(panel); setBusy(false);
    return { activate() {}, deactivate() { operation?.abort(); }, destroy() { alive = false; operation?.abort(); operation = null; root.replaceChildren(); } };
  }
};
