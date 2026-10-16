import { h } from '../../core/ui.js';
import { appendObservation, buildReport, commitPrediction, compareObservation, createLedger, prepareStoredState, reportMarkdown, restoreLedger, validateStoredState } from './model.mjs';

const KEY = 'features.L004.state';
const initialPrediction = () => ({ title: '', type: 'number', rawValue: '', unit: '', optionsText: '上升\n持平\n下降', rationale: '' });
const initialObservation = () => ({ rawValue: '', unit: '', observedAt: '', missing: false, note: '' });
const localTime = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
};

export default {
  id: 'L004',
  create(root, ctx = {}) {
    root.classList.add('feature-l004');
    let ledger = createLedger();
    let selectedId = '';
    let revisesId = null;
    let predictionDraft = initialPrediction();
    let observationDraft = initialObservation();
    let timer = null;
    let destroyed = false;
    let exporting = false;
    let initialNotice = '';
    const saved = ctx.config?.get(KEY);
    if (saved) {
      try {
        validateStoredState(saved);
        ledger = restoreLedger(saved.ledger);
        selectedId = ledger.predictions.some((row) => row.id === saved.selectedId) ? saved.selectedId : ledger.predictions.at(-1)?.id || '';
        if (saved.predictionDraft && Object.keys(initialPrediction()).every((key) => typeof saved.predictionDraft[key] === 'string')) predictionDraft = { ...saved.predictionDraft };
        if (saved.observationDraft && ['rawValue', 'unit', 'observedAt', 'note'].every((key) => typeof saved.observationDraft[key] === 'string')) observationDraft = { ...saved.observationDraft, missing: saved.observationDraft.missing === true };
        revisesId = ledger.predictions.some((row) => row.id === saved.revisesId && !ledger.predictions.some((next) => next.revisesId === row.id)) ? saved.revisesId : null;
      } catch (error) { initialNotice = `保存的账本未能恢复：${error.message} 当前未覆盖旧配置。`; }
    }
    const notice = h('div', { class: 'l004-notice', role: 'status', 'aria-live': 'polite' }, initialNotice);
    const storageNotice = h('div', { class: 'l004-storage-notice', role: 'status', 'aria-live': 'polite' });
    const body = h('div', { class: 'l004-body' });
    function message(value, error = false) { if (!destroyed) { notice.textContent = value; notice.classList.toggle('is-error', error); } }
    function persist() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!ctx.config?.set) return;
      let state;
      try { state = prepareStoredState({ ledger, selectedId, revisesId, predictionDraft, observationDraft }); }
      catch (error) { storageNotice.textContent = `${error.message} 当前内容未写入配置；关闭后可能只恢复较早的记录。请导出整个账本，切走或关闭不能保存超限内容。`; return; }
      storageNotice.textContent = '';
      try { Promise.resolve(ctx.config.set(KEY, state)).catch((error) => message(`本机保存失败，当前页面记录仍保留：${error.message}`, true)); }
      catch (error) { message(`本机保存失败，当前页面记录仍保留：${error.message}`, true); }
    }
    function later() { if (timer) clearTimeout(timer); timer = setTimeout(persist, 250); }
    function field(label, value, update, { multiline = false, disabled = false, type = 'text', max = 2000, placeholder = '' } = {}) {
      const control = h(multiline ? 'textarea' : 'input', { class: 'field', type: multiline ? null : type, rows: multiline ? '3' : null, step: type === 'datetime-local' ? '0.001' : null, maxlength: String(max), disabled, 'aria-label': label, placeholder, oninput: () => { update(control.value); later(); } });
      control.value = value;
      return h('label', { class: 'l004-field' }, h('span', {}, label), control);
    }
    function select(label, value, options, update, disabled = false) {
      const control = h('select', { class: 'field', disabled, 'aria-label': label, onchange: () => { update(control.value); persist(); render(); } }, options.map((option) => h('option', { value: option.value }, option.label)));
      control.value = value;
      return h('label', { class: 'l004-field' }, h('span', {}, label), control);
    }
    function loadRevision(prediction) {
      revisesId = prediction.id;
      predictionDraft = { title: prediction.title, type: prediction.type, rawValue: prediction.rawValue, unit: prediction.unit, optionsText: prediction.options.join('\n'), rationale: '' };
      persist(); render(); message(`基于 ${prediction.id} 追加 v${prediction.version + 1}；只修改预测值与依据，旧版本保持原样。`);
    }
    function registerPrediction() {
      try {
        ledger = commitPrediction(ledger, { ...predictionDraft, options: predictionDraft.optionsText.split('\n').map((line) => line.trim()).filter(Boolean) }, revisesId);
        selectedId = ledger.predictions.at(-1).id;
        observationDraft = { ...initialObservation(), unit: ledger.predictions.at(-1).unit };
        revisesId = null;
        predictionDraft = initialPrediction();
        persist(); render(); message(`预测 ${selectedId} 已锁定在当前账本。后续修改只能追加版本。`);
      } catch (error) { message(error.message, true); }
    }
    function registerObservation() {
      try {
        if (!observationDraft.observedAt || !Number.isFinite(new Date(observationDraft.observedAt).getTime())) throw new Error('请填写实际观察时间；可点“填入当前本机时间”。');
        ledger = appendObservation(ledger, { ...observationDraft, predictionId: selectedId, observedAt: new Date(observationDraft.observedAt).toISOString() });
        const prediction = ledger.predictions.find((row) => row.id === selectedId);
        observationDraft = { ...initialObservation(), unit: prediction.unit };
        persist(); render(); message('观察已追加，原始预测没有改动。偏差只针对所选版本计算。');
      } catch (error) { message(error.message, true); }
    }
    async function exportLedger(format) {
      if (exporting || !ledger.predictions.length) return false;
      try {
        if (!window.toolbox?.files?.saveTextSupportsCopyOnly) throw new Error('当前版本缺少防覆盖保存接口，暂不能导出。');
        const content = format === 'json' ? `${JSON.stringify(buildReport(ledger), null, 2)}\n` : reportMarkdown(ledger);
        exporting = true; render();
        const result = await window.toolbox.files.saveText({ content, extension: format, defaultName: `预测观察对账.${format}`, copyOnly: true });
        if (destroyed) return false;
        if (result?.ok) { message(`整个账本已导出：${result.path}`); return true; }
        message(result?.canceled ? '已取消导出，账本保留。' : result?.error || '导出失败，账本保留。', !result?.canceled);
      } catch (error) { message(error.message, true); }
      finally { exporting = false; if (!destroyed) render(); }
      return false;
    }
    function renderPrediction() {
      const previous = ledger.predictions.find((row) => row.id === revisesId);
      const panel = h('section', { class: 'l004-panel' }, h('span', { class: 'l004-kicker' }, '01 / COMMIT BEFORE OBSERVING'), h('h3', {}, previous ? `追加预测版本 · v${previous.version + 1}` : '登记新预测'),
        h('p', { class: 'faint' }, '提交时间由本机自动记录。提交后锁定，不提供覆盖编辑或删除已提交预测。'),
        field('预测主题', predictionDraft.title, (value) => { predictionDraft.title = value; }, { max: 200, disabled: !!previous, placeholder: '例如：纸桥在固定条件下的承重' }),
        select('预测类型', predictionDraft.type, [{ value: 'number', label: '数值' }, { value: 'enum', label: '枚举标签' }], (value) => { predictionDraft.type = value; predictionDraft.rawValue = ''; if (value === 'enum') predictionDraft.unit = ''; }, !!previous));
      if (predictionDraft.type === 'enum') {
        panel.append(field('枚举选项（每行一条，2至30项）', predictionDraft.optionsText, (value) => { predictionDraft.optionsText = value; }, { multiline: true, disabled: !!previous }),
          select('预测标签', predictionDraft.rawValue, [{ value: '', label: '请选择标签' }, ...[...new Set(predictionDraft.optionsText.split('\n').map((line) => line.trim()).filter(Boolean))].map((value) => ({ value, label: value }))], (value) => { predictionDraft.rawValue = value; }));
        panel.append(h('p', { class: 'faint' }, '编辑选项后点击“刷新标签列表”；实际结果可能不在预期内时，请事先定义“其他”标签。'), h('button', { class: 'btn btn--sm', onclick: render }, '刷新标签列表'));
      } else panel.append(field('数值预测', predictionDraft.rawValue, (value) => { predictionDraft.rawValue = value; }, { max: 100, placeholder: '例如 10；支持小数和科学计数法' }), field('预测单位（留空表示无单位）', predictionDraft.unit, (value) => { predictionDraft.unit = value; }, { max: 100, disabled: !!previous, placeholder: '例如 g；不自动换算单位' }));
      panel.append(field('预测依据（可选）', predictionDraft.rationale, (value) => { predictionDraft.rationale = value; }, { multiline: true }),
        h('div', { class: 'l004-row' }, h('button', { class: 'btn btn--primary', disabled: exporting, onclick: registerPrediction }, previous ? '提交新版本，保留旧版' : '提交并锁定预测'),
          h('button', { class: 'btn', onclick: () => { revisesId = null; predictionDraft = initialPrediction(); persist(); render(); } }, '新主题草稿'),
          h('button', { class: 'btn', onclick: () => { revisesId = null; predictionDraft = { title: '纸桥承重示例', type: 'number', rawValue: '10', unit: 'g', optionsText: '上升\n持平\n下降', rationale: '实验前估计承重 10g。' }; persist(); render(); } }, '载入数值示例')));
      return panel;
    }
    function renderObservation() {
      const prediction = ledger.predictions.find((row) => row.id === selectedId);
      const panel = h('section', { class: 'l004-panel' }, h('span', { class: 'l004-kicker' }, '02 / OBSERVE & COMPARE'), h('h3', {}, '追加观察'));
      if (!prediction) { panel.append(h('p', { class: 'faint' }, '先提交一条预测。观察需要明确绑定一个已锁定版本。')); return panel; }
      panel.append(select('对账的预测版本', selectedId, ledger.predictions.map((row) => ({ value: row.id, label: `${row.title} · v${row.version} · ${row.id}` })), (value) => { selectedId = value; observationDraft = { ...initialObservation(), unit: ledger.predictions.find((row) => row.id === value).unit }; }),
        h('p', { class: 'l004-lock' }, `已锁定：${prediction.rawValue}${prediction.unit ? ` ${prediction.unit}` : ''} · 提交于 ${prediction.committedAt}`));
      const missing = h('input', { type: 'checkbox', onchange: () => { observationDraft.missing = missing.checked; persist(); render(); } });
      missing.checked = observationDraft.missing;
      panel.append(h('label', { class: 'l004-checkbox' }, missing, '本次缺测（必须说明原因，不把缺值当零）'));
      if (prediction.type === 'enum') panel.append(select('观察标签', observationDraft.rawValue, [{ value: '', label: '请选择实际标签' }, ...prediction.options.map((value) => ({ value, label: value }))], (value) => { observationDraft.rawValue = value; }, observationDraft.missing));
      else panel.append(field('数值观察', observationDraft.rawValue, (value) => { observationDraft.rawValue = value; }, { max: 100, disabled: observationDraft.missing }), field('观察单位', observationDraft.unit, (value) => { observationDraft.unit = value; }, { max: 100, disabled: observationDraft.missing }));
      panel.append(field('实际观察时间（本机当地时区）', observationDraft.observedAt, (value) => { observationDraft.observedAt = value; }, { type: 'datetime-local', max: 100 }),
        h('div', { class: 'l004-row' }, h('button', { class: 'btn btn--sm', onclick: () => { observationDraft.observedAt = localTime(); persist(); render(); } }, '填入当前本机时间'),
          prediction.type === 'number' ? h('button', { class: 'btn btn--sm', onclick: () => { observationDraft = { ...initialObservation(), rawValue: '13', unit: prediction.unit, observedAt: localTime(), note: '示例观察值为 13。' }; persist(); render(); } }, '填入观察13示例') : null),
        field(observationDraft.missing ? '缺测原因' : '观察说明（可选）', observationDraft.note, (value) => { observationDraft.note = value; }, { multiline: true }),
        h('button', { class: 'btn btn--primary', disabled: exporting, onclick: registerObservation }, '追加观察并对账'),
        h('p', { class: 'faint' }, '观察时间早于提交时仍可追加，但标记为回补对账。未来观察时间被拒绝。观察也只能追加，填错可补充更正说明的新记录。'));
      return panel;
    }
    function renderHistory() {
      const history = h('section', { class: 'l004-history' }, h('h3', {}, `已锁定预测 ${ledger.predictions.length} 版 · 观察 ${ledger.observations.length} 条`));
      if (!ledger.predictions.length) { history.append(h('p', { class: 'faint' }, '尚无已提交记录。可先载入预测10、观察13的示例。')); return history; }
      const report = buildReport(ledger);
      for (const prediction of [...report.predictions].reverse()) {
        const observations = ledger.observations.filter((row) => row.predictionId === prediction.id);
        const row = h('article', { class: 'l004-record' }, h('div', { class: 'l004-row' }, h('h4', {}, `${prediction.title} · v${prediction.version} (${prediction.id})`),
          h('button', { class: 'btn btn--sm', onclick: () => { selectedId = prediction.id; observationDraft = { ...initialObservation(), unit: prediction.unit }; persist(); render(); } }, `对账 ${prediction.id}`),
          h('button', { class: 'btn btn--sm', disabled: exporting || ledger.predictions.some((next) => next.revisesId === prediction.id), onclick: () => loadRevision(prediction) }, `追加修订 ${prediction.id}`)),
          h('p', { class: 'l004-pre' }, `预测：${prediction.rawValue}${prediction.unit ? ` ${prediction.unit}` : ''}；类型：${prediction.type === 'number' ? '数值' : '枚举'}`),
          h('small', { class: 'faint' }, `提交：${prediction.committedAt} · 修订自：${prediction.revisesId || '首次提交'}`),
          prediction.rationale ? h('p', { class: 'l004-pre' }, `预测依据：${prediction.rationale}`) : null,
          prediction.alreadyHadObservationAtCommit ? h('p', { class: 'l004-caution' }, '本版本提交前已登记过同主题观察；请结合实际观察时间判断是否为事后修订。') : null);
        if (!observations.length) row.append(h('p', { class: 'faint' }, '尚无观察，不计算偏差。'));
        for (const observation of observations) {
          const result = compareObservation(prediction, observation);
          row.append(h('section', { class: 'l004-observation' }, h('strong', {}, `${observation.id} · ${result.status}`),
            h('p', { class: 'l004-pre' }, `观察：${observation.missing ? '缺测' : `${observation.rawValue}${observation.unit ? ` ${observation.unit}` : ''}`}`),
            h('p', {}, prediction.type === 'number' && result.comparable ? `差值（观察−预测）：${result.difference}；绝对误差：${result.absoluteError}；相对偏差：${result.relativePercent === null ? `不计算（${result.relativeUnavailable}）` : `${result.relativePercent}%`}` : result.status),
            h('small', { class: 'faint' }, `实际观察：${observation.observedAt} · 登记：${observation.recordedAt}`),
            h('p', { class: result.timing.startsWith('观察早于') ? 'l004-caution' : 'faint' }, result.timing),
            observation.note ? h('p', { class: 'l004-pre' }, `说明：${observation.note}`) : null));
        }
        history.append(row);
      }
      return history;
    }
    function render() {
      body.replaceChildren(h('div', { class: 'l004-guide' }, h('p', {}, '差值 = 观察 − 预测；绝对误差 = |差值|；相对偏差 = 差值 / |预测| × 100%。预测为零不计算百分比。'), h('p', { class: 'faint' }, '只比较相同单位的有限数值；枚举仅核对标签是否一致。本机时间和用户填的观察时间不是可信时间戳。')),
        h('div', { class: 'l004-forms' }, renderPrediction(), renderObservation()),
        h('section', { class: 'l004-export' }, h('div', { class: 'l004-row' },
          h('button', { class: 'btn', disabled: !ledger.predictions.length || exporting, onclick: () => exportLedger('json') }, '导出整个账本 JSON'),
          h('button', { class: 'btn', disabled: !ledger.predictions.length || exporting, onclick: () => exportLedger('md') }, '导出 Markdown 对账'),
          h('button', { class: 'btn', disabled: !ledger.predictions.length || exporting, onclick: async () => { if (await exportLedger('json')) { ledger = createLedger(); selectedId = ''; revisesId = null; predictionDraft = initialPrediction(); observationDraft = initialObservation(); persist(); render(); message('旧账本已成功导出，现在是新账本。'); } } }, '导出成功后新建账本')),
          h('p', { class: 'faint' }, '导出包括所有版本、所有观察和未观察的预测。新建账本仅在导出成功后执行；保存副本不覆盖已有文件。')), renderHistory());
    }
    root.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), h('header', { class: 'l004-header' }, h('h2', {}, '预测观察对账'), h('p', { class: 'faint' }, '本地记录 · 无需 AI · 全局配置状态上限 64KiB')), notice, storageNotice, body);
    render();
    return { activate() { if (!destroyed) render(); }, deactivate() { persist(); }, destroy() { persist(); destroyed = true; if (timer) clearTimeout(timer); timer = null; root.replaceChildren(); root.classList.remove('feature-l004'); } };
  },
};
