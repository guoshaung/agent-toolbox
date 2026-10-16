import { LIMITS, validateJob } from './model.mjs';

// ECMAScript AdvanceStringIndex: Unicode mode skips an entire surrogate pair.
export function advanceStringIndex(text, index, unicode) {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const first = text.charCodeAt(index), second = text.charCodeAt(index + 1);
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1;
}

function extract(job, send) {
  const input = validateJob(job);
  let regex;
  try { regex = new RegExp(input.pattern, input.flags); }
  catch (error) { const invalid = new Error(`正则语法或flags不受当前运行时支持：${error.message}`); invalid.code = 'syntax'; throw invalid; }
  const repeat = regex.global || regex.sticky;
  const unicode = regex.unicode || regex.unicodeSets;
  const matches = [], samples = []; let resultChars = 0;
  for (let sampleIndex = 0; sampleIndex < input.samples.length; sampleIndex++) {
    const sample = input.samples[sampleIndex]; regex.lastIndex = 0;
    let count = 0, match;
    while ((match = regex.exec(sample.text)) !== null) {
      if (matches.length >= LIMITS.matches) { const error = new Error('匹配结果超过1000条，整批中止，请缩小样本或收紧规则。'); error.code = 'limit'; throw error; }
      if (match.length - 1 > LIMITS.captures) { const error = new Error('捕获组超过64个，整批中止。'); error.code = 'limit'; throw error; }
      const row = {
        sample: sampleIndex + 1, name: sample.name, start: match.index, end: match.index + match[0].length, text: match[0],
        captures: Array.from(match).slice(1).map(value => value ?? null),
        named: Object.fromEntries(Object.entries(match.groups || {}).map(([name, value]) => [name, value ?? null])),
        indices: match.indices ? Array.from(match.indices).map(range => range ? [...range] : null) : null,
        namedIndices: match.indices?.groups ? Object.fromEntries(Object.entries(match.indices.groups).map(([name, range]) => [name, range ? [...range] : null])) : null
      };
      resultChars += JSON.stringify(row).length;
      if (resultChars > LIMITS.reportChars / 2) { const error = new Error('匹配内容过大，整批中止，请缩小样本。'); error.code = 'limit'; throw error; }
      matches.push(row); count++;
      if (!repeat) break;
      if (match[0] === '') regex.lastIndex = advanceStringIndex(sample.text, regex.lastIndex, unicode);
    }
    const status = count ? 'matched' : 'no-match';
    samples.push({ sample: sampleIndex + 1, name: sample.name, text: sample.text, status, matchCount: count });
    send({ type: 'progress', index: sampleIndex, status });
  }
  return { rule: { pattern: input.pattern, flags: input.flags }, samples, matches, stats: { samples: samples.length, matches: matches.length, matchedSamples: samples.filter(sample => sample.status === 'matched').length, failedSamples: samples.filter(sample => sample.status === 'no-match').length } };
}

function handle(input, send) {
  try { send({ type: 'result', result: extract(input, send) }); }
  catch (error) { send({ type: 'error', code: error.code || 'validation', message: error.message }); }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', event => handle(event.data, data => self.postMessage(data)));
} else {
  // Node worker_threads is solely an adapter for real-worker automated tests.
  // This branch is never evaluated by the browser Worker.
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('T004正则引擎只能在Worker中运行。');
  parentPort.on('message', input => handle(input, data => parentPort.postMessage(data)));
}
