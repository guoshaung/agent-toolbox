export const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, rows: 10000, columns: 100, cells: 100000, cellLength: 50000, outputBytes: 12 * 1024 * 1024 });

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
function checkAbort(signal) {
  if (signal?.aborted) { const error = new Error('已取消处理。'); error.name = 'AbortError'; throw error; }
}
async function checkpoint(hooks = {}) {
  checkAbort(hooks.signal);
  await (hooks.yieldControl || nextTurn)();
  checkAbort(hooks.signal);
}
function delimiterOf(value) {
  if (value !== ',' && value !== '\t') throw new Error('分隔符只能是逗号或制表符。');
  return value;
}

/** Strict quoted CSV / TSV. Physical source lines survive embedded newlines. */
export async function parseDelimited(input, options = {}, hooks = {}) {
  checkAbort(hooks.signal);
  if (typeof input !== 'string' || !input.length) throw new Error('请先输入 CSV / TSV 内容。');
  const limits = { ...LIMITS, ...options.limits };
  if (input.length > limits.bytes || new TextEncoder().encode(input).length > limits.bytes) throw new Error('输入超过 5 MiB 上限，请拆分后处理。');
  const delimiter = delimiterOf(options.delimiter ?? ',');
  const hadBOM = input.startsWith('\uFEFF');
  const text = hadBOM ? input.slice(1) : input;
  if (!text) throw new Error('文件只有 BOM，没有表格内容。');
  const records = [];
  let cells = [], field = '', state = 'start', line = 1, sourceLine = 1, cellCount = 0, nextYield = 32768;
  const fail = message => { throw new Error(`源文件第 ${line} 行：${message}`); };
  function pushField() {
    cells.push(field); field = ''; state = 'start';
    if (cells.length > limits.columns) fail(`列数超过 ${limits.columns} 列上限。`);
    if (++cellCount > limits.cells) fail(`单元格数量超过 ${limits.cells} 上限。`);
  }
  function pushRecord() {
    const emptyPhysicalLine = cells.length === 0 && field === '' && state === 'start';
    pushField(); records.push({ cells, sourceLine, emptyPhysicalLine }); cells = [];
    if (records.length > limits.rows + (options.header !== false ? 1 : 0)) fail(`数据超过 ${limits.rows} 行上限。`);
  }
  for (let i = 0; i < text.length; i++) {
    if (i >= nextYield) { nextYield = i + 32768; hooks.onProgress?.(i / text.length); await checkpoint(hooks); }
    const ch = text[i];
    const newline = ch === '\r' || ch === '\n';
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed';
      } else if (newline) {
        if (ch === '\r' && text[i + 1] === '\n') { field += '\r\n'; i++; } else field += ch;
        line++;
      } else field += ch;
    } else if (ch === delimiter) {
      pushField();
    } else if (newline) {
      pushRecord();
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++; sourceLine = line;
    } else if (state === 'closed') {
      fail('闭引号后只能出现分隔符或换行；请将字段内空白放进引号。');
    } else if (ch === '"') {
      if (state !== 'start') fail('未加引号的字段中出现双引号。');
      state = 'quoted';
    } else {
      state = 'plain'; field += ch;
    }
    if (field.length > limits.cellLength) fail(`单个字段超过 ${limits.cellLength} 字符上限。`);
  }
  if (state === 'quoted') fail('双引号字段未闭合。');
  // A terminal record separator ends the preceding row; it does not invent a row.
  if (cells.length || field.length || state !== 'start') pushRecord();
  if (!records.length) throw new Error('没有可解析的表格记录。');
  const width = records[0].cells.length;
  for (const record of records) {
    if (record.emptyPhysicalLine && width > 1) {
      cellCount += width - 1;
      if (cellCount > limits.cells) throw new Error(`单元格数量超过 ${limits.cells} 上限。`);
      record.cells = Array(width).fill('');
    }
    if (record.cells.length !== width) throw new Error(`源文件第 ${record.sourceLine} 行有 ${record.cells.length} 列，预期 ${width} 列。空字段请保留分隔符，不能自动猜测错位。`);
  }
  const header = options.header !== false ? records.shift().cells : null;
  const columns = Array.from({ length: width }, (_, index) => ({ index, label: header?.[index] || `第 ${index + 1} 列` }));
  hooks.onProgress?.(1); checkAbort(hooks.signal);
  return { records, header, columns, delimiter, hadBOM };
}

