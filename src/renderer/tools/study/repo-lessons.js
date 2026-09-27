/**
 * 把一个 GitHub 仓库拆成「跟着敲」的课：一个文件一课，文件按顶层定义切成一格一格。
 * 纯函数，方便测。
 */

const LANG_BY_EXT = { ipynb: 'python', py: 'python', sh: 'bash', bash: 'bash', sql: 'sql', js: 'javascript', mjs: 'javascript', ts: 'typescript', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', java: 'java', rb: 'ruby', m: 'matlab', md: 'markdown' };
const TRACK_BY_LANG = { python: 'python', bash: 'linux', sql: 'sql', matlab: 'matlab' };
const SKIP_FILE = /(^|\/)(__init__\.py|setup\.py|setup\.cfg|conftest\.py|LICENSE|\.gitignore)$/i;

export function langOf(rel) {
  const ext = String(rel || '').split('.').pop().toLowerCase();
  return LANG_BY_EXT[ext] || '';
}

/** 能在实践敲码里直接跑的语言 → 轨道；其他只能敲不能跑 */
export function trackForLang(lang) { return TRACK_BY_LANG[lang] || ''; }

/** 仓库文件排个学习顺序：主代码按大小从小到大，测试放后面，README 示例单列 */
export function orderFiles(files) {
  const code = (files || []).filter((f) => langOf(f.rel) && langOf(f.rel) !== 'markdown' && !SKIP_FILE.test(f.rel) && f.size > 0);
  const isTest = (f) => /(^|\/)(tests?|spec)(\/|_|\.)|_test\.|\.test\./i.test(f.rel);
  const main = code.filter((f) => !isTest(f)).sort((a, b) => a.size - b.size);
  const tests = code.filter(isTest).sort((a, b) => a.size - b.size);
  return [...main, ...tests];
}

/** README 里的代码块：这是最好的「试一试」素材 */
export function readmeExamples(readme) {
  const out = [];
  const re = /```(\w*)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(readme || '')))) {
    const lang = { py: 'python', python: 'python', sh: 'bash', bash: 'bash', shell: 'bash', sql: 'sql', js: 'javascript', javascript: 'javascript' }[m[1].toLowerCase()] || '';
    const code = m[2].replace(/\s+$/, '');
    if (!lang || !code.trim() || /^\s*(pip|npm|uv|conda|brew|apt)\s/.test(code)) continue;   // 装包命令不算示例
    out.push({ lang, code });
  }
  return out;
}

/**
 * 按顶层定义切块。Python 用缩进判断顶层；别的语言按空行段落。
 * 太碎的连续小块合并，单块不超过 maxLines 行（超了就按空行再切）。
 */
export function splitIntoChunks(code, lang = 'python', { maxLines = 40, minLines = 4 } = {}) {
  const lines = String(code || '').replace(/\r/g, '').split('\n');
  const starts = [];
  if (lang === 'python') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^(def |class |async def |@)/.test(line)) {
        // 装饰器和它下面的 def 算一块
        if (/^@/.test(line) && starts.length && /^@/.test(lines[starts[starts.length - 1]]) && starts[starts.length - 1] === i - 1) continue;
        if (starts.length && /^(def |class |async def )/.test(line) && /^@/.test(lines[i - 1] || '')) continue;
        starts.push(i);
      } else if (i === 0 || (/^\S/.test(line) && lines[i - 1] === '' && !/^[)\]}]/.test(line))) {
        // 顶层非定义语句（import / 常量 / 主程序），前面有空行就另起一块
        if (!starts.length || starts[starts.length - 1] !== i) starts.push(i);
      }
    }
  } else {
    starts.push(0);
    for (let i = 1; i < lines.length; i += 1) if (lines[i - 1] === '' && lines[i] !== '') starts.push(i);
  }
  const uniq = [...new Set(starts)].sort((a, b) => a - b);
  let blocks = uniq.map((s, k) => lines.slice(s, uniq[k + 1] ?? lines.length).join('\n').replace(/\s+$/, '')).filter((b) => b.trim());
  // 小块往前并
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    const n = b.split('\n').length;
    if (last && last.split('\n').length + n <= maxLines && (last.split('\n').length < minLines || n < minLines)) merged[merged.length - 1] = `${last}\n\n${b}`;
    else merged.push(b);
  }
  blocks = merged;
  // 大块按空行再拆
  const out = [];
  for (const b of blocks) {
    if (b.split('\n').length <= maxLines) { out.push(b); continue; }
    let cur = [];
    for (const line of b.split('\n')) {
      cur.push(line);
      if (cur.length >= maxLines && line === '') { out.push(cur.join('\n').replace(/\s+$/, '')); cur = []; }
    }
    if (cur.join('').trim()) out.push(cur.join('\n').replace(/\s+$/, ''));
  }
  return out.map((chunk) => ({ code: chunk, title: titleOf(chunk, lang) }));
}

function titleOf(chunk, lang) {
  const m = chunk.match(lang === 'python' ? /^(?:@[^\n]*\n)*\s*(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/m : /^(?:export\s+)?(?:async\s+)?(function|class|const|let|var|func|fn|struct|impl)\s+([A-Za-z_][\w]*)/m);
  if (m) return `${m[1] === 'class' || m[1] === 'struct' ? '类' : '函数'} ${m[2]}`;
  if (/^(import|from)\s/m.test(chunk.split('\n')[0] || '')) return '导入';
  const first = chunk.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) || '';
  return first.trim().slice(0, 32) || '代码块';
}

/** 一个文件 → 一课的格子 */
export function lessonCells(rel, code, lang) {
  const chunks = splitIntoChunks(code, lang);
  const name = rel.split('/').pop();
  return chunks.map((c, i) => ({ title: `${name} · ${c.title}`, code: c.code, reference: c.code, purpose: `第 ${i + 1} / ${chunks.length} 段，照着虚化提示敲一遍，敲完 ⇧⏎ 跑一下看有没有报错` }));
}

/** README 示例 → 格子 */
export function exampleCells(readme, repoName) {
  return readmeExamples(readme).map((ex, i) => ({ title: `README 示例 ${i + 1}`, code: ex.code, reference: ex.code, lang: ex.lang, purpose: `${repoName} 的 README 里的用法示例，在仓库目录里跑，import 能直接找到包` }));
}
