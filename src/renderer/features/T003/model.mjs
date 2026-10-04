export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, rows: 5000, columns: 100, cells: 100000, stringChars: 50000, depth: 32, nodes: 100000, differences: 10000, outputBytes: 12 * 1024 * 1024 });
export const EXAMPLE = Object.freeze({ old: '[\n  {"id":1,"name":"旧记录"},\n  {"id":2,"name":"原名称","meta":{"active":true}}\n]', new: '[\n  {"id":2,"name":"新名称","meta":{"active":true}},\n  {"id":3,"name":"新增记录"}\n]' });
export function checkAbort(signal) { if (signal?.aborted) { const error = new Error('已取消处理。'); error.name = 'AbortError'; throw error; } }
async function checkpoint(hooks) { checkAbort(hooks?.signal); await (hooks?.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks?.signal); }
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const present = value => ({ present: true, value });
const missing = () => ({ present: false });

// Strict quoted CSV/TSV state machine adapted from T002/model.mjs at ba92a386.
// This is an independent parser: mandatory unique nonempty header, provenance,
// no row repair beyond representing an empty physical line as all-empty cells.
async function parseTable(text, delimiter, hooks) {
  const records = []; let cells = [], field = '', state = 'start', line = 1, sourceLine = 1, count = 0;
  const fail = message => { throw new Error(`第${line}行：${message}`); };
  const pushField = () => { cells.push(field); field = ''; state = 'start'; if (cells.length > LIMITS.columns || ++count > LIMITS.cells) fail('列数超过100或单元格超过100000。'); };
  const pushRow = () => { const blank = !cells.length && !field && state === 'start'; pushField(); records.push({ cells, line: sourceLine, blank }); cells = []; if (records.length > LIMITS.rows + 1) fail('数据超过5000行。'); };
  for (let index = 0; index < text.length; index++) {
    if (index % 16384 === 0) await checkpoint(hooks);
    const ch = text[index], newline = ch === '\r' || ch === '\n';
    if (state === 'quoted') {
      if (ch === '"') { if (text[index + 1] === '"') { field += '"'; index++; } else state = 'closed'; }
      else if (newline) { if (ch === '\r' && text[index + 1] === '\n') { field += '\r\n'; index++; } else field += ch; line++; }
      else field += ch;
    } else if (ch === delimiter) pushField();
    else if (newline) { pushRow(); if (ch === '\r' && text[index + 1] === '\n') index++; line++; sourceLine = line; }
    else if (state === 'closed') fail('闭引号后只能出现分隔符或换行。');
    else if (ch === '"') { if (state !== 'start') fail('普通字段中不能出现双引号。'); state = 'quoted'; }
    else { state = 'plain'; field += ch; }
    if (field.length > LIMITS.stringChars) fail('字段超过50000个UTF-16单位。');
  }
  if (state === 'quoted') fail('引号字段未闭合。');
  if (cells.length || field.length || state !== 'start') pushRow();
  if (!records.length) throw new Error('表格缺少标题行。');
  const fields = records.shift().cells;
  if (fields.some(name => !name.trim()) || new Set(fields).size !== fields.length) throw new Error('标题名称必须非空且不重复；不会自动重命名或修剪。');
  const rows = [];
  for (let index = 0; index < records.length; index++) {
    if (index % 128 === 0) await checkpoint(hooks);
    const record = records[index];
    if (record.blank) { count += fields.length - 1; record.cells = Array(fields.length).fill(''); if (count > LIMITS.cells) throw new Error('单元格超过100000。'); }
    if (record.cells.length !== fields.length) throw new Error(`第${record.line}行有${record.cells.length}列，预期${fields.length}列；不会猜测缺失单元格。`);
    rows.push({ line: record.line, value: Object.fromEntries(fields.map((name, column) => [name, record.cells[column]])) });
  }
  return { fields, rows };
}

