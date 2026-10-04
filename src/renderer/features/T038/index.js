import { h } from '../../core/ui.js';
import { parseColor, createReport, SOURCE } from './model.mjs';

export default {
  id: 'T038',
  create(root) {
    let rows = []; let report = null; let counter = 0; let disposed = false;
    const editor = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const output = h('div', { 'aria-live': 'polite' });
    const status = h('p', { role: 'status' });
    const addButton = h('button', { class: 'btn', onclick: () => add({ foreground: '#777777', background: '#FFFFFF', fontPt: 12, bold: false }) }, '添加配色');
    const exportButton = h('button', { class: 'btn', disabled: true, onclick: save }, '导出 JSON 报告副本');
    root.append(h('p', {}, '输入最终文字前景／背景色和字号（pt）。支持 #RGB、#RRGGBB，最多 40 组，全程在本机计算。'),
      h('p', { class: 'faint' }, '普通文本阈值 4.5:1；至少 18pt 或 14pt 粗体按大文本 3:1 检查。只检查文本对比度，不代表完整无障碍合规。'),
      h('p', { class: 'faint' }, '不支持透明色、渐变、图片背景；细笔画、特殊字体、抗锯齿或图片中文字的实际尺寸仍需人工检查。'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, addButton,
        h('button', { class: 'btn', onclick: () => { editor.replaceChildren(); rows = []; add({ label: '黑对白', foreground: '#000000', background: '#FFFFFF', fontPt: 12, bold: false }); add({ label: '普通灰字', foreground: '#777777', background: '#FFFFFF', fontPt: 12, bold: false }); add({ label: '大号灰字', foreground: '#777777', background: '#FFFFFF', fontPt: 18, bold: false }); run(); } }, '载入示例'),
        h('button', { class: 'btn btn--primary', onclick: run }, '检查配色'), exportButton), editor, status, output,
      h('p', { class: 'faint' }, `计算依据：${SOURCE}`));
    function labelControl(label, control) { return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, label, control); }
    function invalidate() { report = null; exportButton.disabled = true; output.replaceChildren(); status.textContent = '输入已改变，请重新检查。'; }
    function add(initial) {
      if (rows.length >= 40) { status.textContent = '最多 40 组。'; return; }
      const key = ++counter;
      const label = h('input', { class: 'field', value: initial.label || `配色 ${key}`, maxlength: 120, oninput: invalidate });
      const foreground = h('input', { class: 'field', value: initial.foreground, 'aria-label': `前景色 ${key}`, oninput: invalidate });
      const background = h('input', { class: 'field', value: initial.background, 'aria-label': `背景色 ${key}`, oninput: invalidate });
      const font = h('input', { class: 'field', type: 'number', min: '0.01', max: 1000, step: '0.1', value: initial.fontPt, 'aria-label': `字号 pt ${key}`, oninput: invalidate });
      const bold = h('input', { type: 'checkbox', checked: initial.bold, 'aria-label': `粗体 ${key}`, onchange: invalidate });
      const row = { label, foreground, background, font, bold };
      function picker(control, text) {
        let value; try { value = parseColor(control.value).hex; } catch { value = '#000000'; }
        const field = h('input', { type: 'color', value, 'aria-label': `${text}取色 ${key}`, oninput: () => { control.value = field.value; invalidate(); } });
        control.addEventListener('change', () => { try { field.value = parseColor(control.value).hex; } catch { /* typed validation remains visible */ } });
        return field;
      }
      const host = h('fieldset', { style: { border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' } },
        h('legend', {}, `配色 ${key}`), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'end' } },
          labelControl('名称', label), labelControl('前景', foreground), picker(foreground, '前景'), labelControl('背景', background), picker(background, '背景'),
          labelControl('字号 pt', font), labelControl('粗体', bold),
          h('button', { class: 'btn', onclick: () => { host.remove(); rows = rows.filter((item) => item !== row); addButton.disabled = false; invalidate(); } }, '移除')));
      row.host = host; rows.push(row); editor.append(host); addButton.disabled = rows.length >= 40; invalidate();
    }
    function run() {
      try {
        report = createReport(rows.map((row) => ({ label: row.label.value, foreground: row.foreground.value, background: row.background.value, fontPt: Number(row.font.value), bold: row.bold.checked })));
        output.replaceChildren(...report.results.map((result, index) => {
          if (!result.ok) return h('div', { class: 'card' }, h('strong', {}, `${result.index}. ${result.label}`), h('p', {}, `输入无效：${result.error}`));
          const row = rows[index];
          return h('div', { class: 'card' }, h('strong', {}, `${result.label}：${result.pass ? '通过' : '未通过'} AA ${result.large ? '大文本' : '普通文本'}阈值`),
            h('p', {}, `对比度 ${result.ratio.toFixed(3)}:1 · 阈值 ${result.threshold}:1 · ${result.fontPt}pt${result.bold ? ' 粗体' : ''}`),
            h('p', { style: { padding: '14px', color: result.foreground, backgroundColor: result.background, fontSize: `${result.fontPt}pt`, fontWeight: result.bold ? '700' : '400', maxHeight: '180px', overflow: 'auto' } }, '配色预览 Abc 123 示例文字'),
            h('p', { class: 'faint' }, '显示值保留三位小数；通过结论依据未四舍五入的完整精度。'),
            ...result.candidates.map((candidate) => h('p', {}, `${candidate.direction}候选 ${candidate.foreground}，对比度 ${candidate.ratio.toFixed(3)}:1 `,
              h('button', { class: 'btn btn--sm', onclick: () => { row.foreground.value = candidate.foreground; invalidate(); run(); } }, '应用到前景'))),
            !result.pass ? h('p', { class: 'faint' }, '候选只沿前景向黑／白插值并验证阈值，不承诺全色域最小改动。') : null);
        }));
        const invalid = report.results.filter((result) => !result.ok).length;
        status.textContent = `已检查 ${report.results.length} 组；${invalid} 组输入无效，报告会如实记录。`;
        exportButton.disabled = false;
      } catch (error) { report = null; exportButton.disabled = true; output.replaceChildren(); status.textContent = error.message; }
    }
    async function save() {
      if (!report) return;
      if (window.toolbox?.files?.saveTextSupportsCopyOnly !== true) { status.textContent = '当前后端不支持安全副本导出，请先合入功能工作台基础 PR。'; return; }
      const content = JSON.stringify(report, null, 2); exportButton.disabled = true;
      try {
        const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '文字配色对比度报告.json', copyOnly: true });
        if (disposed) return;
        status.textContent = result?.ok ? `已保存报告副本：${result.path}` : result?.canceled ? '已取消保存。' : result?.error || '保存失败。';
      } catch (error) { if (!disposed) status.textContent = `保存失败：${error.message}`; }
      finally { if (!disposed) exportButton.disabled = !report; }
    }
    add({ label: '黑对白', foreground: '#000000', background: '#FFFFFF', fontPt: 12, bold: false }); run();
    return { destroy() { disposed = true; rows = []; report = null; root.replaceChildren(); } };
  },
};
