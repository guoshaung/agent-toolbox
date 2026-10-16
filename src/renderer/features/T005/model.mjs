export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, lines: 20000, lineChars: 2000 });
export const OPERATIONS = Object.freeze({ intersection: '交集 A ∩ B', union: '并集 A ∪ B', onlyA: '仅 A 有 A − B', onlyB: '仅 B 有 B − A', symmetric: '对称差集 A △ B' });
export const DEFAULT_RULES = Object.freeze({ trim: true, collapse: false, nfkc: false, ignoreCase: false, ignoreBlank: true });
const bytes = value => new TextEncoder().encode(value).byteLength;
function normalize(value, rules) {
  let key = value;
  if (rules.nfkc) key = key.normalize('NFKC');
  if (rules.trim) key = key.trim();
  if (rules.collapse) key = key.replace(/\s+/gu, ' ');
  if (rules.ignoreCase) key = key.toLowerCase();
  return key;
}
function read(text, rules, label) {
  if (typeof text !== 'string') throw new Error(label + ' 必须是文本。');
  if (bytes(text) > LIMITS.bytes) throw new Error(label + ' 超过 2 MiB UTF-8 上限。');
  const raw = text.replace(/^\uFEFF/u, '');
  const lines = raw === '' ? [] : raw.split(/\r\n|\n|\r/u);
  // A trailing newline terminates the last entry; an additional blank line remains an entry.
  if (lines.at(-1) === '' && /[\r\n]$/u.test(raw)) lines.pop();
  if (lines.length > LIMITS.lines) throw new Error(label + ' 超过 20000 行。');
  const entries = new Map();
  const ignoredLines = [];
  let accepted = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > LIMITS.lineChars) throw new Error(label + ' 第 ' + (i + 1) + ' 行超过 2000 字符。');
    const key = normalize(lines[i], rules);
    if (rules.ignoreBlank && key.trim() === '') { ignoredLines.push(i + 1); continue; }
    accepted++;
    if (!entries.has(key)) entries.set(key, { value: key, occurrences: [] });
    entries.get(key).occurrences.push({ line: i + 1, original: lines[i] });
  }
  const duplicates = [...entries.values()].filter(entry => entry.occurrences.length > 1);
  return { entries, summary: { physicalLines: lines.length, acceptedLines: accepted, distinct: entries.size, repeatedLines: accepted - entries.size, duplicateValues: duplicates.length, ignoredLines, duplicates } };
}
export function analyze(left, right, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('比较规则必须是对象。');
  const rules = { ...DEFAULT_RULES };
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(rules, key) || typeof options[key] !== 'boolean') throw new Error('未知规则或规则不是布尔值：' + key);
    rules[key] = options[key];
  }
  const a = read(left, rules, '清单 A'), b = read(right, rules, '清单 B');
  const keyA = [...a.entries.keys()], keyB = [...b.entries.keys()];
  const intersection = keyA.filter(key => b.entries.has(key));
  const onlyA = keyA.filter(key => !b.entries.has(key)), onlyB = keyB.filter(key => !a.entries.has(key));
  const values = { intersection, union: [...keyA, ...onlyB], onlyA, onlyB, symmetric: [...onlyA, ...onlyB] };
  const sources = [...new Set([...keyA, ...keyB])].map(value => ({ value, A: a.entries.get(value)?.occurrences || [], B: b.entries.get(value)?.occurrences || [] }));
  return { feature: 'T005', schemaVersion: 1, rules, order: 'A 首次出现顺序；新增 B 值按 B 首次出现顺序追加', A: a.summary, B: b.summary, values, counts: Object.fromEntries(Object.entries(values).map(([key, list]) => [key, list.length])), sources };
}
export function resultText(report, operation) {
  if (!Object.hasOwn(OPERATIONS, operation) || !Array.isArray(report?.values?.[operation])) throw new Error('请选择有效的集合运算。');
  const list = report.values[operation];
  return list.length ? list.join('\n') + '\n' : '';
}
