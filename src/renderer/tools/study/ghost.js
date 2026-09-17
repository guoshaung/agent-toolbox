'use strict';

/**
 * 虚化预测代码：照着标准答案，告诉你下一笔该写什么。
 *
 * 思路是「对齐」而不是「猜」：把你已经敲完的整行按顺序去标准答案里对位置，
 * 对上了就把那一行剩下的部分（或者下一整行）作为提示。对不上就什么都不提 ——
 * 宁可不提示，也不要把人往错的方向带。AI 的预测走另一条路，在这之上叠加。
 */

const norm = (line) => line.replace(/\s+/g, ' ').trim();

/**
 * 你敲完的第 n 行对应标准答案的第几行。
 * 允许你多敲空行、也允许你跳过标准答案里的空行，但顺序必须是顺的。
 */
export function alignCursor(typedLines, referenceLines) {
  let ref = 0;
  for (const raw of typedLines) {
    const line = norm(raw);
    if (!line) continue;                       // 自己多敲的空行不影响对位
    while (ref < referenceLines.length && !norm(referenceLines[ref])) ref += 1;
    if (ref >= referenceLines.length) return referenceLines.length;
    if (norm(referenceLines[ref]) === line) ref += 1;
    else return -1;                            // 写岔了，别再照着答案提示
  }
  while (ref < referenceLines.length && !norm(referenceLines[ref])) ref += 1;
  return ref;
}

/**
 * @param {string} typed 光标之前的全部内容
 * @param {string} reference 标准答案
 * @returns {{text: string, kind: 'line'|'rest'|''}} text 是要虚化显示、按 Tab 就补上的内容
 */
export function nextGhost(typed, reference) {
  const none = { text: '', kind: '' };
  const referenceLines = String(reference || '').split(/\r?\n/);
  if (!referenceLines.some((line) => norm(line))) return none;

  const typedLines = String(typed || '').split(/\r?\n/);
  const partial = typedLines[typedLines.length - 1];
  const completed = typedLines.slice(0, -1);

  const index = alignCursor(completed, referenceLines);
  if (index < 0 || index >= referenceLines.length) return none;
  const target = referenceLines[index];

  // 当前行还没写字：提示一整行（连缩进一起给，省得还要自己数空格）
  if (!partial.trim()) {
    if (partial.length > target.length) return none;
    return { text: target.slice(partial.length), kind: 'line' };
  }
  // 当前行写了一半：只有确实是这一行的前缀才接着提示
  if (target.startsWith(partial)) {
    const rest = target.slice(partial.length);
    return rest ? { text: rest, kind: 'rest' } : none;
  }
  // 忽略缩进差异再试一次 —— 人经常少敲或多敲空格
  const trimmedTarget = target.trimStart();
  const trimmedPartial = partial.trimStart();
  if (trimmedPartial && trimmedTarget.startsWith(trimmedPartial)) {
    return { text: trimmedTarget.slice(trimmedPartial.length), kind: 'rest' };
  }
  return none;
}
