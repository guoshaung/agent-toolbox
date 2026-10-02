export const LIMITS = Object.freeze({ inputBytes: 65536, tables: 50, columns: 50, indexes: 100, tokens: 40000, nameChars: 128, outputBytes: 2097152, chunkBytes: 16384 });
export const EXAMPLE_OLD = "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT DEFAULT 'a,b;()');\n";
export const EXAMPLE_NEW = "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\nCREATE INDEX people_name ON people (name);\n";
export class DdlError extends Error { constructor(code, message, line = 1, column = 1) { super(message); this.name = 'DdlError'; this.code = code; this.line = line; this.column = column; } }
const asciiFold = value => value.replace(/[A-Z]/g, c => c.toLowerCase());
const reserved = new Set(('ABORT ACTION ADD AFTER ALL ALTER ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT').split(' '));
function validText(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.inputBytes) throw new DdlError('input_limit', '每份 DDL 最多 64 KiB UTF-8。');
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); if ((n < 32 && ![9, 10, 13].includes(n)) || n === 127 || (n >= 0xd800 && n <= 0xdbff && !(text.charCodeAt(++i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff)) || (n >= 0xdc00 && n <= 0xdfff)) throw new DdlError('invalid_text', '拒绝控制字符或不成对 Unicode。'); }
}
export function lex(text) {
  validText(text); const tokens = []; let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; let line = 1; let column = 1;
  const advance = () => { const c = text[i++]; if (c === '\n') { line++; column = 1; } else column++; return c; };
  const push = (kind, value, startLine, startColumn) => { if (tokens.length >= LIMITS.tokens) throw new DdlError('token_limit', 'DDL 词元过多。', startLine, startColumn); tokens.push({ kind, value, line: startLine, column: startColumn }); };
  while (i < text.length) {
    const c = text[i]; if (' \t\r\n'.includes(c)) { advance(); continue; }
    if (c === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') advance(); continue; }
    if (c === '/' && text[i + 1] === '*') { const l = line; const col = column; advance(); advance(); while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) advance(); if (i === text.length) throw new DdlError('unclosed_comment', '块注释未闭合。', l, col); advance(); advance(); continue; }
    const l = line; const col = column;
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c; const kind = c === "'" ? 'string' : 'quoted'; let value = ''; let closed = false; advance();
      while (i < text.length) { const part = advance(); if (part === close) { if (c !== '[' && text[i] === close) { value += advance(); continue; } closed = true; break; } value += part; }
      if (!closed) throw new DdlError('unclosed_quote', '字符串或标识符引号未闭合。', l, col); push(kind, value, l, col); continue;
    }
    if (/[A-Za-z_]/.test(c)) { let value = ''; while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) value += advance(); push('word', value, l, col); continue; }
    if (/[0-9]/.test(c)) { let value = ''; while (i < text.length && /[0-9]/.test(text[i])) value += advance(); if (text[i] === '.') { value += advance(); if (!/[0-9]/.test(text[i] || '')) throw new DdlError('number_syntax', '小数点后必须有数字。', l, col); while (i < text.length && /[0-9]/.test(text[i])) value += advance(); } push('number', value, l, col); continue; }
    if ('(),;+-'.includes(c)) { push(c, advance(), l, col); continue; }
    throw new DdlError('unsupported_token', '此字符不属于支持的 DDL 语法。', l, col);
  }
  tokens.push({ kind: 'eof', value: '', line, column }); return tokens;
}
export function parseDDL(text) {
  const tokens = lex(text); let pos = 0; const tables = []; const indexes = []; const objectKeys = new Set();
  const peek = () => tokens[pos]; const is = value => peek().kind === 'word' && peek().value.toUpperCase() === value;
  const error = (code, message, t = peek()) => { throw new DdlError(code, message, t.line, t.column); };
  const word = value => { if (!is(value)) error('unsupported_syntax', `只支持有限语法，当前位置需要 ${value}。`); return tokens[pos++]; };
  const punctuation = value => { if (peek().kind !== value) error('unsupported_syntax', `当前位置需要 ${value}。`); pos++; };
  const identifier = () => { const t = peek(); if (!['word', 'quoted'].includes(t.kind) || (t.kind === 'word' && reserved.has(t.value.toUpperCase()))) error('identifier', '名称需要非保留字或标识符引号。'); if (!t.value.length || t.value.length > LIMITS.nameChars || /[\x00-\x1f\x7f]/.test(t.value)) error('identifier_limit', '名称须为 1–128 字符且不含控制字符。'); pos++; return t.value; };
  const object = name => { const key = asciiFold(name); if (key.startsWith('sqlite_')) error('reserved_name', 'sqlite_ 前缀为 SQLite 内部保留。'); if (objectKeys.has(key)) error('duplicate_object', '表和索引名称不可重复（ASCII 大小写不敏感）。'); objectKeys.add(key); };
  const literal = () => { if (is('NULL')) { pos++; return { kind: 'null', value: null, sql: 'NULL' }; } const t = peek(); if (t.kind === 'string') { pos++; return { kind: 'text', value: t.value, sql: "'" + t.value.replace(/'/g, "''") + "'" }; } let sign = ''; if (['+', '-'].includes(peek().kind)) sign = tokens[pos++].kind; const n = peek(); if (n.kind !== 'number') error('unsupported_default', 'DEFAULT 仅支持 NULL、单引号字符串和有符号普通十进制字面量。'); pos++; if (n.value.length > 100 || !Number.isFinite(Number(sign + n.value))) error('default_number', '数字字面量超过支持范围。', n); const sql = (sign === '+' ? '' : sign) + n.value; return { kind: 'number', value: sql, sql }; };
  while (peek().kind !== 'eof') {
    word('CREATE'); let unique = false; if (is('UNIQUE')) { unique = true; pos++; }
    if (is('TABLE') && !unique) {
      pos++; if (tables.length >= LIMITS.tables) error('table_limit', '最多 50 张表。'); const name = identifier(); object(name); punctuation('('); const columns = []; const keys = new Set(); let primaryKey = [];
      while (true) {
        if (is('PRIMARY')) { if (primaryKey.length) error('duplicate_primary_key', '每张表最多一个主键。'); pos++; word('KEY'); punctuation('('); while (true) { const keyName = identifier(); if (primaryKey.some(n => asciiFold(n) === asciiFold(keyName))) error('duplicate_primary_column', '主键列不可重复。'); primaryKey.push(keyName); if (peek().kind !== ',') break; pos++; } punctuation(')'); if (peek().kind === ',') error('primary_position', '表级主键须放在最后。'); }
        else {
          if (columns.length >= LIMITS.columns) error('column_limit', '每表最多 50 列。'); const columnName = identifier(); const key = asciiFold(columnName); if (keys.has(key)) error('duplicate_column', '列名不可重复（ASCII 大小写不敏感）。'); keys.add(key);
          const typeToken = peek(); if (typeToken.kind !== 'word' || !['INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC'].includes(typeToken.value.toUpperCase())) error('unsupported_type', '类型只支持 INTEGER / REAL / TEXT / BLOB / NUMERIC。'); pos++;
          const column = { name: columnName, type: typeToken.value.toUpperCase(), notNull: false, default: null, primaryKey: 0 }; let nullSeen = false; let defaultSeen = false; let pkSeen = false;
          while (![')', ',', 'eof'].includes(peek().kind)) {
            if (is('NOT') || is('NULL')) { if (nullSeen) error('duplicate_nullability', 'NULL/NOT NULL 不可重复。'); nullSeen = true; if (is('NOT')) { pos++; word('NULL'); column.notNull = true; } else pos++; }
            else if (is('DEFAULT')) { if (defaultSeen) error('duplicate_default', 'DEFAULT 不可重复。'); defaultSeen = true; pos++; column.default = literal(); }
            else if (is('PRIMARY')) { if (pkSeen || primaryKey.length) error('duplicate_primary_key', '每张表最多一个主键。'); pkSeen = true; pos++; word('KEY'); primaryKey = [columnName]; }
            else error('unsupported_constraint', '不支持此列约束或 SQL 表达式；整份 DDL 已拒绝。');
          }
          columns.push(column);
        }
        if (peek().kind !== ',') break; pos++; if (peek().kind === ')') error('trailing_comma', '列清单不能以逗号结束。');
      }
      punctuation(')'); for (let i = 0; i < primaryKey.length; i++) { const column = columns.find(c => asciiFold(c.name) === asciiFold(primaryKey[i])); if (!column) error('primary_missing_column', '主键引用了不存在的列。'); column.primaryKey = i + 1; primaryKey[i] = column.name; }
      if (!columns.length) error('empty_table', '表须至少有一列。'); tables.push({ name, columns, primaryKey });
    } else if (is('INDEX')) {
      pos++; if (indexes.length >= LIMITS.indexes) error('index_limit', '最多 100 个显式索引。'); const name = identifier(); object(name); word('ON'); const table = identifier(); punctuation('('); const columns = []; const keys = new Set();
      while (true) { if (columns.length >= LIMITS.columns) error('index_column_limit', '每索引最多 50 列。'); const name = identifier(); const key = asciiFold(name); if (keys.has(key)) error('duplicate_index_column', '索引列不可重复。'); keys.add(key); let direction = 'ASC'; if (is('ASC') || is('DESC')) direction = tokens[pos++].value.toUpperCase(); columns.push({ name, direction }); if (peek().kind !== ',') break; pos++; }
      punctuation(')'); indexes.push({ name, table, unique, columns });
    } else error('unsupported_statement', '只支持 CREATE TABLE 和 CREATE [UNIQUE] INDEX；其他语句整份拒绝。');
    if (peek().kind === ';') pos++; else if (peek().kind !== 'eof') error('statement_separator', '语句之间必须有分号；不支持表选项、索引条件或表达式。');
  }
  for (const index of indexes) { const table = tables.find(t => asciiFold(t.name) === asciiFold(index.table)); if (!table) throw new DdlError('index_missing_table', '索引引用了未在该份 DDL 定义的表。'); index.table = table.name; for (const c of index.columns) { const column = table.columns.find(n => asciiFold(n.name) === asciiFold(c.name)); if (!column) throw new DdlError('index_missing_column', '索引引用了不存在的列。'); c.name = column.name; } }
  return { dialect: 'T056-sqlite-ddl-v1', tables, indexes };
}
const mapByName = array => new Map(array.map(x => [asciiFold(x.name), x]));
const q = name => '"' + name.replace(/"/g, '""') + '"';
export function tableSQL(table) { const columns = table.columns.map(c => `${q(c.name)} ${c.type}${c.notNull ? ' NOT NULL' : ''}${c.default ? ' DEFAULT ' + c.default.sql : ''}`); if (table.primaryKey.length) columns.push(`PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`); return `CREATE TABLE ${q(table.name)} (${columns.join(', ')});`; }
export function indexSQL(index) { return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ON ${q(index.table)} (${index.columns.map(c => q(c.name) + ' ' + c.direction).join(', ')});`; }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaultIdentity = d => d ? [d.kind, d.value] : null;
export function compareDDL(oldText, newText) {
  const before = parseDDL(oldText); const after = parseDDL(newText); const changes = []; const add = (kind, table, subject, destructive, note, oldValue = null, newValue = null) => changes.push({ kind, table, subject, destructive, requiresReview: true, note, before: oldValue, after: newValue });
  const oldTables = mapByName(before.tables); const newTables = mapByName(after.tables);
  for (const [key, table] of oldTables) if (!newTables.has(key)) add('drop_table', table.name, table.name, true, '删表会丢失数据；不生成执行语句。', table, null);
  for (const [key, table] of newTables) {
    const old = oldTables.get(key); if (!old) { add('add_table', table.name, table.name, false, '新表定义仅提供注释草案；核对名称与业务约束。', null, table); continue; }
    const oldColumns = mapByName(old.columns); const newColumns = mapByName(table.columns);
    for (const [columnKey, c] of oldColumns) if (!newColumns.has(columnKey)) add('drop_column', table.name, c.name, true, '删列可能永久丢失数据；需人工选择迁移策略。', c, null);
    for (const [columnKey, c] of newColumns) {
      const previous = oldColumns.get(columnKey); if (!previous) { add('add_column', table.name, c.name, false, '新增列需核对历史行的默认值和约束；不自动 ALTER。', null, c); continue; }
      if (previous.type !== c.type) add('change_type', table.name, c.name, true, '声明类型/亲和性变化可能改变转换与查询行为，需人工核对数据。', previous.type, c.type);
      if (previous.notNull !== c.notNull) add('change_nullability', table.name, c.name, c.notNull, c.notNull ? '收紧 NOT NULL 可能拒绝历史空值。' : '放宽 NULL 仍需人工核对业务约束。', previous.notNull, c.notNull);
      if (!eq(defaultIdentity(previous.default), defaultIdentity(c.default))) add('change_default', table.name, c.name, false, '默认值定义变化；数字按字面量保守比较，不推断表达式等价。', previous.default, c.default);
    }
    const oldPK = old.primaryKey.map(asciiFold); const newPK = table.primaryKey.map(asciiFold); if (!eq(oldPK, newPK)) add('change_primary_key', table.name, table.name, true, '主键/行标识语义变化，需人工核对约束与引用。', old.primaryKey, table.primaryKey);
    const retainedOld = old.columns.filter(c => newColumns.has(asciiFold(c.name))).map(c => asciiFold(c.name)); const retainedNew = table.columns.filter(c => oldColumns.has(asciiFold(c.name))).map(c => asciiFold(c.name)); if (!eq(retainedOld, retainedNew)) add('reorder_columns', table.name, table.name, false, '共同列顺序变化；影响位置取值，需人工核对。', old.columns.map(c => c.name), table.columns.map(c => c.name));
  }
  const oldIndexes = mapByName(before.indexes); const newIndexes = mapByName(after.indexes);
  const identity = index => [asciiFold(index.table), index.unique, index.columns.map(c => [asciiFold(c.name), c.direction])];
  for (const [key, index] of oldIndexes) if (!newIndexes.has(key)) add('drop_index', index.table, index.name, index.unique, index.unique ? '删除唯一索引会撤销唯一性约束。' : '删除索引可能影响查询性能。', index, null);
  for (const [key, index] of newIndexes) { const old = oldIndexes.get(key); if (!old) add('add_index', index.table, index.name, false, index.unique ? '新唯一索引可能因历史重复值失败；需人工复核。' : '新增索引须人工核对字段、空间与锁影响。', null, index); else if (!eq(identity(old), identity(index))) add('change_index', index.table, index.name, old.unique || index.unique, '索引所属表、唯一性、列或方向发生变化；不自动重建。', old, index); }
  return { format: 'T056-ddl-diff', version: 1, scope: '有限 SQLite DDL 声明比较；没有连接数据库或执行迁移。', reviewRequired: true, before, after, counts: { changes: changes.length, destructive: changes.filter(c => c.destructive).length }, changes };
}
export async function analyze(oldText, newText, options = {}) { await new Promise(resolve => setTimeout(resolve, 0)); if (options.isCanceled?.()) throw new DdlError('canceled', '分析已取消，没有部分报告。'); const result = compareDDL(oldText, newText); if (options.isCanceled?.()) throw new DdlError('canceled', '分析已取消，没有部分报告。'); return result; }
export function exportReport(report, extension) {
  let text; if (extension === 'json') text = JSON.stringify(report, null, 2) + '\n';
  else if (extension === 'md') { const cell = value => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' '); text = '# T056 数据库结构差异草案\n\n' + report.scope + '\n\n所有变化必须人工复核；destructive 表示潜在数据或约束破坏，并非其余变化自动安全。DDL 默认值及名称会进入报告，分享前检查。\n\n' + `变化 ${report.counts.changes}；危险 ${report.counts.destructive}。\n\n| 类型 | 表 | 对象 | 危险 | 说明 |\n| --- | --- | --- | --- | --- |\n` + report.changes.map(c => `| ${[c.kind, c.table, c.subject, c.destructive ? '是' : '否', c.note].map(cell).join(' | ')} |`).join('\n') + '\n\n## 完整声明与差异\n\n```json\n' + JSON.stringify(report, null, 2).replace(/`/g, '\\u0060') + '\n```\n'; }
  else if (extension === 'sql') { const lines = ['T056 注释草案：所有行均为注释，不可直接执行。', '没有连接数据库、没有排期或自动安全迁移承诺。', '必须人工检查数据、外键、业务约束、SQLite 版本和迁移备份。', '危险变更只列事项，不自动生成删表、删列或重建 SQL。']; for (const c of report.changes) { lines.push(`${c.kind} ${q(c.table)} / ${q(c.subject)} | destructive=${c.destructive} | ${c.note}`); if (c.kind === 'add_table') lines.push(tableSQL(c.after)); if (c.kind === 'add_index') lines.push(indexSQL(c.after)); } text = lines.flatMap(line => line.split(/\r\n|\r|\n/).map(part => '-- ' + part)).join('\n') + '\n'; }
  else throw new DdlError('output_format', '只支持 JSON、Markdown 和注释 SQL。');
  if (new TextEncoder().encode(text).length > LIMITS.outputBytes) throw new DdlError('output_limit', '完整报告超过 2 MiB，禁止部分导出。'); return text;
}