// Bounded async JSON parser retains top-level row start lines and rejects
// duplicate object properties instead of silently overwriting business data.
async function parseJSONRows(text, hooks) {
  let at = 0, line = 1, nextYield = 0, nodes = 0;
  const fail = message => { throw new Error(`JSON第${line}行：${message}`); };
  const consume = () => { const ch = text[at++]; if (ch === '\n' || (ch === '\r' && text[at] !== '\n')) line++; return ch; };
  const tick = async () => { if (at >= nextYield) { nextYield = at + 8192; await checkpoint(hooks); } };
  const whitespace = async () => { while (' \t\r\n'.includes(text[at]) && at < text.length) { consume(); await tick(); } };
  async function string() {
    const start = at; consume(); let escaped = false;
    while (at < text.length) {
      const ch = consume(); await tick();
      if (ch === '"' && !escaped) {
        let value; try { value = JSON.parse(text.slice(start, at)); } catch { fail('字符串或转义不合法。'); }
        if (value.length > LIMITS.stringChars) fail('字符串超过50000个UTF-16单位。');
        return value;
      }
      if (ch === '\\' && !escaped) escaped = true; else escaped = false;
      if (at - start > LIMITS.stringChars * 6 + 2) fail('字符串编码过长。');
    }
    fail('字符串未闭合。');
  }
  async function value(depth) {
    await whitespace(); await tick();
    if (depth > LIMITS.depth || ++nodes > LIMITS.nodes) fail('嵌套深度超过32或节点数超过100000。');
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === '{') {
      consume(); await whitespace(); const entries = [], keys = new Set();
      if (text[at] === '}') { consume(); return {}; }
      while (true) {
        if (text[at] !== '"') fail('对象属性名须为双引号字符串。');
        const key = await string(); if (keys.has(key)) fail(`对象属性重复：${key}`); keys.add(key);
        if (keys.size > LIMITS.columns) fail('每个对象最多100个属性。');
        await whitespace(); if (consume() !== ':') fail('对象属性后缺少冒号。');
        entries.push([key, await value(depth + 1)]); await whitespace();
        const next = consume(); if (next === '}') return Object.fromEntries(entries);
        if (next !== ',') fail('对象缺少逗号或闭括号。'); await whitespace();
      }
    }
    if (ch === '[') {
      consume(); await whitespace(); const list = [];
      if (text[at] === ']') { consume(); return list; }
      while (true) {
        list.push(await value(depth + 1)); await whitespace();
        const next = consume(); if (next === ']') return list;
        if (next !== ',') fail('数组缺少逗号或闭括号。');
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(literal, at)) { at += literal.length; return result; }
    const start = at;
    while (at < text.length && '-+0123456789.eE'.includes(text[at])) { consume(); await tick(); }
    const numberText = text.slice(start, at);
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(numberText)) fail('值不是合法JSON。');
    const number = Number(numberText);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) fail('数字非有限或超出JavaScript安全整数范围；请用字符串保存大编号。');
    return number;
  }
  await whitespace(); if (consume() !== '[') fail('顶层必须是JSON数组。'); await whitespace();
  const rows = [], fieldSet = new Set();
  if (text[at] === ']') consume();
  else while (true) {
    await whitespace(); const sourceLine = line;
    const record = await value(1);
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('数组中每项必须是对象记录。');
    rows.push({ line: sourceLine, value: record }); Object.keys(record).forEach(key => fieldSet.add(key));
    if (fieldSet.size > LIMITS.columns) fail('顶层字段并集超过100个。');
    if (rows.length > LIMITS.rows) fail('数据超过5000行。');
    await whitespace(); const next = consume(); if (next === ']') break;
    if (next !== ',') fail('记录之间缺少逗号或顶层闭括号。');
  }
  await whitespace(); if (at !== text.length) fail('数组之后有额外内容。');
  return { fields: [...fieldSet].sort(), rows };
}

