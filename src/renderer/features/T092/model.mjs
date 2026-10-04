export const LIMITS = Object.freeze({ inputBytes: 1048576, rows: 5000, columns: 100, cellChars: 65536, headerChars: 100, outputBytes: 8388608, signatures: 20000, audit: 100 });
export class DataError extends Error {
  constructor(code, message, audit = [], failureCount = 0) { super(message); this.name = 'DataError'; this.code = code; this.audit = audit; this.failureCount = failureCount; }
}
const fail = (code, message) => { throw new DataError(code, message); };
const bytes = value => new TextEncoder().encode(value).byteLength;
function validText(value) {
  if (typeof value !== 'string') fail('text', '输入必须是文本。');
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('unicode', '输入含无效 Unicode 代理字符。'); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail('unicode', '输入含无效 Unicode 代理字符。');
  }
}
function header(value) {
  if (typeof value !== 'string' || !value || value.length > LIMITS.headerChars || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) fail('header', '字段名须为 1–100 个字符，不能有首尾空白或控制字符。');
  validText(value); return value;
}
function headers(values) {
  if (!values.length || values.length > LIMITS.columns) fail('columns', '必须有 1–100 列。');
  const names = new Set();
  for (const value of values) { header(value); const canonical = value.normalize('NFKC'); if (names.has(canonical)) fail('duplicateHeader', '字段名重复（含 Unicode 兼容形式），未解析数据。'); names.add(canonical); }
  return values;
}
function parseCSV(text) {
  const records = []; let record = []; let value = ''; let quoted = false; let closed = false; let started = false;
  function addCell() { record.push(value); if (record.length > LIMITS.columns) fail('columns', 'CSV 超过 100 列。'); value = ''; closed = false; started = false; }
  function addRow() { addCell(); records.push(record); record = []; if (records.length > LIMITS.rows + 1) fail('rows', 'CSV 数据超过 5000 行。'); }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === ',') addCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] !== '\n') fail('csvSyntax', 'CSV 换行只能使用 LF 或 CRLF。'); if (c === '\r') i++; addRow(); }
    else if (c === '"') { if (started || closed) fail('csvSyntax', 'CSV 引号位置无效。'); quoted = true; started = true; }
    else { if (closed) fail('csvSyntax', 'CSV 闭合引号后只能是分隔符或换行。'); value += c; started = true; }
    if (value.length > LIMITS.cellChars) fail('cell', '单元格超过 65536 个字符。');
  }
  if (quoted) fail('csvSyntax', 'CSV 引号未闭合。');
  if (value || record.length || started || closed) addRow();
  if (records.length < 2) fail('rows', 'CSV 必须包含表头及至少一行数据。');
  const columns = headers(records.shift());
  for (let i = 0; i < records.length; i++) if (records[i].length !== columns.length) fail('rowWidth', `CSV 数据行 ${i + 1} 的列数不等于表头；未丢弃任何单元格。`);
  return { format: 'csv', columns, rows: records };
}
function parseJSON(text) {
  let at = 0;
  const space = () => { while (/\s/.test(text[at] || '') && at < text.length) { if (!/[\x20\t\n\r]/.test(text[at])) fail('jsonSyntax', 'JSON 存在非法空白。'); at++; } };
  const expect = c => { space(); if (text[at++] !== c) fail('jsonSyntax', `JSON 结构无效，位置 ${at}。`); };
  function string() {
    space(); if (text[at] !== '"') fail('jsonSyntax', `JSON 字符串缺少引号，位置 ${at + 1}。`);
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') { let out; try { out = JSON.parse(text.slice(start, at)); } catch { fail('jsonSyntax', `JSON 字符串无效，位置 ${start + 1}。`); } validText(out); if (out.length > LIMITS.cellChars) fail('cell', '单元格超过 65536 个字符。'); return out; }
      if (c === '\\') { at++; } else if (c.charCodeAt(0) < 32) fail('jsonSyntax', `JSON 字符串含控制字符，位置 ${at}。`);
    }
    fail('jsonSyntax', 'JSON 字符串未闭合。');
  }
  function primitive() {
    space(); if (text[at] === '"') return string();
    if (text[at] === '[' || text[at] === '{') fail('nested', '只接受扁平记录；嵌套对象和数组须先另行展开。');
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) if (text.slice(at, at + token.length) === token) { at += token.length; return value; }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/.exec(text.slice(at))?.[0];
    if (!token) fail('jsonSyntax', `JSON 标量无效，位置 ${at + 1}。`);
    at += token.length;
    if (/[eE]/.test(text[at] || '')) fail('number', 'JSON 数值不接受指数写法，请先改为普通十进制。');
    const digits = token.replace(/[-.]/g, '').replace(/^0+/, '');
    if (digits.length > 15 || (token.split('.')[1]?.length || 0) > 6 || !Number.isFinite(Number(token))) fail('number', 'JSON 数值最多 15 位有效数字、6 位小数。');
    return Number(token);
  }
  expect('['); space(); const columns = []; const rows = [];
  if (text[at] === ']') fail('rows', 'JSON 至少需要一条记录。');
  while (true) {
    expect('{'); const keys = []; const values = []; const seen = new Set(); space();
    if (text[at] === '}') fail('columns', 'JSON 记录不能是空对象。');
    while (true) {
      const key = header(string()); const canonical = key.normalize('NFKC');
      if (seen.has(canonical)) fail('duplicateHeader', `JSON 第 ${rows.length + 1} 行字段名重复，未解析数据。`);
      seen.add(canonical); keys.push(key); if (keys.length > LIMITS.columns) fail('columns', 'JSON 超过 100 列。'); expect(':'); values.push(primitive()); space();
      if (text[at] === '}') { at++; break; } expect(',');
    }
    if (!rows.length) columns.push(...headers(keys));
    if (keys.length !== columns.length || keys.some(k => !columns.includes(k))) fail('unmatched', `JSON 第 ${rows.length + 1} 行字段集合不一致；缺失和多余字段均拒绝，未填入 null。`);
    rows.push(columns.map(k => values[keys.indexOf(k)])); if (rows.length > LIMITS.rows) fail('rows', 'JSON 数据超过 5000 行。'); space();
    if (text[at] === ']') { at++; break; } expect(',');
  }
  space(); if (at !== text.length) fail('jsonSyntax', `JSON 尾部含多余内容，位置 ${at + 1}。`);
  return { format: 'json', columns, rows };
}
export function parseSource(source, format) {
  validText(source); if (source.length > LIMITS.inputBytes || bytes(source) > LIMITS.inputBytes) fail('inputLimit', '输入超过 1 MiB UTF-8。');
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  if (format === 'csv') return parseCSV(text); if (format === 'json') return parseJSON(text); fail('format', '只支持 CSV 或 JSON。');
}
function scaled(value, width = false) {
  if (typeof value !== 'string' && typeof value !== 'number') fail('bucketValue', '分桶只接受普通十进制数字，拒绝空值及布尔值。');
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) fail('bucketValue', '分桶数字须使用普通十进制、最多两位小数，无空白。');
  const negative = text.startsWith('-'); const [integer, fraction = ''] = text.replace(/^-/, '').split('.');
  const number = (Number(integer) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(number) || Math.abs(number) > 100000000 || (width && number <= 0)) fail('bucketValue', width ? '桶宽须为 0.01–1000000，最多两位小数。' : '分桶值须位于 -1000000–1000000。');
  return number;
}
const decimal = value => `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
export function bucketValue(value, width) { const step = scaled(width, true); const lower = Math.floor(scaled(value) / step) * step; return `[${decimal(lower)}, ${decimal(lower + step)})`; }
export function serializeCSV(columns, rows) {
  const cell = value => { const text = value === null ? 'null' : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export async function processData(data, policies, options = {}) {
  if (!data || !['csv', 'json'].includes(data.format) || !Array.isArray(data.columns) || !Array.isArray(data.rows)) fail('data', '请先解析输入。');
  headers(data.columns); if (!data.rows.length || data.rows.length > LIMITS.rows || data.rows.some(row => !Array.isArray(row) || row.length !== data.columns.length)) fail('data', '数据行或列结构无效。');
  if (!Array.isArray(policies) || policies.length !== data.columns.length) fail('policy', '每一列都必须选择处理策略。');
  const policy = policies.map(p => { if (!p || !['keep', 'delete', 'bucket', 'pseudo'].includes(p.type)) fail('policy', '处理策略无效。'); if (p.type === 'bucket') scaled(p.width, true); return { type: p.type, ...(p.type === 'bucket' ? { width: decimal(scaled(p.width, true)) } : {}) }; });
  const indices = policy.flatMap((p, i) => p.type === 'delete' ? [] : [i]); if (!indices.length) fail('policy', '至少保留一列；全部删除不能形成有意义的数据副本。');
  const columns = indices.map(i => data.columns[i]); const rows = []; const audit = []; let failures = 0; let estimated = bytes(JSON.stringify(columns)) + 4; let signatures = 0;
  const canceled = () => { if (options.isCanceled?.()) fail('canceled', '处理已取消，未保留部分结果。'); };
  const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
  const cache = new Map(); let key = null; const cryptoAPI = options.crypto || globalThis.crypto;
  try {
    canceled();
    if (policy.some(p => p.type === 'pseudo')) {
      if (!cryptoAPI?.subtle?.generateKey || !cryptoAPI?.subtle?.sign) fail('crypto', '当前环境缺少 WebCrypto HMAC，无法执行伪名处理。');
      key = await cryptoAPI.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']); canceled();
    }
    for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex++) {
      canceled(); const row = [];
      for (const col of indices) {
        const value = data.rows[rowIndex][col]; const p = policy[col];
        if (!(value === null || ['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value))) fail('data', '数据含不支持的标量。');
        if (p.type === 'keep') row.push(value);
        else if (p.type === 'bucket') {
          try { row.push(bucketValue(value, p.width)); } catch (error) { failures++; if (audit.length < LIMITS.audit) audit.push({ row: rowIndex + 1, column: `C${String(col + 1).padStart(3, '0')}`, reason: error.code || 'bucketValue' }); row.push(''); }
        } else {
          const identity = JSON.stringify([data.columns[col], value === null ? 'null' : typeof value, value]);
          if (!cache.has(identity)) {
            if (++signatures > LIMITS.signatures) fail('workLimit', '本次不同伪名值超过 20000 个，请分批处理。');
            const signature = await cryptoAPI.subtle.sign('HMAC', key, new TextEncoder().encode(identity)); canceled();
            cache.set(identity, 'p_' + Array.from(new Uint8Array(signature), v => v.toString(16).padStart(2, '0')).join(''));
          }
          row.push(cache.get(identity));
        }
      }
      estimated += bytes(JSON.stringify(row)) + 3; if (estimated > LIMITS.outputBytes) fail('outputLimit', '结果超过 8 MiB，请缩小输入或删除更多字段。');
      rows.push(row);
      if ((rowIndex + 1) % 50 === 0) { options.onProgress?.({ processed: rowIndex + 1, total: data.rows.length }); await yieldTask(); canceled(); }
    }
    if (failures) {
      const error = new DataError('bucketFailures', `分桶有 ${failures} 个不匹配单元格；整次处理失败，无数据副本。审计仅列行号、列编号和原因，最多 100 项。`, audit, failures);
      error.report = { feature: 'T092', version: 1, state: 'failed', sourceFormat: data.format, rowCount: data.rows.length, inputColumns: data.columns.length, outputColumns: 0, columnPolicy: policy.map((p, i) => ({ column: `C${String(i + 1).padStart(3, '0')}`, strategy: p.type, ...(p.type === 'bucket' ? { width: p.width } : {}) })), failureCount: failures, audit, noDataExport: true, notice: '分桶不匹配，整次处理失败。仅保留行号、列编号和原因；没有原值、字段名映射、原文或密钥。审计最多 100 项，failureCount 为全部不匹配数。' };
      throw error;
    }
    canceled();
    const objects = rows.map(row => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
    const json = JSON.stringify(objects, null, 2); const csv = serializeCSV(columns, rows);
    if (bytes(json) > LIMITS.outputBytes || bytes(csv) > LIMITS.outputBytes) fail('outputLimit', '格式化结果超过 8 MiB，请分批处理。');
    const report = { feature: 'T092', version: 1, state: 'completed', sourceFormat: data.format, rowCount: rows.length, inputColumns: data.columns.length, outputColumns: columns.length, columnPolicy: policy.map((p, i) => ({ column: `C${String(i + 1).padStart(3, '0')}`, strategy: p.type, ...(p.type === 'bucket' ? { width: p.width, interval: '左闭右开，零为边界，负数向下取整' } : {}) })), preservedColumns: policy.filter(p => p.type === 'keep').length, pseudonym: policy.some(p => p.type === 'pseudo') ? '每次新生成不可导出 256-bit HMAC-SHA-256 密钥；仅本次同字段同类型同值关联，完整 256-bit 摘要' : '未使用', audit: [], notice: '未处理列及字段名原样保留，由使用者选择；伪名和分桶不保证无法重新识别。CSV 不携带 JSON 类型信息；JSON null 在 CSV 中明确写为 null。密钥、原值映射和完整源文本不导出、不写配置。' };
    return { columns, rows, json, csv, report };
  } catch (error) { if (error instanceof DataError) throw error; throw new DataError('processing', '本地加密或处理失败，未生成结果。'); }
  finally { cache.clear(); key = null; }
}
