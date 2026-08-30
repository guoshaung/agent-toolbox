/**
 * 极简语法高亮。自己写一个是为了不引入 highlight.js 这种几百 KB 的依赖 ——
 * 这里只需要认出注释、字符串、关键字、数字，够看就行。
 *
 * 先分词再转义（不是先转义再正则），否则字符串里的 < > 会把词法搞乱。
 */
const KEYWORDS = {
  python: new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
    'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
    'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
    'return', 'try', 'while', 'with', 'yield', 'match', 'case', 'self', 'cls']),
  javascript: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'class', 'extends', 'new', 'this', 'import', 'export', 'from', 'default', 'async', 'await',
    'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false']),
};

const BUILTINS = new Set(['print', 'len', 'range', 'enumerate', 'zip', 'sorted', 'sum', 'max', 'min',
  'abs', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple', 'super', 'isinstance', 'getattr',
  'setattr', 'hasattr', 'torch', 'np', 'nn', 'F', 'math', 'heapq', 'deque', 'defaultdict', 'Counter']);

const escapeHtml = (text) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LINE_COMMENT = { python: '#', javascript: '//' };

export function highlight(code, lang = 'python') {
  const keywords = KEYWORDS[lang] || KEYWORDS.python;
  const commentStart = LINE_COMMENT[lang] || '#';
  const out = [];
  let i = 0;

  const emit = (cls, text) => out.push(
    cls ? `<span class="tok tok--${cls}">${escapeHtml(text)}</span>` : escapeHtml(text),
  );

  while (i < code.length) {
    const rest = code.slice(i);

    // 行注释
    if (rest.startsWith(commentStart)) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      emit('com', code.slice(i, stop));
      i = stop;
      continue;
    }

    // 三引号字符串（Python 的 docstring 都靠它）
    const triple = rest.match(/^("""|''')/);
    if (triple) {
      const quote = triple[1];
      const end = code.indexOf(quote, i + 3);
      const stop = end === -1 ? code.length : end + 3;
      emit('str', code.slice(i, stop));
      i = stop;
      continue;
    }

    // 普通字符串（支持 f/r/b 前缀和转义）
    const strMatch = rest.match(/^[frbu]{0,2}(['"])(?:\\.|(?!\1)[^\n])*\1?/i);
    if (strMatch && /['"]/.test(strMatch[0])) {
      emit('str', strMatch[0]);
      i += strMatch[0].length;
      continue;
    }

    // 装饰器
    const decorator = rest.match(/^@[A-Za-z_][\w.]*/);
    if (decorator) {
      emit('dec', decorator[0]);
      i += decorator[0].length;
      continue;
    }

    // 数字
    const num = rest.match(/^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?/);
    if (num) {
      emit('num', num[0]);
      i += num[0].length;
      continue;
    }

    // 标识符
    const ident = rest.match(/^[A-Za-z_]\w*/);
    if (ident) {
      const word = ident[0];
      const after = code.slice(i + word.length);
      let cls = null;
      if (keywords.has(word)) cls = 'kw';
      else if (/^\s*\(/.test(after)) cls = 'fn';        // 后面跟括号，当函数名
      else if (BUILTINS.has(word)) cls = 'bi';
      emit(cls, word);
      i += word.length;
      continue;
    }

    emit(null, code[i]);
    i += 1;
  }

  return out.join('');
}

/** 带行号的完整代码块 HTML */
export function highlightBlock(code, lang = 'python') {
  const lines = code.split('\n');
  const width = String(lines.length).length;
  return lines
    .map((line, index) => {
      const no = String(index + 1).padStart(width, ' ');
      return `<span class="code__ln">${no}</span>${highlight(line, lang)}`;
    })
    .join('\n');
}
