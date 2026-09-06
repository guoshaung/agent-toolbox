/** Small dependency-free word diff for local paper comparison. */
export function tokenize(text) { return String(text || '').split(/(\s+|[^\p{L}\p{N}]+)/u).filter(Boolean); }
export function diffWords(left, right) {
  const a = tokenize(left), b = tokenize(right), dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i++] }); j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'delete', text: a[i++] });
    else out.push({ type: 'insert', text: b[j++] });
  }
  while (i < a.length) out.push({ type: 'delete', text: a[i++] });
  while (j < b.length) out.push({ type: 'insert', text: b[j++] });
  return out;
}
