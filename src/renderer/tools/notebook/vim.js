/**
 * textarea 上的极简 Vim。够日常敲代码用，不求全：
 * 普通模式：h j k l 0 ^ $ w b e gg G，i a I A o O，x dd dw D，v 选择 + d/y，p P，u 撤销，/ 交给外面。
 * 所有改动走 document.execCommand('insertText' / 'delete')，保住浏览器撤销栈（和编辑器其它地方一条规矩）。
 * 光标数学抽成纯函数，好测；DOM 操作在 createVim 里。
 */

// ---- 纯函数：都在「整段文本 + 光标下标」上算，返回新下标 ----

export function lineBounds(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  return { start, end };
}

export function columnOf(text, pos) { return pos - lineBounds(text, pos).start; }

/** 上 / 下移一行，尽量保持列 */
export function moveVertical(text, pos, dir, wantCol) {
  const { start, end } = lineBounds(text, pos);
  const col = wantCol == null ? pos - start : wantCol;
  if (dir < 0) {
    if (start === 0) return { pos, col };
    const prev = lineBounds(text, start - 1);
    return { pos: Math.min(prev.start + col, prev.end), col };
  }
  if (end >= text.length) return { pos, col };
  const next = lineBounds(text, end + 1);
  return { pos: Math.min(next.start + col, next.end), col };
}

export function lineStart(text, pos) { return lineBounds(text, pos).start; }
export function lineEnd(text, pos) { return lineBounds(text, pos).end; }
export function firstNonBlank(text, pos) {
  const { start, end } = lineBounds(text, pos);
  const line = text.slice(start, end);
  const m = line.match(/^\s*/)[0].length;
  return start + Math.min(m, Math.max(0, line.length - 1));
}

const WORD = /[A-Za-z0-9_一-鿿]/;
export function wordForward(text, pos) {
  let i = pos; const n = text.length;
  if (i >= n) return n;
  const onWord = WORD.test(text[i]);
  while (i < n && !/\s/.test(text[i]) && WORD.test(text[i]) === onWord) i += 1;
  while (i < n && /\s/.test(text[i])) i += 1;
  return i;
}
export function wordBackward(text, pos) {
  let i = pos - 1;
  while (i > 0 && /\s/.test(text[i])) i -= 1;
  if (i <= 0) return 0;
  const onWord = WORD.test(text[i]);
  while (i > 0 && WORD.test(text[i - 1]) === onWord && !/\s/.test(text[i - 1])) i -= 1;
  return Math.max(0, i);
}
export function wordEnd(text, pos) {
  let i = pos + 1; const n = text.length;
  while (i < n && /\s/.test(text[i])) i += 1;
  const onWord = i < n && WORD.test(text[i]);
  while (i + 1 < n && !/\s/.test(text[i + 1]) && WORD.test(text[i + 1]) === onWord) i += 1;
  return Math.min(i, n - 1 < 0 ? 0 : i);
}

// ---- DOM 侧 ----

