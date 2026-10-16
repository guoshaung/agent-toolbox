export const STATE_MAX_BYTES = 65536;
const MAX_PREDICTIONS = 200;
const MAX_OBSERVATIONS = 500;

function text(value, name, max = 2000, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim())) throw new Error(`${name}不能为空。`);
  if (value.length > max) throw new Error(`${name}超过 ${max} 字符。`);
  return value;
}
function timestamp(value, name) {
  const parts = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/) : null;
  if (!parts || !Number.isFinite(Date.parse(value))) throw new Error(`${name}需要包含时区的有效时间。`);
  const year = Number(parts[1]); const month = Number(parts[2]); const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] || 0) > 59) throw new Error(`${name}不是有效的日历时间。`);
  return new Date(value).toISOString();
}
export function parseNumeric(value) {
  text(value, '数值', 100);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) throw new Error('数值需为有限十进制数；不支持逗号、NaN 或 Infinity。');
  return Number(value);
}
function enumOptions(values) {
  if (!Array.isArray(values)) throw new Error('枚举选项需要列表。');
  const unique = [...new Set(values.map((value) => text(value, '枚举标签', 100).trim()))];
  if (unique.length < 2 || unique.length > 30) throw new Error('枚举需要 2 至 30 个不同选项。');
  return unique;
}
export function createLedger() { return { predictions: [], observations: [] }; }

export function commitPrediction(ledger, input, revisesId = null, at = new Date().toISOString()) {
  if (ledger.predictions.length >= MAX_PREDICTIONS) throw new Error('最多登记 200 个预测版本，请导出后开始新账本。');
  const previous = revisesId ? ledger.predictions.find((entry) => entry.id === revisesId) : null;
  if (revisesId && !previous) throw new Error('要修订的预测不存在。');
  if (previous && ledger.predictions.some((entry) => entry.revisesId === previous.id)) throw new Error('请从该主题的最新版本追加修订，不能建立分叉版本。');
  const type = previous?.type || input.type;
  if (!['number', 'enum'].includes(type)) throw new Error('预测类型只支持数值或枚举。');
  const options = type === 'enum' ? (previous ? [...previous.options] : enumOptions(input.options)) : [];
  const rawValue = text(input.rawValue, '预测值', 100);
  const value = type === 'number' ? parseNumeric(rawValue) : rawValue.trim();
  if (type === 'enum' && !options.includes(value)) throw new Error('预测值必须属于已定义的枚举选项。');
  const id = `p${ledger.predictions.length + 1}`;
  const committedAt = timestamp(at, '提交时间');
  if (previous && Date.parse(committedAt) < Date.parse(previous.committedAt)) throw new Error('本次提交时间早于旧版本，请检查本机时钟后再追加版本。');
  const prediction = {
    id, seriesId: previous?.seriesId || id, revisesId: previous?.id || null, version: previous ? previous.version + 1 : 1,
    title: previous?.title || text(input.title, '主题', 200).trim(), type, rawValue, value,
    unit: type === 'enum' ? '' : previous ? previous.unit : text(input.unit || '', '单位', 100, true).trim(), options,
    rationale: text(input.rationale || '', '预测依据', 2000, true), committedAt,
  };
  return { ...ledger, predictions: [...ledger.predictions, prediction] };
}

export function appendObservation(ledger, input, at = new Date().toISOString()) {
  if (ledger.observations.length >= MAX_OBSERVATIONS) throw new Error('最多追加 500 条观察，请导出后开始新账本。');
  const prediction = ledger.predictions.find((entry) => entry.id === input.predictionId);
  if (!prediction) throw new Error('请选择要对账的预测版本。');
  const recordedAt = timestamp(at, '记录时间');
  const observedAt = timestamp(input.observedAt, '实际观察时间');
  if (Date.parse(observedAt) > Date.parse(recordedAt)) throw new Error('实际观察时间不能晚于本次记录时间。');
  const missing = input.missing === true;
  const note = text(input.note || '', missing ? '缺测原因' : '观察说明', 2000, !missing);
  const rawValue = missing ? null : text(input.rawValue, '观察值', 100);
  const value = missing ? null : prediction.type === 'number' ? parseNumeric(rawValue) : rawValue.trim();
  if (!missing && prediction.type === 'enum' && !prediction.options.includes(value)) throw new Error('观察值必须属于该版本的枚举选项；可用事先定义的“其他”标签。');
  const observation = {
    id: `o${ledger.observations.length + 1}`, predictionId: prediction.id, rawValue, value,
    unit: text(input.unit || '', '观察单位', 100, true).trim(), missing, note, observedAt, recordedAt,
  };
  return { ...ledger, observations: [...ledger.observations, observation] };
}

