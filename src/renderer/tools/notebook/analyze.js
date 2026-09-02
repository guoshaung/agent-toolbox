import { tokenize, LANGUAGES } from './tokenize.js';

/**
 * 在 token 流上做启发式静态分析，标出每个标识符的角色。
 *
 * 说清楚它的边界：这是**片段内**的词法级分析，不是语言服务。
 * 它不解析导入、不做类型推导、分不清同名的不同对象的方法。
 * 但对于「我粘了一段代码，想知道这个名字在哪定义、在哪被调用」，它足够准，
 * 而且不需要装任何语言环境。跨文件的调用处交给知识图谱那一层。
 */

export const KIND_LABEL = {
  def: '定义',
  param: '参数',
  call: '调用',
  member: '成员访问',
  bind: '绑定 / 导入',
  ref: '引用',
};

const isPunct = (token, value) => token && token.type === 'punct' && token.value === value;

export function analyze(code, langId = 'python') {
  const lang = LANGUAGES[langId] || LANGUAGES.plain;
  const defKeywords = new Set(lang.defKeywords || []);
  const importKeywords = new Set(lang.importKeywords || []);
  const bindKeywords = new Set(lang.bindKeywords || []);

  const tokens = tokenize(code, langId);

  // 只在"有意义"的 token 之间判断前后关系，空白和注释不参与
  const meaningful = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'space' || tokens[i].type === 'comment') continue;
    meaningful.push(i);
  }
  const positionInMeaningful = new Map();
  meaningful.forEach((tokenIndex, order) => positionInMeaningful.set(tokenIndex, order));

  const at = (order) => (order >= 0 && order < meaningful.length ? tokens[meaningful[order]] : null);

  // 形参区间：遇到 def 关键字 + 名字 + '(' 就进入，括号配平后退出
  let paramDepth = 0;
  let inParams = false;

  for (let order = 0; order < meaningful.length; order++) {
    const token = tokens[meaningful[order]];

    if (inParams) {
      if (isPunct(token, '(')) paramDepth += 1;
      else if (isPunct(token, ')')) {
        paramDepth -= 1;
        if (paramDepth <= 0) { inParams = false; paramDepth = 0; }
      }
    }

    if (token.type !== 'ident') continue;

    const prev = at(order - 1);
    const next = at(order + 1);

    let kind = 'ref';

    if (prev && prev.type === 'keyword' && defKeywords.has(prev.value)) {
      kind = 'def';
      // 函数/方法定义后面紧跟的括号里是形参。
      // depth 置 0 而不是 1：那个 '(' 下一轮循环还会被计一次，
      // 直接给 1 会算成 2，形参就全被判成普通引用了。
      if (isPunct(next, '(')) { inParams = true; paramDepth = 0; }
    } else if (prev && prev.type === 'keyword'
        && (importKeywords.has(prev.value) || bindKeywords.has(prev.value))) {
      kind = 'bind';
    } else if (inParams && paramDepth === 1 && (isPunct(prev, '(') || isPunct(prev, ','))) {
      kind = 'param';
    } else if (isPunct(prev, '.')) {
      // obj.foo —— 可能和顶层的 foo 是两码事，单独标出来提醒
      kind = isPunct(next, '(') ? 'member' : 'member';
    } else if (isPunct(next, '(')) {
      kind = 'call';
    } else if (next && next.type === 'punct' && next.value === '='
        && (!prev || prev.line < token.line || isPunct(prev, ';') || isPunct(prev, '{') || isPunct(prev, '}'))) {
      // 语句开头的赋值 = 定义了一个名字
      kind = 'def';
    }

    token.kind = kind;
  }

  // 建索引
  const symbols = new Map();
  for (const token of tokens) {
    if (token.type !== 'ident') continue;
    if (!symbols.has(token.value)) {
      symbols.set(token.value, { name: token.value, occurrences: [], counts: {} });
    }
    const entry = symbols.get(token.value);
    entry.occurrences.push({ line: token.line, col: token.col, kind: token.kind, start: token.start });
    entry.counts[token.kind] = (entry.counts[token.kind] || 0) + 1;
  }

  // 大纲：本片段里定义了什么
  const outline = [];
  for (let order = 0; order < meaningful.length; order++) {
    const token = tokens[meaningful[order]];
    if (token.type !== 'ident' || token.kind !== 'def') continue;
    const prev = at(order - 1);
    outline.push({
      name: token.value,
      line: token.line,
      keyword: prev && prev.type === 'keyword' ? prev.value : '=',
    });
  }

  // 按行分组，渲染时直接用
  const lines = [];
  for (const token of tokens) {
    const parts = token.value.split('\n');
    parts.forEach((part, index) => {
      const lineNo = token.line + index;
      while (lines.length < lineNo) lines.push([]);
      if (part !== '') {
        lines[lineNo - 1].push({ ...token, value: part, line: lineNo });
      }
    });
  }
  if (!lines.length) lines.push([]);

  return {
    tokens,
    lines,
    symbols,
    outline,
    lang: langId,
    lineCount: lines.length,
  };
}

/** 供搜索框补全用：按出现次数排序的标识符列表 */
export function rankedSymbols(analysis, query = '') {
  const needle = query.trim().toLowerCase();
  return [...analysis.symbols.values()]
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      // 有定义的排前面，其次按出现次数
      const defA = (a.counts.def || 0) + (a.counts.param || 0);
      const defB = (b.counts.def || 0) + (b.counts.param || 0);
      if (defA !== defB) return defB - defA;
      return b.occurrences.length - a.occurrences.length;
    });
}
