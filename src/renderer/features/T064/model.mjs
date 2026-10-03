export class MatrixError extends Error { constructor(code, message) { super(message); this.code = code; } }
export function inputPayload(hostText, portText) {
  if (typeof hostText !== 'string' || typeof portText !== 'string' || new TextEncoder().encode(hostText).length > 4096 || new TextEncoder().encode(portText).length > 512) throw new MatrixError('input_limit', '主机文本最多 4096 字节，端口文本最多 512 字节。');
  const hosts = hostText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const tokens = portText.trim().split(/[,\s]+/).filter(Boolean);
  if (!hosts.length || hosts.length > 6 || !tokens.length || tokens.length > 8 || hosts.length * tokens.length > 24 || tokens.some(t => !/^[0-9]{1,5}$/.test(t))) throw new MatrixError('matrix_limit', '填写 1–6 行主机和 1–8 个十进制端口（逗号/空白分隔），总端点最多 24；不支持端口段。');
  const ports = tokens.map(Number);
  if (ports.some(p => p < 1 || p > 65535)) throw new MatrixError('invalid_port', '端口须为 1–65535；主机不附带端口。');
  return { hosts, ports };
}
export const statusLabel = status => ({ connected: '连接成功', refused: '连接拒绝', timed_out: 'TCP 超时', dns_error: 'DNS 失败', dns_timed_out: 'DNS 超时', network_error: '其它网络错误', canceled: '已取消', not_run: '未运行' })[status] || status;
export function reportText(report, extension) {
  if (report?.format !== 'T064-tcp-matrix' || report.version !== 1 || !Array.isArray(report.rows) || !report.rows.length || report.rows.length !== report.plan?.endpoints?.length) throw new MatrixError('invalid_report', '缺少完整矩阵报告，拒绝部分导出。');
  const cell = v => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  const json = JSON.stringify(report, null, 2);
  let content;
  if (extension === 'json') content = json + '\n';
  else if (extension === 'md') content = '# T064 TCP 服务可达性矩阵\n\n' + report.plan.warning + '\n\n开始 UTC ' + report.startedAtUTC + '；结束 UTC ' + report.completedAtUTC + '；取消 ' + report.canceled + '；整批超时 ' + report.batchTimedOut + '。\n\n| 主机 | 端口 | 状态 | 阶段 | code / 未运行原因 | TCP 开始 UTC | TCP ms |\n| --- | --- | --- | --- | --- | --- | --- |\n' + report.rows.map(r => '| ' + [r.host, r.port, statusLabel(r.status), r.stage, r.code ?? r.reason, r.startedAtUTC, r.tcpElapsedMs].map(cell).join(' | ') + ' |').join('\n') + '\n\n' + report.scope + '\n\n## 完整报告\n\n```json\n' + json.replace(/`/g, '\\u0060') + '\n```\n';
  else throw new MatrixError('output_format', '仅支持 JSON/Markdown。');
  if (new TextEncoder().encode(content).length > 2097152) throw new MatrixError('output_limit', '完整报告超过 2 MiB，不截断。');
  return content;
}
