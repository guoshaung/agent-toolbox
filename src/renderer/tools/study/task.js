'use strict';

import { alignCursor } from './ghost.js';

/**
 * 把参考实现切成「步骤」。
 *
 * 空行是人写代码时天然的分段：一段做完一件事。所以按空行切块，
 * 每块取它的第一行有效代码当标识 —— 不编故事，就是告诉你现在在第几段。
 */
export function splitSteps(reference) {
  const lines = String(reference || '').split(/\r?\n/);
  const steps = [];
  let current = null;
  lines.forEach((line, index) => {
    if (!line.trim()) { current = null; return; }
    if (!current) {
      current = { startLine: index, endLine: index, lines: [] };
      steps.push(current);
    }
    current.endLine = index;
    current.lines.push(line);
  });
  return steps.map((step, index) => ({
    index,
    startLine: step.startLine,
    endLine: step.endLine,
    lineCount: step.lines.length,
    head: step.lines[0].trim(),
  }));
}

/** 你敲到第几步了。-1 表示写岔了对不上，steps.length 表示都写完了。 */
export function currentStep(typed, reference) {
  const referenceLines = String(reference || '').split(/\r?\n/);
  const steps = splitSteps(reference);
  if (!steps.length) return { step: -1, steps };
  const typedLines = String(typed || '').split(/\r?\n/);
  const completed = typedLines[typedLines.length - 1].trim()
    ? typedLines.slice(0, -1)
    : typedLines;
  const at = alignCursor(completed, referenceLines);
  if (at < 0) return { step: -1, steps };
  if (at >= referenceLines.length) return { step: steps.length, steps };
  const index = steps.findIndex((step) => at <= step.endLine);
  return { step: index < 0 ? steps.length : index, steps };
}

/**
 * 没有现成任务说明时，给一句能用的。
 * 宁可说「照着参考实现敲 N 行」这种大实话，也不要编一段听着像那么回事的空话。
 */
export function describeTask({ title = '', level = '', reference = '', purpose = '' } = {}) {
  if (purpose) return purpose;
  const steps = splitSteps(reference);
  const lines = String(reference || '').split(/\r?\n/).filter((line) => line.trim()).length;
  if (!lines) return '这一格随便写，跑一下看结果。';
  // 标题通常已经在旁边单独显示了，这里不重复它
  const head = [title ? `「${title}」` : '', level].filter(Boolean).join(' · ');
  const shape = steps.length > 1 ? `${steps.length} 段、共 ${lines} 行` : `${lines} 行`;
  return `${head ? `${head} · ` : ''}${shape}，照着虚化提示敲，Tab 接受。`;
}
