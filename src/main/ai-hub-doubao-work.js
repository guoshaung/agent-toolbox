'use strict';

// Original app session stays in memory. No navigation, profile writes or global proxy changes.
const WebSocket = require('ws');
const crypto = require('node:crypto');
const PORT = 19223;
function textValue(v) {
  return typeof v === 'string' && v.length <= 120 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
}
function date(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 8.64e15 ? new Date(n).toISOString() : null;
}
function quota(body) {
  if (!body || body.code !== 0) throw Error(body?.code === 710012001 ? 'Doubao Work login expired' : 'Doubao Work quota request rejected');
  const data = body.data;
  if (!data || typeof data !== 'object') throw Error('Missing quota data');
  const groups = data.window_limit_section?.window_limit_groups;
  if (!Array.isArray(groups)) throw Error('Quota windows unavailable');
  const group = groups.find(g => g.feature_group === 'general') || groups[0];
  const windows = (Array.isArray(group?.window_limits) ? group.window_limits : []).filter(w => Number.isInteger(w.window_type)).map(w => ({
    type: w.window_type,
    label: ({ 1: '当前 5 小时', 2: '近 7 天' })[w.window_type] || `窗口 ${w.window_type}`,
    usedText: textValue(w.used_amount), totalText: textValue(w.total_amount),
    usedPercent: typeof w.used_percent === 'number' && w.used_percent >= 0 && w.used_percent <= 100 ? w.used_percent : null,
    lessThanOnePercent: w.less_than_one_percent === true,
    resetAt: date(w.end_time),
  }));
  if (!windows.length) throw Error('Quota windows unavailable');
  const sub = data.current_subscription;
  return { windows, plan: textValue(sub?.display?.short_name) || textValue(sub?.display?.product_name),
    planEndsAt: date(data.campaign_benefit_info?.benefit_end_time) || date(sub?.end_time), observedAt: new Date().toISOString() };
}
function targetAllowed(target) {
  if (target.type !== 'page') return false;
  try {
    const u = new URL(target.url);
    return ['chrome:', 'doubaowork:'].includes(u.protocol) && u.hostname === 'doubaowork-chat' && /^\/chat(?:\/|$)/.test(u.pathname);
  } catch { return false; }
}
async function connect() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw Error('Local debug endpoint unavailable');
  const raw = await response.text();
  if (raw.length > 1024 * 1024) throw Error('Unexpected debug response size');
  const targets = JSON.parse(raw);
  const target = Array.isArray(targets) && targets.find(targetAllowed);
  if (!target) throw Error('Doubao Work native chat page unavailable');
  const wsUrl = new URL(target.webSocketDebuggerUrl);
  if (wsUrl.protocol !== 'ws:' || wsUrl.hostname !== '127.0.0.1' || wsUrl.port !== String(PORT) || wsUrl.username || wsUrl.password || !wsUrl.pathname.startsWith('/devtools/page/')) throw Error('Unexpected debug socket');
  const ws = new WebSocket(wsUrl);
  let id = 0;
  let onPaused = null;
  const pending = new Map();
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string' || event.data.length > 2 * 1024 * 1024) { ws.close(); return; }
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.method === 'Fetch.requestPaused' && onPaused) { onPaused(msg.params).catch(() => {}); return; }
    const call = pending.get(msg.id); if (!call) return;
    clearTimeout(call.timer); pending.delete(msg.id);
    if (msg.error || msg.result?.exceptionDetails) call.reject(Error('Native page query failed'));
    else call.resolve(call.raw ? msg.result : msg.result?.result?.value);
  });
  const rejectAll = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Debug connection closed')); } pending.clear(); };
  ws.addEventListener('close', rejectAll);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(Error('Debug connect timeout')); }, 4000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('Debug connect failed')); }, { once: true });
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('Native page query timeout')); }, 115000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  const command = (method, params) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('Debug query timeout')); }, 10000);
    pending.set(key, { resolve, reject, timer, raw: true });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  ws.send(JSON.stringify({ id: ++id, method: 'Network.enable', params: {} }));
  return { evaluate, command, setPaused: handler => { onPaused = handler; }, close: () => ws.close() };
}

