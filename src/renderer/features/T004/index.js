import { h } from '../../core/ui.js';
import { LIMITS, EXAMPLE, validateJob, runExtraction, captureColumns, captureValue, serializeReport } from './model.mjs';

const css = `.t004{display:grid;gap:16px;color:var(--text);max-width:1200px;margin:auto}.t004 label{display:grid;gap:6px}.t004 input,.t004 textarea,.t004 select{padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--bg-sunken);color:var(--text);font:inherit}.t004 textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace}.t004 .t004-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.t004 .t004-row>label{flex:1;min-width:160px}.t004 .t004-rule{font-family:monospace}.t004 .t004-muted{color:var(--text-dim);font-size:13px;line-height:1.6}.t004 .t004-sample{padding:12px;border:1px solid var(--line);border-radius:8px;display:grid;gap:8px}.t004 .t004-scroll{overflow:auto;max-height:470px}.t004 table{border-collapse:collapse;width:100%;font-size:13px}.t004 th,.t004 td{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:pre-wrap;min-width:65px;max-width:300px;overflow-wrap:anywhere}.t004 th{position:sticky;top:0;background:var(--bg-raised)}.t004 pre{white-space:pre-wrap;overflow-wrap:anywhere}.t004 .t004-status{padding:10px;background:var(--bg-sunken);border-radius:6px;white-space:pre-wrap}.t004 button:disabled{opacity:.5;cursor:not-allowed}`;
const clip = (text, length = 240) => text.length > length ? text.slice(0, length) + '…' : text;
const field = (label, element) => h('label', {}, label, element);
const btn = (label, action, primary = false) => h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', onclick: action }, label);
const display = value => value === null ? '∅（未参与捕获）' : value === '' ? '""（空字符串）' : value;

function readFile(file, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); const error = new Error('已取消文件读取。'); error.name = 'AbortError'; reject(error); };
    const done = action => { signal.removeEventListener('abort', abort); action(); };
    reader.onload = () => done(() => resolve(reader.result));
    reader.onerror = () => done(() => reject(new Error(`读取${file.name}失败。`)));
    reader.onabort = () => done(() => { const error = new Error('已取消文件读取。'); error.name = 'AbortError'; reject(error); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else reader.readAsArrayBuffer(file);
  });
}