export function compareObservation(prediction, observation) {
  const timing = Date.parse(observation.observedAt) < Date.parse(prediction.committedAt) ? '观察早于预测提交，不能作为事前预测证据' : '观察时间不早于预测提交';
  const base = { timing, comparable: false, difference: null, absoluteError: null, relativePercent: null, relativeUnavailable: null, matched: null };
  if (observation.missing) return { ...base, status: '缺测，不计算偏差' };
  if (prediction.type === 'enum') return { ...base, comparable: true, matched: prediction.value === observation.value, status: prediction.value === observation.value ? '枚举一致' : '枚举不一致' };
  if (prediction.unit !== observation.unit) return { ...base, status: '单位不一致，不自动换算' };
  const difference = observation.value - prediction.value;
  if (!Number.isFinite(difference)) return { ...base, status: '差值超出数值范围' };
  const relative = prediction.value === 0 ? null : difference / Math.abs(prediction.value) * 100;
  return { ...base, comparable: true, status: '数值可比较', difference, absoluteError: Math.abs(difference), relativePercent: Number.isFinite(relative) ? relative : null, relativeUnavailable: prediction.value === 0 ? '预测为零' : !Number.isFinite(relative) ? '百分比超出数值范围' : null };
}

export function restoreLedger(raw) {
  if (!raw || !Array.isArray(raw.predictions) || !Array.isArray(raw.observations)) throw new Error('账本格式不正确。');
  let ledger = createLedger();
  for (const row of raw.predictions) {
    ledger = commitPrediction(ledger, row, row.revisesId, row.committedAt);
    const restored = ledger.predictions.at(-1);
    if (row.id !== restored.id || row.version !== restored.version || row.seriesId !== restored.seriesId || row.title !== restored.title || row.value !== restored.value || row.type !== restored.type || row.unit !== restored.unit || JSON.stringify(row.options) !== JSON.stringify(restored.options)) throw new Error('保存的预测版本关系不一致。');
  }
  for (const row of raw.observations) {
    ledger = appendObservation(ledger, row, row.recordedAt);
    const restored = ledger.observations.at(-1);
    if (restored.id !== row.id || restored.value !== row.value || restored.missing !== row.missing) throw new Error('保存的观察编号或数值不一致。');
  }
  return ledger;
}

export function prepareStoredState(state) {
  const payload = { ...state, schemaVersion: 1 };
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > STATE_MAX_BYTES) throw new Error('状态超过 64KiB 本机保存上限。');
  return JSON.parse(serialized);
}
export function validateStoredState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('保存状态版本不支持，需要 schemaVersion:1。');
  prepareStoredState(state);
  return state;
}

export function buildReport(ledger) {
  const predictions = ledger.predictions.map((entry) => ({ ...entry, options: [...entry.options], alreadyHadObservationAtCommit: ledger.observations.some((item) => ledger.predictions.find((value) => value.id === item.predictionId)?.seriesId === entry.seriesId && Date.parse(item.recordedAt) < Date.parse(entry.committedAt)) }));
  return {
    feature: 'L004', version: 1,
    calculations: '差值=观察−预测；绝对误差=|差值|；相对偏差%=差值/|预测|×100，预测为零时不计算。仅同单位有限数值可比较。枚举只比较标签。',
    timestampNotice: '使用本机时钟，观察时间由用户填写；不提供可信时间戳或防篡改证明。观察早于预测提交的记录仅作为回补对账。',
    predictions,
    observations: ledger.observations.map((entry) => ({ ...entry, comparison: compareObservation(ledger.predictions.find((prediction) => prediction.id === entry.predictionId), entry) })),
    pendingPredictionIds: ledger.predictions.filter((entry) => !ledger.observations.some((item) => item.predictionId === entry.id)).map((entry) => entry.id),
  };
}
export function reportMarkdown(ledger) {
  const report = buildReport(ledger);
  const lines = ['# 预测观察对账', '', report.calculations, '', report.timestampNotice];
  for (const prediction of report.predictions) {
    lines.push('', `## ${prediction.title} · v${prediction.version} (${prediction.id})`, '', `提交时间：${prediction.committedAt}`, `预测：${prediction.rawValue}${prediction.unit ? ` ${prediction.unit}` : ''}`, `修订自：${prediction.revisesId || '首次提交'}`, `预测依据：${prediction.rationale || '未填写'}`, `提交时已有同主题观察：${prediction.alreadyHadObservationAtCommit ? '是' : '否'}`);
    const observations = report.observations.filter((entry) => entry.predictionId === prediction.id);
    if (!observations.length) lines.push('', '尚无观察，不计算偏差。');
    for (const entry of observations) {
      lines.push('', `### 观察 ${entry.id}`, `实际观察时间：${entry.observedAt}`, `登记时间：${entry.recordedAt}`, `观察：${entry.missing ? '缺测' : `${entry.rawValue}${entry.unit ? ` ${entry.unit}` : ''}`}`, `说明：${entry.note || '无'}`, `结果：${entry.comparison.status}`, `时序：${entry.comparison.timing}`, `差值：${entry.comparison.difference ?? '不适用'}`, `绝对误差：${entry.comparison.absoluteError ?? '不适用'}`, `相对偏差：${entry.comparison.relativePercent === null ? entry.comparison.relativeUnavailable || '不适用' : `${entry.comparison.relativePercent}%`}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
