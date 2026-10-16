export class ChainError extends Error { constructor(code, message) { super(message); this.code = code; } }
export function inputPayload(urlText, hostText, maxText, method) {
  if (typeof urlText !== 'string' || typeof hostText !== 'string' || new TextEncoder().encode(urlText).length > 8192 || new TextEncoder().encode(hostText).length > 2048 || typeof maxText !== 'string' || !/^[0-5]$/.test(maxText) || !['HEAD', 'GET'].includes(method)) throw new ChainError('input_limit', '最多 4 个 URL、8 个明确允许主机、0–5 次跳转；方法 HEAD/GET。');
  const urls = urlText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const allowedHosts = hostText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  if (!urls.length || urls.length > 4 || !allowedHosts.length || allowedHosts.length > 8) throw new ChainError('input_limit', 'URL 与允许主机每行一个，分别最多 4 / 8 项。');
  return { urls, allowedHosts, maxRedirects: Number(maxText), method };
}
export const statusLabel = s => ({ terminal: '收到终点响应', loop: '跳转循环', limit: '跳数已满', domain_blocked: '下一主机不允许', downgrade_blocked: 'HTTPS 降级已阻止', missing_location: '缺少 Location', ambiguous_location: '重复 Location', invalid_location: '下一 URL 无效', request_error: '请求失败', timed_out: '请求 / 整批超时', canceled: '已取消', not_run: '未运行' })[s] || s;
export function reportText(r, ext) {
  if (r?.format !== 'T065-redirect-chains' || r.version !== 1 || !Array.isArray(r.chains) || r.chains.length !== r.plan?.urls?.length) throw new ChainError('invalid_report', '缺少完整链报告，拒绝部分导出。');
  const cell = v => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  const json = JSON.stringify(r, null, 2); let text;
  if (ext === 'json') text = json + '\n';
  else if (ext === 'md') text = '# T065 网址跳转链验收\n\n' + r.plan.warning + '\n\n' + r.chains.map(c => '## ' + cell(c.startURL) + '\n\n状态 ' + statusLabel(c.status) + ' / ' + cell(c.code) + '；最后已请求 ' + cell(c.finalRequestedURL) + '；终点 ' + cell(c.terminalURL) + '；未请求停止目标 ' + cell(c.stopTargetURL) + '。\n\n| 请求序号 | URL | HTTP | ms | next URL | warnings / code |\n| --- | --- | --- | --- | --- | --- |\n' + c.hops.map(h => '| ' + [h.index, h.url, h.statusCode, h.elapsedMs, h.nextURL, [...h.warnings, h.code].filter(Boolean).join(', ')].map(cell).join(' | ') + ' |').join('\n')).join('\n\n') + '\n\n' + r.scope + '\n\n## 完整报告\n\n```json\n' + json.replace(/`/g, '\\u0060') + '\n```\n';
  else throw new ChainError('output_format', '仅支持 JSON/Markdown。');
  if (new TextEncoder().encode(text).length > 2097152) throw new ChainError('output_limit', '完整报告超过 2 MiB，不截断。');
  return text;
}
