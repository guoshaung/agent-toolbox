import { LIMITS as JSON_LIMITS, parseJSON, checkAbort } from './json.mjs';
export { parseJSON, checkAbort };
export const LIMITS = Object.freeze({ ...JSON_LIMITS, parents: 5000, mappings: 30, rows: 10000, cells: 100000, pointerChars: 512, columnChars: 80, discardedPaths: 10000, auditBytes: 2 * 1024 * 1024, outputBytes: 12 * 1024 * 1024 });
export const RESERVED = Object.freeze(['__source_name_json', '__parent_row', '__parent_line', '__array_index', '__element_line', '__array_state', '__element_present', '__missing_columns_json', '__json_literal_columns_json']);
export const EXAMPLE = '{\n  "records": [\n    {"id":"P1","items":[{"sku":"A"},{"sku":"B"}],"tags":["x","y"],"note":"未选择"},\n    {"id":"P2","items":[{"sku":"C"}],"tags":["z"],"note":"未选择"}\n  ],\n  "metadata":{"version":1}\n}';
export const EXAMPLE_CONFIG = Object.freeze({ parentPath: '/records', arrayPath: '/items', strategy: 'expand', arrayColumn: 'items_json', mappings: [ { column: 'parent_id', scope: 'parent', path: '/id' }, { column: 'sku', scope: 'element', path: '/sku' }, { column: 'tags_json', scope: 'parent', path: '/tags' } ] });
export const POLICY = Object.freeze({ pointers: '原生JSON Pointer，不是点路径/URI片段/通配符；空映射路径表示当前范围根值；数组索引按固定0基序号读取，不随展开序号联动', expansion: '仅一个相对父记录的数组被展开；父字段重复到各输出行，其他数组只作为JSON字面量单元，不自动zip或笛卡尔积', empty: '所选数组missing/null/空数组均保留一条父行，元素不存在、数组序号null，并记录明确状态；真正null元素为存在的元素', values: '标量保留JSON类型，对象/数组编码为JSON字面量字符串并列入jsonLiteralColumns；缺失字段省略于values并列入missingColumns，null仍为null', loss: '未映射字段全部丢弃；审计逐父及元素列出未覆盖叶路径（含空对象/数组），父路径之外的元数据也列出；完整映射对象/数组会保留其整个子树', provenance: '父记录与数组序号从1开始，原文物理行从1开始；输入路径中的数组索引从0开始', precision: '严格JSON，拒绝重复属性、不安全整数及最短Number十进制表示改变原值；0.1允许十进制往返，不提供任意精度' });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
const encodeToken = token => token.replaceAll('~', '~0').replaceAll('/', '~1');
export function parsePointer(path) {
  if (typeof path !== 'string' || path.length > LIMITS.pointerChars || (path !== '' && !path.startsWith('/'))) throw new Error('JSON Pointer须为空或以/开头，最多512单位。');
  if (path === '') return [];
  const tokens = path.slice(1).split('/'); if (tokens.length > LIMITS.depth) throw new Error('路径超过32层。');
  return tokens.map(token => { if (/~(?:[^01]|$)/u.test(token)) throw new Error('路径~转义仅允许~0或~1。'); return token.replaceAll('~1', '/').replaceAll('~0', '~'); });
}
export function resolvePointer(root, tokens) {
  let value = root;
  for (const token of tokens) {
    if (value === null || typeof value !== 'object') return { present: false };
    if (Array.isArray(value) && (!/^(?:0|[1-9]\d*)$/u.test(token) || !Number.isSafeInteger(Number(token)))) throw new Error('数组路径仅接受固定0基整数索引（不支持01、-、*）。');
    if (!own(value, token)) return { present: false }; value = value[token];
  }
  return { present: true, value };
}
export function validateConfig(config) {
  if (!config || !['expand', 'preserve'].includes(config.strategy)) throw new Error('请选择单数组展开或保留策略。');
  const parentTokens = parsePointer(config.parentPath), arrayTokens = parsePointer(config.arrayPath);
  if (!arrayTokens.length) throw new Error('请选择父记录内明确的数组路径，不能为空。');
  if (!Array.isArray(config.mappings) || !config.mappings.length || config.mappings.length > LIMITS.mappings) throw new Error('请配置1至30个映射列。');
  const columns = new Set(RESERVED);
  const addColumn = column => { if (typeof column !== 'string' || !column.trim() || column !== column.trim() || column.length > LIMITS.columnChars || columns.has(column)) throw new Error('列名须唯一、无首尾空白、最多80单位，且不能与保留来源列重复。'); columns.add(column); };
  const mappings = config.mappings.map(mapping => { addColumn(mapping.column); if (!['parent', 'element'].includes(mapping.scope) || (config.strategy === 'preserve' && mapping.scope === 'element')) throw new Error('范围须为父记录/当前元素；保留策略不可使用元素范围映射。'); return { column: mapping.column, scope: mapping.scope, path: mapping.path, tokens: parsePointer(mapping.path) }; });
  if (!mappings.some(mapping => mapping.scope === 'parent')) throw new Error('至少映射一个父字段，建议显式选择业务主键。');
  if (config.strategy === 'preserve') addColumn(config.arrayColumn);
  return { parentPath: config.parentPath, arrayPath: config.arrayPath, strategy: config.strategy, arrayColumn: config.strategy === 'preserve' ? config.arrayColumn : null, parentTokens, arrayTokens, mappings };
}
const covers = (selected, path) => selected.length <= path.length && selected.every((token, index) => token === path[index]);

