import { h } from '../../core/ui.js';
import { MODEL_VERSION, PREDICATES, getPredicate, reduceInput, prepareStoredState, validateStoredState, reportMarkdown } from './model.mjs';

const KEY = 'features.L021.state';
const PAGE_SIZE = 25;
const STATUS = { running: '运行中', completed: '已完成', cancelled: '已取消', limit: '达到上限', rejected: '起始输入通过', unverified: '未能验证' };
const PHASE = { initial: '初始验证', reduce: '删除缩减', verify: '逐元素证据' };
export default {
  id: 'L021',
  create(root, ctx = {}) {
    root.classList.add('feature-l021');
    let draft = { source: '[1,2,3,7,9]', predicateId: PREDICATES[0].id, mode: 'auto', maxAttempts: '1024' };
    let report = null; let progress = null; let trace = []; let selected = 0; let page = 0; let follow = true;
    let running = false; let controller = null; let waitTimer = null; let resume = null; let saveTimer = null; let destroyed = false; let exporting = false; let restoreNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try {
        validateStoredState(saved); getPredicate(saved.predicateId);
        if (typeof saved.source !== 'string' || !['auto', 'step'].includes(saved.mode) || typeof saved.maxAttempts !== 'string') throw new Error('草稿结构无效。');
        draft = { source: saved.source, predicateId: saved.predicateId, mode: saved.mode, maxAttempts: saved.maxAttempts };
        restoreNotice = '已恢复草稿。尝试轨迹只保留在当前页面和导出文件中，需重新运行验证；不会恢复未完成任务。';
      } catch (error) { restoreNotice = `保存草稿未能恢复：${error.message} 旧配置未被自动覆盖。`; }
    }
    const notice = h('div', { class: 'l021-notice', role: 'status', 'aria-live': 'polite' }, restoreNotice);
    const storageNotice = h('div', { class: 'l021-storage', role: 'status' });
    const editor = h('div', { class: 'l021-editor' }); const output = h('div', { class: 'l021-output' });
    function message(text, error = false) { if (!destroyed) { notice.textContent = text; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState(draft); }
      catch (error) { storageNotice.textContent = `${error.message} 当前输入未写入全局配置，关闭后只能恢复较早草稿；请导出完整JSON，切走不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`保存草稿失败：${error.message} 请导出记录。`, true)); }
      catch (error) { message(`保存草稿失败：${error.message} 请导出记录。`, true); }
    }
    function changed() { report = null; progress = null; trace = []; selected = 0; page = 0; renderOutput(); if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
    function releaseWait() { if (waitTimer !== null) clearTimeout(waitTimer); waitTimer = null; const resolve = resume; resume = null; if (resolve) resolve(); }
    function cancel() { controller?.abort(); releaseWait(); if (running) message('正在取消；已保留尝试，未完成结果不标为1-minimal。'); }
    function waitForNext() {
      return new Promise((resolve) => {
        resume = resolve;
        if (controller.signal.aborted) { releaseWait(); return; }
        if (draft.mode === 'auto') waitTimer = setTimeout(releaseWait, 80);
        if (!destroyed) renderOutput();
      });
    }
    function select(label, value, values, update) {
      const control = h('select', { class: 'field', disabled: running, 'aria-label': label, onchange: () => { if (running) return; update(control.value); changed(); renderEditor(); } }, values.map((option) => h('option', { value: option.value }, option.label)));
      control.value = value; return h('label', { class: 'l021-field' }, h('span', {}, label), control);
    }
    function renderEditor() {
      const source = h('textarea', { class: 'field', rows: '4', maxlength: '8000', disabled: running, 'aria-label': '输入JSON整数数组', oninput: () => { if (running) return; draft.source = source.value; changed(); } }); source.value = draft.source;
      const max = h('input', { class: 'field', type: 'number', min: '1', max: '1024', step: '1', disabled: running, 'aria-label': '尝试上限', oninput: () => { if (running) return; draft.maxAttempts = max.value; changed(); } }); max.value = draft.maxAttempts;
      editor.replaceChildren(
        h('div', { class: 'l021-actions' }, PREDICATES.map((predicate) => h('button', { class: 'btn', disabled: running, onclick: () => { draft = { ...draft, predicateId: predicate.id, source: predicate.example }; changed(); renderEditor(); message(`已载入${predicate.name}示例，请开始缩减。`); } }, `载入${predicate.name}示例`))),
        h('label', { class: 'l021-field' }, h('span', {}, '输入JSON整数数组（最多128个元素）'), source),
        h('p', { class: 'l021-muted' }, '只删除元素并保留顺序；接受安全整数，不接受嵌套、字符串或小数。不会执行用户代码。重复值按原始位置区分。'),
        h('div', { class: 'l021-parameters' }, select('内置失败谓词', draft.predicateId, PREDICATES.map((predicate) => ({ value: predicate.id, label: predicate.name })), (value) => { draft.predicateId = value; }), select('执行方式', draft.mode, [{ value: 'auto', label: '自动（每次让出80ms）' }, { value: 'step', label: '手动继续一步' }], (value) => { draft.mode = value; }), h('label', { class: 'l021-field' }, h('span', {}, '尝试上限（含初始及证据检查）'), max)),
        h('p', {}, `失败条件：${getPredicate(draft.predicateId).rule}`),
        h('div', { class: 'l021-actions' }, h('button', { class: 'btn primary', disabled: running, onclick: start }, '开始缩减'), h('button', { class: 'btn', disabled: !running, onclick: cancel }, '取消缩减')),
      );
    }
    async function start() {
      if (running || destroyed) return;
      running = true; report = null; progress = null; trace = []; selected = 0; page = 0; follow = true; controller = new AbortController(); renderEditor(); renderOutput(); persist();
      try {
        const value = await reduceInput(draft.source, draft.predicateId, {
          signal: controller.signal, maxAttempts: Number(draft.maxAttempts), yieldControl: waitForNext,
          onAttempt: (attempt, state) => { if (destroyed) return; trace.push(attempt); progress = state; if (follow) { selected = trace.length - 1; page = Math.floor(selected / PAGE_SIZE); } renderOutput(); },
        });
        if (!destroyed) { report = value; progress = null; trace = value.trace; message(value.message, value.status === 'rejected' || value.status === 'unverified'); }
      } catch (error) { if (!destroyed) message(error.message, true); }
      finally { releaseWait(); running = false; controller = null; if (!destroyed) { renderEditor(); renderOutput(); persist(); } }
    }
    function currentReport() { return report || (progress ? { ...progress, trace: [...trace] } : null); }
    function pick(index) { if (!trace.length) return; selected = Math.max(0, Math.min(trace.length - 1, index)); page = Math.floor(selected / PAGE_SIZE); follow = false; renderOutput(); }
    function chips(values, indices) { return h('div', { class: 'l021-chips' }, values.length ? values.map((value, index) => h('span', { class: 'l021-chip' }, h('strong', {}, String(value)), h('small', {}, `原位${indices[index]}`))) : h('span', { class: 'l021-muted' }, '[] 空数组')); }
    async function exportReport(extension) {
      if (exporting) return;
      const files = window.toolbox?.files;
      if (!files?.saveTextSupportsCopyOnly) { message('当前基础层缺少防覆盖导出能力，请升级后导出。', true); return; }
      const snapshot = currentReport(); exporting = true;
      try {
        const payload = { feature: 'L021', schemaVersion: 1, modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), draft: { ...draft }, result: snapshot };
        const response = await files.saveText({ content: extension === 'json' ? JSON.stringify(payload, null, 2) : reportMarkdown(snapshot), extension, defaultName: `L021-reduction.${extension}`, copyOnly: true });
        message(response?.ok ? `已导出新文件；${snapshot?.minimality.verified ? '包含完整1-minimal证据。' : '属于草稿或未完成轨迹，不声称1-minimal。'}` : response?.canceled ? '已取消导出，输入与轨迹仍保留。' : `导出失败：${response?.error || '未确认保存成功'}`, !response?.ok && !response?.canceled);
      } catch (error) { message(`导出失败：${error.message}`, true); }
      finally { exporting = false; }
    }
    function renderOutput() {
      const value = currentReport();
      if (!value) { output.replaceChildren(h('p', {}, running ? '准备验证初始输入…' : '选择内置条件后开始；必须先证明原数组失败，才进行删除。'), h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON')); return; }
      const attempt = trace[selected]; const pageCount = Math.ceil(trace.length / PAGE_SIZE);
      const followControl = h('input', { type: 'checkbox', checked: follow, 'aria-label': '跟随最新尝试', onchange: () => { follow = followControl.checked; if (follow) { selected = trace.length - 1; page = Math.floor(selected / PAGE_SIZE); } renderOutput(); } }); followControl.checked = follow;
      const range = h('input', { type: 'range', min: '1', max: String(trace.length), step: '1', 'aria-label': '查看尝试序号', oninput: () => pick(Number(range.value) - 1) }); range.value = String(selected + 1);
      output.replaceChildren(
        h('div', { class: 'l021-summary' }, `${STATUS[value.status] || value.status} · 尝试 ${value.attemptCount}/${value.maxAttempts} · 元素 ${value.initial.length} → ${value.final.length}`),
        h('p', {}, `当前保留数组：${JSON.stringify(value.final)}；失败证据来自尝试 ${value.failureEvidenceStep ?? '尚无'}。`), chips(value.final, value.finalIndices),
        h('div', { class: `l021-proof-status${value.minimality.verified ? ' is-verified' : ''}` }, value.minimality.verified ? '1-minimal已验证：当前仍失败，删除任一剩余位置均通过。未证明全局最小。' : '1-minimal尚未验证；取消、达到上限或起始通过均不能标为完成。'),
        h('div', { class: 'l021-actions' }, running && draft.mode === 'step' ? h('button', { class: 'btn primary', onclick: releaseWait }, '继续一步') : document.createDocumentFragment(), h('label', { class: 'l021-toggle' }, followControl, '跟随最新尝试'), h('button', { class: 'btn', disabled: selected === 0, onclick: () => pick(selected - 1) }, '上一次尝试'), h('button', { class: 'btn', disabled: selected === trace.length - 1, onclick: () => pick(selected + 1) }, '下一次尝试'), range),
        attempt ? h('div', { class: `l021-attempt ${attempt.verdict === 'fail' ? 'is-fail' : 'is-pass'}` }, h('strong', {}, `尝试${attempt.step} · ${PHASE[attempt.phase]} · ${attempt.verdict === 'fail' ? '失败 fail' : '通过 pass'}`), h('p', {}, `删除原始位置 ${JSON.stringify(attempt.removedIndices)}${attempt.granularity ? `；分块数参数 ${attempt.granularity}` : ''}。${attempt.reason}。`), chips(attempt.candidate, attempt.keptIndices), h('p', {}, `候选：${JSON.stringify(attempt.candidate)} · ${attempt.accepted ? '接受此删除' : attempt.phase === 'reduce' ? '拒绝此删除' : '证据检查，无额外删除'}`)) : document.createDocumentFragment(),
        h('div', { class: 'l021-table-scroll' }, h('table', {}, h('caption', {}, `每次尝试完整轨迹 · 第${page + 1}/${pageCount}页 · 每页${PAGE_SIZE}条，点击序号查看候选`), h('thead', {}, h('tr', {}, ['序号', '阶段', '删除原始位置', '候选长度', '判定', '接受删除'].map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, trace.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => h('tr', { class: row.step === attempt?.step ? 'is-current' : '' }, h('td', {}, h('button', { 'aria-label': `查看尝试${row.step}`, onclick: () => pick(row.step - 1) }, String(row.step))), [PHASE[row.phase], JSON.stringify(row.removedIndices), row.candidate.length, row.verdict, row.accepted ? '是' : '否'].map((cell) => h('td', {}, String(cell)))))))),
        h('div', { class: 'l021-actions' }, h('button', { class: 'btn', disabled: page === 0, onclick: () => pick((page - 1) * PAGE_SIZE) }, '上一页轨迹'), h('button', { class: 'btn', disabled: page === pageCount - 1, onclick: () => pick((page + 1) * PAGE_SIZE) }, '下一页轨迹')),
        h('h3', {}, '逐元素删除证据（原始位置从0开始）'), value.minimality.checks.length ? h('ul', {}, value.minimality.checks.map((check) => h('li', {}, `删除原位${check.removedOriginalIndex}的值${check.removedValue} → ${JSON.stringify(check.candidate)} → ${check.verdict}（尝试${check.traceStep}）`))) : h('p', {}, '尚无逐元素证据。'),
        h('div', { class: 'l021-actions' }, h('button', { class: 'btn', onclick: () => exportReport('json') }, '导出完整 JSON'), h('button', { class: 'btn', onclick: () => exportReport('md') }, '导出缩减 Markdown')),
      );
    }
    root.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('h2', {}, '失败输入缩减器'), h('p', {}, '删除无关片段，保留失败条件；用逐元素证据区分局部不可再删与全局最小。'), notice, storageNotice, h('details', {}, h('summary', {}, '算法、判定与保存范围'), h('p', {}, 'ddmin删除补集路径：从两块开始尝试删除每块；候选仍失败才接受，否则增大分块粒度。结束后另行逐元素删除验证。只删除原数组位置，保持值和顺序。'), h('p', {}, 'fail表示触发内置失败条件，pass表示不触发；这里不执行实际程序，不接收自定义代码。最终仍失败且每个单位置删除都通过，才标为1-minimal。非单调谓词与搜索顺序可使结果不是全局最小。'), h('p', {}, '最多128个安全整数、8000字符、1024次判定（含初始与证据）。每次判定后异步让出；取消/切走立即停止等待，保留未完成轨迹；手动模式用“继续一步”推进。'), h('p', {}, '全局配置仅保存≤64KiB草稿，不保存结果/轨迹；恢复后需重新运行。导出完整JSON和Markdown记录，文件禁止覆盖已有目标。')), editor, output);
    renderEditor(); renderOutput();
    return { activate() {}, deactivate() { cancel(); persist(); }, destroy() { destroyed = true; controller?.abort(); releaseWait(); persist(); root.replaceChildren(); root.classList.remove('feature-l021'); } };
  },
};
