'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('raw LaTeX equation is converted to aligned rows', async () => {
  const { formatAlignedLatex, splitAlignedEquation } = await import('../src/renderer/tools/research/latex-layout.js');
  const result = formatAlignedLatex(String.raw`\text{System} = \underbrace{\text{Memory}}_{\text{A}} + \underbrace{\text{Evaluation}}_{\text{B}} + \underbrace{\text{Evolution}}_{\text{C}}`);
  assert.match(result, /\\begin\{aligned\}/);
  assert.match(result, /\\text\{System\} &=/);
  assert.match(result, /\\quad\+ \\underbrace/);
  assert.match(result, /\\end\{aligned\}/);
  assert.deepEqual(splitAlignedEquation(String.raw`a = b + c`), { left: 'a', terms: ['b', 'c'] });
});

test('already aligned and non-equation LaTeX is not rewritten', async () => {
  const { formatAlignedLatex } = await import('../src/renderer/tools/research/latex-layout.js');
  const aligned = String.raw`\begin{aligned} a &= b \\ c &= d \end{aligned}`;
  assert.equal(formatAlignedLatex(aligned), aligned);
  assert.equal(formatAlignedLatex(String.raw`\frac{a}{b}`), String.raw`\frac{a}{b}`);
});
