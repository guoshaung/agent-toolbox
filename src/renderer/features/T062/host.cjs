'use strict';
const tls = require('node:tls');
const net = require('node:net');
const { domainToASCII } = require('node:url');
const { X509Certificate, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const LIMITS = Object.freeze({ timeoutMs: 5000, chainCertificates: 16, certificateBytes: 65536, chainBytes: 262144, metadataChars: 16384, senders: 32, jobsPerSender: 128 });
class InputError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new InputError(code, message); };
const keys = (value, allowed) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('invalid_payload', '请求不属于 T062 固定协议，不接受凭据、CA 或代码。'); };
function normalizeHost(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > 512 || /[\s\x00-\x1f\x7f/\\?#@%();,'"`$*=<>]/u.test(raw)) fail('invalid_host', '目标须为主机名或 IP，不能是 URL、路径、端口或命令。');
  let host = raw; if (raw.startsWith('[') && raw.endsWith(']')) { host = raw.slice(1, -1); if (net.isIP(host) !== 6) fail('invalid_host', '方括号中须为 IPv6。'); }
  const family = net.isIP(host); if (family) { if (family === 6) host = new URL('http://[' + host + ']/').hostname.slice(1, -1); if (host === '0.0.0.0' || host === '::' || host === '255.255.255.255' || (family === 4 && Number(host.split('.')[0]) >= 224) || (family === 6 && /^ff/i.test(host))) fail('invalid_host', '不连接未指定、有限广播或多播 IP。'); return { host, family, identityName: host, servername: null }; }
  if (/[:\[\]]/.test(raw)) fail('invalid_host', '端口独立填写，IPv6 须为合法地址。'); let ascii; try { ascii = domainToASCII(raw).toLowerCase(); } catch { fail('invalid_host', 'IDNA 转换失败。'); }
  const name = ascii.endsWith('.') ? ascii.slice(0, -1) : ascii; if (!name || name.length > 253 || !/^[a-z0-9.-]+$/.test(name) || name.split('.').some(l => !l || l.length > 63 || l.startsWith('-') || l.endsWith('-')) || (name !== 'localhost' && !name.includes('.')) || net.isIP(name)) fail('invalid_host', 'IDNA 主机名须为有限 DNS 标签，单标签只支持 localhost；IP 须为规范形式。');
  return { host: ascii, family: 0, identityName: name, servername: name };
}
function plan(payload) {
  keys(payload, ['host', 'port']); const target = normalizeHost(payload.host); const port = typeof payload.port === 'string' && /^[0-9]{1,5}$/.test(payload.port) ? Number(payload.port) : payload.port; if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('invalid_port', '端口须为 1–65535 整数。');
  return { ...target, port, target: target.family === 6 ? `[${target.host}]:${port}` : `${target.host}:${port}`, maxConnectionAttempts: 1, maxHandshakes: 1, timeoutMs: LIMITS.timeoutMs, mode: 'certificate_observation', rejectUnauthorized: false, tlsRange: ['TLSv1.2', 'TLSv1.3'], autoSelectFamily: false, warning: '只做一次证书观察握手，rejectUnauthorized:false 用于读取失败证书，不是修复、信任或验证成功。记录 Node authorized/authorizationError，名称与日期另行检查。不发送 HTTP/应用数据/凭据，不自动切换地址、端口或协议；域名可能触发系统名称解析，其内部查询不可观测。' };
}
const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'TLS_ERROR';
function extractChain(peer, wallTime) {
  const chain = []; const seen = new Set(); let current = peer; let total = 0; let ending = 'issuer_not_available';
  while (current && Buffer.isBuffer(current.raw)) {
    const raw = current.raw; if (!raw.length || raw.length > LIMITS.certificateBytes) fail('certificate_limit', '证书大小超过有界观察范围，未截断链。'); const sha256 = createHash('sha256').update(raw).digest('hex'); if (seen.has(sha256)) { ending = 'repeated_certificate'; break; } if (total + raw.length > LIMITS.chainBytes) fail('certificate_limit', '证书总量超过范围，未输出部分链。'); if (chain.length >= LIMITS.chainCertificates) fail('chain_limit', '观察链超过 16 张证书，未输出部分链。'); seen.add(sha256); total += raw.length;
    let x509; try { x509 = new X509Certificate(raw); } catch { fail('invalid_certificate', '节点证书无法由 X509 解析，未输出部分链。'); }
    const from = Date.parse(x509.validFrom); const to = Date.parse(x509.validTo); if (!Number.isFinite(from) || !Number.isFinite(to)) fail('invalid_certificate_date', '证书日期无法可靠解析。'); const validity = wallTime < from ? 'not_yet_valid' : wallTime > to ? 'expired' : 'within_dates';
    const metadata = { index: chain.length, subject: x509.subject, issuer: x509.issuer, subjectAltName: x509.subjectAltName ?? null, serialNumber: x509.serialNumber, isCA: x509.ca, publicKeyType: x509.publicKey.asymmetricKeyType, validFromUTC: new Date(from).toISOString(), validToUTC: new Date(to).toISOString(), validity, daysUntilExpiry: Math.floor((to - wallTime) / 86400000), sha256, bytes: raw.length, derBase64: raw.toString('base64') };
    if ([metadata.subject, metadata.issuer, metadata.subjectAltName, metadata.serialNumber].some(v => v !== null && (typeof v !== 'string' || v.length > LIMITS.metadataChars))) fail('metadata_limit', '证书名称字段超过有界范围，未部分导出。'); chain.push(metadata); current = current.issuerCertificate;
  }
  if (!chain.length) fail('no_certificate', '未获得可用对端证书；不能推断期限或主机名。');
  return { certificates: chain, ending, completeness: 'unknown', source: 'Node getPeerCertificate(true) available issuer chain; not a proven complete trusted chain or exact wire capture' };
}
function identityCheck(name, raw, tlsApi = tls) { try { const certificate = new X509Certificate(raw).toLegacyObject(); const error = tlsApi.checkServerIdentity(name, certificate); return error ? { status: 'mismatch', code: safeCode(error.code), name, independent: true, explanation: '名称不匹配；此检查独立于 Node 信任和有效期结果。' } : { status: 'matched', code: null, name, independent: true, explanation: '名称匹配不代表证书可信、有效或站点可用。' }; } catch { return { status: 'unknown', code: 'IDENTITY_CHECK_ERROR', name, independent: true, explanation: '无法完成独立名称检查，未当作匹配。' }; } }
function createHost(dependencies = {}) {
  const tlsApi = dependencies.tls || tls; const now = dependencies.now || (() => performance.now()); const wall = dependencies.wall || Date.now; const setTimer = dependencies.setTimer || setTimeout; const clearTimer = dependencies.clearTimer || clearTimeout; const senders = new Map();
  function state(context, create) { const id = context?.senderId; if (!Number.isSafeInteger(id) || id < 1) fail('invalid_sender', '宿主发送者无效。'); if (!senders.has(id) && create) { if (senders.size >= LIMITS.senders) fail('sender_limit', '诊断窗口数量超过上限，请关闭旧窗口。'); senders.set(id, { seen: new Set(), job: null }); } return senders.get(id); }
  const idOf = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(id)) fail('invalid_job_id', '任务 ID 须为 12–64 字符字母数字、连字符或下划线。'); return id; };
  async function run(payload, context) {
    keys(payload, ['host', 'port', 'jobId', 'confirmed']); if (payload.confirmed !== true) fail('confirmation_required', '先核对观察模式、目标和期限，再点击确认。'); const target = plan({ host: payload.host, port: payload.port }); const id = idOf(payload.jobId); const sender = state(context, true);
    if (sender.seen.has(id)) fail('duplicate_job_id', '任务 ID 已使用，拒绝重复连接。'); if (sender.job) fail('job_busy', '本窗口已有任务，先等待或取消。'); if (sender.seen.size >= LIMITS.jobsPerSender) fail('job_limit', '本窗口已达 128 次任务，请重新打开窗口。');
    const started = now(); const measuredAt = wall(); const job = { id, socket: null, finish: null, canceled: false }; sender.seen.add(id); sender.job = job;
    try { return await new Promise(resolve => {
      let finished = false; let timer; const finish = (status, code, observed = {}) => { if (finished) return; finished = true; clearTimer(timer); try { job.socket?.destroy(); } catch {} resolve({ ok: true, report: { format: 'T062-tls-certificate-report', version: 1, jobId: id, plan: target, measuredAtUTC: new Date(measuredAt).toISOString(), elapsedMs: Math.max(0, Math.round(now() - started)), status, code, canceled: job.canceled, handshakeObserved: false, authorization: { authorized: null, authorizationError: null, mode: 'observation_rejectUnauthorized_false', trustGrantedByTool: false }, identity: { status: 'not_checked', name: target.identityName, independent: true }, chain: { certificates: [], ending: 'not_available', completeness: 'unknown' }, protocol: null, cipher: null, issues: status === 'observed' ? [] : [code], applicationDataSent: false, httpMeasured: false, revocationChecked: false, caveat: '观察模式不是信任成功。未发送应用数据/HTTP/凭据，未做 OCSP/CRL 吊销、完整路径构建或浏览器信任验证。证书日期依赖本机时钟；链仅是 Node 当前可提供的记录，完整性未知。', ...observed } }); };
      job.finish = finish; timer = setTimer(() => finish('timed_out', 'T062_TIMEOUT'), LIMITS.timeoutMs);
      try {
        const socket = tlsApi.connect({ host: target.host, port: target.port, ...(target.servername ? { servername: target.servername } : {}), rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3', autoSelectFamily: false, requestOCSP: false }); job.socket = socket; socket.disableRenegotiation?.();
        socket.once('secureConnect', () => { if (finished) return; let chain; const authorized = socket.authorized === true; const authorizationError = authorized ? null : safeCode(typeof socket.authorizationError === 'string' ? socket.authorizationError : socket.authorizationError?.code); const authorization = { authorized, authorizationError, mode: 'observation_rejectUnauthorized_false', trustGrantedByTool: false }; try {
            const checkedAt = wall(); const peer = socket.getPeerCertificate(true); chain = extractChain(peer, checkedAt); const identity = identityCheck(target.identityName, peer.raw, tlsApi); const issues = []; if (!authorized) issues.push('node_authorization_failed'); if (identity.status === 'mismatch') issues.push('hostname_mismatch'); else if (identity.status !== 'matched') issues.push('hostname_unknown'); chain.certificates.forEach(c => { if (c.validity === 'expired') issues.push(c.index === 0 ? 'leaf_expired' : `chain_${c.index}_expired`); if (c.validity === 'not_yet_valid') issues.push(c.index === 0 ? 'leaf_not_yet_valid' : `chain_${c.index}_not_yet_valid`); }); const cipher = socket.getCipher(); const safeCipher = cipher && typeof cipher.name === 'string' && cipher.name.length <= 100 ? { name: cipher.name, standardName: typeof cipher.standardName === 'string' && cipher.standardName.length <= 100 ? cipher.standardName : null, version: typeof cipher.version === 'string' && cipher.version.length <= 40 ? cipher.version : null } : null; finish('observed', null, { measuredAtUTC: new Date(checkedAt).toISOString(), handshakeObserved: true, authorization, identity, chain, protocol: socket.getProtocol(), cipher: safeCipher, issues });
          } catch (error) { finish('certificate_error', error instanceof InputError ? error.code : 'CERTIFICATE_READ_ERROR', { handshakeObserved: true, authorization }); } });
        socket.once('error', error => finish('connection_error', safeCode(error?.code))); socket.once('close', () => { if (!finished) finish('connection_closed', 'TLS_CLOSED_BEFORE_CERTIFICATE'); });
      } catch { finish('connection_error', 'TLS_CONNECT_ERROR'); }
    }); } finally { if (sender.job === job) sender.job = null; }
  }
  async function invoke(operation, payload, context) { try { state(context, false); if (operation === 'plan') return { ok: true, plan: plan(payload) }; if (operation === 'run') return await run(payload, context); return { ok: false, code: 'unsupported_operation', error: 'T062 仅支持 plan 和 run。' }; } catch (error) { return { ok: false, code: error instanceof InputError ? error.code : 'host_error', error: error instanceof InputError ? error.message : '本地 TLS 诊断失败，没有回显内部路径或异常。' }; } }
  async function cancel(id, context) { try { idOf(id); const sender = state(context, false); if (!sender?.job || sender.job.id !== id) return { ok: true, canceled: false, jobId: id }; const job = sender.job; job.canceled = true; job.finish?.('canceled', 'ECANCELLED'); return { ok: true, canceled: true, jobId: id }; } catch (error) { return { ok: false, code: error instanceof InputError ? error.code : 'host_error', error: error instanceof InputError ? error.message : '取消失败。' }; } }
  function disposeSender(senderId) { const sender = senders.get(senderId); if (sender?.job) { sender.job.canceled = true; sender.job.finish?.('canceled', 'ECANCELLED'); } senders.delete(senderId); }
  return { invoke, cancel, disposeSender };
}
const host = createHost(); module.exports = { ...host, createHost, normalizeHost, plan, extractChain, identityCheck, LIMITS };
