/**
 * 给 textarea 加上最基本的代码编辑器手感：Tab 补全 / 缩进、自动缩进、
 * ⌘Enter 下开新行、括号自动配对、⌘/ 注释。
 *
 * 一条铁律：所有改动都走 document.execCommand('insertText')，
 * 不直接赋值 textarea.value —— 直接赋值会把浏览器的撤销栈清空，
 * 敲错一个字符就再也 ⌘Z 不回去了，那比没有这些功能更难受。
 */

/** 各轨道的补全词表。只放真的常用的，列太长反而挑不动。 */
const KEYWORDS = {
  python: ['def', 'class', 'return', 'import', 'from', 'for', 'while', 'if', 'elif', 'else',
    'try', 'except', 'finally', 'raise', 'with', 'as', 'lambda', 'yield', 'async', 'await',
    'print', 'len', 'range', 'enumerate', 'zip', 'sorted', 'sum', 'min', 'max', 'abs', 'round',
    'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool', 'isinstance', 'open',
    'True', 'False', 'None', 'self', '__init__', '__name__', 'f-string'],
  regex: ['import re', 're.search', 're.match', 're.findall', 're.finditer', 're.sub', 're.split',
    're.compile', 're.IGNORECASE', 're.MULTILINE', 're.DOTALL', 'group', 'groupdict', 'groups'],
  numpy: ['import numpy as np', 'np.array', 'np.arange', 'np.zeros', 'np.ones', 'np.linspace',
    'np.reshape', 'np.mean', 'np.std', 'np.sum', 'np.max', 'np.min', 'np.argmax', 'np.argmin',
    'np.concatenate', 'np.stack', 'np.where', 'np.random.default_rng', 'axis=0', 'axis=1', 'dtype'],
  asyncio: ['import asyncio', 'async def', 'await', 'asyncio.run', 'asyncio.gather', 'asyncio.sleep',
    'asyncio.wait_for', 'asyncio.Semaphore', 'asyncio.TimeoutError', 'asyncio.create_task', 'async with'],
  datafile: ['from pathlib import Path', 'import json', 'import csv', 'Path', 'read_text', 'write_text',
    'json.dumps', 'json.loads', 'json.dump', 'json.load', 'csv.DictReader', 'csv.DictWriter',
    'encoding="utf-8"', 'ensure_ascii=False', 'glob', 'rename', 'exists', 'mkdir'],
  pytest: ['import pytest', 'def test_', 'assert', 'pytest.raises', 'pytest.mark.parametrize',
    'pytest.fixture', 'pytest.approx', 'pytest.skip'],
  pandas: ['import pandas as pd', 'pd.DataFrame', 'pd.read_csv', 'pd.concat', 'pd.merge',
    'groupby', 'sort_values', 'head', 'tail', 'describe', 'to_string', 'to_csv', 'iloc', 'loc'],
  pytorch: ['import torch', 'torch.tensor', 'torch.zeros', 'torch.ones', 'torch.randn', 'torch.nn',
    'torch.nn.Linear', 'torch.optim.SGD', 'torch.optim.Adam', 'requires_grad=True', 'backward',
    'zero_grad', 'step', 'no_grad', 'item', 'shape'],
  matplotlib: ['import matplotlib.pyplot as plt', 'plt.plot', 'plt.scatter', 'plt.bar', 'plt.xlabel',
    'plt.ylabel', 'plt.title', 'plt.legend', 'plt.savefig', 'plt.figure', 'plt.show'],
  requests: ['import requests', 'requests.get', 'requests.post', 'response.json', 'response.text',
    'response.status_code', 'raise_for_status', 'timeout=10', 'headers', 'params'],
  linux: ['echo', 'printf', 'grep', 'sed', 'awk', 'find', 'sort', 'uniq', 'head', 'tail', 'cut',
    'wc', 'cat', 'ls', 'mkdir', 'chmod', 'export', 'for', 'do', 'done', 'if', 'then', 'fi', 'else'],
  textproc: ['awk', 'sed', 'grep', 'sort', 'uniq', 'cut', 'tr', 'paste', 'xargs', 'NR', 'NF', 'END', 'BEGIN'],
  git: ['git init', 'git add', 'git commit', 'git status', 'git log', 'git diff', 'git branch',
    'git checkout', 'git merge', 'git reset', 'git stash', 'git remote', '--oneline', '--graph'],
  sql: ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'INSERT INTO',
    'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE TABLE', 'JOIN', 'LEFT JOIN', 'ON', 'AS',
    'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'RANK() OVER', 'PARTITION BY'],
  matlab: ['disp', 'fprintf', 'zeros', 'ones', 'linspace', 'size', 'length', 'sum', 'mean', 'max',
    'min', 'find', 'reshape', 'for', 'end', 'if', 'else', 'function'],
};

