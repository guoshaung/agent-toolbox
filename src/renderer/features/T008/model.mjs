import { LIMITS as PARSE_LIMITS, parseDataset, checkAbort } from './parser.mjs';
export { parseDataset, checkAbort };
export const LIMITS = Object.freeze({ ...PARSE_LIMITS, descriptionChars: 2000, examples: 3, topValues: 10 });
export const EXAMPLE = '[\n' + Array.from({ length: 10 }, (_, index) => '  ' + JSON.stringify({ id: index + 1, score: index < 8 ? (index + 1) * 10 : null, label: index < 8 ? '正常' : '待补充' })).join(',\n') + '\n]';
export const BASIS = Object.freeze({ scope: '顶层字段；每条对象记录或CSV数据行为一个样本，不展开嵌套对象/数组', denominator: '解析得到的全部数据记录；包含实际空物理行，不包含CSV标题及末尾换行', empty: '缺失字段 + null + 空字符串；纯空白字符串、0、false、空对象和空数组不计为空', csvTypes: '所有CSV单元格为字符串，不推断数字/日期/布尔值', mixed: '排除missing/null后有两种及以上实际类型即为混合；空字符串仍参与string类型', strings: '字符串长度按UTF-16单位；最小/最大按UTF-16编码单元字典序，含空字符串，不使用地区排序', examples: '按源记录顺序取最多3个不同的非空值，保留类型及原始来源；不代表全量枚举', frequencies: '字符串展示频次前10个值（含空字符串）；相同频次按UTF-16字典序；同时报告准确去重数', numbers: '有限安全Number，拒绝十进制输入与最短Number表示含义不一致的精度丢失；不做数学运算或任意精度分析' });
const order = ['missing', 'null', 'string', 'number', 'boolean', 'object', 'array'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const pointer = name => '/' + name.replaceAll('~', '~0').replaceAll('/', '~1');
async function checkpoint(hooks) { checkAbort(hooks.signal); await (hooks.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0))))(); checkAbort(hooks.signal); }
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function formatRate(rate) { return rate === null ? '不适用（0条样本）' : `${Number((rate * 100).toFixed(4))}%`; }

export async function buildDictionary(dataset, descriptions = new Map(), hooks = {}) {
  if (!(descriptions instanceof Map)) throw new Error('字段说明须为Map。');
  const states = dataset.fields.map(name => {
    const description = descriptions.get(name) ?? '';
    if (typeof description !== 'string' || description.length > LIMITS.descriptionChars) throw new Error('每字段说明最多2000个UTF-16单位。');
    return { name, path: pointer(name), description, typeCounts: Object.fromEntries(order.map(type => [type, 0])), examples: [], examplesSeen: new Set(), numbers: new Set(), strings: new Map(), numberMin: null, numberMax: null, stringMin: null, stringMax: null, stringMinLength: null, stringMaxLength: null, trueCount: 0, falseCount: 0 };
  });
  let cells = 0;
  for (const record of dataset.records) {
    for (const state of states) {
      if (cells++ % 1024 === 0) await checkpoint(hooks);
      const exists = own(record.value, state.name), value = record.value[state.name];
      const type = !exists ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      if (!order.includes(type)) throw new Error('出现非JSON数据类型，无法生成可信字典。');
      state.typeCounts[type]++;
      if (type === 'number') { state.numbers.add(value); state.numberMin = state.numberMin === null ? value : Math.min(state.numberMin, value); state.numberMax = state.numberMax === null ? value : Math.max(state.numberMax, value); }
      if (type === 'string') {
        state.strings.set(value, (state.strings.get(value) || 0) + 1);
        state.stringMin = state.stringMin === null || value < state.stringMin ? value : state.stringMin;
        state.stringMax = state.stringMax === null || value > state.stringMax ? value : state.stringMax;
        state.stringMinLength = state.stringMinLength === null ? value.length : Math.min(state.stringMinLength, value.length);
        state.stringMaxLength = state.stringMaxLength === null ? value.length : Math.max(state.stringMaxLength, value.length);
      }
      if (type === 'boolean') { if (value) state.trueCount++; else state.falseCount++; }
      if (!['missing', 'null'].includes(type) && value !== '' && state.examples.length < LIMITS.examples) {
        const token = type + ':' + JSON.stringify(value);
        if (!state.examplesSeen.has(token)) { state.examplesSeen.add(token); state.examples.push({ type, value, source: record.source }); }
      }
    }
  }
  const fields = [];
  for (const state of states) {
    await checkpoint(hooks);
    const count = dataset.records.length, missing = state.typeCounts.missing, nulls = state.typeCounts.null, emptyString = state.strings.get('') || 0;
    const nonNullTypes = order.filter(type => !['missing', 'null'].includes(type) && state.typeCounts[type] > 0);
    const values = [...state.strings.entries()].sort((a, b) => b[1] - a[1] || lexical(a[0], b[0]));
    fields.push({ name: state.name, path: state.path, description: state.description, sampleCount: count, typeCounts: state.typeCounts,
      empty: { missing, null: nulls, emptyString, count: missing + nulls + emptyString, rate: count ? (missing + nulls + emptyString) / count : null },
      mixedTypes: nonNullTypes.length > 1, nonNullTypes,
      numericDomain: { count: state.typeCounts.number, min: state.numberMin, max: state.numberMax, distinctCount: state.numbers.size },
      stringDomain: { count: state.typeCounts.string, minLengthUTF16: state.stringMinLength, maxLengthUTF16: state.stringMaxLength, lexicalMin: state.stringMin, lexicalMax: state.stringMax, distinctCount: state.strings.size, topValues: values.slice(0, LIMITS.topValues).map(([value, count]) => ({ value, count })), topValuesTruncated: values.length > LIMITS.topValues },
      booleanDomain: { true: state.trueCount, false: state.falseCount }, examples: state.examples });
  }
  checkAbort(hooks.signal);
  return { feature: 'T008', version: 1, source: { name: dataset.name, format: dataset.format }, sampleCount: dataset.records.length, fieldCount: fields.length, basis: { ...BASIS }, fields };
}