export function createVim(editor, { onMode } = {}) {
  let on = false;
  let mode = 'normal';   // normal | insert | visual
  let wantCol = null;
  let visualAnchor = 0;
  let pending = '';      // 等第二个键：d / g
  let register = '';     // y / d 存的东西
  const emit = () => onMode && onMode(on ? mode : 'off');

  const val = () => editor.value;
  const setSel = (a, b = a) => { editor.selectionStart = a; editor.selectionEnd = b; };
  const caret = () => editor.selectionStart;
  const clamp = (p) => Math.max(0, Math.min(p, val().length));

  function toNormal() { mode = 'normal'; pending = ''; const p = caret(); setSel(p); render(); }
  function toInsert(at) { mode = 'insert'; pending = ''; if (at != null) setSel(clamp(at)); render(); }
  function toVisual() { mode = 'visual'; visualAnchor = caret(); render(); }

  function render() { editor.classList.toggle('is-vim-normal', on && mode === 'normal'); editor.classList.toggle('is-vim-visual', on && mode === 'visual'); emit(); }

  function insert(str) { document.execCommand('insertText', false, str); }
  function deleteRange(a, b) { if (a === b) return ''; setSel(a, b); const s = val().slice(a, b); document.execCommand('delete'); return s; }

  function deleteLine() {
    const text = val(); const { start, end } = lineBounds(text, caret());
    const to = end < text.length ? end + 1 : end;
    const from = to === end && start > 0 ? start - 1 : start;
    register = text.slice(start, end) + '\n';
    deleteRange(from, to);
    setSel(clamp(lineStart(val(), Math.min(from, val().length))));
  }

  /** 返回 true = 已处理，吞掉事件 */
  function handle(e) {
    if (!on) return false;
    if (mode === 'insert') {
      if (e.key === 'Escape') { e.preventDefault(); toNormal(); setSel(clamp(caret() - 1) === caret() ? caret() : Math.max(lineStart(val(), caret()), caret() - 1)); return true; }
      return false;   // 插入模式完全交给原来的编辑逻辑
    }
    // normal / visual
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key;
    if (k === 'Shift') return false;
    e.preventDefault();
    const text = val(); const pos = caret();

    if (pending === 'd') {
      pending = '';
      if (k === 'd') { deleteLine(); return true; }
      if (k === 'w') { register = deleteRange(pos, wordForward(text, pos)); return true; }
      if (k === '$') { register = deleteRange(pos, lineEnd(text, pos)); return true; }
      return true;
    }
    if (pending === 'g') { pending = ''; if (k === 'g') { setSel(0); wantCol = 0; } return true; }

    switch (k) {
      case 'h': case 'ArrowLeft': setSel(clamp(pos - 1)); wantCol = null; break;
      case 'l': case 'ArrowRight': setSel(clamp(pos + 1)); wantCol = null; break;
      case 'j': case 'ArrowDown': { const r = moveVertical(text, pos, 1, wantCol); wantCol = r.col; move(r.pos); break; }
      case 'k': case 'ArrowUp': { const r = moveVertical(text, pos, -1, wantCol); wantCol = r.col; move(r.pos); break; }
      case '0': move(lineStart(text, pos)); wantCol = null; break;
      case '^': move(firstNonBlank(text, pos)); wantCol = null; break;
      case '$': move(lineEnd(text, pos)); wantCol = null; break;
      case 'w': move(wordForward(text, pos)); wantCol = null; break;
      case 'b': move(wordBackward(text, pos)); wantCol = null; break;
      case 'e': move(wordEnd(text, pos)); wantCol = null; break;
      case 'G': move(val().length); wantCol = null; break;
      case 'g': pending = 'g'; break;
      case 'i': toInsert(pos); break;
      case 'a': toInsert(pos + 1); break;
      case 'I': toInsert(firstNonBlank(text, pos)); break;
      case 'A': toInsert(lineEnd(text, pos)); break;
      case 'o': { setSel(lineEnd(text, pos)); insert('\n'); toInsert(caret()); break; }
      case 'O': { setSel(lineStart(text, pos)); insert('\n'); setSel(clamp(lineStart(text, pos) === 0 ? 0 : pos)); toInsert(lineStart(val(), Math.max(0, caret() - 1))); break; }
      case 'x': if (mode === 'visual') { yankSel(true); toNormal(); } else deleteRange(pos, clamp(pos + 1)); break;
      case 'D': register = deleteRange(pos, lineEnd(text, pos)); break;
      case 'd': if (mode === 'visual') { yankSel(true); toNormal(); } else pending = 'd'; break;
      case 'y': if (mode === 'visual') { yankSel(false); toNormal(); } break;
      case 'v': mode === 'visual' ? toNormal() : toVisual(); break;
      case 'p': if (register) { setSel(clamp(pos + 1)); insert(register); } break;
      case 'P': if (register) insert(register); break;
      case 'u': document.execCommand('undo'); break;
      case 'Escape': if (mode === 'visual') toNormal(); break;
      default: return true;
    }
    if (mode === 'visual') setSel(Math.min(visualAnchor, caret()), Math.max(visualAnchor, caret()));
    return true;
  }

  function move(p) { const np = clamp(p); if (mode === 'visual') setSel(Math.min(visualAnchor, np), Math.max(visualAnchor, np)), (editor.selectionDirection = np < visualAnchor ? 'backward' : 'forward'); else setSel(np); }
  function yankSel(cut) { const a = editor.selectionStart; const b = editor.selectionEnd; register = val().slice(a, b); if (cut) deleteRange(a, b); else setSel(a); }

  return {
    isOn: () => on,
    mode: () => (on ? mode : 'off'),
    setEnabled(next) { on = Boolean(next); mode = 'normal'; pending = ''; render(); if (on) editor.focus(); },
    handle,
  };
}
