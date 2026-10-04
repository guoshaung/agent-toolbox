import { h } from '../../core/ui.js';
import { FORMATS, LIMITS, buildTimeline, serializeTimeline, offsetText } from './model.mjs';

const CSS = `
.t006{height:100%;overflow:auto;padding:24px;max-width:1440px;margin:auto;color:var(--text)}.t006 h2,.t006 h3{margin:0 0 10px}.t006 p{line-height:1.6}
.t006__section{border-top:1px solid var(--line);padding:18px 0}.t006__row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.t006__field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:150px}
.t006 .field{background:var(--bg-sunken);border:1px solid var(--line);padding:9px;border-radius:6px;width:100%}.t006__input{min-height:170px;resize:vertical;font-family:var(--mono);line-height:1.5}
.t006__note{font-size:12px;color:var(--text-dim)}.t006__source{border-top:1px solid var(--line);padding:12px 0}.t006__snippet{font-family:var(--mono);font-size:12px;white-space:pre-wrap;max-height:100px;overflow:auto;color:var(--text-dim)}
.t006__stats{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0}.t006__stat strong{display:block;font-size:24px}.t006__stat span{font-size:12px;color:var(--text-dim)}
.t006__status{min-height:26px;margin:12px 0;color:var(--text-dim)}.t006__status[data-error=true]{color:var(--bad)}.t006__scroll{max-height:480px;overflow:auto;border:1px solid var(--line)}
.t006 table{border-collapse:collapse;width:100%;font-size:12px}.t006 th,.t006 td{padding:9px;text-align:left;vertical-align:top;min-width:110px;max-width:480px;border-bottom:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.t006 th{position:sticky;top:0;background:var(--bg-raised)}.t006__raw{max-height:120px;overflow:auto;font-family:var(--mono)}.t006 td[data-same=true]{background:var(--accent-soft)}.t006 button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:820px){.t006{padding:16px}}
`;
const examples = () => [
  { name: 'utc.log', format: 'iso-offset', offset: 'Z', text: '2026-07-01T12:00:00.123Z API accepted\n2026-07-01T11:59:59.999Z start\nstack continuation\n' },
  { name: 'east8.log', format: 'local', offset: '+08:00', text: '2026-07-01 20:00:00.123 UI received\n2026-07-01 20:00:00.456 done\n' },
];

