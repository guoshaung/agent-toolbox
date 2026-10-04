// Independent parser copied from T008/parser.mjs at 66785178; no cross-feature imports.
export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, rows: 5000, columns: 100, cells: 100000, stringChars: 50000, depth: 32, nodes: 100000, outputBytes: 12 * 1024 * 1024 });
export function checkAbort(signal) { if (signal?.aborted) { const error = new Error('已取消处理。'); error.name = 'AbortError'; throw error; } }
async function checkpoint(hooks) { checkAbort(hooks?.signal); await (hooks?.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks?.signal); }

// Compare decimal meanings rather than spelling (1.00 == 1e0). Reject values
// whose shortest Number decimal representation changes the input meaning.
function decimalMeaning(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(text);
  let digits = (match[2] + (match[3] || '')).replace(/^0+/u, '');
  if (!digits) return '0';
  const tail = digits.length - digits.replace(/0+$/u, '').length;
  digits = digits.slice(0, digits.length - tail);
  return `${match[1]}${digits}e${Number(match[4] || 0) - (match[3]?.length || 0) + tail}`;
}

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
    if (numberText.length > 128) fail('数字文本超过128字符，请用字符串保存。');
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(numberText)) fail('值不是合法JSON。');
    const number = Number(numberText);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) fail('数字非有限或超出JavaScript安全整数范围；请用字符串保存大编号。');
    if (decimalMeaning(numberText) !== decimalMeaning(String(number))) fail('数字转换为JavaScript Number会丢失十进制值精度，请用字符串保存。');
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
  if (!['json', 'csv'].includes(source.format)) throw new Error('请选择JSON对象数组或CSV格式。');
  if (source.text.length > LIMITS.bytes || new TextEncoder().encode(source.text).length > LIMITS.bytes) throw new Error('每份输入最多2 MiB。');
  const text = source.text.startsWith('\uFEFF') ? source.text.slice(1) : source.text;
  const parsed = source.format === 'json' ? await parseJSONRows(text, hooks) : await parseTable(text, source.format === 'csv' ? ',' : '\t', hooks);
  checkAbort(hooks.signal);
  return { name: source.name, format: source.format, fields: parsed.fields, records: parsed.rows.map((row, index) => ({ source: { name: source.name, row: index + 1, line: row.line }, value: row.value })) };
}