/** Python 系的轨道共用 python 词表打底。 */
const PY_LIKE = new Set(['python', 'regex', 'numpy', 'asyncio', 'datafile', 'pytest',
  'pandas', 'pytorch', 'matplotlib', 'requests', 'transformers', 'fastapi', 'langchain']);

const INDENT = '    ';
const WORD_RE = /[A-Za-z_][\w.]*$/;
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };

/** 当前行的缩进空白 */
function indentOf(line) {
  return (line.match(/^[ \t]*/) || [''])[0];
}

function lineInfo(area) {
  const value = area.value;
  const pos = area.selectionStart;
  const start = value.lastIndexOf('\n', pos - 1) + 1;
  let end = value.indexOf('\n', pos);
  if (end < 0) end = value.length;
  return { start, end, text: value.slice(start, end), pos };
}

/** 收集候选：轨道词表 + 当前文件里已经出现过的标识符（后者最有用，变量名都在里面） */
export function collectCandidates(trackId, text, prefix) {
  if (!prefix) return [];
  const pool = new Set();
  for (const word of KEYWORDS[trackId] || []) pool.add(word);
  if (PY_LIKE.has(trackId)) for (const word of KEYWORDS.python) pool.add(word);
  // 带点的也要收：你自己写的 model.forward、cfg.lr 这种，不收就只能补词表里的
  for (const word of String(text).match(/[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*/g) || []) {
    if (word.length >= 3) pool.add(word);
  }

  const lower = prefix.toLowerCase();
  const hits = [...pool].filter((word) => word.toLowerCase().startsWith(lower) && word !== prefix);
  // 前缀完全一致的排前面，其次短的（短的通常是你要的那个）
  hits.sort((a, b) => {
    const ea = Number(a.startsWith(prefix));
    const eb = Number(b.startsWith(prefix));
    return eb - ea || a.length - b.length || a.localeCompare(b);
  });
  return hits.slice(0, 8);
}

/**
 * 把编辑器行为挂到一个 textarea 上。
 * @param area   textarea 元素
 * @param getTrackId 返回当前轨道 id 的函数（轨道会切换，不能只取一次）
 */
export function attachEditorKeys(area, getTrackId) {
  let popup = null;
  let items = [];
  let active = 0;
  let anchorPrefix = '';

  /**
   * 把光标滚进可视区。
   * 我们 preventDefault 之后是程序化插入，浏览器那套「自动把光标滚进视野」不会触发，
   * 结果就是回车后新行掉到可视区外面，你在看不见的地方打字。
   */
  function scrollCaretIntoView() {
    const cs = getComputedStyle(area);
    const lh = parseFloat(cs.lineHeight) || 22;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const line = area.value.slice(0, area.selectionStart).split('\n').length - 1;
    const top = padTop + line * lh;
    if (top < area.scrollTop) area.scrollTop = Math.max(0, top - lh);
    else if (top + lh > area.scrollTop + area.clientHeight) {
      area.scrollTop = top + lh - area.clientHeight + lh;   // 多留一行余量，别贴着底边
    }
    // 横向同理：写长行时别让光标顶出右边界
    const col = area.selectionStart - (area.value.lastIndexOf('\n', area.selectionStart - 1) + 1);
    const cw = 7.4;
    const x = col * cw;
    if (x < area.scrollLeft) area.scrollLeft = Math.max(0, x - 40);
    else if (x > area.scrollLeft + area.clientWidth - 320) area.scrollLeft = x - area.clientWidth + 340;
  }

  const write = (text) => {
    area.focus();
    document.execCommand('insertText', false, text);
    scrollCaretIntoView();
  };

  function closePopup() {
    if (popup) popup.remove();
    popup = null;
    items = [];
    active = 0;
  }

  function renderPopup() {
    if (!items.length) return closePopup();
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'practice__complete';
      (area.parentElement || document.body).appendChild(popup);
    }
    popup.textContent = '';
    items.forEach((word, i) => {
      const row = document.createElement('div');
      row.className = `practice__complete-item${i === active ? ' is-active' : ''}`;
      row.textContent = word;
      row.addEventListener('mousedown', (e) => { e.preventDefault(); accept(i); });
      popup.appendChild(row);
    });
    // 定位到光标所在行的下一行
    const info = lineInfo(area);
    const lineIndex = area.value.slice(0, info.pos).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(area).lineHeight) || 22;
    const col = info.pos - info.start;
    popup.style.top = `${Math.max(4, 14 + (lineIndex + 1) * lh - area.scrollTop)}px`;
    popup.style.left = `${Math.min(520, 14 + col * 7.4)}px`;
  }

  function accept(index = active) {
    const word = items[index];
    if (!word) return;
    // 选中已经打出来的前缀，再整词替换。
    // 别用 execCommand('delete') 逐字符删：光标折叠时它的行为不确定，
    // 实测三个字符只删掉两个，补出来会多一个字母。
    const end = area.selectionStart;
    area.selectionStart = end - anchorPrefix.length;
    area.selectionEnd = end;
    write(word);
    closePopup();
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** @param minPrefix 自动弹出要求 2 个字符起，手动按 Tab 触发时 1 个就够 */
  function refreshPopup(minPrefix = 2) {
    const info = lineInfo(area);
    const before = area.value.slice(info.start, info.pos);
    const match = before.match(WORD_RE);
    anchorPrefix = match ? match[0] : '';
    if (anchorPrefix.length < minPrefix) { closePopup(); return false; }
    items = collectCandidates(getTrackId(), area.value, anchorPrefix);
    active = 0;
    renderPopup();
    return items.length > 0;
  }

  // 用 input 而不是 keydown 来驱动候选：中文输入法提交和粘贴都不产生逐字符 keydown，
  // 挂在 keydown 上会整段漏掉。
  area.addEventListener('input', () => refreshPopup(2));
  area.addEventListener('blur', closePopup);
  area.addEventListener('scroll', () => { if (popup) renderPopup(); });

  area.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    const info = lineInfo(area);

    // ---- 补全面板开着的时候，方向键和回车归它 ----
    if (popup && items.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % items.length; renderPopup(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + items.length) % items.length; renderPopup(); return; }
      if (event.key === 'Escape') { event.preventDefault(); closePopup(); return; }
      if (event.key === 'Tab' || (event.key === 'Enter' && !meta && !event.isComposing)) {
        event.preventDefault();
        accept();
        return;
      }
    }

    // ---- ⌘Enter：在下面开一行（VSCode 的 ⌘↵）；加 Shift 则在上面开 ----
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      const pad = indentOf(info.text);
      if (event.shiftKey) {
        area.selectionStart = area.selectionEnd = info.start;
        write(`${pad}\n`);
        area.selectionStart = area.selectionEnd = info.start + pad.length;
      } else {
        area.selectionStart = area.selectionEnd = info.end;
        write(`\n${pad}`);
      }
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // ---- ⌘/ 注释切换。选中多行就整块切，跟 VSCode 一致 ----
    if (meta && event.key === '/') {
      event.preventDefault();
      const track = getTrackId();
      const mark = track === 'sql' ? '--' : (track === 'matlab' ? '%' : '#');
      const value = area.value;
      const blockStart = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
      let blockEnd = value.indexOf('\n', area.selectionEnd);
      if (blockEnd < 0) blockEnd = value.length;
      const lines = value.slice(blockStart, blockEnd).split('\n');
      // 只要还有一行没注释，就整块加注释；全都注释了才整块取消。
      const allCommented = lines.every((l) => !l.trim() || l.trimStart().startsWith(mark));
      const next = lines.map((line) => {
        if (!line.trim()) return line;
        const pad = indentOf(line);
        const body = line.trimStart();
        if (allCommented) return pad + body.slice(mark.length).replace(/^ /, '');
        return `${pad}${mark} ${body}`;
      }).join('\n');
      area.selectionStart = blockStart;
      area.selectionEnd = blockEnd;
      write(next);
      area.selectionStart = blockStart;
      area.selectionEnd = blockStart + next.length;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // ---- Tab：先试补全，没得补再当缩进用 ----
    if (event.key === 'Tab') {
      event.preventDefault();
      if (!event.shiftKey && area.selectionStart === area.selectionEnd && refreshPopup(1)) {
        // 只有一个候选就别弹面板了，直接补上
        if (items.length === 1) accept(0);
        return;
      }
      if (area.selectionStart !== area.selectionEnd) {
        const value = area.value;
        const blockStart = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
        const blockEnd = value.indexOf('\n', area.selectionEnd) < 0 ? value.length : value.indexOf('\n', area.selectionEnd);
        const block = value.slice(blockStart, blockEnd);
        const shifted = event.shiftKey
          ? block.split('\n').map((l) => l.replace(new RegExp(`^ {1,${INDENT.length}}`), '')).join('\n')
          : block.split('\n').map((l) => INDENT + l).join('\n');
        area.selectionStart = blockStart;
        area.selectionEnd = blockEnd;
        write(shifted);
        area.selectionStart = blockStart;
        area.selectionEnd = blockStart + shifted.length;
      } else if (event.shiftKey) {
        const pad = indentOf(info.text);
        if (pad.length) {
          const cut = Math.min(INDENT.length, pad.length);
          area.selectionStart = info.start;
          area.selectionEnd = info.start + cut;
          document.execCommand('delete', false);
        }
      } else {
        write(INDENT);
      }
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // ---- Enter：保持缩进，遇到 : 或 { 再多缩一层 ----
    if (event.key === 'Enter' && !meta && !event.isComposing) {
      event.preventDefault();
      const upto = info.text.slice(0, info.pos - info.start).trimEnd();
      const deeper = /[:{[(]$/.test(upto);
      write(`\n${indentOf(info.text)}${deeper ? INDENT : ''}`);
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // ---- 三引号：打第三个引号时补成 ''' ''' 并把光标放中间（写 docstring / 块注释用） ----
    if ((event.key === '"' || event.key === "'") && area.selectionStart === area.selectionEnd && !event.isComposing) {
      const q = event.key;
      const pos = area.selectionStart;
      // 前面已经是两个同样的引号（第 1 个自动配对、第 2 个跳过之后就是这个状态）
      if (area.value.slice(pos - 2, pos) === q + q && area.value[pos] !== q) {
        event.preventDefault();
        write(q + q + q + q);        // 补完开头第三个，再补上闭合的三个
        area.selectionStart = area.selectionEnd = pos + 1;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    // ---- 括号 / 引号自动配对；已经有闭合符就跳过去而不是再插一个 ----
    if (PAIRS[event.key] && area.selectionStart === area.selectionEnd && !event.isComposing) {
      const nextChar = area.value[area.selectionStart] || '';
      // 引号成对时，紧邻的下一个字符就是它 → 跳过
      if ((event.key === '"' || event.key === "'") && nextChar === event.key) {
        event.preventDefault();
        area.selectionStart = area.selectionEnd = area.selectionStart + 1;
        scrollCaretIntoView();
        return;
      }
      // 后面紧跟字母数字就别自动补了，多半是在词中间打括号
      if (!/[\w"']/.test(nextChar)) {
        event.preventDefault();
        write(event.key + PAIRS[event.key]);
        area.selectionStart = area.selectionEnd = area.selectionStart - 1;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    if ((event.key === ')' || event.key === ']' || event.key === '}')
      && area.value[area.selectionStart] === event.key
      && area.selectionStart === area.selectionEnd) {
      event.preventDefault();
      area.selectionStart = area.selectionEnd = area.selectionStart + 1;
      scrollCaretIntoView();
      return;
    }

    // ---- 退格：一次删掉一层缩进，而不是一个空格 ----
    if (event.key === 'Backspace' && area.selectionStart === area.selectionEnd) {
      const before = area.value.slice(info.start, area.selectionStart);
      if (before.length && /^ +$/.test(before) && before.length % INDENT.length === 0) {
        event.preventDefault();
        area.selectionStart = area.selectionStart - INDENT.length;
        document.execCommand('delete', false);
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

  });

  return { closePopup };
}
