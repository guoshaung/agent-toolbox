const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/renderer/features/T005/model.mjs');
test('T005: canonical sample yields exact sets and physical duplicate sources', async () => {
  const { analyze } = await model, report = analyze('甲\n乙\n乙', '乙\n丙');
  assert.deepEqual(report.values, { intersection: ['乙'], union: ['甲','乙','丙'], onlyA: ['甲'], onlyB: ['丙'], symmetric: ['甲','丙'] });
  assert.equal(report.A.repeatedLines, 1);
  assert.deepEqual(report.A.duplicates[0].occurrences, [{ line: 2, original: '乙' }, { line: 3, original: '乙' }]);
  assert.deepEqual(report.sources.find(row => row.value === '乙').B, [{ line: 1, original: '乙' }]);
});
test('T005: defaults retain width and case; opt-in rules retain original evidence', async () => {
  const { analyze } = await model;
  assert.deepEqual(analyze(' Ａ  B \nA b', 'a b').values.intersection, []);
  const report = analyze(' Ａ  B \nA b', 'a b', { nfkc: true, collapse: true, ignoreCase: true });
  assert.deepEqual(report.values.intersection, ['a b']); assert.equal(report.A.repeatedLines, 1);
  assert.equal(report.A.duplicates[0].occurrences[0].original, ' Ａ  B ');
});
test('T005: BOM, mixed newline, trailing terminator and ignored blank positions', async () => {
  const { analyze } = await model, report = analyze('\uFEFF甲\r\n \r乙\n\n', '乙\n');
  assert.equal(report.A.physicalLines, 4); assert.deepEqual(report.A.ignoredLines, [2,4]);
  assert.deepEqual(report.values.intersection, ['乙']);
  assert.equal(report.B.physicalLines, 1);
});
test('T005: empty text, explicit empty entry and exact comparison are distinguished', async () => {
  const { analyze, resultText } = await model;
  const empty = analyze('', ''); assert.equal(empty.A.physicalLines, 0); assert.equal(resultText(empty, 'union'), '');
  const blank = analyze('\n', '\n', { ignoreBlank: false }); assert.deepEqual(blank.values.union, ['']); assert.equal(resultText(blank, 'union'), '\n');
  assert.deepEqual(analyze(' 甲 ', '甲', { trim: false }).values.intersection, []);
});
test('T005: set order is stable, pathological object keys are ordinary values', async () => {
  const { analyze } = await model, report = analyze('__proto__\nconstructor\n2\n1', '1\n3\n__proto__');
  assert.deepEqual(report.values.union, ['__proto__','constructor','2','1','3']);
  assert.deepEqual(report.values.intersection, ['__proto__','1']);
  assert.equal(JSON.parse(JSON.stringify(report)).sources[0].value, '__proto__');
});
test('T005: input limits and explicit rule validation fail before partial output', async () => {
  const { analyze, LIMITS, resultText } = await model;
  assert.throws(() => analyze('甲'.repeat(Math.ceil(LIMITS.bytes / 3)), ''), /MiB/);
  assert.throws(() => analyze('a\n'.repeat(LIMITS.lines + 1), ''), /20000/);
  assert.throws(() => analyze('a'.repeat(2001), ''), /2000/);
  assert.throws(() => analyze('a', 'a', { ignoreCase: 1 }), /布尔/);
  assert.throws(() => analyze('a', 'a', { mystery: false }), /未知/);
  assert.throws(() => resultText(analyze('a','a'), '__proto__'), /有效/);
});
