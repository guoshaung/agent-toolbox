'use strict';

const QUICK_FIELDS = [
  { label: '这一行在做什么', aliases: ['这一行在做什么', '作用'] },
  { label: '关键写法', aliases: ['关键写法', '知识缺口'] },
  { label: '为什么要这样写', aliases: ['为什么要这样写', '为什么这样写'] },
  { label: '你现在只要记住', aliases: ['你现在只要记住', '下一步'] },
];

function buildQuickExplainMessages({ code, language = '', stuck = '', trace = false }) {
  const system = [
    '你是代码阅读训练中的“快速解释器”，唯一目标是降低当前这小段代码的认知负荷。',
    '不要泛化聊天，不要猜项目、调用方、业务背景或未提供的定义，不要试图解释所有知识。',
    '只解释当前层。除非请求明确标记为“向上一层追溯”，否则绝不扩展定义链路。',
    '一次、非流式返回可解析 JSON，不得输出 Markdown 围栏或 JSON 之外的文字。',
    'JSON 必须有 quick 和 supplement 两部分。quick 只含四个短字符串字段：这一行在做什么、关键写法、为什么要这样写、你现在只要记住。',
    'quick 显示后必须严格形成四行，像代码老师自然讲解：',
    '“这一行在做什么”用一句话直接翻译代码行为；“关键写法”指出本段最值得注意的具体语法或调用（如 default_factory、lambda、切片），不要写抽象能力缺口；',
    '“为什么要这样写”解释该写法解决的直接问题；“你现在只要记住”只给一个短记忆锚点或单一动作。',
    'supplement 必须有四个字符串字段：语法拆解、真正的知识点、最小例子、当前调用关系。',
    '语法拆解只解释代码中实际出现的语法/写法。真正的知识点用白话解释最关键概念，并说明为何它比表层 API 或容器更值得学。',
    '最小例子独立可读且不超过 8 行。当前调用关系只说当前符号来自哪里、返回什么、下一跳是什么；无法确定时写“需点击向上一层追溯”。',
    '输出形状：{"quick":{"这一行在做什么":"…","关键写法":"…","为什么要这样写":"…","你现在只要记住":"…"},"supplement":{"语法拆解":"…","真正的知识点":"…","最小例子":"…","当前调用关系":"…"}}',
    '若信息不足，明确说“仅从当前代码无法判断”，不可补全或猜测。',
  ].join('\n');
  const mode = trace
    ? '用户已明确点击“向上一层追溯”。仅根据本次提供的代码/剪贴板内容解释紧邻的上一层；若没有上层定义或调用处，“你现在只要记住”只让用户复制一个所需定义。'
    : '这是首次快速解释：停留在当前层，不追踪调用链。';
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${mode}\n语言：${language || '未指定'}\n我卡在哪里：${stuck || '未填写'}\n<code>\n${String(code || '').slice(0, 16000)}\n</code>`,
    },
  ];
}

const SUPPLEMENT_DEFAULTS = {
  syntax: '本段没有识别出需要额外拆解的特殊语法。',
  knowledge: '仅从当前代码无法确定更深的核心概念。',
  example: '当前信息不足，暂不提供可能误导的例子。',
  relation: '需点击向上一层追溯。',
};

function pickText(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseJSONObject(text) {
  const raw = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function normalizeFourLines(text) {
  const raw = String(text || '').replace(/```[\w-]*|```/g, '').trim();
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const values = QUICK_FIELDS.map((field) => {
    for (const alias of field.aliases) {
      const pattern = new RegExp(`^(?:[-*\\d.、\\s]*)?${alias}\\s*[：:]`);
      const found = lines.find((line) => pattern.test(line));
      if (found) return found.replace(new RegExp(`^(?:[-*\\d.、\\s]*)?${alias}\\s*[：:]\\s*`), '').trim();
    }
    return '';
  });
  values[1] = values[1].replace(/[（(](高|中|低)[）)]\s*$/, '').trim();
  const defaults = ['仅从当前代码无法判断', '当前代码中最显眼的具体写法', '仅从当前代码无法判断', '先确认这一行的输入和输出'];
  return QUICK_FIELDS.map((field, index) => `${field.label}：${values[index] || defaults[index]}`).join('\n');
}

function parseQuickExplainResponse(text) {
  const payload = parseJSONObject(text);
  if (!payload || typeof payload !== 'object') {
    return { quick: normalizeFourLines(text), supplement: { ...SUPPLEMENT_DEFAULTS } };
  }

  const quickSource = payload.quick || payload['快速结论'] || payload;
  const legacyGap = quickSource?.['知识缺口'];
  const keyWriting = typeof legacyGap === 'object'
    ? pickText(legacyGap, '概念', 'concept')
    : pickText(quickSource, '关键写法', '知识缺口', 'knowledgeGap');
  const quick = normalizeFourLines([
    `这一行在做什么：${pickText(quickSource, '这一行在做什么', '作用', 'purpose')}`,
    `关键写法：${keyWriting}`,
    `为什么要这样写：${pickText(quickSource, '为什么要这样写', '为什么这样写', 'why')}`,
    `你现在只要记住：${pickText(quickSource, '你现在只要记住', '下一步', 'next')}`,
  ].join('\n'));

  const detail = payload.supplement || payload['补充内容'] || {};
  const example = pickText(detail, '最小例子', 'example')
    .replace(/^```[\w-]*\s*/i, '').replace(/\s*```$/i, '').split(/\r?\n/).slice(0, 8).join('\n');
  return {
    quick,
    supplement: {
      syntax: pickText(detail, '语法拆解', 'syntax') || SUPPLEMENT_DEFAULTS.syntax,
      knowledge: pickText(detail, '真正的知识点', 'knowledge') || SUPPLEMENT_DEFAULTS.knowledge,
      example: example || SUPPLEMENT_DEFAULTS.example,
      relation: pickText(detail, '当前调用关系', 'relation') || SUPPLEMENT_DEFAULTS.relation,
    },
  };
}

module.exports = { buildQuickExplainMessages, normalizeFourLines, parseQuickExplainResponse, SUPPLEMENT_DEFAULTS };
