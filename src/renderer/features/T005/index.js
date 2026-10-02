import { h } from '../../core/ui.js';
import { analyze, DEFAULT_RULES, LIMITS, OPERATIONS, resultText } from './model.mjs';

export default {
  id: 'T005',
  create(root) {
    let report = null, operation = 'intersection', page = 0, alive = true, busy = false, generation = 0;
    const rules = { ...DEFAULT_RULES }, inputs = {};
    const status = h('p', { role: 'status', 'aria-live': 'polite' });
    const totals = h('div'), result = h('div'), duplicate = h('div');
    const jsonButton = h('button', { class: 'btn', disabled: true, onclick: () => save(true) }, '导出完整对账 JSON');
    const textButton = h('button', { class: 'btn', disabled: true, onclick: () => save(false) }, '导出当前集合 TXT');
    const calculate = h('button', { class: 'btn btn--primary', onclick: run }, '计算五种集合');
    const selector = h('select', { class: 'field', 'aria-label': '结果集合', onchange: () => { operation = selector.value; page = 0; renderResults(); } }, ...Object.entries(OPERATIONS).map(([key, name]) => h('option', { value: key }, name)));
    const editor = label => {
      const input = h('textarea', { class: 'field', rows: 8, spellcheck: 'false', 'aria-label': '清单 ' + label, oninput: invalidate });
      inputs[label] = input;
      const file = h('input', { type: 'file', accept: '.txt,.csv,.tsv', 'aria-label': '导入清单 ' + label, onchange: async () => {
        const selected = file.files?.[0], token = ++generation;
        if (!selected) return;
        try {
          if (selected.size > LIMITS.bytes) throw Error('文件超过 2 MiB 上限。');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
          if (!alive || token !== generation) return;
          input.value = text; invalidate(); status.textContent = '已载入 ' + label + '：' + selected.name + '。请核对规则再计算。';
        } catch (error) { if (alive && token === generation) status.textContent = '导入失败：' + error.message; }
        finally { if (alive) file.value = ''; }
      } });
      return h('section', {}, h('h3', {}, '清单 ' + label), input, file);
    };
    const labels = { trim: '去除首尾空白', collapse: '连续空白合并为一个空格', nfkc: 'NFKC 宽度与兼容字符规范化', ignoreCase: '忽略大小写（Unicode 小写转换）', ignoreBlank: '忽略空白行' };
    const checks = Object.keys(rules).map(key => {
      const input = h('input', { type: 'checkbox', checked: rules[key], onchange: () => { rules[key] = input.checked; invalidate(); } });
      return h('label', {}, input, labels[key]);
    });
    root.append(h('style', {}, '.feature-t005-inputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.feature-t005-rules{display:flex;flex-wrap:wrap;gap:12px}.feature-t005-results{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}'),
      h('h2', {}, '清单集合运算'), h('p', {}, '每行是一个完整值，不解析 CSV 列。按明确规则比较，展示重复来源，输出中每个规范化值只出现一次。'),
      h('div', { class: 'feature-t005-inputs' }, editor('A'), editor('B')),
      h('h3', {}, '比较规则'), h('div', { class: 'feature-t005-rules' }, ...checks),
      h('p', { class: 'faint' }, '规则顺序：NFKC → 首尾空白 → 连续空白 → 小写；默认只去首尾空白、忽略空白行。原始行保留在 JSON 来源表。'),
      h('div', { class: 'feature-lab__actions' }, h('button', { class: 'btn', onclick: () => { inputs.A.value = '甲\n乙\n乙'; inputs.B.value = '乙\n丙'; invalidate(); run(); } }, '载入甲乙丙示例'), calculate, jsonButton, textButton),
      status, totals, selector, result, duplicate, h('p', { class: 'faint' }, '每份上限 2 MiB / 20000 行，每行 2000 字符。输入不自动存入应用配置，切换功能前请导出。'));
    function invalidate() { generation++; report = null; jsonButton.disabled = textButton.disabled = true; totals.replaceChildren(); result.replaceChildren(); duplicate.replaceChildren(); status.textContent = '输入或规则已改变，请重新计算。'; }
    function run() {
      if (!alive || busy) return;
      try {
        report = analyze(inputs.A.value, inputs.B.value, rules); page = 0;
        totals.replaceChildren(h('p', {}, 'A：' + report.A.distinct + ' 个不同值，' + report.A.repeatedLines + ' 个重复行；B：' + report.B.distinct + ' 个不同值，' + report.B.repeatedLines + ' 个重复行。'),
          h('p', {}, Object.entries(OPERATIONS).map(([key, label]) => label + '：' + report.counts[key]).join('；')));
        status.textContent = '已计算。集合去重，重复明细保留原始行号与原文。'; jsonButton.disabled = textButton.disabled = false;
        renderResults(); renderDuplicates();
      } catch (error) { report = null; jsonButton.disabled = textButton.disabled = true; status.textContent = error.message; }
    }
    function renderResults() {
      if (!report) return;
      const list = report.values[operation], pages = Math.max(1, Math.ceil(list.length / 100));
      page = Math.min(page, pages - 1);
      result.replaceChildren(h('p', {}, OPERATIONS[operation] + ' · ' + list.length + ' 项 · 第 ' + (page + 1) + ' / ' + pages + ' 页'),
        h('pre', { class: 'feature-t005-results', 'aria-label': '集合结果预览' }, list.length ? list.slice(page * 100, (page + 1) * 100).map(value => value === '' ? '（空字符串）' : value).join('\n') : '（空集）'),
        h('button', { class: 'btn', disabled: page === 0, onclick: () => { page--; renderResults(); } }, '上一页'),
        h('button', { class: 'btn', disabled: page + 1 >= pages, onclick: () => { page++; renderResults(); } }, '下一页'));
    }
    function renderDuplicates() {
      duplicate.replaceChildren(h('h3', {}, '重复项来源（每份预览前 20 个，完整内容见 JSON）'),
        ...['A', 'B'].map(label => h('section', {}, h('h4', {}, '清单 ' + label + ' · ' + report[label].duplicateValues + ' 个重复值'),
          report[label].duplicates.length ? h('ul', {}, ...report[label].duplicates.slice(0, 20).map(item => h('li', {}, JSON.stringify(item.value) + ' · 行 ' + item.occurrences.map(source => source.line).join('、') + ' · 原文：' + item.occurrences.slice(0, 5).map(source => JSON.stringify(source.original)).join(' / ')))) : h('p', {}, '没有重复项。'),
          h('p', { class: 'faint' }, '忽略的空白行：' + (report[label].ignoredLines.slice(0, 50).join('、') || '无') + (report[label].ignoredLines.length > 50 ? ' … 完整行号见 JSON' : '')))));
    }
    async function save(json) {
      if (!report || busy || !alive) return;
      try {
        if (window.toolbox?.files?.saveTextSupportsCopyOnly !== true) throw Error('当前版本缺少防覆盖导出接口。');
        const content = json ? JSON.stringify({ ...report, selectedOperation: operation }, null, 2) : resultText(report, operation);
        busy = true; jsonButton.disabled = textButton.disabled = calculate.disabled = true;
        const outcome = await window.toolbox.files.saveText({ content, extension: json ? 'json' : 'txt', defaultName: json ? '清单集合对账.json' : '清单_' + operation + '.txt', copyOnly: true });
        if (alive) status.textContent = outcome?.ok ? '副本已保存：' + outcome.path : outcome?.canceled ? '已取消保存。' : outcome?.error || '未确认保存成功。';
      } catch (error) { if (alive) status.textContent = error.message; }
      finally { busy = false; if (alive) { calculate.disabled = false; jsonButton.disabled = textButton.disabled = !report; } }
    }
    return { deactivate() { generation++; }, destroy() { alive = false; generation++; report = null; root.replaceChildren(); } };
  },
};
