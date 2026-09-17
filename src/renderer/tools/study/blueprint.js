'use strict';

/**
 * 从「标准答案」里反推出一份施工图。
 *
 * 练习题的 cells[].code 本来就是写完的样子，所以几个类、每个类几个方法、
 * 引了哪些库、库里用到哪些函数，全都能直接数出来 —— 不用问 AI，也不会瞎编。
 * AI 只负责补那些数不出来的东西（为什么这么拆、该用什么设计模式）。
 */

const PY_STDLIB_HINT = {
  collections: '内置容器的加强版',
  statistics: '均值 / 标准差这类统计量',
  json: 'JSON 读写',
  os: '路径与环境',
  pathlib: '面向对象的路径',
  re: '正则',
  math: '数学函数',
  random: '随机数',
  itertools: '迭代器组合',
  functools: '函数工具（缓存、偏应用）',
  dataclasses: '少写样板的数据类',
  typing: '类型标注',
  datetime: '日期时间',
  abc: '抽象基类',
  enum: '枚举',
  asyncio: '异步',
  threading: '线程',
};

/** 一行里 `名字(` 形式的调用，用来判断某个库的哪些函数真的被用到了。 */
function calledNames(code) {
  const names = new Set();
  const re = /([A-Za-z_][\w.]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) names.add(m[1]);
  return names;
}

function parsePythonImports(code) {
  const libs = new Map();
  const add = (name) => {
    if (!libs.has(name)) libs.set(name, { name, functions: [], note: PY_STDLIB_HINT[name] || '' });
    return libs.get(name);
  };
  for (const line of code.split(/\r?\n/)) {
    const from = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/);
    if (from) {
      const entry = add(from[1].split('.')[0]);
      for (const raw of from[2].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name && name !== '*' && !entry.functions.includes(name)) entry.functions.push(name);
      }
      continue;
    }
    const plain = line.match(/^\s*import\s+(.+)$/);
    if (plain) {
      for (const raw of plain[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name) add(name.split('.')[0]);
      }
    }
  }
  // `import math` 之后用的是 math.xxx，把真正调到的挑出来
  const called = calledNames(code);
  for (const entry of libs.values()) {
    for (const call of called) {
      if (!call.startsWith(`${entry.name}.`)) continue;
      const fn = call.slice(entry.name.length + 1);
      if (fn && !entry.functions.includes(fn)) entry.functions.push(fn);
    }
    entry.functions = entry.functions.filter((fn) => !/^[A-Z_]+$/.test(fn)).slice(0, 8);
  }
  return [...libs.values()];
}

function parseJsImports(code) {
  const libs = new Map();
  const add = (name) => {
    if (!libs.has(name)) libs.set(name, { name, functions: [], note: '' });
    return libs.get(name);
  };
  const named = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = named.exec(code))) {
    const entry = add(m[2]);
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !entry.functions.includes(name)) entry.functions.push(name);
    }
  }
  const plain = /import\s+[\w*\s]+\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = plain.exec(code))) add(m[1]);
  const req = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = req.exec(code))) add(m[1]);
  return [...libs.values()];
}

/** 数出类和它们的方法。Python 按缩进，JS 按花括号里的 `name(` 行。 */
function parsePythonObjects(code) {
  const lines = code.split(/\r?\n/);
  const objects = [];
  const functions = [];
  let current = null;
  for (const line of lines) {
    const cls = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/);
    if (cls) {
      current = { name: cls[2], base: (cls[3] || '').trim(), indent: cls[1].length, methods: [] };
      objects.push(current);
      continue;
    }
    const def = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/);
    if (!def) continue;
    const indent = def[1].length;
    if (current && indent > current.indent) current.methods.push(def[2]);
    else { functions.push(def[2]); if (indent === 0) current = null; }
  }
  return { objects, functions };
}

function parseJsObjects(code) {
  const objects = [];
  const functions = [];
  const classRe = /class\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([\w$.]+)\s*)?\{/g;
  let m;
  while ((m = classRe.exec(code))) {
    // 从类体开始扫到配对的右花括号，再在里面找方法
    let depth = 0; let i = m.index + m[0].length - 1; let end = code.length;
    for (; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const body = code.slice(m.index + m[0].length, end);
    const methods = [];
    const methodRe = /(?:^|\n)\s*(?:static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    let mm;
    while ((mm = methodRe.exec(body))) if (!methods.includes(mm[1])) methods.push(mm[1]);
    objects.push({ name: m[1], base: m[2] || '', methods });
  }
  const fnRe = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fnRe.exec(code))) functions.push(m[1]);
  return { objects, functions };
}

/** 从类名和继承关系上认一认常见设计模式，认不出就不猜。 */
const PATTERN_HINTS = [
  [/Factory$/i, '工厂方法：把“创建哪一个”从使用方抽出去'],
  [/Builder$/i, '建造者：分步拼装复杂对象'],
  [/Singleton$/i, '单例：全局只留一个实例'],
  [/Observer$|Listener$|Subscriber$/i, '观察者：状态变了通知一串订阅方'],
  [/Strategy$/i, '策略：把可替换的算法各自封成一个类'],
  [/Adapter$|Wrapper$/i, '适配器：把不合用的接口包成合用的'],
  [/Decorator$/i, '装饰器：不改原类地叠加行为'],
  [/Command$/i, '命令：把一次操作本身变成对象'],
  [/State$/i, '状态：把每种状态下的行为分开放'],
  [/Repository$|Store$|Dao$/i, '仓储：把取数据的细节挡在外面'],
];

function guessPatterns(objects) {
  const found = [];
  for (const object of objects) {
    for (const [re, text] of PATTERN_HINTS) {
      if (re.test(object.name) && !found.some((f) => f.text === text)) {
        found.push({ object: object.name, text });
      }
    }
    if (object.base && object.base.includes('ABC') && !found.some((f) => f.text.startsWith('抽象基类'))) {
      found.push({ object: object.name, text: '抽象基类：先把接口定死，子类各自实现' });
    }
  }
  return found;
}

/**
 * @param {string} code 标准答案（可以是多个 cell 拼起来的）
 * @param {string} lang 'python' | 'javascript'
 */
export function analyzeBlueprint(code, lang = 'python') {
  const source = String(code || '');
  const js = /^(javascript|js|typescript|ts|node)$/i.test(String(lang));
  const { objects, functions } = js ? parseJsObjects(source) : parsePythonObjects(source);
  const libraries = js ? parseJsImports(source) : parsePythonImports(source);
  const methodTotal = objects.reduce((sum, object) => sum + object.methods.length, 0);
  return {
    objects,
    functions,
    libraries,
    patterns: guessPatterns(objects),
    counts: {
      objects: objects.length,
      methods: methodTotal,
      functions: functions.length,
      libraries: libraries.length,
      lines: source.split(/\r?\n/).filter((line) => line.trim()).length,
    },
  };
}

export { PY_STDLIB_HINT };