export default {
  id: 'T004',
  create(root) {
    let samples = [], result = null, failures = [], page = 0, busy = false, alive = true, operation = null;
    const pattern = h('input', { class: 't004-rule', 'aria-label': '正则表达式', value: EXAMPLE.pattern, maxlength: LIMITS.patternChars });
    const flags = h('input', { 'aria-label': '正则flags', value: 'gu', maxlength: 8 });
    const timeout = h('select', { 'aria-label': '隔离执行超时' }, ...[1000, 3000, 5000].map(ms => h('option', { value: ms }, `${ms / 1000}秒`))); timeout.value = '3000';
    const pasteName = h('input', { 'aria-label': '粘贴样本名称', placeholder: '例如 server.log', maxlength: 120 });
    const pasteText = h('textarea', { 'aria-label': '粘贴样本内容', rows: 4, placeholder: '一份样本可包含多行；偏移相对于整份样本原文。', maxlength: LIMITS.sampleChars });
    const fileInput = h('input', { 'aria-label': '选择多份样本文件', type: 'file', multiple: true, accept: '.txt,.log,.csv,.json,.md' });
    const status = h('div', { class: 't004-status', role: 'status', 'aria-live': 'polite' }, '添加样本或载入示例，然后验证规则。');
    const sampleHost = h('div'), outputHost = h('div'), failureHost = h('div'), inspectHost = h('div');
    const files = window.toolbox?.files;
    const safeSave = () => files?.saveTextSupportsCopyOnly === true && typeof files.saveText === 'function';
    const statusText = text => { if (alive) status.textContent = text; };
    const setBusy = value => {
      busy = value;
      if (!alive) return;
      for (const element of panel.querySelectorAll('input,textarea,select,button')) element.disabled = value;
      cancel.disabled = !value;
      if (!value) {
        run.disabled = samples.length === 0;
        json.disabled = csv.disabled = !result || !safeSave();
        for (const element of panel.querySelectorAll('[data-page-disabled]')) element.disabled = element.dataset.pageDisabled === 'true';
      }
    };
    const invalidate = () => {
      result = null; failures = []; page = 0; outputHost.replaceChildren(); failureHost.replaceChildren(); inspectHost.replaceChildren();
      statusText('输入已改变，请重新验证规则。'); setBusy(false);
    };
    pattern.addEventListener('input', invalidate); flags.addEventListener('input', invalidate); timeout.addEventListener('change', invalidate);
    const validateSamples = candidate => validateJob({ pattern: '', flags: '', samples: candidate });
    const renderSamples = () => {
      sampleHost.replaceChildren(...samples.map((sample, index) => {
        const name = h('input', { 'aria-label': `样本${index + 1}名称`, value: sample.name, maxlength: 120, oninput: event => { sample.name = event.currentTarget.value; invalidate(); } });
        const text = h('textarea', { 'aria-label': `样本${index + 1}内容`, rows: 3, maxlength: LIMITS.sampleChars, oninput: event => { sample.text = event.currentTarget.value; invalidate(); } }, sample.text);
        return h('div', { class: 't004-sample' }, h('div', { class: 't004-row' }, field(`样本${index + 1}`, name), btn('移除此样本', () => { samples.splice(index, 1); invalidate(); renderSamples(); })), text,
          h('span', { class: 't004-muted' }, '完整保留样本文本。文件导入保留BOM与换行；手动编辑采用文本框返回的换行。'));
      }));
      setBusy(busy);
    };
    const addPaste = btn('添加粘贴样本', () => {
      try {
        const candidate = [...samples, { name: pasteName.value.trim() || `粘贴样本${samples.length + 1}`, text: pasteText.value }];
        validateSamples(candidate); samples = candidate; pasteName.value = ''; pasteText.value = ''; invalidate(); renderSamples(); statusText(`已添加，共${samples.length}份样本。`);
      } catch (error) { statusText(error.message); }
    });
    fileInput.addEventListener('change', async () => {
      const selected = Array.from(fileInput.files || []); if (!selected.length || busy) return;
      const controller = new AbortController(); operation = controller; setBusy(true);
      try {
        if (samples.length + selected.length > LIMITS.samples) throw new Error('总样本数量不可超过12份。');
        if (selected.some(file => file.size > LIMITS.fileBytes) || selected.reduce((sum, file) => sum + file.size, 0) > LIMITS.totalFileBytes) throw new Error('每文件最多1 MiB，一批文件最多4 MiB。');
        const imported = [];
        for (const file of selected) {
          statusText(`正在读取${file.name}…`);
          const buffer = await readFile(file, controller.signal);
          if (!alive || controller.signal.aborted) throw Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' });
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
          catch { throw new Error(`${file.name}不是有效UTF-8；请转换编码后重试。本批未添加。`); }
          imported.push({ name: file.name, text });
          validateSamples([...samples, ...imported]);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (controller.signal.aborted || !alive) throw Object.assign(new Error('已取消文件读取。'), { name: 'AbortError' });
        samples.push(...imported); invalidate(); renderSamples(); statusText(`已导入${imported.length}份UTF-8样本；原文件保持不变。`);
      } catch (error) { statusText(error.message); }
      finally { fileInput.value = ''; if (operation === controller) { operation = null; setBusy(false); } }
    });
    const example = btn('载入三条日志示例', () => {
      samples = EXAMPLE.samples.map(sample => ({ ...sample })); pattern.value = EXAMPLE.pattern; flags.value = EXAMPLE.flags;
      invalidate(); renderSamples(); statusText('已载入3份独立日志样本；预计2条匹配、1份未匹配。');
    });
    const clear = btn('清空样本', () => { samples = []; invalidate(); renderSamples(); });
    const renderFailures = () => {
      const rows = result ? result.samples.filter(sample => sample.status === 'no-match').map(sample => ({ ...sample, reason: '未匹配：规则执行完成，但未找到匹配。' })) : failures;
      failureHost.replaceChildren(h('h3', {}, '未匹配 / 执行失败样本'), rows.length ? h('ul', {}, ...rows.map(row => h('li', {}, `#${row.sample} ${row.name}：${row.reason}${row.status && row.status !== 'no-match' ? `（${row.status}）` : ''}`))) : h('p', { class: 't004-muted' }, '无失败样本。'));
    };
    const inspect = row => {
      inspectHost.replaceChildren(h('h3', {}, `匹配原文：样本${row.sample} ${row.name} [${row.start}, ${row.end})`),
        h('textarea', { readonly: true, rows: 4, 'aria-label': '选中匹配完整原文' }, row.text),
        h('p', { class: 't004-muted' }, '捕获数组和命名捕获使用JSON表示；null表示未参与，空字符串为""。'),
        h('pre', {}, JSON.stringify({ captures: row.captures, named: row.named, indices: row.indices, namedIndices: row.namedIndices }, null, 2)));
    };
    const renderOutput = () => {
      if (!result) return;
      const columns = captureColumns(result), pages = Math.max(1, Math.ceil(result.matches.length / 25));
      page = Math.max(0, Math.min(page, pages - 1));
      const back = btn('上一页', () => { page--; renderOutput(); setBusy(false); }); back.dataset.pageDisabled = String(page === 0); back.disabled = page === 0;
      const next = btn('下一页', () => { page++; renderOutput(); setBusy(false); }); next.dataset.pageDisabled = String(page >= pages - 1); next.disabled = page >= pages - 1;
      outputHost.replaceChildren(h('h3', {}, '匹配区间与捕获表'),
        h('p', {}, `${result.stats.samples}份样本 · ${result.stats.matches}条匹配 · ${result.stats.failedSamples}份未匹配`),
        h('div', { class: 't004-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['样本', '起点', '终点', '原文', ...columns, '查看'].map(title => h('th', {}, title)))),
          h('tbody', {}, ...result.matches.slice(page * 25, page * 25 + 25).map(row => h('tr', {}, h('td', {}, `#${row.sample} ${row.name}`), h('td', {}, row.start), h('td', {}, row.end), h('td', {}, clip(display(row.text))),
            ...columns.map(column => h('td', {}, clip(display(captureValue(row, column))))), h('td', {}, btn('完整原文与捕获', () => inspect(row)))))))),
        h('div', { class: 't004-row' }, back, h('span', {}, `第${page + 1}/${pages}页，每页25条`), next));
      renderFailures();
    };
    const run = btn('验证并抽取', async () => {
      if (busy || !samples.length) return;
      invalidate(); const controller = new AbortController(); operation = controller; setBusy(true);
      statusText('规则正在独立Worker中执行…');
      try {
        const extracted = await runExtraction({ pattern: pattern.value, flags: flags.value, samples }, { signal: controller.signal, timeoutMs: Number(timeout.value), onProgress: ({ completed, total }) => statusText(`隔离执行中：${completed}/${total}份样本已完成…`) });
        if (!alive || controller.signal.aborted) return;
        result = extracted; renderOutput(); statusText(`验证完成，${result.stats.matches}条匹配。请核对预览后另存新文件。`);
      } catch (error) { if (alive) { failures = error.failures || samples.map((sample, index) => ({ sample: index + 1, name: sample.name, status: '未执行', reason: error.message })); renderFailures(); statusText(error.message); } }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    }, true);
    const cancel = btn('取消当前操作', () => { operation?.abort(); }); cancel.disabled = true;
    const save = async format => {
      if (!result || busy || !safeSave()) return;
      const controller = new AbortController(); operation = controller; setBusy(true);
      try {
        statusText('正在生成副本内容…');
        const content = await serializeReport(result, format, { signal: controller.signal });
        if (!alive || controller.signal.aborted) return;
        const response = await files.saveText({ content, extension: format, defaultName: `regex-extraction-copy.${format}`, copyOnly: true });
        if (!alive) return;
        statusText(response?.canceled ? '已取消另存。' : response?.ok ? `已保存副本：${response.path}` : `保存失败：${response?.error || '未知错误'}`);
      } catch (error) { statusText(error.message); }
      finally { if (operation === controller) { operation = null; setBusy(false); } }
    };
    const json = btn('保存完整 JSON 副本', () => save('json')), csv = btn('保存匹配 CSV 副本', () => save('csv'));
    const panel = h('section', { class: 't004' }, h('style', {}, css), h('h2', {}, '正则抽取规则工坊'),
      h('p', { class: 't004-muted' }, '所有处理在本机完成，不执行JavaScript代码。输入正则主体（不加 / 分隔符），用 (?<字段名>...) 命名捕获。偏移为UTF-16单位：[起点,终点)，相对于整份样本；不是字节或Unicode码点。'),
      field('JavaScript 正则主体', pattern), h('div', { class: 't004-row' }, field('flags', flags), field('整批Worker超时（含启动）', timeout)),
      h('p', { class: 't004-muted' }, 'g：抽取全部非重叠匹配；不带g/y：每样本只取首条；y：从0开始连续粘连匹配，第一次失败即停止。i忽略大小写，m多行锚点，s点含换行，u/v启用Unicode语义（二选一），d记录捕获偏移。不支持的语法由运行时报告。零长度匹配会安全前进。'),
      h('div', { class: 't004-row' }, example, clear), h('div', { class: 't004-row' }, field('UTF-8多文件导入（每文件成为一份样本）', fileInput)),
      field('粘贴样本名称', pasteName), field('粘贴样本内容（允许空文本）', pasteText), addPaste, sampleHost,
      h('p', { class: 't004-muted' }, '上限：12份样本，每份100000、总计400000个UTF-16单位；规则2048；1000条匹配、64个捕获组。超时/取消/限额整批中止，禁止导出不完整结果。'),
      h('div', { class: 't004-row' }, run, cancel), status, outputHost, failureHost, inspectHost,
      h('div', { class: 't004-row' }, json, csv), h('p', { class: 't004-muted' }, 'JSON保留规则、原始样本、失败状态、捕获和偏移。CSV仅含匹配，字符串单元格使用JSON字面量，以区分null/空值并防止被表格软件当作公式。先查看预览，再在保存对话框核对目标路径并选择新文件名；禁止覆盖已有文件。系统保存对话框打开后用其取消按钮关闭。'),
      !safeSave() ? h('p', { class: 't004-muted' }, '当前环境缺少副本保护接口，导出已禁用。') : null);
    root.replaceChildren(panel); setBusy(false);
    return {
      activate() {},
      deactivate() { operation?.abort(); },
      destroy() { alive = false; operation?.abort(); operation = null; root.replaceChildren(); }
    };
  }
};
