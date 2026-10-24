'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const GATEWAY = 'https://gateway.qwenwork.cn';
const fault = (status, message) => Object.assign(new Error(message), { status });
function childJSON(exe, args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(fault(503, 'QwenWork 本机组件超时')); }, 20000);
    child.stdout.on('data', b => { out += b; if (out.length > 16 * 1024 * 1024) { child.kill(); finish(fault(502, 'QwenWork 本机组件输出过大')); } });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(fault(503, '无法启动 QwenWork 本机组件')));
    child.on('close', code => { if (code !== 0) return finish(fault(503, 'QwenWork 本机组件执行失败')); try { finish(null, JSON.parse(out.trim().replace(/^\uFEFF/, ''))); } catch { finish(fault(502, 'QwenWork 本机组件响应无效')); } });
    child.stdin.end(input);
  });
}
function findWasm() {
  const roots = ['C:/QwenWorkCN', 'D:/QwenWorkCN', 'E:/QwenWorkCN', path.join(process.env.LOCALAPPDATA || '', 'Programs/QwenWorkCN'), path.join(process.env.ProgramFiles || 'C:/Program Files', 'QwenWorkCN')];
  const candidates = [];
  for (const root of roots) {
    let names; try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of ['', ...names.filter(n => /^\d+\.\d+\.\d+/.test(n))]) {
      const file = path.join(root, name, 'resources/qoder-auth-wasm/qoder_auth_wasm_bg.wasm');
      if (fs.existsSync(file)) candidates.push({ file, name });
    }
  }
  candidates.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  if (!candidates.length) throw fault(503, '未找到 QwenWork 客户端请求组件，请先安装客户端');
  return candidates[0].file;
}
async function localAuth(identity, directory = path.join(process.env.APPDATA || '', 'QwenWorkCN')) {
  let state, raw; try { state = JSON.parse(fs.readFileSync(path.join(directory, 'Local State'), 'utf8')); raw = fs.readFileSync(path.join(directory, 'auth-v2.dat')); } catch { throw fault(401, '请先在 QwenWork 国内版客户端登录'); }
  if (raw.subarray(0, 3).toString() !== 'v10' || raw.length < 32) throw fault(401, 'QwenWork 登录格式暂不支持');
  const wrapped = Buffer.from(state.os_crypt?.encrypted_key || '', 'base64');
  if (wrapped.subarray(0, 5).toString() !== 'DPAPI') throw fault(401, 'QwenWork 系统凭据格式暂不支持');
  const script = 'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $k=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ConvertTo-Json -Compress -InputObject ([Convert]::ToBase64String($k))';
  const key = Buffer.from(await childJSON('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], wrapped.subarray(5).toString('base64')), 'base64');
  let doc;
  try { const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(3, 15)); d.setAuthTag(raw.subarray(-16)); doc = JSON.parse(Buffer.concat([d.update(raw.subarray(15, -16)), d.final()]).toString()); } catch { throw fault(401, 'QwenWork 本机登录无法读取，请在客户端重新登录'); } finally { key.fill(0); }
  const token = doc.token || doc.accessToken;
  let claims; try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { throw fault(401, 'QwenWork 登录令牌无效'); }
  const uid = String(doc.user?.id || doc.user?.uid || claims.sub || claims.uid || '');
  const expires = claims.exp ? claims.exp * 1000 : Date.parse(doc.expiresAt);
  if (!uid || !doc.loginDeviceId || !Number.isFinite(expires) || expires <= Date.now() + 10000) throw fault(401, 'QwenWork 登录已到期，请在原客户端刷新登录');
  const fingerprint = crypto.createHash('sha256').update('qwenwork|' + uid).digest('hex');
  if (identity && identity.fingerprint !== fingerprint) throw fault(401, 'QwenWork 账号已变化，请重新连接');
  return { uid, token, machineId: doc.loginDeviceId, fingerprint, expiresAt: new Date(expires).toISOString() };
}
function parseQuota(body) {
  const d = body?.data;
  if (!d || body.success === false) throw fault(502, 'QwenWork 积分查询失败');
  const pools = ['daily_credits', 'monthly_credits', 'longterm_credits'].map((key, i) => {
    const value = d[key]?.total_balance;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw fault(502, 'QwenWork 积分字段缺失，未以零代替');
    return { name: ['每日积分', '订阅积分', '长期积分'][i], remaining: value };
  });
  return { remaining: pools.reduce((n, p) => n + p.remaining, 0), unit: 'credits', pools, source: 'api', updatedAt: new Date().toISOString(), resetAt: null };
}
function buildBody(body) {
  if (!Array.isArray(body.messages) || !body.messages.length || !body.messages.every(m => ['system', 'developer', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')) throw fault(400, 'QwenWork 首版仅支持文本对话');
  if (body.tools || body.functions || body.tool_choice || body.response_format || (body.n != null && body.n !== 1)) throw fault(400, 'QwenWork 暂不支持工具调用协议和结构化输出');
  const id = crypto.randomUUID(), text = [...body.messages].reverse().find(m => m.role === 'user')?.content || '';
  return { request_id: id, request_set_id: id, chat_record_id: id, session_id: crypto.randomUUID(), stream: true, chat_task: 'FREE_INPUT',
    chat_context: { text, features: [], extra: { context: [], modelConfig: { key: body.model, is_reasoning: false }, originalContent: text, chatPrompt: '' }, chatPrompt: '', imageUrls: null },
    is_reply: true, is_retry: false, source: 1, version: '3', agent_id: 'agent_common', task_id: 'common', session_type: 'qoder_work', aliyun_user_type: '',
    model_config: { key: body.model, display_name: body.model, model: '', format: 'openai', is_vl: false, is_reasoning: false, api_key: '', url: '', source: 'system', max_input_tokens: 1000000 },
    business: { product: 'qoder_work', version: '1.1.52', type: 'agent', id: crypto.randomUUID(), name: '', begin_at: Date.now(), stage: 'processing' },
    system: body.messages.filter(m => ['system', 'developer'].includes(m.role)).map(m => m.content).join('\n'), messages: body.messages.map(m => ({ role: m.role === 'developer' ? 'system' : m.role, content: m.content })), parameters: { max_tokens: body.max_tokens ?? 4096, ...(body.temperature != null ? { temperature: body.temperature } : {}) } };
}
function parseStream(raw, model) {
  let content = '', reasoning = '', usage, finish;
  for (const frame of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    const text = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!text || text === '[DONE]') continue;
    let outer; try { outer = JSON.parse(text); } catch { throw fault(502, 'QwenWork 回复格式异常'); }
    if (Number(outer.statusCodeValue) >= 400 || outer.error || (outer.code != null && ![0, 200, '0', '200', 'SUCCESS'].includes(outer.code))) throw fault(Number(outer.statusCodeValue) === 429 ? 429 : 502, 'QwenWork 上游拒绝请求');
    let inner = outer.body ?? outer;
    if (typeof inner === 'string') { if (!inner || inner === '[DONE]') continue; try { inner = JSON.parse(inner); } catch { throw fault(502, 'QwenWork 内层回复格式异常'); } }
    if (inner?.error || (inner?.code != null && ![0, 200, '0', '200', 'SUCCESS'].includes(inner.code))) throw fault(502, 'QwenWork 返回业务错误');
    if (inner?.usage) usage = inner.usage;
    const c = inner?.choices?.[0];
    if (c?.delta?.tool_calls) throw fault(502, 'QwenWork 返回了尚不支持的工具调用');
    if (typeof c?.delta?.content === 'string') content += c.delta.content;
    if (typeof c?.delta?.reasoning_content === 'string') reasoning += c.delta.reasoning_content;
    if (c?.finish_reason) finish = c.finish_reason;
  }
  if (!finish || !content) throw fault(502, 'QwenWork 回答未完整结束');
  return { id: 'chatcmpl-' + crypto.randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: finish }], ...(usage ? { usage } : {}) };
}
async function read(response, limit = 16 * 1024 * 1024) { let size = 0; const chunks = []; for await (const c of response.body) { size += c.length; if (size > limit) throw fault(502, 'QwenWork 响应过大'); chunks.push(Buffer.from(c)); } return Buffer.concat(chunks).toString(); }
class QwenWork {
  constructor({ fetchImpl = fetch, authReader = localAuth } = {}) { this.fetch = fetchImpl; this.authReader = authReader; }
  async prepare(auth, mode, body, model) {
    let helper = path.join(__dirname, 'vendor/qwenwork-wasm.mjs');
    const unpacked = helper.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); if (fs.existsSync(unpacked)) helper = unpacked;
    const built = await childJSON(process.execPath, [helper], JSON.stringify({ wasm: findWasm(), auth, mode, body, model }), { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
    const u = new URL(built.url);
    if (u.origin !== GATEWAY || u.username || u.password || !['/api/v2/model/list', '/algo/api/v2/model/list', '/algo/api/v2/service/pro/sse/agent_chat_generation'].includes(u.pathname)) throw fault(502, 'QwenWork 请求地址异常：' + u.origin + u.pathname);
    return built;
  }
  async models(auth) {
    const b = await this.prepare(auth, 'req');
    const r = await this.fetch(b.url, { headers: b.headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw fault(r.status, `QwenWork 模型查询失败（${r.status}）`);
    const j = JSON.parse(await read(r, 1024 * 1024));
    const list = (j.data || j).qwork;
    if (!Array.isArray(list)) throw fault(502, 'QwenWork 未返回模型目录');
    const models = list.filter(m => m.enable !== false && typeof m.key === 'string').map(m => m.key);
    if (!models.length) throw fault(502, 'QwenWork 当前没有可用模型');
    return models;
  }
  async quota(auth) {
    const r = await this.fetch('https://qwenwork.cn/user/wallets', { headers: { Authorization: 'Bearer ' + auth.token, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw fault(r.status, `QwenWork 积分查询失败（${r.status}）`);
    return parseQuota(JSON.parse(await read(r, 1024 * 1024)));
  }
  async inspect(identity) {
    const auth = await this.authReader(identity);
    const [models, quota] = await Promise.all([this.models(auth), this.quota(auth)]);
    return { fingerprint: auth.fingerprint, expiresAt: auth.expiresAt, models, quota };
  }
  async chat(identity, body, signal) {
    const payload = buildBody(body), auth = await this.authReader(identity);
    const b = await this.prepare(auth, 'infer', payload, body.model);
    signal?.throwIfAborted();
    const r = await this.fetch(b.url, { method: 'POST', headers: b.headers, body: b.body, redirect: 'error', signal });
    if (!r.ok) return r;
    const result = parseStream(await read(r), body.model);
    if (!body.stream) return Response.json(result);
    const base = { id: result.id, object: 'chat.completion.chunk', created: result.created, model: result.model };
    const chunk = { ...base, choices: [{ index: 0, delta: result.choices[0].message, finish_reason: null }] };
    const end = { ...base, choices: [{ index: 0, delta: {}, finish_reason: result.choices[0].finish_reason }], ...(result.usage ? { usage: result.usage } : {}) };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
}
module.exports = { QwenWork, localAuth, parseQuota, parseStream, buildBody };