export default {
  id: 'T006',
  create(root, _ctx) {
    let inputs = [], result = null, eventPage = 0, unparsedPage = 0, busy = false, destroyed = false, controller = null, reader = null;
    let sourceControls = [];
    const wrapper = h('div', { class: 't006' });
    const sourceHost = h('div'), statsHost = h('div', { class: 't006__stats' }), timelineHost = h('div'), unparsedHost = h('div');
    const status = h('div', { class: 't006__status', role: 'status', 'aria-live': 'polite' });
    const formatSelect = (label, action) => h('select', { class: 'field', 'aria-label': label, onchange: action }, ...FORMATS.map(format => h('option', { value: format.id }, format.label)));
    const importFormat = formatSelect('新增日志时间格式', () => { syncControls(); updateHint(); });
    const importOffset = h('input', { class: 'field', type: 'text', value: '+00:00', maxlength: 6, 'aria-label': '新增日志固定 UTC 偏移', placeholder: 'Z 或 +08:00' });
    const hint = h('p', { class: 't006__note' });
    const file = h('input', { type: 'file', multiple: true, accept: '.log,.txt,.jsonl,text/plain', 'aria-label': '选择多份日志文件', onchange: () => loadFiles([...file.files || []]) });
    const pasteName = h('input', { class: 'field', type: 'text', value: '粘贴日志.log', maxlength: 200, 'aria-label': '粘贴日志名称' });
    const paste = h('textarea', { class: 'field t006__input', 'aria-label': '粘贴日志内容', spellcheck: 'false', placeholder: '将一份日志粘贴到这里，再添加到来源列表。每份可使用不同格式和固定UTC偏移。' });
    const addPaste = h('button', { class: 'btn', onclick: () => addPasted() }, '添加粘贴日志');
    const sample = h('button', { class: 'btn btn--sm', onclick: () => { inputs = examples(); invalidate(); renderSources(); setStatus('已载入UTC与东八区示例：两个同刻事件、一个无法解析行。点击生成时间线。'); } }, '载入跨时区示例');
    const clear = h('button', { class: 'btn btn--sm', onclick: () => { inputs = []; invalidate(); renderSources(); } }, '清空来源列表');
    const build = h('button', { class: 'btn btn--primary', disabled: true, onclick: () => generate() }, '生成统一时间线');
    const cancelButton = h('button', { class: 'btn', hidden: true, onclick: () => cancel() }, '取消处理');
    const saveCsv = h('button', { class: 'btn btn--primary', disabled: true, onclick: () => saveCopy('csv') }, '保存时间线 CSV 副本');
    const saveJson = h('button', { class: 'btn', disabled: true, onclick: () => saveCopy('json') }, '保存完整 JSON（含未解析行）');
    const field = (label, element) => h('label', { class: 't006__field' }, h('span', {}, label), element);
    wrapper.append(
      h('style', {}, CSS), h('h2', {}, '日志事件时间线'),
      h('p', { class: 't006__note' }, '将多份日志的时刻换成UTC再排序。同刻事件保持来源列表顺序及各文件原始行序，保留文件名、物理行号和原文。数据仅在本机处理。'),
      h('section', { class: 't006__section' }, h('h3', {}, '添加日志'), h('div', { class: 't006__row' }, field('新增日志的时间格式', importFormat), field('固定UTC偏移（仅指定偏移格式使用）', importOffset)), hint, file, h('div', { class: 't006__row' }, field('粘贴日志名称', pasteName), addPaste, sample), paste, h('p', { class: 't006__note' }, '最多8份UTF-8日志，每份2 MiB、合计8 MiB、50,000物理行。只识别行首完整时间；允许[时间]前缀。无年份/无日期时间、IANA时区与夏令时、微秒/纳秒不会被猜测或截断。固定偏移须自行确认。')),
      h('section', { class: 't006__section' }, h('h3', {}, '日志来源与解释规则'), sourceHost, h('div', { class: 't006__row' }, clear, build, cancelButton)), status,
      h('section', { class: 't006__section' }, h('h3', {}, '统一时间线'), statsHost, timelineHost),
      h('section', { class: 't006__section' }, h('h3', {}, '无法解析行'), unparsedHost),
      h('section', { class: 't006__section' }, h('h3', {}, '核对后保存副本'), h('div', { class: 't006__row' }, saveCsv, saveJson), h('p', { class: 't006__note' }, 'CSV包含已解析事件，完整JSON同时包含无法解析行及原因。保存对话框展示最终路径，副本保护拒绝任何已有目标。原文和堆栈可能含敏感信息，请按原日志同等私密程度保管副本。'))
    );
    root.replaceChildren(wrapper); updateHint(); renderSources(); renderResult(); syncControls();

    function setStatus(message, error = false) { if (destroyed) return; status.textContent = message; status.dataset.error = String(error); }
    function canSave() { return window.toolbox?.files?.saveTextSupportsCopyOnly === true && typeof window.toolbox?.files?.saveText === 'function'; }
    function updateHint() { hint.textContent = FORMATS.find(format => format.id === importFormat.value)?.hint || ''; }
    function syncControls() {
      for (const control of wrapper.querySelectorAll('input,textarea,select,button')) control.disabled = busy;
      for (const control of wrapper.querySelectorAll('[data-page-disabled]')) control.disabled = busy || control.dataset.pageDisabled === 'true';
      importOffset.disabled = busy || importFormat.value !== 'local';
      for (const controls of sourceControls) controls.offset.disabled = busy || controls.source.format !== 'local';
      build.disabled = busy || !inputs.length; clear.disabled = busy || !inputs.length;
      addPaste.disabled = busy || inputs.length >= LIMITS.sources; file.disabled = busy || inputs.length >= LIMITS.sources;
      cancelButton.disabled = false; cancelButton.hidden = !busy;
      saveCsv.disabled = busy || !result?.timeline.length || !canSave(); saveJson.disabled = busy || !result || !canSave();
    }
    function invalidate() { result = null; eventPage = unparsedPage = 0; renderResult(); setStatus('来源或规则已更新，请重新生成时间线。'); syncControls(); }
    function renderSources() {
      sourceControls = [];
      if (!inputs.length) { sourceHost.replaceChildren(h('p', { class: 't006__note' }, '尚未添加日志。选择多个本地文件，或粘贴一份后点击添加。')); syncControls(); return; }
      sourceHost.replaceChildren(...inputs.map((source, index) => {
        const name = h('input', { class: 'field', type: 'text', value: source.name, maxlength: 200, 'aria-label': `来源${index + 1}名称`, oninput: () => { source.name = name.value; invalidate(); } });
        const format = formatSelect(`来源${index + 1}时间格式`, () => { source.format = format.value; invalidate(); renderSources(); }); format.value = source.format;
        const offset = h('input', { class: 'field', type: 'text', value: source.offset, maxlength: 6, 'aria-label': `来源${index + 1}固定 UTC 偏移`, oninput: () => { source.offset = offset.value; invalidate(); } });
        sourceControls.push({ source, offset });
        return h('div', { class: 't006__source' }, h('div', { class: 't006__row' }, h('strong', {}, `来源 ${index + 1}`), field('日志名称', name), field('时间格式', format), field('固定UTC偏移', offset), h('button', { class: 'btn btn--sm', onclick: () => { inputs.splice(index, 1); invalidate(); renderSources(); } }, '移除此来源')), h('p', { class: 't006__note' }, FORMATS.find(item => item.id === source.format)?.hint, ` · ${(new TextEncoder().encode(source.text).length / 1024).toFixed(1)} KiB · 下方仅显示前300字符`), h('pre', { class: 't006__snippet' }, source.text.slice(0, 300)));
      })); syncControls();
    }
    function totalBytes() { return inputs.reduce((sum, source) => sum + new TextEncoder().encode(source.text).length, 0); }
    function addPasted() {
      if (!paste.value) { setStatus('请先粘贴日志内容。', true); return; }
      if (inputs.length >= LIMITS.sources) { setStatus('最多8份日志，请移除一份后添加。', true); return; }
      if (paste.value.length > LIMITS.sourceBytes) { setStatus('单份粘贴日志超过2 MiB，请拆分。', true); return; }
      const bytes = new TextEncoder().encode(paste.value).length;
      if (bytes > LIMITS.sourceBytes || totalBytes() + bytes > LIMITS.totalBytes) { setStatus('单份日志最多2 MiB，全部合计最多8 MiB。', true); return; }
      inputs.push({ name: pasteName.value.trim(), text: paste.value, format: importFormat.value, offset: importOffset.value });
      paste.value = ''; invalidate(); renderSources();
    }
    function cancel() { if (!controller && !reader) return; controller?.abort(); reader?.abort(); setStatus('已取消当前日志处理。'); }
    async function run(message, action) {
      if (busy || destroyed) return;
      const job = new AbortController(); controller = job; busy = true; syncControls(); setStatus(message);
      try { return await action(job.signal); }
      catch (error) { setStatus(error.name === 'AbortError' ? '已取消当前日志处理。' : error.message || String(error), error.name !== 'AbortError'); return null; }
      finally { if (controller === job) { controller = null; reader = null; busy = false; if (!destroyed) syncControls(); } }
    }
    async function loadFiles(selected) {
      if (!selected.length) return;
      if (inputs.length + selected.length > LIMITS.sources) { file.value = ''; setStatus('来源列表最多8份日志，请减少所选文件。', true); return; }
      if (selected.some(entry => entry.size > LIMITS.sourceBytes) || totalBytes() + selected.reduce((sum, entry) => sum + entry.size, 0) > LIMITS.totalBytes) { file.value = ''; setStatus('单文件最多2 MiB，所有来源合计最多8 MiB，请拆分。', true); return; }
      await run('正在读取本地日志…', async signal => {
        const added = [], format = importFormat.value, offset = importOffset.value;
        for (const entry of selected) {
          if (signal.aborted || destroyed) return;
          setStatus(`正在读取 ${entry.name}…`);
          const buffer = await new Promise((resolve, reject) => {
            reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`${entry.name}读取失败，请检查权限。`));
            reader.onabort = () => { const error = new Error('已取消读取。'); error.name = 'AbortError'; reject(error); };
            reader.readAsArrayBuffer(entry);
          });
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
          catch { throw new Error(`${entry.name}不是有效UTF-8，请先另存UTF-8；本次所选文件未加入来源列表。`); }
          added.push({ name: entry.name, text, format, offset });
        }
        if (signal.aborted || destroyed) return;
        inputs.push(...added); file.value = ''; invalidate(); renderSources(); setStatus(`已添加${added.length}份日志，可为每份分别设置时间格式与固定偏移。`);
      });
      file.value = '';
    }
    async function generate() {
      result = null; renderResult();
      await run('正在解析日志…', async signal => {
        const computed = await buildTimeline(inputs, { signal, onProgress: progress => setStatus(progress.phase === 'sort' ? '正在稳定排序UTC事件…' : `正在解析 ${progress.name}，已处理至第${progress.line}行…`) });
        if (signal.aborted || destroyed) return;
        result = computed; eventPage = unparsedPage = 0; renderResult();
        setStatus(`已解析${result.stats.eventLines}条事件，${result.stats.unparsedLines}条无法解析，${result.stats.sameInstantGroups}个同刻组。${canSave() ? '核对来源后可保存副本。' : '当前应用缺少副本保护保存接口，导出需更新基础工作台。'}`);
      });
    }
    function pager(total, page, onPage) {
      const pages = Math.max(1, Math.ceil(total / 25));
      return h('div', { class: 't006__row' }, h('button', { class: 'btn btn--sm', dataset: { pageDisabled: String(page <= 0) }, onclick: () => onPage(Math.max(0, page - 1)) }, '上一页'), h('span', { class: 't006__note' }, `第${page + 1}/${pages}页，共${total}条；每页25条`), h('button', { class: 'btn btn--sm', dataset: { pageDisabled: String(page + 1 >= pages) }, onclick: () => onPage(Math.min(pages - 1, page + 1)) }, '下一页'));
    }
    function table(headers, rows) { return h('div', { class: 't006__scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...headers.map(label => h('th', {}, label)))), h('tbody', {}, ...rows))); }
    function renderResult() {
      statsHost.replaceChildren(); timelineHost.replaceChildren(); unparsedHost.replaceChildren();
      if (!result) { timelineHost.append(h('p', { class: 't006__note' }, '生成后按UTC毫秒排序，同刻组以蓝色显示。')); unparsedHost.append(h('p', { class: 't006__note' }, '不匹配格式、无效日期、缺失时区及空行会保留在这里，不会静默丢弃。')); return; }
      for (const [key, label] of [['sourceCount', '来源'], ['totalLines', '原始物理行'], ['eventLines', '解析事件'], ['unparsedLines', '无法解析行'], ['sameInstantGroups', '同刻组']]) statsHost.append(h('div', { class: 't006__stat' }, h('strong', {}, result.stats[key]), h('span', {}, label)));
      if (!result.timeline.length) timelineHost.append(h('p', { class: 't006__note' }, '没有可排序的事件，请检查每份日志的时间格式及固定偏移。'));
      else timelineHost.append(table(['UTC时刻 / 同刻组', '来源 / 物理行', '原时间 / 偏移', '日志原文'], result.timeline.slice(eventPage * 25, (eventPage + 1) * 25).map(event => h('tr', {}, h('td', { 'data-same': String(event.sameInstantCount > 1) }, `${event.utc}${event.sameInstantCount > 1 ? `\n同刻${event.sameInstantCount}条，保持输入顺序` : ''}`), h('td', {}, `来源${event.sourceIndex} · ${event.source}\n第${event.line}行`), h('td', {}, `${event.timestamp}\n${offsetText(event.sourceOffsetMinutes)}`), h('td', {}, h('div', { class: 't006__raw' }, event.raw))))), pager(result.timeline.length, eventPage, page => { eventPage = page; renderResult(); syncControls(); }));
      if (!result.unparsed.length) unparsedHost.append(h('p', { class: 't006__note' }, '全部物理行已解析。'));
      else unparsedHost.append(table(['来源 / 物理行', '无法解析原因', '原始行'], result.unparsed.slice(unparsedPage * 25, (unparsedPage + 1) * 25).map(entry => h('tr', {}, h('td', {}, `来源${entry.sourceIndex} · ${entry.source}\n第${entry.line}行`), h('td', {}, entry.reason), h('td', {}, h('div', { class: 't006__raw' }, entry.raw || '（空行）'))))), pager(result.unparsed.length, unparsedPage, page => { unparsedPage = page; renderResult(); syncControls(); }));
    }
    async function saveCopy(kind) {
      if (!result || !canSave()) return;
      await run('正在准备副本…', async signal => {
        const content = await serializeTimeline(result, kind, { signal });
        if (signal.aborted || destroyed) return;
        cancelButton.hidden = true; setStatus('请在保存对话框中核对新的副本路径。');
        const saved = await window.toolbox.files.saveText({ content, extension: kind, defaultName: `日志时间线.${kind}`, copyOnly: true });
        if (destroyed) return;
        if (saved?.ok) setStatus(`副本已保存：${saved.path}`); else if (saved?.canceled) setStatus('已取消保存。'); else throw new Error(saved?.error || '未确认副本保存成功。');
      });
    }
    return { activate() { if (!destroyed) syncControls(); }, deactivate() { cancel(); }, destroy() { cancel(); destroyed = true; paste.value = ''; inputs = []; result = null; root.replaceChildren(); } };
  },
};