export async function predictFlatten(parsed, inputConfig, hooks = {}) {
  const config = validateConfig(inputConfig), selected = resolvePointer(parsed.root, config.parentTokens);
  if (!selected.present || !Array.isArray(selected.value)) throw new Error('父路径必须指向一个存在的对象记录数组。');
  const parents = selected.value; if (parents.length > LIMITS.parents) throw new Error('父记录超过5000。');
  const plans = []; let rowCount = 0;
  for (let index = 0; index < parents.length; index++) {
    if (index % 128 === 0) await checkpoint(hooks);
    const parent = parents[index]; if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) throw new Error(`父记录${index + 1}必须是对象。`);
    const array = resolvePointer(parent, config.arrayTokens); if (array.present && array.value !== null && !Array.isArray(array.value)) throw new Error(`父记录${index + 1}的数组路径不是数组/null，禁止猜测。`);
    const length = Array.isArray(array.value) ? array.value.length : 0;
    for (const mapping of config.mappings.filter(mapping => mapping.scope === 'parent')) resolvePointer(parent, mapping.tokens);
    if (config.strategy === 'expand') for (let item = 0; item < length; item++) {
      if (item % 64 === 0) await checkpoint(hooks);
      for (const mapping of config.mappings.filter(mapping => mapping.scope === 'element')) resolvePointer(array.value[item], mapping.tokens);
    }
    const state = !array.present ? 'missing-array' : array.value === null ? 'null-array' : !length ? 'empty-array' : config.strategy === 'expand' ? 'expanded' : 'preserved-array';
    const count = config.strategy === 'expand' && length ? length : 1; rowCount += count;
    if (rowCount > LIMITS.rows || rowCount * (config.mappings.length + (config.strategy === 'preserve' ? 1 : 0)) > LIMITS.cells) throw new Error('预测超过10000输出行或100000数据单元格，整批拒绝。');
    plans.push({ parent, array, state, length, count, parentIndex: index + 1, parentLine: parsed.objects.get(parent), itemLines: Array.isArray(array.value) ? parsed.arrays.get(array.value) : [] });
  }
  let visited = 0, discardedCount = 0;
  const uncovered = async (root, selections) => {
    const paths = [];
    const visit = async (value, tokens) => {
      if (++visited % 256 === 0) await checkpoint(hooks);
      if (selections.some(selection => covers(selection, tokens))) return;
      const path = tokens.length ? '/' + tokens.map(encodeToken).join('/') : '';
      if (path.length > LIMITS.pointerChars) throw new Error('审计字段路径超过512单位，请缩短字段名或拆分深层数据。');
      const keys = value !== null && typeof value === 'object' ? Object.keys(value) : [];
      if (keys.length) for (const key of keys) await visit(value[key], [...tokens, key]);
      else { if (++discardedCount > LIMITS.discardedPaths) throw new Error('未映射叶路径超过10000，整批拒绝。'); paths.push(path); }
    };
    await visit(root, []); return paths;
  };
  const auditParents = [], parentSelections = config.mappings.filter(mapping => mapping.scope === 'parent').map(mapping => mapping.tokens), elementSelections = config.mappings.filter(mapping => mapping.scope === 'element').map(mapping => mapping.tokens);
  const outside = await uncovered(parsed.root, [config.parentTokens]);
  const elementAlreadyKept = parentSelections.some(selection => covers(selection, config.arrayTokens));
  const encoder = new TextEncoder(); let auditBytes = encoder.encode(JSON.stringify(outside)).length;
  if (auditBytes > LIMITS.auditBytes) throw new Error('完整丢弃审计超过2 MiB，整批拒绝。');
  for (const plan of plans) {
    await checkpoint(hooks);
    const discardedParentPaths = await uncovered(plan.parent, [...parentSelections, config.arrayTokens]); const elements = [];
    if (config.strategy === 'expand' && plan.length && !elementAlreadyKept) for (let index = 0; index < plan.length; index++) {
      if (index % 64 === 0) await checkpoint(hooks);
      const retainedByFixedParentPath = parentSelections.filter(selection => covers(config.arrayTokens, selection) && selection[config.arrayTokens.length] === String(index)).map(selection => selection.slice(config.arrayTokens.length + 1));
      elements.push({ arrayIndex: index + 1, line: plan.itemLines[index], discardedPaths: await uncovered(plan.array.value[index], [...elementSelections, ...retainedByFixedParentPath]) });
    }
    const record = { parentIndex: plan.parentIndex, parentLine: plan.parentLine, arrayState: plan.state, arrayPresent: plan.array.present, arrayLength: plan.length, predictedRows: plan.count, discardedParentPaths, elements, elementsKeptByParentJSON: elementAlreadyKept };
    auditBytes += encoder.encode(JSON.stringify(record)).length; if (auditBytes > LIMITS.auditBytes) throw new Error('完整丢弃审计超过2 MiB，整批拒绝。'); auditParents.push(record);
  }
  checkAbort(hooks.signal);
  const mappingConfig = config.mappings.map(({ column, scope, path }) => ({ column, scope, path }));
  const audit = { source: parsed.name, parentPath: config.parentPath, arrayPath: config.arrayPath, strategy: config.strategy, arrayColumn: config.arrayColumn, mappings: mappingConfig, policy: { ...POLICY }, predictedRows: rowCount, parentCount: parents.length, discardedLeafPaths: discardedCount, discardedOutsideParentPaths: outside, parents: auditParents };
  if (encoder.encode(JSON.stringify(audit)).length > LIMITS.auditBytes) throw new Error('完整丢弃审计超过2 MiB，整批拒绝。');
  return { config, plans, rowCount, parentCount: parents.length, source: { name: parsed.name }, audit };
}