const fail = (status, message) => Object.assign(new Error(message), { status });
const MODEL = 'doubao-work-auto';
function promptOf(body) {
  if (body.tools || body.tool_choice || body.functions || body.response_format || (body.n != null && body.n !== 1)) throw fail(400, '豆包工作桥接暂不支持工具调用协议、结构化输出或多候选');
  if (!Array.isArray(body.messages) || !body.messages.length || !body.messages.every(m => ['user', 'assistant', 'system', 'developer'].includes(m.role) && typeof m.content === 'string')) throw fail(400, '豆包工作桥接目前仅支持文本消息');
  if (body.model !== MODEL) throw fail(400, '豆包工作暂仅验证了客户端自动模型');
  const prompt = body.messages.length === 1 && body.messages[0].role === 'user' ? body.messages[0].content : body.messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
  if (!prompt.trim() || Buffer.byteLength(prompt) > 128 * 1024) throw fail(400, '豆包工作文本为空或过长');
  return prompt;
}
function payloadFor(prompt) {
  const messageId = crypto.randomUUID();
  const task = { action: 0, thread_local_message_id: [messageId], client_option: { enable_sandbox: false, os: 'Windows', shared_folder_path: [] }, runtime_type: 2, agent_task_param: { runtime_type: 2 }, agent_task_param_change: { runtime_changed: true, device_changed: false, sandbox_auth_type_changed: false }, need_modify_conversation: false, task_input_json: '{"project_context":{}}' };
  return {
    client_meta: { local_conversation_id: 'local_' + crypto.randomInt(1e14), conversation_id: '', bot_id: '7338286299411103781', last_section_id: '', last_message_index: null },
    messages: [{ local_message_id: messageId, content_block: [{ block_type: 10000, content: { text_block: { text: prompt, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' }, block_id: crypto.randomUUID(), parent_id: '', meta_info: [], append_fields: [] }], message_status: 0 }],
    option: { create_time_ms: Date.now(), unique_key: crypto.randomUUID(), agent_mode: 1, need_deep_think: 9, need_create_conversation: true, start_seq: 0, general_task_param: task, model_config: { model_item_key: '9', model_extra_params: { total_window_size: '256000' }, reasoning_effort: 3 }, aggregate_params: { conversation_mode: '', mode_id: '3', model_item_key: '9', agent_mode: '1', reasoning_effort: '3', provider_id: '' }, sse_recv_event_options: { support_chunk_delta: true }, connector_info_list: [] },
    ext: { general_task_param: JSON.stringify(task), use_deep_think: '9', agent_mode: '1', is_finish: '1', commerce_credit_config_enable: '0', sub_conv_firstmet_type: '1', conversation_init_option: '{"need_ack_conversation":true}' }, user_context: []
  };
}
function parseReply(raw) {
  let event = '', ended = false, content = '', reasoning = '', thinking = false, markers = 0;
  for (const frame of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    let data = '';
    for (const line of frame.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); if (line.startsWith('data:')) data += line.slice(5).trim(); }
    if (!data || data === '[DONE]') continue;
    let b; try { b = JSON.parse(data); } catch { throw fail(502, '豆包回复事件格式异常'); }
    if (event === 'STREAM_ERROR' || b.error_code || b.code) throw fail(b.error_code === 710022004 ? 429 : 502, `豆包拒绝请求（${Number(b.error_code || b.code) || '未知错误'}）`);
    if (event === 'SSE_REPLY_END' && b.answer_finish_attr) ended = true;
    const append = value => { if (thinking) reasoning += value; else content += value; };
    if (event === 'CHUNK_DELTA' && typeof b.text === 'string') append(b.text);
    if (event === 'STREAM_CHUNK' || event === 'STREAM_MSG_NOTIFY') {
      const blocks = [...(b.content?.content_block || []), ...(b.patch_op || []).flatMap(p => p.patch_value?.content_block || [])];
      for (const block of blocks) {
        if (block.block_type === 10040) { thinking = ++markers === 1; continue; }
        if (block.block_type === 10000 && typeof block.content?.text_block?.text === 'string') append(block.content.text_block.text);
      }
    }
  }
  if (!ended || !content) throw fail(502, '豆包未返回完整文本回答，未计为成功');
  return { content, ...(reasoning ? { reasoning_content: reasoning } : {}) };
}
async function limited(response, max = 8 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const b of response.body) { size += b.length; if (size > max) throw fail(502, '豆包响应过大'); chunks.push(Buffer.from(b)); }
  return Buffer.concat(chunks).toString('utf8');
}
class DoubaoWork {
  constructor({ fetchImpl = fetch, connectImpl = connect } = {}) { this.fetch = fetchImpl; this.connect = connectImpl; this.busy = false; }
  async session(cdp, identity, signal) {
    const url = 'https://www.doubao.com/alice/commerce/sale/subscription/overview/?aid=1044603';
    const result = await cdp.command('Network.getCookies', { urls: [url] });
    const cookies = (result.cookies || []).filter(c => ['.doubao.com', 'doubao.com', 'www.doubao.com'].includes(c.domain));
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (!cookie) throw fail(401, '请先在豆包工作中登录');
    const r = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}', redirect: 'error', signal });
    if (!r.ok) throw fail(r.status, `豆包额度查询失败（HTTP ${r.status}）`);
    let b; try { b = JSON.parse(await limited(r, 1024 * 1024)); } catch { throw fail(502, '豆包额度格式异常'); }
    const snapshot = quota(b);
    const account = b.data?.current_subscription?.merchant_user_id || cookies.find(c => c.name === 'uid_tt')?.value || cookies.find(c => c.name === 'sid_tt')?.value;
    if (!account) throw fail(401, '无法确认豆包账号，请在客户端重新登录');
    const fingerprint = crypto.createHash('sha256').update('doubao-work|' + account).digest('hex');
    if (identity && identity.fingerprint !== fingerprint) throw fail(401, '豆包工作账号已变化，请重新连接');
    return { cookie, fingerprint, quota: { ...snapshot, updatedAt: snapshot.observedAt, source: 'api' } };
  }
  async inspect(identity) {
    const cdp = await this.connect().catch(() => { throw fail(503, '豆包工作未开放本机连接，请按接入说明启动客户端'); });
    try { const session = await this.session(cdp, identity, AbortSignal.timeout(15000)); return { fingerprint: session.fingerprint, quota: session.quota, models: [MODEL] }; }
    finally { cdp.close(); }
  }
  async chat(identity, body, externalSignal) {
    const prompt = promptOf(body);
    if (this.busy) throw fail(429, '豆包工作正在处理上一条请求，请稍后再试');
    this.busy = true;
    const abort = new AbortController(); const onAbort = () => abort.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    if (externalSignal?.aborted) abort.abort();
    const timer = setTimeout(onAbort, 110000);
    let cdp, intercepting = false;
    const operation = '__toolbox_' + crypto.randomUUID().replace(/-/g, '');
    abort.signal.addEventListener('abort', () => { if (cdp) cdp.evaluate(`window[${JSON.stringify(operation)}]?.abort()`).catch(() => {}); }, { once: true });
    try {
      cdp = await this.connect();
      const { cookie } = await this.session(cdp, identity, abort.signal);
      const webId = await cdp.evaluate(`(() => { try { return JSON.parse(localStorage.getItem('samantha_web_web_id') || '{}').web_id || ''; } catch { return ''; } })()`);
      const payload = payloadFor(prompt);
      const query = new URLSearchParams({ aid: '1044603', real_aid: '1044603', device_platform: 'web', doubao_device_platform: 'desktop', web_id: String(webId), version_code: '20800', language: 'zh' });
      cdp.setPaused(async event => {
        let ours = false;
        try {
          const u = new URL(event.request.url);
          let posted; try { posted = JSON.parse(event.request.postData); } catch {}
          ours = u.origin === 'https://www.doubao.com' && u.pathname === '/chat/completion' && event.request.method === 'POST' && posted?.option?.unique_key === payload.option.unique_key;
          if (!ours) { await cdp.command('Fetch.continueRequest', { requestId: event.requestId }); return; }
          const headers = { ...event.request.headers, Cookie: cookie };
          for (const key of Object.keys(headers)) if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) delete headers[key];
          const upstream = await this.fetch(u, { method: 'POST', headers, body: event.request.postData, redirect: 'error', signal: abort.signal });
          const raw = await limited(upstream);
          await cdp.command('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: upstream.status, responseHeaders: [{ name: 'Content-Type', value: upstream.headers.get('content-type') || 'application/json' }], body: Buffer.from(raw).toString('base64') });
        } catch { if (ours) await cdp.command('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }).catch(() => {}); }
      });
      await cdp.command('Fetch.enable', { patterns: [{ urlPattern: 'https://www.doubao.com/chat/completion*', requestStage: 'Request' }] }); intercepting = true;
      const result = await cdp.evaluate(`(async () => { const key=${JSON.stringify(operation)}; const controller=new AbortController(); window[key]=controller; try { const r=await fetch(${JSON.stringify('https://www.doubao.com/chat/completion?' + query)}, {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:${JSON.stringify(JSON.stringify(payload))}, signal:controller.signal}); return {status:r.status,raw:await r.text()}; } finally { delete window[key]; } })()`);
      if (result.status !== 200) throw fail(result.status, `豆包请求失败（HTTP ${result.status}）`);
      const message = { role: 'assistant', ...parseReply(result.raw) };
      const base = { id: 'chatcmpl-' + crypto.randomUUID(), created: Math.floor(Date.now() / 1000), model: MODEL };
      if (!body.stream) return new Response(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
      // This first adapter buffers the native reply. It does not claim live token streaming or invented usage.
      const chunk = { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] };
      const end = { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    } finally {
      abort.abort(); clearTimeout(timer); externalSignal?.removeEventListener('abort', onAbort);
      if (cdp) {
        await cdp.evaluate(`window[${JSON.stringify(operation)}]?.abort(); delete window[${JSON.stringify(operation)}]`).catch(() => {});
        if (intercepting) await cdp.command('Fetch.disable', {}).catch(() => {});
        cdp.close();
      }
      this.busy = false;
    }
  }
}
module.exports = { DoubaoWork, quota, parseReply, promptOf, targetAllowed, MODEL };
