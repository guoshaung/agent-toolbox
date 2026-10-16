export const LIMITS = Object.freeze({ participants: 20, expenses: 100, maxCents: 5000000000, maxWeight: 1000000 });
export function parseAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('金额需要正数元，最多两位小数，不支持千位分隔或科学计数');
  const [whole, decimal = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > LIMITS.maxCents) throw new Error('每项金额须大于 0 且不超过 50,000,000 元');
  return cents;
}
export function formatCents(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('无效整数分');
  return `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}
export function allocate(cents, weights) {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > LIMITS.maxCents || !Array.isArray(weights) || weights.length < 1 || weights.length > LIMITS.participants) throw new Error('金额或参与人数超出范围');
  if (weights.some(value => !Number.isInteger(value) || value < 0 || value > LIMITS.maxWeight)) throw new Error('权重需要 0–1,000,000 的整数，0 表示不参与该项费用');
  const sum = weights.reduce((total, value) => total + BigInt(value), 0n);
  if (sum === 0n) throw new Error('每项费用至少有一人权重大于 0');
  const shares = weights.map((weight, index) => ({ index, weight, base: Number(BigInt(cents) * BigInt(weight) / sum), remainder: BigInt(cents) * BigInt(weight) % sum }));
  const extra = cents - shares.reduce((total, share) => total + share.base, 0);
  const ranked = shares.filter(share => share.weight > 0).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < extra; i++) ranked[i].base++;
  return shares.map(share => share.base);
}
export function settle(participants, expenses) {
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > LIMITS.participants) throw new Error('需要 2–20 位参与者');
  if (!Array.isArray(expenses) || !expenses.length || expenses.length > LIMITS.expenses) throw new Error('需要 1–100 项费用');
  const ids = new Set(); const names = new Set();
  const members = participants.map((person, index) => {
    if (!person || typeof person.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(person.id) || ids.has(person.id)) throw new Error('参与者编号无效或重复');
    if (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 60 || names.has(person.name.trim())) throw new Error('参与者姓名须为不重复的 1–60 字符');
    ids.add(person.id); names.add(person.name.trim());
    return { id: person.id, name: person.name.trim(), index, paidCents: 0, shareCents: 0, netCents: 0 };
  });
  const details = expenses.map((expense, index) => {
    if (!expense || typeof expense.label !== 'string' || !expense.label.trim() || expense.label.length > 120) throw new Error(`第 ${index + 1} 项需要 1–120 字符说明`);
    const payer = members.find(member => member.id === expense.paidBy);
    if (!payer) throw new Error(`第 ${index + 1} 项付款人不存在`);
    let cents; let shares;
    try { cents = parseAmount(expense.amount); shares = allocate(cents, members.map(member => expense.weights?.[member.id] ?? 0)); }
    catch (error) { throw new Error(`第 ${index + 1} 项：${error.message}`); }
    payer.paidCents += cents;
    const allocations = members.map((member, i) => { member.shareCents += shares[i]; return { id: member.id, name: member.name, weight: expense.weights?.[member.id] ?? 0, cents: shares[i] }; });
    return { number: index + 1, label: expense.label.trim(), paidBy: payer.id, paidByName: payer.name, cents, allocations };
  });
  for (const member of members) member.netCents = member.paidCents - member.shareCents;
  const totalCents = details.reduce((total, expense) => total + expense.cents, 0);
  if (members.reduce((total, member) => total + member.netCents, 0) !== 0) throw new Error('内部账目不平衡');
  const rank = (a, b) => b.remaining - a.remaining || a.index - b.index;
  const debtors = members.filter(member => member.netCents < 0).map(member => ({ ...member, remaining: -member.netCents })).sort(rank);
  const creditors = members.filter(member => member.netCents > 0).map(member => ({ ...member, remaining: member.netCents })).sort(rank);
  const transfers = []; let d = 0; let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const from = debtors[d]; const to = creditors[c]; const cents = Math.min(from.remaining, to.remaining);
    transfers.push({ from: from.id, fromName: from.name, to: to.id, toName: to.name, cents });
    from.remaining -= cents; to.remaining -= cents;
    if (!from.remaining) d++; if (!to.remaining) c++;
  }
  return { schemaVersion: 1, featureId: 'T083', currency: 'CNY', unit: 'cent', totalCents, members, expenses: details, transfers,
    rounding: '各项先向下取整数分，余分按最大余数分配；余数相同按参与者列表顺序。0权重不参与。',
    settlement: '按净额生成最多参与者人数减一笔的转账建议，不承诺全局最少笔数，不发起支付。' };
}
