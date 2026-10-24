'use strict';
// International IDE only. Read the user's existing login without writing or
// refreshing the IDE's credentials. Protocol notes and validation: docs/AI-HUB.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fault = (status, message) => Object.assign(new Error(message), { status });
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const CORE = { SG: 'https://coresg-normal.trae.ai', US: 'https://coreva-normal.trae.ai' };
const BILLING = { SG: 'https://grow-normal.trae.ai', US: 'https://grow-normal.traeapi.us' };
// Request schema revision found in the installed international IDE's completion
// extension. This is distinct from product.json's UI version code.
const SCHEMA_VERSION = '20260212';
function parseQuota(payload, now = Date.now()) {
  const data = payload?.data || payload;
  if (!Array.isArray(data?.user_entitlement_pack_list) || !data.user_entitlement_pack_list.length) throw fault(502, 'TRAE 未返回可确认的套餐，额度未知');
  const dollar = data.is_dollar_usage_billing === true;
  if (!dollar && data.is_credits_billing !== true) throw fault(502, 'TRAE 套餐计量方式暂不支持，未估算额度');
  let count = 0, remaining = 0, reset = Infinity;
  for (const pack of data.user_entitlement_pack_list) {
    const base = pack.entitlement_base_info;
    if (!base || !finite(base.start_time) || !finite(base.end_time)) throw fault(502, 'TRAE 套餐有效期缺失');
    if (base.start_time * 1000 > now || base.end_time * 1000 <= now || base.is_hide === true) continue;
    if ((base.ent_status ?? base.status) !== 0) throw fault(502, 'TRAE 套餐状态未确认');
    const q = base.quota || base.product_extra?.subscription_extra?.quota || base.product_extra?.package_extra?.quota;
    const u = pack.usage;
    const pairs = dollar ? [['basic_usage_limit', 'basic_usage_amount'], ['bonus_usage_limit', 'bonus_usage_amount']] : [['credits_limit', 'credits_amount']];
    for (const [limit, used] of pairs) {
      if (!finite(q?.[limit]) || !finite(u?.[used])) throw fault(502, 'TRAE 额度字段缺失，保留上次数据');
      remaining += Math.max(0, q[limit] - u[used]);
    }
    count++; reset = Math.min(reset, base.end_time * 1000);
  }
  if (!count || !Number.isFinite(remaining)) throw fault(502, 'TRAE 没有可确认的有效套餐');
  return { remaining, unit: dollar ? 'USD 额度' : 'credits', source: 'api', updatedAt: new Date(now).toISOString(), resetAt: new Date(reset).toISOString() };
}
function parseModels(data) {
  if (!Array.isArray(data?.config_info_list)) throw fault(502, 'TRAE 模型目录格式不正确');
  return [...new Set(data.config_info_list.filter(m => !m.is_invisible_to_user && !m.config_name?.startsWith('custom_model_') && !['summary','fast_apply','input_optimization','title_generation'].includes(m.config_name))
    .map(m => m.config_name).filter(n => typeof n === 'string' && n.length > 0 && n.length < 150))].slice(0, 200);
}
class TraeIDE {
  constructor({ fetchImpl = fetch, storageFile = path.join(process.env.APPDATA || '', 'Trae/User/globalStorage/storage.json'), now = () => Date.now() } = {}) {
    this.fetch = fetchImpl; this.storageFile = storageFile; this.now = now;
  }
  localAuth(identity) {
    let store, auth;
    try { store = JSON.parse(fs.readFileSync(this.storageFile, 'utf8')); auth = JSON.parse(store['iCubeAuthInfo://icube.cloudide']); }
    catch { throw fault(401, '请先在本机 TRAE 国际版 IDE 登录；当前登录格式无法读取'); }
    const region = typeof auth?.userRegion === 'string' ? auth.userRegion : auth?.userRegion?.region;
    const expiresAt = Date.parse(auth?.expiredAt);
    if (!CORE[region]) throw fault(401, '仅支持 TRAE 国际版 IDE 的 SG／US 账号，不会替换为国内版或 SOLO');
    if (typeof auth.token !== 'string' || auth.token.length > 32768 || /[\r\n]/.test(auth.token) || !auth.userId || !Number.isFinite(expiresAt) || expiresAt <= this.now() + 60000) throw fault(401, 'TRAE 登录已过期，请在 IDE 重新登录后刷新');
    const fingerprint = crypto.createHash('sha256').update(String(auth.userId)).digest('hex');
    if (identity && (identity.fingerprint !== fingerprint || identity.region !== region)) throw fault(409, 'TRAE 已切换账号，请重新连接本机 IDE');
    return { token: auth.token, region, expiresAt, fingerprint, deviceId: String(store['telemetry.devDeviceId'] || '') };
  }
  headers(auth) {
    return { 'Content-Type': 'application/json', Authorization: `Cloud-IDE-JWT ${auth.token}`, 'X-User-Region': auth.region,
      'X-Device-Id': auth.deviceId, 'User-Agent': 'AgentToolbox/0.46.20', 'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
      'x-app-version': 'default', 'x-ide-version-code': SCHEMA_VERSION, 'x-app-version-code': SCHEMA_VERSION };
  }
  async request(auth, route, body, billing = false, signal, passHttpErrors = false) {
    let response;
    try { response = await this.fetch((billing ? BILLING : CORE)[auth.region] + route, { method: 'POST', headers: this.headers(auth), body: JSON.stringify(body), redirect: 'error', signal: signal || AbortSignal.timeout(15000) }); }
    catch { throw fault(502, 'TRAE 请求失败或已取消，未重复发送'); }
    if (!response.ok && !passHttpErrors) { await response.body?.cancel(); throw fault(response.status === 401 ? 401 : 502, `TRAE 返回 HTTP ${response.status}`); }
    return response;
  }
  async json(auth, route, body, billing) {
    const response = await this.request(auth, route, body, billing); let text = ''; const decoder = new TextDecoder();
    for await (const chunk of response.body) { text += decoder.decode(chunk, { stream: true }); if (text.length > 4 * 1024 * 1024) throw fault(502, 'TRAE 数据过大'); }
    text += decoder.decode();
    let data; try { data = JSON.parse(text); } catch { throw fault(502, 'TRAE 数据格式不正确'); }
    if (data.code || data.error || data.ResponseMetadata?.Error) throw fault(502, 'TRAE 拒绝本次查询');
    return data;
  }
  async quota(auth) { return parseQuota(await this.json(auth, '/trae/api/v1/pay/ide_user_ent_usage', {}, true), this.now()); }
  async models(auth) { return parseModels(await this.json(auth, '/api/ide/v1/get_detail_param', { function: 'chat_v3', config_names: null, need_prompt: false, current_config_info: null, poly_prompt: true, mode_type: null, agent_type: null })); }
  async chat(auth, input, signal) {
    if ((input.n && input.n !== 1) || input.tools?.length || input.functions?.length || input.response_format) throw fault(400, 'TRAE IDE 通道目前支持文本对话；工具调用、结构化输出和多候选尚未验证');
    if (!Array.isArray(input.messages) || input.messages.some(m => !['system','user','assistant'].includes(m.role) || typeof m.content !== 'string')) throw fault(400, 'TRAE IDE 通道目前仅接受文本消息');
    const body = { function: 'chat_v3', config_name: input.model, model: input.model, stream: true,
      messages: input.messages.map(m => ({ role: m.role, content: [{ type: 'text', text: m.content }] })) };
    for (const key of ['max_tokens','temperature','top_p','stop']) if (input[key] !== undefined) body[key] = input[key];
    const response = await this.request(auth, '/api/agent/v3/llm_utils_chat', body, false, signal, true);
    if (!response.ok) return response; // Let the shared gateway apply its explicit HTTP failover policy.
    if (!response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw fault(502, 'TRAE 未返回预期的事件流'); }
    const iterator = convertStream(response.body, input.model);
    if (input.stream) {
      return new Response(new ReadableStream({ async pull(controller) { try { const r = await iterator.next(); if (r.done) controller.close(); else controller.enqueue(new TextEncoder().encode(`data: ${r.value === '[DONE]' ? r.value : JSON.stringify(r.value)}\n\n`)); } catch (e) { controller.error(e); } }, async cancel() { await iterator.return(); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const message = { role: 'assistant', content: '' }; let final;
    for await (const event of iterator) {
      if (event === '[DONE]') continue;
      final = event; const delta = event.choices[0].delta;
      message.content += delta.content || '';
      if (delta.reasoning_content) message.reasoning_content = (message.reasoning_content || '') + delta.reasoning_content;
    }
    return new Response(JSON.stringify({ ...final, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: final.choices[0].finish_reason }] }), { headers: { 'content-type': 'application/json' } });
  }
}
async function* convertStream(body, model) {
  const id = `chatcmpl-${crypto.randomUUID()}`, created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null, usage) => ({ id, created, model, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) });
  const decoder = new TextDecoder(); let pending = '', bytes = 0, done = false, usage;
  for await (const bytesChunk of body) {
    bytes += bytesChunk.length; if (bytes > 32 * 1024 * 1024) throw fault(502, 'TRAE 响应过大');
    pending += decoder.decode(bytesChunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(pending))) {
      const block = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
      const lines = block.split(/\r?\n/), type = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
      const raw = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'); if (!raw) continue;
      let event; try { event = JSON.parse(raw); } catch { throw fault(502, 'TRAE 事件格式不正确'); }
      if (type === 'error' || event.code || event.error) throw fault(502, 'TRAE 流中返回错误，未重复请求');
      if (type === 'output') {
        if (event.tool_calls?.length || event.multimodal_contents?.length) throw fault(502, 'TRAE 返回了当前尚未支持的工具或多模态数据');
        const delta = {};
        if (typeof (event.response ?? event.content) === 'string') delta.content = event.response ?? event.content;
        if (typeof (event.reasoning_content ?? event.reasoning) === 'string') delta.reasoning_content = event.reasoning_content ?? event.reasoning;
        if (Object.keys(delta).length) yield chunk(delta);
      }
      if (type === 'token_usage') {
        if (finite(event.prompt_tokens) && finite(event.completion_tokens) && finite(event.total_tokens)) usage = { prompt_tokens: event.prompt_tokens, completion_tokens: event.completion_tokens, total_tokens: event.total_tokens };
      }
      if (type === 'done') { done = true; yield chunk({}, event.finish_reason || 'stop', usage); yield '[DONE]'; return; }
    }
    if (pending.length > 2 * 1024 * 1024) throw fault(502, 'TRAE 单个事件过大');
  }
  if (!done) throw fault(502, 'TRAE 响应中断，未重复请求');
}
module.exports = { TraeIDE, parseQuota, parseModels, convertStream };
