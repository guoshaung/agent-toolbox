const LIMITS = { steps: 20, premises: 40, text: 10000, premise: 300 };

function text(value, label, { optional = false, max = LIMITS.text } = {}) {
  if (typeof value !== 'string') throw new Error(`${label}需要文本。`);
  if (!optional && !value.trim()) throw new Error(`${label}不能为空。`);
  if (value.length > max) throw new Error(`${label}超过 ${max} 字符。`);
  return value;
}

function premises(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label}需要前提列表。`);
  const unique = [...new Set(values.map((value) => text(value, label, { max: LIMITS.premise }).trim()))];
  if (unique.length > LIMITS.premises) throw new Error(`${label}最多 ${LIMITS.premises} 条。`);
  return unique;
}

export function normalizeExercise(input) {
  if (!input || typeof input !== 'object') throw new Error('请先填写例题。');
  const pool = premises(input.premises || [], '可选前提');
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > LIMITS.steps) throw new Error(`例题需要 1 至 ${LIMITS.steps} 步。`);
  const steps = input.steps.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error(`第 ${index + 1} 步格式不正确。`);
    const expected = premises(step.premises || [], `第 ${index + 1} 步参考前提`);
    if (expected.some((value) => !pool.includes(value))) throw new Error(`第 ${index + 1} 步的参考前提不在可选前提中。`);
    return {
      id: `step-${index + 1}`,
      title: text(step.title, `第 ${index + 1} 步标题`, { max: 200 }).trim(),
      prompt: text(step.prompt, `第 ${index + 1} 步提示`),
      answer: text(step.answer, `第 ${index + 1} 步参考结果`),
      reason: text(step.reason, `第 ${index + 1} 步参考理由`),
      premises: expected,
    };
  });
  return { title: text(input.title, '例题标题', { max: 200 }).trim(), problem: text(input.problem, '题目'), premises: pool, steps };
}

export function createSession(exercise, at = new Date().toISOString()) {
  return { exercise: normalizeExercise(exercise), startedAt: at, records: [] };
}

export function submitReason(session, index, originalReason, selectedPremises = [], at = new Date().toISOString()) {
  if (!Number.isInteger(index) || index < 0 || index >= session.exercise.steps.length) throw new Error('步骤不存在。');
  if (index !== session.records.length) throw new Error('请按顺序提交，已提交的原始依据不能改写。');
  text(originalReason, '自己的依据');
  const selected = premises(selectedPremises, '采用的前提');
  if (selected.some((value) => !session.exercise.premises.includes(value))) throw new Error('采用了前提列表中不存在的项。');
  const step = session.exercise.steps[index];
  const record = {
    stepId: step.id, stepNumber: index + 1, title: step.title, prompt: step.prompt,
    originalReason, selectedPremises: selected, submittedAt: at,
    referenceAnswer: step.answer, referenceReason: step.reason, referencePremises: [...step.premises],
    unselectedReferencePremises: step.premises.filter((value) => !selected.includes(value)),
    otherSelectedPremises: selected.filter((value) => !step.premises.includes(value)),
    reflection: '', reflectionUpdatedAt: null,
  };
  return { ...session, records: [...session.records, record] };
}

export function updateReflection(session, index, value, at = new Date().toISOString()) {
  if (!Number.isInteger(index) || index < 0 || index >= session.records.length) throw new Error('请先提交该步的依据。');
  text(value, '反思', { optional: true });
  return { ...session, records: session.records.map((record, i) => i === index ? { ...record, reflection: value, reflectionUpdatedAt: at } : record) };
}

export function restoreSession(saved) {
  if (!saved || !Array.isArray(saved.records) || saved.records.length > LIMITS.steps) throw new Error('保存的练习记录格式不正确。');
  let session = createSession(saved.exercise, saved.startedAt);
  for (let index = 0; index < saved.records.length; index += 1) {
    const record = saved.records[index];
    session = submitReason(session, index, record.originalReason, record.selectedPremises, record.submittedAt);
    if (typeof record.reflection === 'string' && (record.reflection || record.reflectionUpdatedAt)) session = updateReflection(session, index, record.reflection, record.reflectionUpdatedAt);
  }
  return session;
}

export function buildReport(session) {
  if (session.records.length !== session.exercise.steps.length) throw new Error('完成所有步骤后才能导出完整记录。');
  return {
    feature: 'L002', version: 1, title: session.exercise.title, problem: session.exercise.problem,
    startedAt: session.startedAt, completedSteps: session.records.length,
    notice: '前提差异仅供自查，不是推理正确性的自动评分。原始依据保留提交时文本，反思另存。',
    records: session.records.map((record) => ({ ...record, selectedPremises: [...record.selectedPremises], referencePremises: [...record.referencePremises], unselectedReferencePremises: [...record.unselectedReferencePremises], otherSelectedPremises: [...record.otherSelectedPremises] })),
  };
}

export function reportMarkdown(session) {
  const report = buildReport(session);
  const lines = [`# ${report.title}`, '', report.problem, '', `开始时间：${report.startedAt}`, '', report.notice];
  for (const record of report.records) {
    lines.push('', `## ${record.stepNumber}. ${record.title}`, '', '### 提示', '', record.prompt,
      '', '### 提交时的原始依据', '', record.originalReason, '', `提交时间：${record.submittedAt}`,
      '', '### 当时采用的前提', '', ...(record.selectedPremises.length ? record.selectedPremises.map((value) => `- ${value}`) : ['未选择前提。']),
      '', '### 参考结果与理由', '', record.referenceAnswer, '', record.referenceReason,
      '', '### 参考中采用但当时未选择的前提', '', ...(record.unselectedReferencePremises.length ? record.unselectedReferencePremises.map((value) => `- ${value}`) : ['无。']),
      '', '### 另选的前提（不代表错误）', '', ...(record.otherSelectedPremises.length ? record.otherSelectedPremises.map((value) => `- ${value}`) : ['无。']),
      '', '### 后续反思', '', record.reflection || '尚未填写。');
  }
  return `${lines.join('\n')}\n`;
}

export function sampleExercise() {
  const pool = ['等式两边减去相同的数仍相等', '系数 2 不为零', '等式两边同除非零数仍相等', '原等式是 2x + 3 = 11'];
  return {
    title: '从解方程到说明每步依据', problem: '求解 2x + 3 = 11，并验证得到的 x。每一步先说明依据，再看参考结果。', premises: pool,
    steps: [
      { title: '消去常数项', prompt: '想把左边的 +3 消去，你会对等式做什么？为什么这样做仍保持等式成立？', answer: '两边都减去 3，得到 2x = 8。', reason: '对等式两边减去同一个数，等式仍然成立；不能只改变左边。', premises: [pool[0]] },
      { title: '消去系数', prompt: '由上一步的等式求 x。需要满足什么条件，才能做这一步操作？', answer: '两边同除以 2，得到 x = 4。', reason: '除数 2 不为零，所以两边可以同除以 2，保持等式成立。', premises: [pool[1], pool[2]] },
      { title: '代回检验', prompt: '如何确认候选解确实满足最初的题目，而不只满足中间步骤？', answer: '代入 x = 4：2 × 4 + 3 = 11，左右相等。', reason: '把候选值代入原等式，核对原条件；中间步骤不能代替原式的检验。', premises: [pool[3]] },
    ],
  };
}