export function setDescription(report, index, description) {
  if (!Number.isInteger(index) || index < 0 || index >= report.fields.length) throw new Error('字段索引无效。');
  if (typeof description !== 'string' || description.length > LIMITS.descriptionChars) throw new Error('每字段说明最多2000个UTF-16单位。');
  report.fields[index].description = description;
}

const md = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/gu, ch => '\\' + ch).replace(/\r\n|\r|\n/gu, '<br>');
export async function serializeDictionary(report, format, hooks = {}) {
  if (!['json', 'md'].includes(format)) throw new Error('只支持JSON与Markdown。');
  const chunks = []; let bytes = 0; const encoder = new TextEncoder();
  const append = text => { bytes += encoder.encode(text).length; if (bytes > LIMITS.outputBytes) throw new Error('字典导出超过12 MiB，请缩小输入或说明。'); chunks.push(text); };
  await checkpoint(hooks);
  if (format === 'json') {
    append(JSON.stringify({ ...report, fields: undefined }).slice(0, -1)); append(',"fields":[');
    for (let index = 0; index < report.fields.length; index++) { await checkpoint(hooks); append((index ? ',' : '') + JSON.stringify(report.fields[index])); }
    append(']}\n');
  } else {
    append(`# 数据字段字典\n\n来源：${md(report.source.name)}（${report.source.format}）\n\n样本数：${report.sampleCount}；字段数：${report.fieldCount}。\n\n## 统计口径\n\n`);
    for (const [key, value] of Object.entries(report.basis)) append(`- ${key}：${md(value)}\n`);
    for (const field of report.fields) {
      await checkpoint(hooks);
      append(`\n## ${md(field.name)}\n\n路径：${md(field.path)}\n\n人工说明：${md(field.description || '未填写')}\n\n样本数：${field.sampleCount}；空值率：${formatRate(field.empty.rate)}；缺失=${field.empty.missing}、null=${field.empty.null}、空字符串=${field.empty.emptyString}。\n\n类型分布：${order.map(type => `${type}=${field.typeCounts[type]}`).join('；')}。\n\n混合类型：${field.mixedTypes ? '是（' + field.nonNullTypes.join(' / ') + '）' : '否'}。\n\n`);
      append(`数值域：${md(JSON.stringify(field.numericDomain))}\n\n字符串值域：${md(JSON.stringify(field.stringDomain))}\n\n布尔值域：${md(JSON.stringify(field.booleanDomain))}\n\n示例（最多3个非空值，原始来源）：\n\n`);
      if (!field.examples.length) append('无非空示例。\n');
      for (const example of field.examples) append(`- ${example.type} ${md(JSON.stringify(example.value))}（${md(example.source.name)}，记录${example.source.row}，物理行${example.source.line}）\n`);
    }
  }
  checkAbort(hooks.signal); return chunks.join('');
}
