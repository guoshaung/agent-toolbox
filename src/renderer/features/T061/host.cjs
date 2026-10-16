'use strict';
const dns = require('node:dns');
const net = require('node:net');
const { domainToASCII } = require('node:url');
const { performance } = require('node:perf_hooks');
const LIMITS = Object.freeze({ timeoutMs: 5000, domainChars: 253, addresses: 1024, senders: 32, jobsPerSender: 128 });
class InputError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new InputError(code, message); };
const ownKeys = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid_payload', '请求字段不属于 T061 固定协议。'); };
function normalizeDomain(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > 512 || /[\s\x00-\x1f\x7f:/\\?#@%\[\]();,'"`$*=<>]/u.test(raw)) fail('invalid_domain', '请输入域名，不接受 URL、IP、路径、空格或命令语法。');
  let ascii; try { ascii = domainToASCII(raw).toLowerCase(); } catch { fail('invalid_domain', '域名无法进行 IDNA 转换。'); }
  if (!ascii || net.isIP(ascii)) fail('invalid_domain', '必须是域名，不能是 IP 地址。');
  const absolute = ascii.endsWith('.'); const name = absolute ? ascii.slice(0, -1) : ascii;
  if (name.length > LIMITS.domainChars || !/^[a-z0-9.-]+$/.test(name)) fail('invalid_domain', 'IDNA 后域名须符合有限 DNS 主机名范围，最多 253 字符。');
  const labels = name.split('.'); if (labels.some(l => !l.length || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) fail('invalid_domain', 'DNS 标签须为 1–63 字符，首尾不能为连字符。');
  if (labels.length < 2 && name !== 'localhost') fail('invalid_domain', '除 localhost 外，至少需要两个域名标签；不扩展系统搜索后缀。');
  if (net.isIP(name)) fail('invalid_domain', '必须是域名，不能是 IP 地址。');
  return name + (absolute ? '.' : '');
}
function normalizeServer(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > 100 || /[\s\x00-\x1f\x7f%/?#@]/u.test(raw)) fail('invalid_dns_server', 'DNS 服务器须为 IP 或 IP:端口；IPv6 使用方括号。');
  let address; let port = 53; let match;
  if ((match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(raw))) { address = match[1]; if (net.isIP(address) !== 6) fail('invalid_dns_server', '方括号里必须是 IPv6 地址。'); if (match[2] !== undefined) port = Number(match[2]); }
  else if ((match = /^([^:]+)(?::([0-9]+))?$/.exec(raw))) { address = match[1]; if (net.isIP(address) !== 4) fail('invalid_dns_server', 'IPv4 须为规范点分十进制；IPv6 须用方括号。'); if (match[2] !== undefined) port = Number(match[2]); }
  else fail('invalid_dns_server', 'DNS 服务器格式无效。');
  if (net.isIP(address) === 6) address = new URL('http://[' + address + ']/').hostname.slice(1, -1);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('invalid_dns_port', 'DNS 端口须为 1–65535。');
  if (address === '0.0.0.0' || address === '::' || address.toLowerCase() === 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' || address === '255.255.255.255' || (net.isIP(address) === 4 && Number(address.split('.')[0]) >= 224) || (net.isIP(address) === 6 && /^ff/i.test(address))) fail('invalid_dns_server', '不使用未指定、广播或多播 DNS 服务器地址。');
  return { address, port, target: net.isIP(address) === 6 ? `[${address}]:${port}` : `${address}:${port}` };
}
function plan(payload) {
  ownKeys(payload, ['domain', 'dnsServer', 'recordType']); const domain = normalizeDomain(payload.domain); const server = normalizeServer(payload.dnsServer);
  if (!['A', 'AAAA'].includes(payload.recordType)) fail('invalid_record_type', '记录类型只能为 A 或 AAAA。');
  return { domain, dnsServer: server.target, recordType: payload.recordType, timeoutMs: LIMITS.timeoutMs, maxApiCalls: 2, targets: [{ source: 'system_lookup', target: `系统名称服务：${domain}`, operation: 'dns.lookup(all:true)', family: payload.recordType === 'A' ? 4 : 6, maxCalls: 1 }, { source: 'specified_dns', target: server.target, domain, operation: payload.recordType === 'A' ? 'Resolver.resolve4' : 'Resolver.resolve6', maxCalls: 1 }], warning: '最多两次 API 调用；系统可能读取 hosts/缓存/系统 DNS，内部 DNS 报文、重传或 CNAME/TCP 行为不可观测。不会 HTTP、修改系统 DNS 或自动更换服务器。' };
}
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'DNS_ERROR';
function classify(source, code) {
  if (code === 'T061_TIMEOUT' || code === 'ETIMEOUT') return { category: 'timeout', explanation: '查询超时，没有测量 HTTP。' };
  if (code === 'ECANCELLED') return { category: 'canceled', explanation: '查询已取消，没有测量 HTTP。' };
  if (source === 'specified_dns' && code === 'ENOTFOUND') return { category: 'dns_nxdomain', explanation: '指定 DNS 查询返回不存在域名（Node ENOTFOUND）；不是 HTTP 失败。' };
  if (source === 'system_lookup' && code === 'ENOTFOUND') return { category: 'system_name_failure', explanation: '系统名称查询失败；此代码可能有多种原因，不能据此精确认定 DNS NXDOMAIN。' };
  if (code === 'ENODATA') return { category: 'no_data', explanation: '名称没有请求的记录类型数据，区别于 NXDOMAIN；没有测量 HTTP。' };
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ESERVFAIL', 'EREFUSED'].includes(code)) return { category: 'dns_connection_or_server_error', explanation: '名称服务连接或服务器错误；不是 HTTP 连接检测。' };
  return { category: 'resolution_error', explanation: '名称解析失败，保留错误代码但不推断 HTTP 状态。' };
}
function createHost(dependencies = {}) {
  const dnsApi = dependencies.dns || dns; const now = dependencies.now || (() => performance.now()); const setTimer = dependencies.setTimer || setTimeout; const clearTimer = dependencies.clearTimer || clearTimeout; const senders = new Map();
  function sender(context, create) { const id = context?.senderId; if (!Number.isSafeInteger(id) || id < 1) fail('invalid_sender', '宿主发送者无效。'); if (!senders.has(id) && create) { if (senders.size >= LIMITS.senders) fail('sender_limit', '宿主诊断窗口数量已达上限，请关闭旧窗口。'); senders.set(id, { seen: new Set(), job: null }); } return senders.get(id); }
  function jobId(raw) { if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(raw)) fail('invalid_job_id', '诊断任务 ID 必须为 12–64 个字母、数字、连字符或下划线。'); return raw; }
  async function run(payload, context) {
    ownKeys(payload, ['domain', 'dnsServer', 'recordType', 'jobId', 'confirmed']); if (payload.confirmed !== true) fail('confirmation_required', '请先查看目标和次数，再点击确认运行。'); const id = jobId(payload.jobId); const target = plan({ domain: payload.domain, dnsServer: payload.dnsServer, recordType: payload.recordType }); const state = sender(context, true);
    if (state.seen.has(id)) fail('duplicate_job_id', '该任务 ID 已使用，拒绝重复查询。'); if (state.job) fail('job_busy', '此窗口已有诊断任务，请等待或取消。'); if (state.seen.size >= LIMITS.jobsPerSender) fail('job_limit', '本窗口已达 128 次诊断上限，请重新打开窗口。');
    const resolver = new dnsApi.Resolver({ timeout: LIMITS.timeoutMs, tries: 1 }); try { resolver.setServers([target.dnsServer]); } catch { fail('invalid_dns_server', '解析器拒绝 DNS 服务器设置。'); }
    const job = { id, canceled: false, pending: new Set(), resolver }; state.seen.add(id); state.job = job;
    const begin = now(); const family = target.recordType === 'A' ? 4 : 6;
    function query(source, targetLabel, invoke) {
      return new Promise(resolve => { const started = now(); let ended = false; let timer; const finish = (error, raw = []) => { if (ended) return; ended = true; clearTimer(timer); job.pending.delete(abort); const code = error ? safeCode(error) : null; const classification = error ? classify(source, code) : { category: 'resolved', explanation: '此来源解析成功；地址不代表网站或 HTTP 可用。' }; let addresses = []; if (!error) { const values = Array.isArray(raw) ? (source === 'system_lookup' ? raw : raw.map(address => ({ address, family }))) : null; if (!Array.isArray(values) || values.length > LIMITS.addresses || values.some(v => typeof v?.address !== 'string' || ![4, 6].includes(v.family) || net.isIP(v.address) !== v.family || v.family !== family)) { resolve({ source, target: targetLabel, recordType: target.recordType, elapsedMs: Math.max(0, Math.round(now() - started)), status: 'failed', code: 'invalid_dns_result', category: 'invalid_result', explanation: '解析结果格式或数量超出范围，未截断地址。', addresses: [], cached: 'unknown', httpMeasured: false }); return; } addresses = values; } resolve({ source, target: targetLabel, recordType: target.recordType, elapsedMs: Math.max(0, Math.round(now() - started)), status: error ? 'failed' : 'resolved', code, ...classification, addresses, cached: 'unknown', httpMeasured: false }); };
        const abort = () => finish({ code: 'ECANCELLED' }); job.pending.add(abort); timer = setTimer(() => { finish({ code: 'T061_TIMEOUT' }); if (source === 'specified_dns') { try { resolver.cancel(); } catch {} } }, LIMITS.timeoutMs);
        try { invoke(finish); } catch { finish({ code: 'DNS_ERROR' }); }
      });
    }
    try {
      const results = await Promise.all([query('system_lookup', '系统名称服务', callback => dnsApi.lookup(target.domain, { all: true, family, verbatim: true }, callback)), query('specified_dns', target.dnsServer, callback => resolver[target.recordType === 'A' ? 'resolve4' : 'resolve6'](target.domain, callback))]);
      return { ok: true, report: { format: 'T061-dns-path-report', version: 1, jobId: id, plan: target, canceled: job.canceled, elapsedMs: Math.max(0, Math.round(now() - begin)), results, httpMeasured: false, cacheObservation: 'unknown', difference: results.every(r => r.status === 'resolved') ? (JSON.stringify([...new Set(results[0].addresses.map(a => a.address))].sort()) === JSON.stringify([...new Set(results[1].addresses.map(a => a.address))].sort()) ? 'same_address_set' : 'different_address_set') : 'incomplete_resolution', caveat: '来源语义不同。差异不是 DNS 劫持证据；未测 HTTP/TLS/连接、缓存命中或真实网络报文数。系统 lookup 无可取消句柄，取消/超时仅停止等待并忽略晚回调。' } };
    } finally { try { resolver.cancel(); } catch {} if (state.job === job) state.job = null; }
  }
  async function invoke(operation, payload, context) { try { sender(context, false); if (operation === 'plan') return { ok: true, plan: plan(payload) }; if (operation === 'run') return await run(payload, context); return { ok: false, code: 'unsupported_operation', error: 'T061 仅支持 plan 和 run 操作。' }; } catch (error) { return { ok: false, code: error instanceof InputError ? error.code : 'host_error', error: error instanceof InputError ? error.message : '本地诊断失败；未返回系统路径或内部异常。' }; } }
  async function cancel(id, context) { try { jobId(id); const state = sender(context, false); if (!state?.job || state.job.id !== id) return { ok: true, canceled: false, jobId: id }; const job = state.job; job.canceled = true; for (const abort of [...job.pending]) abort(); try { job.resolver.cancel(); } catch {} return { ok: true, canceled: true, jobId: id }; } catch (error) { return { ok: false, code: error instanceof InputError ? error.code : 'host_error', error: error instanceof InputError ? error.message : '本地取消失败。' }; } }
  function dispose(senderId) { const state = senders.get(senderId); if (state?.job) { state.job.canceled = true; for (const abort of [...state.job.pending]) abort(); try { state.job.resolver.cancel(); } catch {} } senders.delete(senderId); }
  return { invoke, cancel, disposeSender: dispose };
}
const host = createHost(); module.exports = { ...host, createHost, normalizeDomain, normalizeServer, plan, classify, LIMITS };
