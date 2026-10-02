'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/renderer/features/T038/model.mjs');
test('black against white is exactly 21:1, identical colors 1:1', async () => {
  const { contrastRatio, luminance } = await load();
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.equal(luminance('#000'), 0); assert.equal(luminance('#FFF'), 1);
});
test('AA does not round values before the threshold comparison', async () => {
  const { evaluateAA } = await load();
  assert.equal(evaluateAA(4.499, 12).pass, false);
  assert.equal(evaluateAA(4.5, 12).pass, true);
  assert.equal(evaluateAA(2.9999, 18).pass, false);
  assert.equal(evaluateAA(3, 18).pass, true);
});
test('same gray pair has distinct ordinary and large text conclusions', async () => {
  const { checkPair } = await load();
  const pair = { foreground: '#777', background: '#fff', fontPt: 12 };
  assert.equal(checkPair(pair).pass, false);
  assert.equal(checkPair({ ...pair, fontPt: 18 }).pass, true);
  assert.equal(checkPair({ ...pair, fontPt: 14, bold: true }).pass, true);
  assert.equal(checkPair({ ...pair, fontPt: 14, bold: false }).pass, false);
  assert.equal(checkPair({ ...pair, fontPt: 17.999 }).threshold, 4.5);
  assert.equal(checkPair({ ...pair, fontPt: 13.999, bold: true }).threshold, 4.5);
});
test('strict opaque hex validation rejects transparent, malformed and injected styles', async () => {
  const { parseColor, evaluateAA } = await load();
  assert.equal(parseColor(' #aB3 ').hex, '#AABB33');
  for (const color of ['red', '#1234', '#11223344', 'rgba(0,0,0,.5)', '#ggg', '#fff; color:red', null]) assert.throws(() => parseColor(color));
  for (const size of [0, -1, Infinity, NaN, 1001, '18']) assert.throws(() => evaluateAA(4, size));
  assert.throws(() => evaluateAA(4, 12, 'false'));
});
test('adjustment candidates preserve background and all pass unrounded threshold', async () => {
  const { checkPair, contrastRatio } = await load();
  for (const [fg, bg] of [['#777777', '#FFFFFF'], ['#333333', '#000000'], ['#888888', '#888888']]) {
    const result = checkPair({ foreground: fg, background: bg, fontPt: 12 });
    assert.ok(result.candidates.length > 0);
    for (const candidate of result.candidates) {
      assert.equal(candidate.background, bg);
      assert.ok(contrastRatio(candidate.foreground, bg) >= 4.5);
    }
  }
  assert.deepEqual(checkPair({ foreground: '#000', background: '#fff', fontPt: 12 }).candidates, []);
});
test('batch report isolates invalid input and preserves raw numerical evidence', async () => {
  const { createReport } = await load();
  const report = createReport([{ label: 'valid', foreground: '#000', background: '#fff', fontPt: 12 }, { label: 'alpha', foreground: '#0000', background: '#fff', fontPt: 12 }]);
  assert.equal(report.schemaVersion, 1); assert.equal(report.results[0].ratio, 21);
  assert.equal(report.results[0].ok, true); assert.equal(report.results[1].ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(report)).results, report.results);
  assert.throws(() => createReport([])); assert.throws(() => createReport(Array(41).fill({})));
});