function cell(resolved, alwaysJSON = false) {
  if (!resolved.present) return { present: false };
  const structured = alwaysJSON || (resolved.value !== null && typeof resolved.value === 'object');
  const value = structured ? JSON.stringify(resolved.value) : resolved.value;
  return { present: true, value, jsonLiteral: structured, byteSize: new TextEncoder().encode(JSON.stringify(value)).length };
}
export async function executeFlatten(prediction, hooks = {}) {
  if (!prediction || !prediction.config || prediction.rowCount > LIMITS.rows) throw new Error('请先完成有效的输出预测。');
  const { config } = prediction; const rows = [], encoder = new TextEncoder(); let bytes = encoder.encode(JSON.stringify(prediction.audit)).length;
  const columns = config.mappings.map(({ column, scope, path }) => ({ column, scope, path }));
  if (config.strategy === 'preserve') columns.push({ column: config.arrayColumn, scope: 'parent', path: config.arrayPath, retainedArray: true });
  for (const plan of prediction.plans) {
    const parentCells = new Map(), encodedPaths = new Map();
    for (const mapping of config.mappings.filter(mapping => mapping.scope === 'parent')) {
      if (!encodedPaths.has(mapping.path)) encodedPaths.set(mapping.path, cell(resolvePointer(plan.parent, mapping.tokens)));
      parentCells.set(mapping.column, encodedPaths.get(mapping.path));
    }
    if (config.strategy === 'preserve') parentCells.set(config.arrayColumn, cell(plan.array, true));
    for (let index = 0; index < plan.count; index++) {
      if (rows.length % 32 === 0) await checkpoint(hooks);
      const elementPresent = config.strategy === 'expand' && plan.length > 0;
      const element = elementPresent ? plan.array.value[index] : undefined;
      const entries = [], missingColumns = [], jsonLiteralColumns = []; let dataBytes = 0;
      for (const mapping of columns) {
        const value = parentCells.has(mapping.column) ? parentCells.get(mapping.column) : elementPresent ? cell(resolvePointer(element, config.mappings.find(item => item.column === mapping.column).tokens)) : { present: false };
        if (!value.present) missingColumns.push(mapping.column); else { dataBytes += value.byteSize; if (bytes + dataBytes > LIMITS.outputBytes) throw new Error('重复映射内容使输出超过12 MiB，整批中止。'); entries.push([mapping.column, value.value]); if (value.jsonLiteral) jsonLiteralColumns.push(mapping.column); }
      }
      const row = { source: { name: prediction.source.name, parentIndex: plan.parentIndex, parentLine: plan.parentLine, arrayIndex: elementPresent ? index + 1 : null, elementLine: elementPresent ? plan.itemLines[index] : null, arrayState: plan.state, elementPresent }, values: Object.fromEntries(entries), missingColumns, jsonLiteralColumns };
      bytes += encoder.encode(JSON.stringify(row)).length; if (bytes > LIMITS.outputBytes) throw new Error('完整输出与审计超过12 MiB，整批中止。'); rows.push(row);
    }
  }
  checkAbort(hooks.signal); if (rows.length !== prediction.rowCount) throw new Error('输出行数与预测不一致，结果不可导出。');
  return { feature: 'T010', version: 1, columns, rowCount: rows.length, audit: prediction.audit, rows };
}