export async function cleanTable(table, rules = {}, hooks = {}) {
  checkAbort(hooks.signal);
  const selected = new Set(rules.columns ?? table.columns.map(column => column.index));
  if ([...selected].some(index => !Number.isInteger(index) || index < 0 || index >= table.columns.length)) throw new Error('选择列超出表格范围。');
  const letterCase = rules.letterCase ?? 'preserve';
  if (!['preserve', 'lower', 'upper'].includes(letterCase)) throw new Error('大小写规则无效。');
  if (!['keep', 'drop'].includes(rules.blankRows ?? 'keep') || !['keep', 'drop'].includes(rules.duplicateRows ?? 'keep')) throw new Error('行处理规则无效。');
  const fillValue = String(rules.fillValue ?? '');
  if (fillValue.length > 1000) throw new Error('空值替换文本最多 1000 字符。');
  const rows = [], changes = [], removed = [], seen = new Map();
  const stats = { inputRows: table.records.length, outputRows: 0, changedCells: 0, changedRows: 0, blankRows: 0, duplicateRows: 0, removedBlankRows: 0, removedDuplicateRows: 0 };
  for (let r = 0; r < table.records.length; r++) {
    if (r % 128 === 0) { hooks.onProgress?.(r / Math.max(1, table.records.length)); await checkpoint(hooks); }
    const record = table.records[r];
    let rowChanged = false;
    const cells = record.cells.map((before, index) => {
      if (!selected.has(index)) return before;
      let after = before;
      const reasons = [];
      const apply = (value, reason) => { if (value !== after) { after = value; reasons.push(reason); } };
      if (rules.trim !== false) apply(after.trim(), '首尾空白');
      if (rules.collapseWhitespace) apply(after.replace(/\s+/gu, ' '), '连续空白');
      if (rules.nfkc) apply(after.normalize('NFKC'), '兼容字符规范化');
      if (letterCase === 'lower') apply(after.toLowerCase(), '转小写');
      if (letterCase === 'upper') apply(after.toUpperCase(), '转大写');
      if (rules.fillEmpty && after === '') apply(fillValue, '空值替换');
      if (after.length > LIMITS.cellLength) throw new Error(`源文件第 ${record.sourceLine} 行处理后的字段过长。`);
      if (after !== before) {
        rowChanged = true;
        changes.push({ sourceLine: record.sourceLine, column: table.columns[index].label, columnIndex: index + 1, before, after, reasons });
      }
      return after;
    });
    if (rowChanged) stats.changedRows++;
    const blank = cells.every(value => value === '');
    if (blank) stats.blankRows++;
    if (blank && rules.blankRows === 'drop') {
      stats.removedBlankRows++; removed.push({ sourceLine: record.sourceLine, reason: '清洗后整行为空' }); continue;
    }
    const key = JSON.stringify(cells);
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) {
      stats.duplicateRows++;
      if (rules.duplicateRows === 'drop') {
        stats.removedDuplicateRows++; removed.push({ sourceLine: record.sourceLine, reason: '清洗后完全重复', duplicateOf }); continue;
      }
    } else seen.set(key, record.sourceLine);
    rows.push({ sourceLine: record.sourceLine, cells });
  }
  stats.changedCells = changes.length; stats.outputRows = rows.length;
  hooks.onProgress?.(1); checkAbort(hooks.signal);
  return { ...table, rows, changes, removed, stats };
}

function quote(value, delimiter) {
  const text = String(value);
  return text.includes(delimiter) || /["\r\n]/u.test(text) || /^\s|\s$/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export async function serializeTable(result, options = {}, hooks = {}) {
  checkAbort(hooks.signal);
  const delimiter = delimiterOf(options.delimiter ?? result.delimiter);
  const includeSourceLine = options.includeSourceLine !== false;
  let sourceLabel = '_source_line';
  while (result.header?.includes(sourceLabel)) sourceLabel += '_';
  const lines = [];
  let characterCount = 0;
  const append = cells => {
    const line = cells.map(cell => quote(cell, delimiter)).join(delimiter);
    characterCount += line.length + 2;
    if (characterCount > LIMITS.outputBytes) throw new Error('导出超过 12 MiB 上限，请减少替换文本或拆分数据。');
    lines.push(line);
  };
  if (result.header) append(includeSourceLine ? [sourceLabel, ...result.header] : result.header);
  for (let i = 0; i < result.rows.length; i++) {
    if (i % 128 === 0) await checkpoint(hooks);
    const row = result.rows[i];
    append(includeSourceLine ? [String(row.sourceLine), ...row.cells] : row.cells);
  }
  const output = (options.bom !== false ? '\uFEFF' : '') + (lines.length ? lines.join('\r\n') + '\r\n' : '');
  if (new TextEncoder().encode(output).length > LIMITS.outputBytes) throw new Error('导出超过 12 MiB 上限，请拆分数据。');
  checkAbort(hooks.signal); return output;
}

/** Bound report generation as well as parsing: replacement text can expand a report. */
export async function serializeReport(result, details = {}, hooks = {}) {
  checkAbort(hooks.signal);
  const encoder = new TextEncoder();
  const chunks = [];
  let bytes = 0;
  function append(text) {
    bytes += encoder.encode(text).length;
    if (bytes > LIMITS.outputBytes) throw new Error('变更清单超过 12 MiB 上限，请拆分数据。');
    chunks.push(text);
  }
  const prefix = JSON.stringify({ feature: 'T002', sourceName: details.sourceName ?? '表格', rules: details.rules ?? {}, stats: result.stats });
  append(prefix.slice(0, -1));
  for (const key of ['changes', 'removed']) {
    append(`,"${key}":[`);
    for (let i = 0; i < result[key].length; i++) {
      if (i % 128 === 0) await checkpoint(hooks);
      append((i ? ',' : '') + JSON.stringify(result[key][i]));
    }
    append(']');
  }
  append('}\n'); checkAbort(hooks.signal); return chunks.join('');
}
