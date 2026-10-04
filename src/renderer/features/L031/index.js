import { h } from '../../core/ui.js';
import { LIMITS, normalizeForSelection, bindClaim, inspectBindings, validateCards, reportMarkdown } from './model.mjs';

export default {
  id: 'L031',
  create(root) {
    let raw = '', cards = [], report = null, busy = false, destroyed = false, generation = 0;
    const note = h('p', { role: 'status', 'aria-live': 'polite', class: 'l031-note' });
    const name = h('input', { type: 'text', value: 'source.txt', maxlength: '120', 'aria-label': '来源名称', oninput: changed });
    const source = h('textarea', { rows: '12', spellcheck: 'false', 'aria-label': '原文', oninput: () => { raw = source.value; changed(); } });
    const claim = h('textarea', { rows: '3', maxlength: String(LIMITS.claimChars), 'aria-label': '自己的论断' });
    const sourceFile = h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', 'aria-label': '导入原文文件', onchange: () => importFile(sourceFile, false) });
    const reportFile = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '恢复 JSON 报告', onchange: () => importFile(reportFile, true) });
    const summary = h('p', { class: 'l031-summary' });
    const list = h('div', { class: 'l031-cards' });
    const actions = h('div', { class: 'l031-actions' },
      h('button', { onclick: example }, '载入原文示例'),
      h('button', { onclick: add }, '将选中原文绑定论断'),
      h('button', { onclick: () => task(async current => { const checked = await inspectBindings(name.value, raw, cards); if (!current()) return; report = checked; render(); message('已核对全文哈希和每张卡的原始范围。'); }) }, '重新校验全部绑定'),
      h('button', { onclick: () => exportFile('json') }, '导出完整 JSON 副本'),
      h('button', { onclick: () => exportFile('md') }, '导出 Markdown 副本'));
    const shell = h('section', { class: 'feature-l031' }, h('h2', {}, '论断原文绑定'),
      h('p', {}, '写下自己的论断，用鼠标或键盘选中原文，再绑定引文与全文 SHA-256。源版本变动会使旧绑定失效，原始引文仍保留。'),
      h('p', { class: 'l031-warning' }, '仅校验来源、版本和定位；引文是否支持论断需要人工判断。输入、引文和报告保留在当前窗口内，切换功能前请导出。不会把整篇材料写入全局配置。'),
      h('label', {}, '来源名称', name), h('label', {}, '导入 UTF-8 TXT / Markdown（保留原始换行与 BOM）', sourceFile),
      h('label', {}, '原文：请选中支持论断的非空范围', source),
      h('small', {}, '原文最多1MiB UTF-8及500000 UTF-16单位；显示换行统一为LF，绑定偏移映射回原始文本。编辑原文后，新源文本采用编辑框的LF换行。'),
      h('label', {}, '自己的论断（最多2000字符）', claim), actions, note, summary, list,
      h('label', {}, '从本功能 JSON 报告恢复完整原文及论断卡', reportFile),
      h('details', {}, h('summary', {}, '范围、哈希与保存规则'), h('p', {}, '最多50张卡，每张卡至少有一个非空选区，最长10000个UTF-16单位；不切开emoji等代理对。原始偏移为左闭右开UTF-16索引，哈希针对完整原始UTF-8文本，包括CRLF与BOM。名字变化但内容相同仍保留内容绑定并提示名称差异。'), h('p', {}, '源哈希不同不自动迁移偏移，不用相似文本代替旧引文；报告恢复忽略旧状态和旧源哈希，按原文重新计算。所有计算本机完成，不访问所写路径或链接，也不执行Markdown。JSON包含完整原文，分享前请确认材料范围。')));
    root.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }), shell);
    function message(text) { if (!destroyed) note.textContent = text; }
    function controls() { shell.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = busy; }); }
    function changed() { if (destroyed) return; generation++; report = null; render(); message('源输入已改变，旧引文保留；请重新校验，不能沿用旧状态。'); }
    function render() {
      summary.textContent = report ? `论断卡 ${cards.length}/50 · 有效绑定 ${report.validCount} · 失效 ${report.invalidCount} · 当前 SHA-256 ${report.currentSource.hash}` : `论断卡 ${cards.length}/50 · 当前输入尚未校验`;
      list.replaceChildren(...cards.map(card => {
        const checked = report?.cards.find(row => row.id === card.id);
        return h('article', {}, h('h3', {}, `${card.id} · ${checked?.status === 'bound' ? '绑定有效' : checked ? '绑定失效' : '待校验'}`),
          h('p', {}, card.claim), h('p', { class: 'l031-anchor' }, `${card.sourceName} · 原始 UTF-16 [${card.rawStart},${card.rawEnd})`),
          h('p', { class: 'l031-anchor' }, `源 SHA-256 ${card.sourceHash}`), h('blockquote', {}, h('pre', {}, card.quote)),
          h('p', {}, checked?.reason || '源变化后尚未重新校验；下面保留的是绑定当时的引文。'),
          h('button', { onclick: () => { cards = cards.filter(row => row.id !== card.id); report = null; render(); message(`已移除 ${card.id}，其余卡请重新校验。`); } }, `删除 ${card.id}`));
      })); controls();
    }
    async function task(action) {
      if (busy || destroyed) return; busy = true; const ticket = generation; controls();
      try { await action(() => !destroyed && ticket === generation); }
      catch (error) { message(error.message); }
      finally { if (!destroyed && ticket === generation) { busy = false; controls(); } }
    }
    function example() {
      raw = '本地实验\r\n样本量为20。\r\n平均结果为10。'; name.value = '实验摘录.md'; source.value = normalizeForSelection(raw).display;
      claim.value = '这个本地实验使用了20个样本。'; changed();
      const start = source.value.indexOf('样本量为20'); source.focus(); source.setSelectionRange(start, start + '样本量为20。'.length);
      message('示例已选中样本数量引文；按“将选中原文绑定论断”，已有卡仍保留。');
    }
    function add() {
      const start = source.selectionStart, end = source.selectionEnd, text = claim.value, inputName = name.value, inputRaw = raw;
      task(async current => {
        if (cards.length >= LIMITS.cards) throw Error('论断卡最多50张，请先删除或导出。');
        let n = 1; while (cards.some(card => card.id === `C${n}`)) n++;
        const card = await bindClaim(inputName, inputRaw, `C${n}`, start, end, text);
        const next = [...cards, card], checked = await inspectBindings(inputName, inputRaw, next);
        if (!current()) return; cards = next; report = checked; render(); message(`${card.id}已绑定原始引文，范围和全文哈希核对一致。`);
      });
    }
    async function importFile(control, restore) {
      const file = control.files?.[0]; if (!file) return;
      await task(async current => {
        if (file.size > (restore ? 4194304 : LIMITS.sourceBytes)) throw Error(restore ? '恢复报告最多4MiB。' : '原文文件最多1MiB。');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: !restore }).decode(await file.arrayBuffer());
        let nextRaw = text, nextName = file.name, nextCards = cards;
        if (restore) {
          const input = JSON.parse(text);
          if (input?.feature !== 'L031' || input.schemaVersion !== 1 || !input.currentSource || typeof input.currentSource.text !== 'string') throw Error('不是支持的L031版本1完整报告。');
          nextRaw = input.currentSource.text; nextName = input.currentSource.name; nextCards = validateCards(input.cards);
        }
        const checked = await inspectBindings(nextName, nextRaw, nextCards), normalized = normalizeForSelection(nextRaw);
        if (!current()) return; raw = nextRaw; name.value = nextName; source.value = normalized.display; cards = nextCards; report = checked; render();
        message(restore ? '已恢复原文与卡，重新计算哈希及状态；报告中的旧状态未直接采用。' : '原文已导入并重新校验全部旧卡；保留了文件的原始换行和BOM。');
      }); if (!destroyed) control.value = '';
    }
    function exportFile(extension) {
      task(async current => {
        const files = window.toolbox?.files;
        if (files?.saveTextSupportsCopyOnly !== true || typeof files.saveText !== 'function') throw Error('当前版本缺少安全副本保存能力，请更新工具箱。');
        const checked = await inspectBindings(name.value, raw, cards); if (!current()) return;
        report = checked; render();
        const result = await files.saveText({ content: extension === 'json' ? JSON.stringify(checked, null, 2) : reportMarkdown(checked), extension, defaultName: `L031-论断引文.${extension}`, copyOnly: true });
        if (!current()) return; message(result?.ok ? '已保存完整新副本，包含当前校验状态与原始引文。' : result?.canceled ? '已取消保存，材料仍在当前窗口。' : `保存失败：${result?.error || '未确认成功'}`);
      });
    }
    render();
    return { activate() {}, deactivate() {}, destroy() { destroyed = true; generation++; raw = ''; cards = []; report = null; root.replaceChildren(); } };
  },
};
