#!/usr/bin/env node
/**
 * 终端选择题。用法：node quiz-cli.mjs 题库.json
 * 题库由工具箱「学习 → 懒人模式 → 导出到终端」生成：{ title, questions: [{ question, options, answer, explain, knowledge }] }
 * 零依赖，只用 Node 自带的 readline。答完给正确率和错题回顾，错题会写到同目录的 错题-<日期>.json，下次可以只考错题。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log(`${C.r}用法：node quiz-cli.mjs 题库.json${C.x}`); process.exit(1); }

let bank;
try { bank = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`${C.r}题库读不了：${e.message}${C.x}`); process.exit(1); }
let questions = (Array.isArray(bank.questions) ? bank.questions : []).filter((q) => q && Array.isArray(q.options) && q.options.length >= 2);
if (!questions.length) { console.log(`${C.y}题库里没有选择题。${C.x}`); process.exit(0); }

const shuffle = process.argv.includes('--shuffle');
if (shuffle) questions = questions.sort(() => Math.random() - 0.5);

// 不用 rl.question：管道输入时，下一行可能在 question() 注册前就到了，会被丢掉。
// 自己排队：来一行存一行，ask() 先取队列，没有再等。stdin 关了就当按了 q。
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lineQueue = []; const waiters = []; let closed = false;
rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lineQueue.push(l); });
rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()('q'); });
const ask = (q) => new Promise((res) => {
  process.stdout.write(q);
  if (lineQueue.length) return res(lineQueue.shift());
  if (closed) return res('q');
  waiters.push(res);
});

console.log(`\n${C.b}${C.c}📝 ${bank.title || '终端选择题'}${C.x}  ${C.d}共 ${questions.length} 题 · 输入 A/B/C/D 回车 · q 退出${C.x}\n`);

const wrong = [];
let correct = 0;
for (let i = 0; i < questions.length; i += 1) {
  const q = questions[i];
  console.log(`${C.b}${i + 1}. ${q.question}${C.x}`);
  if (q.knowledge) console.log(`${C.d}   考察：${q.knowledge}${C.x}`);
  q.options.forEach((opt, k) => console.log(`   ${C.c}${'ABCD'[k] || k + 1}${C.x}  ${opt}`));
  let pick = -1;
  while (pick < 0) {
    const a = (await ask(`${C.y}你的答案 › ${C.x}`)).trim().toUpperCase();
    if (a === 'Q') { rl.close(); finish(); process.exit(0); }
    pick = 'ABCD'.indexOf(a);
    if (pick < 0 || pick >= q.options.length) { pick = -1; console.log(`${C.d}   输入 A-${'ABCD'[q.options.length - 1]}${C.x}`); }
  }
  const ans = Number(q.answer);
  if (pick === ans) { correct += 1; console.log(`${C.g}   ✓ 对了${C.x}`); }
  else { wrong.push(q); console.log(`${C.r}   ✗ 错了，正确是 ${'ABCD'[ans]}${C.x}`); }
  if (q.explain) console.log(`${C.d}   解析：${q.explain}${C.x}`);
  console.log('');
}
rl.close();
finish();

function finish() {
  const total = correct + wrong.length;
  if (!total) return;
  const rate = Math.round((correct / total) * 100);
  const tone = rate >= 80 ? C.g : rate >= 50 ? C.y : C.r;
  console.log(`${C.b}━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.x}`);
  console.log(`${C.b}正确率 ${tone}${rate}%${C.x}${C.b}  （${correct}/${total}）${C.x}`);
  if (wrong.length) {
    console.log(`\n${C.r}错题回顾：${C.x}`);
    wrong.forEach((q, i) => console.log(`  ${i + 1}. ${q.question}\n     ${C.d}→ ${q.options[Number(q.answer)]}${C.x}`));
    const out = path.join(path.dirname(file), `错题-${new Date().toISOString().slice(0, 10)}.json`);
    try {
      fs.writeFileSync(out, JSON.stringify({ title: `${bank.title || '题库'} · 错题`, questions: wrong }, null, 2), 'utf8');
      console.log(`\n${C.d}错题已存到：${out}\n下次只考错题：node quiz-cli.mjs "${out}"${C.x}`);
    } catch { /* 写不了就算了 */ }
  } else {
    console.log(`${C.g}全对，这一轮可以放心往下学了。${C.x}`);
  }
  console.log('');
}
