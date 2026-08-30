/**
 * 背诵模式：遮住代码 → 默写 → 逐行对比。
 *
 * 只"看"代码是学不会的，能默写出来才算记住。所以对比要逐行给出
 * 「缺了哪行 / 多了哪行 / 哪行不一样」，而不是只给一个相似度分数。
 */

/** 归一化：去掉行尾空白和空行，缩进保留（Python 里缩进是语义） */
function normalize(code) {
  return code
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''));
}

/** 对比时忽略注释和纯空行 —— 背的是代码，不是注释 */
function meaningful(lines, commentStart = '#') {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith(commentStart);
  });
}

/** 最长公共子序列，用来做逐行 diff。行数都是几十，O(n·m) 完全够用 */
function lcsTable(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/**
 * 返回 [{ type: 'same' | 'missing' | 'extra', text }]
 * missing = 标准答案里有、你没写出来
 * extra   = 你写了、标准答案里没有
 */
export function diffLines(expected, actual, commentStart = '#') {
  const a = meaningful(normalize(expected), commentStart);
  const b = meaningful(normalize(actual), commentStart);
  const dp = lcsTable(a, b);

  const result = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'missing', text: a[i] });
      i += 1;
    } else {
      result.push({ type: 'extra', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) result.push({ type: 'missing', text: a[i++] });
  while (j < b.length) result.push({ type: 'extra', text: b[j++] });

  const same = result.filter((r) => r.type === 'same').length;
  return {
    rows: result,
    score: a.length ? same / a.length : 0,
    expectedLines: a.length,
    matched: same,
  };
}

/** 复述评价，比一个百分比更有指导性 */
export function verdict(score) {
  if (score >= 0.95) return { text: '完全记住了', kind: 'good' };
  if (score >= 0.8) return { text: '骨架对了，细节还差一点', kind: 'good' };
  if (score >= 0.5) return { text: '记住一半，再默一遍', kind: 'warn' };
  return { text: '还不熟，先回去看两遍再默', kind: 'bad' };
}