export async function parseDataset(source, hooks = {}) {
  checkAbort(hooks.signal);
  if (!source || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 120 || typeof source.text !== 'string') throw new Error('来源须有名称（最多120字符）与文本。');
  if (!['json', 'csv', 'tsv'].includes(source.format)) throw new Error('请选择JSON数组、CSV或TSV格式。');
  if (source.text.length > LIMITS.bytes || new TextEncoder().encode(source.text).length > LIMITS.bytes) throw new Error('每份输入最多2 MiB。');
  const text = source.text.startsWith('\uFEFF') ? source.text.slice(1) : source.text;
  const parsed = source.format === 'json' ? await parseJSONRows(text, hooks) : await parseTable(text, source.format === 'csv' ? ',' : '\t', hooks);
  checkAbort(hooks.signal);
  return { name: source.name, format: source.format, fields: parsed.fields, records: parsed.rows.map((row, index) => ({ source: { name: source.name, row: index + 1, line: row.line }, value: row.value })) };
}

function businessKey(record, field) {
  if (!own(record.value, field)) return { error: '缺失主键字段' };
  const value = record.value[field], type = typeof value;
  if (value === null) return { error: '主键为null' };
  if (type === 'string' && !value.trim()) return { error: '主键为空字符串或纯空白' };
  if (!['string', 'number', 'boolean'].includes(type)) return { error: '主键必须是字符串、数字或布尔值，不能是对象/数组' };
  return { token: `${type}:${JSON.stringify(value)}`, key: { type, value } };
}

export async function reconcile(oldDataset, newDataset, primaryKey, hooks = {}) {
  if (typeof primaryKey !== 'string' || !primaryKey.trim() || primaryKey.length > LIMITS.stringChars) throw new Error('请填写一个明确的顶层主键字段名称。');
  const indexes = [new Map(), new Map()], conflicts = [], changes = []; let compared = 0, differences = 0;
  for (const [side, dataset] of [oldDataset, newDataset].entries()) {
    for (let index = 0; index < dataset.records.length; index++) {
      if (index % 128 === 0) await checkpoint(hooks);
      const record = dataset.records[index], resolved = businessKey(record, primaryKey);
      if (resolved.error) conflicts.push({ kind: 'invalid-key', key: null, reason: resolved.error, old: side === 0 ? [record] : [], new: side === 1 ? [record] : [] });
      else {
        const found = indexes[side].get(resolved.token);
        if (found) found.records.push(record); else indexes[side].set(resolved.token, { key: resolved.key, records: [record] });
      }
    }
  }
  const tokens = new Set([...indexes[0].keys(), ...indexes[1].keys()]); let unchanged = 0;
  const diff = async (before, after, path, fields) => {
    if (++compared % 128 === 0) await checkpoint(hooks);
    if (before.present && after.present) {
      const a = before.value, b = after.value;
      if (a === b) return;
      const aa = Array.isArray(a), ba = Array.isArray(b);
      if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && aa === ba) {
        const keys = aa ? Array.from({ length: Math.max(a.length, b.length) }, (_, index) => String(index)) : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
        for (const key of keys) await diff(own(a, key) ? present(a[key]) : missing(), own(b, key) ? present(b[key]) : missing(), path + '/' + pointer(key), fields);
        return;
      }
    }
    if (++differences > LIMITS.differences) throw new Error('字段差异超过10000项，整批中止，请拆分输入。');
    fields.push({ path, before, after });
  };
  let count = 0;
  for (const token of tokens) {
    if (count++ % 128 === 0) await checkpoint(hooks);
    const old = indexes[0].get(token), newer = indexes[1].get(token), key = (old || newer).key;
    if (old?.records.length > 1 || newer?.records.length > 1) {
      conflicts.push({ kind: 'duplicate-key', key, reason: '一侧或两侧存在重复主键；该键的两侧全部记录排除于正常对账', old: old?.records || [], new: newer?.records || [] }); continue;
    }
    const before = old?.records[0] || null, after = newer?.records[0] || null;
    const fields = [];
    if (!before || !after) {
      if (++differences > LIMITS.differences) throw new Error('字段差异超过10000项，整批中止。');
      fields.push({ path: '', before: before ? present(before.value) : missing(), after: after ? present(after.value) : missing() });
    } else await diff(present(before.value), present(after.value), '', fields);
    if (fields.length) changes.push({ kind: !before ? 'added' : !after ? 'removed' : 'modified', key, old: before, new: after, fields }); else unchanged++;
  }
  const stats = {
    oldRows: oldDataset.records.length, newRows: newDataset.records.length,
    added: changes.filter(row => row.kind === 'added').length, removed: changes.filter(row => row.kind === 'removed').length, modified: changes.filter(row => row.kind === 'modified').length, unchanged,
    conflictGroups: conflicts.length, conflictOldRows: conflicts.reduce((sum, conflict) => sum + conflict.old.length, 0), conflictNewRows: conflicts.reduce((sum, conflict) => sum + conflict.new.length, 0), fieldDifferences: differences
  };
  checkAbort(hooks.signal);
  return { primaryKey, sources: { old: { name: oldDataset.name, format: oldDataset.format }, new: { name: newDataset.name, format: newDataset.format } }, rules: 'strict-typed-key; object-key-order-ignored; array-order-preserved; missing-not-null; no-string-trim-or-coercion', stats, changes, conflicts };
}

