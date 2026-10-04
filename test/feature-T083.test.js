'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/renderer/features/T083/model.mjs');
const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }];
test('three people split 100 yuan with exact totals and settle to zero', async () => {
  const { settle } = await load();
  const result = settle(people, [{ label: '晚餐', amount: '100.00', paidBy: 'a', weights: { a: 1, b: 1, c: 1 } }]);
  assert.equal(result.totalCents, 10000); assert.deepEqual(result.members.map(person=>person.shareCents), [3334,3333,3333]);
  assert.deepEqual(result.transfers.map(transfer=>[transfer.from,transfer.to,transfer.cents]), [['b','a',3333],['c','a',3333]]);
  const after = new Map(result.members.map(person=>[person.id,person.netCents]));
  for (const transfer of result.transfers) { after.set(transfer.from,after.get(transfer.from)+transfer.cents);after.set(transfer.to,after.get(transfer.to)-transfer.cents); }
  assert.deepEqual([...after.values()], [0,0,0]);
});
test('largest remainder handles weights, equal ties and nonparticipants', async () => {
  const { allocate } = await load();
  assert.deepEqual(allocate(100,[1,2,0]),[33,67,0]);
  assert.deepEqual(allocate(1,[1,1,1]),[1,0,0]);
  assert.deepEqual(allocate(2,[0,1,1]),[0,1,1]);
  assert.throws(()=>allocate(100,[0,0])); assert.throws(()=>allocate(100,[0.5,1]));
});
test('integer arithmetic remains exact when multiplication exceeds safe Number', async () => {
  const { allocate } = await load();
  const result=allocate(5000000000,[999999,1000000,1]);
  assert.equal(result.reduce((a,b)=>a+b,0),5000000000); assert.deepEqual(result,[2499997500,2500000000,2500]);
});
test('money input uses decimal strings with explicit cent precision', async () => {
  const { parseAmount,formatCents } = await load();
  assert.equal(parseAmount('0.01'),1);assert.equal(parseAmount('1.2'),120);assert.equal(parseAmount('100'),10000);
  assert.equal(formatCents(-3333),'-33.33');assert.equal(formatCents(0),'0.00');
  for (const value of ['0','-1','1.001','1e2','1,000','NaN',100,'50000000.01']) assert.throws(()=>parseAmount(value));
});
test('different payers and weighted expenses conserve both paid and owed', async () => {
  const { settle } = await load();
  const result=settle(people,[{label:'餐费',amount:'99.99',paidBy:'a',weights:{a:1,b:1,c:1}},{label:'车费',amount:'20',paidBy:'b',weights:{a:1,b:0,c:2}}]);
  assert.equal(result.totalCents,11999);assert.equal(result.members.reduce((t,p)=>t+p.paidCents,0),11999);
  assert.equal(result.members.reduce((t,p)=>t+p.shareCents,0),11999);assert.equal(result.members.reduce((t,p)=>t+p.netCents,0),0);
  assert.ok(result.transfers.length<=people.length-1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).expenses,result.expenses);
});
test('invalid participant, payer or expense is rejected without partial results', async () => {
  const { settle } = await load();
  const expense={label:'餐费',amount:'100',paidBy:'a',weights:{a:1,b:1,c:1}};
  assert.throws(()=>settle([people[0],people[0]],[expense]));
  assert.throws(()=>settle([{id:'a',name:'甲'},{id:'b',name:' 甲 '}],[expense]));
  assert.throws(()=>settle(people,[{...expense,paidBy:'missing'}]));
  assert.throws(()=>settle(people,[{...expense,weights:{a:1,b:-1}}]));
  assert.throws(()=>settle(people,[])); assert.throws(()=>settle(people,Array(101).fill(expense)));
});
