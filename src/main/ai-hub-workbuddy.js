'use strict';

// Wire format references: workbuddy2api-hub and cpa-multi-plugins (see docs/AI-HUB.md).
// This adapter uses explicit browser authorization; it never reads desktop credentials.
const crypto = require('node:crypto');
const BASE = 'https://copilot.tencent.com';
const fault = (status, message) => Object.assign(new Error(message), { status });
const LIMIT = 2 * 1024 * 1024;
async function bounded(body, limit = LIMIT) {
  let size = 0; const chunks = [];
  for await (const chunk of body) { size += chunk.length; if (size > limit) throw fault(502, '服务响应过大'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
function claims(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return {}; } }
function credentials(data) {
  if (typeof data?.accessToken !== 'string' || data.accessToken.length > 32768) throw fault(502, '授权未返回有效令牌');
  const jwt = claims(data.accessToken);
  return { accessToken: data.accessToken, refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : '',
    uid: String(jwt.sub || jwt.uid || ''), expiresAt: Number(jwt.exp) * 1000 || Date.now() + 30 * 60000 };
}
function parseModels(payload) {
  const found = new Set();
  for (const agent of payload?.data?.agents || []) for (const model of agent.models || []) {
    const id = typeof model === 'string' ? model : model?.id;
    if (typeof id === 'string' && id.length < 150) found.add(id);
  }
  for (const model of payload?.data?.models || []) {
    const id = typeof model === 'string' ? model : model?.id;
    if (typeof id === 'string' && id.length < 150) found.add(id);
  }
  return [...found].slice(0, 200);
}
function parseQuota(payload) {
  const accounts = payload?.data?.Response?.Data?.Accounts;
  if (!Array.isArray(accounts) || !accounts.length) throw fault(502, '服务未返回可确认的个人积分包，额度仍为未知');
  let remaining = 0; let count = 0;
  for (const account of accounts) {
    if (String(account.CapacityUnit || '').toLowerCase() !== 'credits') continue;
    const raw = account.CycleCapacityRemainPrecise ?? account.CycleCapacityRemain;
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') throw fault(502, '积分包余额字段缺失');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw fault(502, '积分包余额格式不正确');
    remaining += value; count++;
  }
  if (!count || !Number.isFinite(remaining)) throw fault(502, '未找到 credits 额度数据');
  return { remaining, unit: 'credits', source: 'api', updatedAt: new Date().toISOString(), resetAt: null };
}
class WorkBuddyCN {
  constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) { this.fetch = fetchImpl; this.now = now; this.pending = null; }
  headers(auth) {
    return { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'AgentToolbox/0.46.19',
      ...(auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-User-Id': auth.uid, 'X-Domain': 'copilot.tencent.com' } : {}) };
  }
  async request(route, { auth, body, headers, billing = false } = {}) {
    let response;
    try { response = await this.fetch((billing ? 'https://www.codebuddy.cn' : BASE) + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...this.headers(auth), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw fault(502, 'WorkBuddy 服务连接失败，请稍后重试'); }
    if (!response.ok) { await response.body?.cancel(); throw fault(response.status === 401 || response.status === 403 ? response.status : 502, `WorkBuddy 返回 HTTP ${response.status}，未重试或切换身份`); }
    let payload; try { payload = JSON.parse(await bounded(response.body)); } catch (e) { throw e.status ? e : fault(502, 'WorkBuddy 返回了无法解析的响应'); }
    return payload;
  }
  check(payload) {
    if (payload?.code !== 0) throw fault(502, `WorkBuddy 未接受请求（服务码 ${Number.isInteger(payload?.code) ? payload.code : '未知'}）`);
    return payload;
  }
  async begin() {
    this.cancel();
    const payload = this.check(await this.request('/v2/plugin/auth/state?platform=CLI', { body: {} }));
    const { state, authUrl } = payload.data || {};
    if (typeof state !== 'string' || state.length > 4096) throw fault(502, 'WorkBuddy 登录状态无效');
    let url; try { url = new URL(authUrl); } catch { throw fault(502, 'WorkBuddy 登录地址无效'); }
    if (url.protocol !== 'https:' || !['copilot.tencent.com', 'www.codebuddy.cn', 'www.workbuddy.cn', 'workbuddy.cn'].includes(url.hostname) || url.username || url.password) throw fault(502, 'WorkBuddy 返回了非预期的登录站点');
    this.pending = { id: crypto.randomUUID(), state, expires: this.now() + 10 * 60000, lastPoll: 0, busy: false };
    return { loginId: this.pending.id, authUrl: url.href, expiresAt: this.pending.expires };
  }
  cancel() { this.pending = null; }
  async poll(id) {
    const p = this.pending;
    if (!p || p.id !== id) throw fault(400, '登录已取消，请重新发起');
    if (this.now() >= p.expires) { this.cancel(); throw fault(400, '登录已超时，请重新发起'); }
    if (p.busy || this.now() - p.lastPoll < 2000) return null;
    p.busy = true; p.lastPoll = this.now();
    try {
      const payload = await this.request('/v2/plugin/auth/token?state=' + encodeURIComponent(p.state));
      if (this.pending !== p) throw fault(400, '登录已取消');
      if (payload.code === 11217) return null;
      this.check(payload);
      const auth = credentials(payload.data);
      this.pending = null; return auth;
    } finally { p.busy = false; }
  }
  async renew(auth) {
    if (!auth.refreshToken) throw fault(401, 'WorkBuddy 登录已到期，请重新登录');
    const payload = this.check(await this.request('/v2/plugin/auth/token/refresh', { auth, body: {},
      headers: { 'X-Refresh-Token': auth.refreshToken, 'X-Auth-Refresh-Source': 'plugin' } }));
    const next = credentials(payload.data); if (!next.refreshToken) next.refreshToken = auth.refreshToken;
    return next;
  }
  async models(auth) { return parseModels(this.check(await this.request('/v2/enterprises/personal/models', { auth }))); }
  async quota(auth) {
    const accounts = [];
    const begin = new Date(this.now()).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const end = new Date(this.now() + 10 * 366 * 86400000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    for (let page = 1; page <= 20; page++) {
      const payload = this.check(await this.request('/v2/billing/meter/get-user-resource', { auth, billing: true, body: {
        ProductCode: 'p_tcaca', Status: [0, 3], PageNumber: page, PageSize: 100, PackageEndTimeRangeBegin: begin, PackageEndTimeRangeEnd: end } }));
      const items = payload?.data?.Response?.Data?.Accounts;
      if (!Array.isArray(items)) throw fault(502, 'WorkBuddy 未返回积分包列表');
      accounts.push(...items);
      if (items.length < 100) return parseQuota({ data: { Response: { Data: { Accounts: accounts } } } });
    }
    throw fault(502, '积分包分页超过限制，未将部分数据当成总额度');
  }
  async chat(auth, body, signal) {
    if (body.n !== undefined && body.n !== 1) throw fault(400, 'WorkBuddy 通道暂只支持每次返回一条回答（n=1）');
    const response = await this.fetch(BASE + '/v2/chat/completions', { method: 'POST', headers: this.headers(auth),
      body: JSON.stringify({ ...body, stream: true }), redirect: 'error', signal });
    if (!response.ok || body.stream) return response;
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) { await response.body?.cancel(); throw fault(502, 'WorkBuddy 未返回预期的流式响应'); }
    // Upstream requires SSE even for callers asking for one JSON response.
    let pending = ''; let total = 0; let done = false; let usage; let finish = 'stop'; let id = ''; let model = body.model;
    const message = { role: 'assistant', content: '' }; const calls = new Map(); const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      total += chunk.length; if (total > 32 * 1024 * 1024) throw fault(502, 'WorkBuddy 响应过大');
      pending += decoder.decode(chunk, { stream: true }); let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim(); if (raw === '[DONE]') { done = true; continue; }
        let event; try { event = JSON.parse(raw); } catch { throw fault(502, 'WorkBuddy 事件格式不正确'); }
        if (event.error || (event.code && event.code !== 0)) throw fault(502, 'WorkBuddy 流式调用返回错误');
        id ||= event.id || ''; model = event.model || model; usage = event.usage || usage;
        const choice = event.choices?.[0]; if (!choice) continue;
        finish = choice.finish_reason || finish; const d = choice.delta || {};
        if (typeof d.content === 'string') message.content += d.content;
        if (typeof d.reasoning_content === 'string') message.reasoning_content = (message.reasoning_content || '') + d.reasoning_content;
        for (const part of d.tool_calls || []) {
          if (!Number.isInteger(part.index) || part.index < 0 || part.index > 100) throw fault(502, 'WorkBuddy 工具调用索引无效');
          const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
          call.id += part.id || ''; call.function.name += part.function?.name || ''; call.function.arguments += part.function?.arguments || ''; calls.set(part.index, call);
        }
      }
    }
    if (!done) throw fault(502, 'WorkBuddy 响应中断，未重复请求');
    if (calls.size) { message.tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(v => v[1]); if (!message.content) message.content = null; }
    return new Response(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message, finish_reason: finish }], ...(usage ? { usage } : {}) }), { headers: { 'content-type': 'application/json' } });
  }
}
module.exports = { WorkBuddyCN, parseQuota, parseModels };