export async function serializeFlatten(report, format, hooks = {}) {
  if (!['json', 'csv', 'audit'].includes(format)) throw new Error('只支持JSON、CSV和JSON审计。');
  const chunks = [], encoder = new TextEncoder(); let bytes = 0;
  const append = text => { bytes += encoder.encode(text).length; if (bytes > LIMITS.outputBytes) throw new Error('导出超过12 MiB，请缩小数据或映射。'); chunks.push(text); };
  await checkpoint(hooks);
  if (format === 'audit') append(JSON.stringify({ feature: report.feature, version: report.version, ...report.audit }));
  else if (format === 'json') {
    append(JSON.stringify({ ...report, rows: undefined }).slice(0, -1)); append(',"rows":[');
    for (let index = 0; index < report.rows.length; index++) { if (index % 32 === 0) await checkpoint(hooks); append((index ? ',' : '') + JSON.stringify(report.rows[index])); } append(']}\n');
  } else {
    const quote = text => '"' + text.replaceAll('"', '""') + '"';
    append('\uFEFF' + [...RESERVED, ...report.columns.map(column => column.column)].map(quote).join(',') + '\r\n');
    for (let index = 0; index < report.rows.length; index++) {
      if (index % 32 === 0) await checkpoint(hooks); const row = report.rows[index], source = row.source;
      const values = [source.name, source.parentIndex, source.parentLine, source.arrayIndex, source.elementLine, source.arrayState, source.elementPresent, row.missingColumns, row.jsonLiteralColumns, ...report.columns.map(column => own(row.values, column.column) ? row.values[column.column] : { present: false })];
      append(values.map(value => quote(JSON.stringify(value))).join(',') + '\r\n');
    }
  }
  checkAbort(hooks.signal); return chunks.join('');
}