export function previewRows(report) { return report.changes.flatMap(change => change.fields.map(field => ({ ...field, kind: change.kind, key: change.key, oldSource: change.old?.source || null, newSource: change.new?.source || null }))); }
export async function serializeReport(report, format, hooks = {}) {
  if (!['json', 'csv'].includes(format)) throw new Error('只支持JSON/CSV导出。');
  const chunks = []; let bytes = 0; const encoder = new TextEncoder();
  const append = text => { bytes += encoder.encode(text).length; if (bytes > LIMITS.outputBytes) throw new Error('导出超过12 MiB，请拆分数据。'); chunks.push(text); };
  await checkpoint(hooks);
  if (format === 'json') {
    const header = { feature: 'T003', version: 1, primaryKey: report.primaryKey, sources: report.sources, rules: report.rules, stats: report.stats };
    append(JSON.stringify(header).slice(0, -1));
    for (const name of ['changes', 'conflicts']) {
      append(`,"${name}":[`);
      for (let index = 0; index < report[name].length; index++) { if (index % 32 === 0) await checkpoint(hooks); append((index ? ',' : '') + JSON.stringify(report[name][index])); }
      append(']');
    }
    append('}\n');
  } else {
    const cell = value => { const text = typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value); return '"' + text.replaceAll('"', '""') + '"'; };
    const source = record => record ? [record.name, record.row, record.line] : [null, null, null];
    append('\uFEFFkind,key_json,old_name_json,old_row,old_line,new_name_json,new_row,new_line,path_json,before_present,before_json,after_present,after_json,reason_json\r\n');
    let index = 0;
    for (const row of previewRows(report)) {
      if (index++ % 64 === 0) await checkpoint(hooks);
      append([row.kind, row.key, ...source(row.oldSource), ...source(row.newSource), row.path, row.before.present, row.before.present ? row.before.value : null, row.after.present, row.after.present ? row.after.value : null, null].map(cell).join(',') + '\r\n');
    }
    for (const conflict of report.conflicts) for (const [side, records] of [['old', conflict.old], ['new', conflict.new]]) for (const record of records) {
      if (index++ % 64 === 0) await checkpoint(hooks);
      append([conflict.kind, conflict.key, ...source(side === 'old' ? record.source : null), ...source(side === 'new' ? record.source : null), '', side === 'old', side === 'old' ? record.value : null, side === 'new', side === 'new' ? record.value : null, conflict.reason].map(cell).join(',') + '\r\n');
    }
  }
  checkAbort(hooks.signal); return chunks.join('');
}
