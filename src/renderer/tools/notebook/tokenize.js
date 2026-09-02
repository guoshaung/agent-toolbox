/**
 * 多语言分词器。
 *
 * 为什么不用正则直接染色：那样没法区分「字符串里的 user」和「变量 user」，
 * 输入一个字段名去高亮就会误伤一大片。先分词，后面所有功能——高亮、找定义、
 * 找调用处——都建立在 token 上，字符串和注释里的同名文字天然不会命中。
 */

const COMMON = {
  ident: /^[A-Za-z_$一-龥][\w$一-龥]*/,
  number: /^0[xXbBoO][0-9a-fA-F_]+|^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/,
};

export const LANGUAGES = {
  python: {
    label: 'Python',
    line: ['#'],
    block: [],
    triple: ['"""', "'''"],
    quotes: ['"', "'"],
    prefixes: /^[rRbBuUfF]{0,2}(?=['"])/,
    defKeywords: ['def', 'class'],
    importKeywords: ['import', 'from'],
    bindKeywords: ['as', 'for', 'global', 'nonlocal'],
    keywords: ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
      'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
      'import', 'in', 'is', 'lambda', 'match', 'case', 'nonlocal', 'not', 'or', 'pass', 'raise',
      'return', 'try', 'while', 'with', 'yield'],
    builtins: ['self', 'cls', 'print', 'len', 'range', 'enumerate', 'zip', 'sorted', 'sum', 'max',
      'min', 'abs', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple', 'super', 'isinstance',
      'open', 'type', 'getattr', 'setattr', 'hasattr'],
  },
  javascript: {
    label: 'JavaScript / TypeScript',
    line: ['//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'", '`'],
    defKeywords: ['function', 'class', 'const', 'let', 'var', 'interface', 'type', 'enum'],
    importKeywords: ['import', 'from', 'require'],
    bindKeywords: ['as', 'catch'],
    keywords: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
      'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function',
      'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'of', 'return',
      'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while',
      'yield', 'null', 'undefined', 'true', 'false'],
    builtins: ['console', 'window', 'document', 'Object', 'Array', 'JSON', 'Promise', 'Math', 'Map', 'Set'],
  },
  java: {
    label: 'Java',
    line: ['//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'"],
    defKeywords: ['class', 'interface', 'enum', 'record'],
    importKeywords: ['import', 'package'],
    bindKeywords: ['catch'],
    keywords: ['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
      'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
      'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'new', 'package',
      'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'this',
      'throw', 'throws', 'try', 'void', 'while', 'null', 'true', 'false', 'var', 'record'],
    builtins: ['System', 'String', 'List', 'Map', 'Integer'],
  },
  go: {
    label: 'Go',
    line: ['//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'", '`'],
    defKeywords: ['func', 'type', 'struct', 'interface'],
    importKeywords: ['import', 'package'],
    bindKeywords: ['range'],
    keywords: ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
      'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return',
      'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false'],
    builtins: ['fmt', 'err', 'make', 'len', 'cap', 'append', 'panic', 'recover'],
  },
  rust: {
    label: 'Rust',
    line: ['//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'"],
    defKeywords: ['fn', 'struct', 'enum', 'trait', 'let', 'const', 'static', 'type', 'mod'],
    importKeywords: ['use', 'extern'],
    bindKeywords: ['as', 'for'],
    keywords: ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
      'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move',
      'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'true', 'type',
      'unsafe', 'use', 'where', 'while'],
    builtins: ['Some', 'None', 'Ok', 'Err', 'Vec', 'String', 'Option', 'Result', 'println'],
  },
  c: {
    label: 'C / C++',
    line: ['//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'"],
    defKeywords: ['struct', 'class', 'enum', 'union', 'typedef', 'namespace'],
    importKeywords: ['include'],
    bindKeywords: [],
    keywords: ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
      'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register',
      'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
      'unsigned', 'void', 'volatile', 'while', 'class', 'namespace', 'template', 'public', 'private',
      'protected', 'virtual', 'nullptr', 'true', 'false', 'new', 'delete'],
    builtins: ['printf', 'malloc', 'free', 'std', 'cout', 'cin'],
  },
  sql: {
    label: 'SQL',
    line: ['--'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'", '`'],
    caseInsensitive: true,
    defKeywords: ['table', 'view', 'index', 'as'],
    importKeywords: [],
    bindKeywords: ['as'],
    keywords: ['select', 'from', 'where', 'group', 'by', 'order', 'having', 'join', 'left', 'right',
      'inner', 'outer', 'on', 'as', 'and', 'or', 'not', 'in', 'exists', 'union', 'all', 'insert',
      'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'view', 'index', 'drop',
      'alter', 'with', 'case', 'when', 'then', 'else', 'end', 'limit', 'offset', 'distinct', 'null'],
    builtins: ['count', 'sum', 'avg', 'max', 'min', 'coalesce', 'cast'],
  },
  plain: {
    label: '纯文本 / 其它',
    line: ['#', '//'],
    block: [['/*', '*/']],
    triple: [],
    quotes: ['"', "'"],
    defKeywords: [],
    importKeywords: [],
    bindKeywords: [],
    keywords: [],
    builtins: [],
  },
};

/** 按特征猜语言。猜错了用户可以在下拉里改，所以宁可保守 */
export function guessLanguage(code) {
  const text = String(code || '').slice(0, 4000);
  const score = {
    python: /(^|\n)\s*(def |class |import |from .+ import |print\()/.test(text) ? 3 : 0,
    javascript: /(^|\n)\s*(const |let |function |export |import .+ from |=>)/.test(text) ? 3 : 0,
    go: /(^|\n)\s*(func |package |type .+ struct)/.test(text) ? 4 : 0,
    rust: /(^|\n)\s*(fn |impl |pub fn |let mut )/.test(text) ? 4 : 0,
    java: /(^|\n)\s*(public class|private |protected |package .+;)/.test(text) ? 3 : 0,
    c: /#include|std::|printf\(/.test(text) ? 3 : 0,
    sql: /\bSELECT\b[\s\S]+\bFROM\b/i.test(text) ? 4 : 0,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : 'plain';
}

/**
 * 返回 token 数组。每个 token：
 *   { type, value, line, col, start, end }
 * type: comment | string | number | keyword | builtin | ident | punct | space
 */
export function tokenize(code, langId = 'python') {
  const lang = LANGUAGES[langId] || LANGUAGES.plain;
  const keywords = new Set(lang.caseInsensitive ? lang.keywords.map((k) => k.toLowerCase()) : lang.keywords);
  const builtins = new Set(lang.caseInsensitive ? lang.builtins.map((k) => k.toLowerCase()) : lang.builtins);

  const tokens = [];
  const text = String(code || '');
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (type, value) => {
    tokens.push({ type, value, line, col, start: i, end: i + value.length });
    // 跨行的 token（块注释、多行字符串）要把行号推进到正确位置
    const breaks = value.split('\n');
    if (breaks.length > 1) {
      line += breaks.length - 1;
      col = breaks[breaks.length - 1].length + 1;
    } else {
      col += value.length;
    }
    i += value.length;
  };

  /** 吃掉一段带转义的字符串；没闭合就吃到行尾（粘贴半截代码是常事） */
  const eatString = (quote, multiline) => {
    let j = i + quote.length;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (!multiline && text[j] === '\n') break;
      if (text.startsWith(quote, j)) { j += quote.length; break; }
      j += 1;
    }
    return text.slice(i, j);
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i];

    if (ch === '\n') { push('space', '\n'); continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      push('space', rest.match(/^[ \t\r]+/)[0]);
      continue;
    }

    // 行注释
    const lineComment = lang.line.find((mark) => rest.startsWith(mark));
    if (lineComment) {
      const end = text.indexOf('\n', i);
      push('comment', text.slice(i, end === -1 ? text.length : end));
      continue;
    }

    // 块注释
    const blockComment = (lang.block || []).find(([open]) => rest.startsWith(open));
    if (blockComment) {
      const [open, close] = blockComment;
      const end = text.indexOf(close, i + open.length);
      push('comment', text.slice(i, end === -1 ? text.length : end + close.length));
      continue;
    }

    // 三引号字符串（Python docstring）
    const triple = (lang.triple || []).find((mark) => rest.startsWith(mark));
    if (triple) { push('string', eatString(triple, true)); continue; }

    // 带前缀的字符串：f"..." r'...' b"..."
    if (lang.prefixes) {
      const prefix = rest.match(lang.prefixes);
      if (prefix && prefix[0]) {
        const quote = text[i + prefix[0].length];
        const inner = eatString(quote, false);
        push('string', prefix[0] + inner.slice(prefix[0].length));
        continue;
      }
    }

    if (lang.quotes.includes(ch)) {
      push('string', eatString(ch, ch === '`'));
      continue;
    }

    const number = rest.match(COMMON.number);
    if (number) { push('number', number[0]); continue; }

    const ident = rest.match(COMMON.ident);
    if (ident) {
      const word = ident[0];
      const probe = lang.caseInsensitive ? word.toLowerCase() : word;
      if (keywords.has(probe)) push('keyword', word);
      else if (builtins.has(probe)) push('builtin', word);
      else push('ident', word);
      continue;
    }

    push('punct', ch);
  }

  return tokens;
}
