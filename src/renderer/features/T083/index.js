import { h } from '../../core/ui.js';
import { settle, formatCents, LIMITS } from './model.mjs';

export default {
  id: 'T083',
  create(root) {
    let participants = []; let expenses = []; let report = null; let nextId = 0; let disposed = false;
    const memberHost = h('div'); const expenseHost = h('div'); const output = h('div', { 'aria-live': 'polite' }); const status = h('p', { role: 'status' });
    const saveButton = h('button', { class: 'btn', disabled: true, onclick: save }, '导出结算 JSON 副本');
    const addMember = h('button', { class: 'btn', onclick: () => {
      if (participants.length >= LIMITS.participants) return;
      const person = { id: `p${++nextId}`, name: `成员 ${nextId}` }; participants.push(person);
      for (const expense of expenses) expense.weights[person.id] = 1;
      render(); invalidate();
    } }, '添加参与者');
    const addExpense = h('button', { class: 'btn', onclick: () => {
      if (expenses.length >= LIMITS.expenses) return;
      expenses.push({ label: `费用 ${expenses.length + 1}`, amount: '', paidBy: participants[0].id, weights: Object.fromEntries(participants.map(person => [person.id, 1])) }); render(); invalidate();
    } }, '添加费用');
    root.append(h('p', {}, '逐项登记共同费用及付款人，按等分或整数权重计算。金额用人民币元输入、精确到分，仅提供转账建议。'),
      h('p', { class: 'faint' }, '余分按最大余数分配，相同余数按参与者列表顺序。权重 0 表示不参与该项；权重 1:2 表示承担比例 1:2。'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, addMember, addExpense,
        h('button', { class: 'btn', onclick: example }, '载入三人 100 元示例'),
        h('button', { class: 'btn btn--primary', onclick: calculate }, '计算结算'), saveButton),
      h('h3', {}, '参与者'), memberHost, h('h3', {}, '共同费用'), expenseHost, status, output,
      h('p', { class: 'faint' }, '输入不自动保存到全局配置；切换功能前请导出。上限 20 人、100 项费用，每项不超过 50,000,000 元。不同币种须先自行统一，工具不做汇率换算。'));
    function control(label, input) { return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, label, input); }
    function invalidate() { report = null; saveButton.disabled = true; output.replaceChildren(); status.textContent = '输入已改变，请重新计算。'; }
    function example() {
      participants = [{ id: 'p1', name: '甲' }, { id: 'p2', name: '乙' }, { id: 'p3', name: '丙' }]; nextId = 3;
      expenses = [{ label: '共同晚餐', amount: '100.00', paidBy: 'p1', weights: { p1: 1, p2: 1, p3: 1 } }]; render(); calculate();
    }
    function render() {
      memberHost.replaceChildren(...participants.map(person => {
        const input = h('input', { class: 'field', value: person.name, maxlength: 60, 'aria-label': `姓名 ${person.id}`, oninput: () => { person.name = input.value; invalidate(); }, onchange: render });
        return h('div', { style: { display: 'flex', gap: '8px', padding: '5px 0' } }, input,
          h('button', { class: 'btn', disabled: participants.length <= 2, onclick: () => {
            if (expenses.some(expense => expense.paidBy === person.id)) { status.textContent = '该成员是某项费用的付款人，请先重新指定付款人。'; return; }
            participants = participants.filter(item => item !== person); for (const expense of expenses) delete expense.weights[person.id]; render(); invalidate();
          } }, '移除成员'));
      }));
      expenseHost.replaceChildren(...expenses.map((expense, index) => {
        const label = h('input', { class: 'field', value: expense.label, maxlength: 120, 'aria-label': `费用说明 ${index + 1}`, oninput: () => { expense.label = label.value; invalidate(); } });
        const amount = h('input', { class: 'field', value: expense.amount, inputmode: 'decimal', placeholder: '例如 100.00', 'aria-label': `金额 元 ${index + 1}`, oninput: () => { expense.amount = amount.value; invalidate(); } });
        const payer = h('select', { class: 'field', 'aria-label': `付款人 ${index + 1}`, onchange: () => { expense.paidBy = payer.value; invalidate(); } }, ...participants.map(person => h('option', { value: person.id, selected: person.id === expense.paidBy }, person.name || person.id)));
        const weightHost = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' } }, ...participants.map(person => {
          const input = h('input', { class: 'field', type: 'number', min: 0, max: LIMITS.maxWeight, step: 1, value: expense.weights[person.id] ?? 0, style: { width: '90px' }, 'aria-label': `权重 ${index + 1} ${person.id}`, oninput: () => { expense.weights[person.id] = input.value === '' ? NaN : Number(input.value); invalidate(); } });
          return control(`${person.name || person.id} 权重`, input);
        }));
        return h('fieldset', { style: { border: '1px solid var(--line)', padding: '12px', borderRadius: '8px', marginBottom: '12px' } }, h('legend', {}, `费用 ${index + 1}`),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } }, control('说明', label), control('金额（元）', amount), control('付款人', payer),
            h('button', { class: 'btn', onclick: () => { for (const person of participants) expense.weights[person.id] = 1; render(); invalidate(); } }, '此项所有人等分'),
            h('button', { class: 'btn', disabled: expenses.length <= 1, onclick: () => { expenses = expenses.filter(item => item !== expense); render(); invalidate(); } }, '移除费用')), weightHost);
      }));
      addMember.disabled = participants.length >= LIMITS.participants; addExpense.disabled = expenses.length >= LIMITS.expenses;
    }
    function table(headings, rows) { return h('table', {}, h('thead', {}, h('tr', {}, ...headings.map(title => h('th', {}, title)))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(value => h('td', {}, value)))))); }
    function calculate() {
      try {
        report = settle(participants, expenses); status.textContent = `总费用 ${formatCents(report.totalCents)} 元，${report.transfers.length} 笔转账建议。`;
        output.replaceChildren(h('h3', {}, '每人付款、承担与净额'),
          table(['姓名', '已付（元）', '承担（元）', '净额（元）'], report.members.map(person => [person.name, formatCents(person.paidCents), formatCents(person.shareCents), `${formatCents(person.netCents)}${person.netCents > 0 ? ' 待收' : person.netCents < 0 ? ' 待付' : ' 已平'} `])),
          h('h3', {}, '转账建议'), report.transfers.length ? table(['付款人', '收款人', '金额（元）'], report.transfers.map(transfer => [transfer.fromName, transfer.toName, formatCents(transfer.cents)])) : h('p', {}, '每人净额已平，无需转账。'),
          h('p', { class: 'faint' }, report.settlement), h('h3', {}, '逐项分摊'),
          ...report.expenses.map(expense => h('div', { class: 'card' }, h('strong', {}, `${expense.number}. ${expense.label} · ${expense.paidByName}支付 ${formatCents(expense.cents)} 元`),
            table(['姓名', '权重', '承担（元）'], expense.allocations.map(share => [share.name, share.weight, formatCents(share.cents)])))), h('p', { class: 'faint' }, report.rounding));
        saveButton.disabled = false;
      } catch (error) { report = null; saveButton.disabled = true; output.replaceChildren(); status.textContent = error.message; }
    }
    async function save() {
      if (!report) return;
      if (window.toolbox?.files?.saveTextSupportsCopyOnly !== true) { status.textContent = '当前版本缺少安全副本保存能力，请先合入基础工作台 PR。'; return; }
      const content = JSON.stringify(report, null, 2); saveButton.disabled = true;
      try {
        const result = await window.toolbox.files.saveText({ content, extension: 'json', defaultName: '共同账单结算.json', copyOnly: true });
        if (!disposed) status.textContent = result?.ok ? `结算副本已保存：${result.path}` : result?.canceled ? '已取消保存。' : result?.error || '保存失败。';
      } catch (error) { if (!disposed) status.textContent = error.message; }
      finally { if (!disposed) saveButton.disabled = !report; }
    }
    example();
    return { destroy() { disposed = true; participants = []; expenses = []; report = null; root.replaceChildren(); } };
  },
};
