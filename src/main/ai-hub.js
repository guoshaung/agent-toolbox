'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { WorkBuddyCN } = require('./ai-hub-workbuddy');
const { TraeIDE } = require('./ai-hub-trae');
const { DoubaoWork } = require('./ai-hub-doubao-work');
const { QwenWork } = require('./ai-hub-qwenwork');

const CATALOG = [
  { id: 'workbuddy', name: 'WorkBuddy 国内版', url: 'https://www.codebuddy.cn/docs/cli/sdk', note: '可在浏览器授权登录，读取个人模型列表和 credits。登录后先选模型并启用，再测试调用；上游拒绝时会直接显示失败。' },
  { id: 'trae', name: 'TRAE 国际版 IDE', url: 'https://docs.trae.ai/', note: '只读连接本机已登录的国际版代码编辑器，查询 IDE 套餐及模型。支持文本对话；不混用独立 SOLO／Work 额度。' },
  { id: 'doubao-work', name: '豆包工作', url: 'https://www.doubao.com/work', note: '连接本机已登录客户端，查询 5 小时／7 天额度，使用工作 Agent 自动模型。仅文本，完整回复后返回；客户端需保持运行。首次连接或重启后使用下方启动按钮；若客户端已经运行，请先从托盘退出。' },
  { id: 'qianwen-work', name: 'QwenWork 国内版', url: 'https://qwenwork.cn/', note: '只读连接本机 QwenWork 登录，查询实际模型与每日／订阅／长期积分。首版支持文本，完整回答后返回；登录过期请在原客户端重新登录。' },
];
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 32 * 1024 * 1024;
const fault = (status, message) => Object.assign(new Error(message), { status });
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function endpoint(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { throw fault(400, '请填写有效的 Base URL'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) || u.username || u.password || u.search || u.hash) {
    throw fault(400, '远程服务须使用 HTTPS；本地服务可使用 HTTP。地址中不要包含账号、查询参数或片段');
  }
  u.pathname = u.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  if (!u.pathname || u.pathname === '/') u.pathname = '/v1';
  return u.href.replace(/\/$/, '');
}
async function readLimited(body, limit) {
  let size = 0; const chunks = [];
  for await (const piece of body) {
    const b = Buffer.from(piece); size += b.length;
    if (size > limit) throw fault(413, '数据超过大小限制');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function at(object, dotted) {
  return String(dotted || '').split('.').reduce((v, key) => v && Object.hasOwn(v, key) ? v[key] : undefined, object);
}

class AiHub {
  constructor({ directory, safeStorage, currentApi = () => ({}), fetchImpl = fetch, timeoutMs = 120000, traeStorageFile }) {
    this.file = path.join(directory, 'state.json');
    this.safeStorage = safeStorage; this.currentApi = currentApi; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
    this.server = null; this.starting = null; this.controllers = new Set(); this.inflight = 0; this.token = ''; this.cooldowns = new Map();
    this.workbuddy = new WorkBuddyCN({ fetchImpl }); this.renewals = new Map(); this.loginTarget = null;
    this.trae = new TraeIDE({ fetchImpl, storageFile: traeStorageFile });
    this.doubao = new DoubaoWork({ fetchImpl });
    this.qwenwork = new QwenWork({ fetchImpl });
    this.state = { version: 1, channels: [], requests: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.channels) || !Array.isArray(saved.requests)) throw Error('schema');
      this.state = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw Error('额度中枢配置无法读取，已保留原文件，请先检查该文件'); }
  }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  seal(value) {
    if (!this.safeStorage?.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw fault(503, '系统安全存储不可用，未保存密钥');
    return this.safeStorage.encryptString(value).toString('base64');
  }
  unseal(value) {
    if (!value || !this.safeStorage?.isEncryptionAvailable()) return '';
    try { return this.safeStorage.decryptString(Buffer.from(value, 'base64')); } catch { return ''; }
  }
  resolved(channel) {
    if (channel.source === 'qwenwork-cn') return { ...channel, key: this.unseal(channel.accountEncrypted) ? 'local-app-session' : '' };
    if (channel.source === 'doubao-work') return { ...channel, key: this.unseal(channel.accountEncrypted) ? 'local-app-session' : '' };
    if (channel.source === 'trae-ide') {
      let auth; try { auth = this.traeAuth(channel); } catch { /* unavailable stays out of routing */ }
      return { ...channel, baseUrl: auth?.region === 'US' ? 'https://coreva-normal.trae.ai' : 'https://coresg-normal.trae.ai', key: auth?.token || '' };
    }
    if (channel.source === 'current') {
      const config = this.currentApi();
      return { ...channel, baseUrl: config.baseUrl || '', model: config.model || '', key: config.key || '' };
    }
    if (channel.source === 'workbuddy-cn') {
      let auth; try { auth = JSON.parse(this.unseal(channel.accountEncrypted)); } catch { /* invalid credentials remain unavailable */ }
      return { ...channel, baseUrl: 'https://copilot.tencent.com/v2', key: auth?.accessToken || '' };
    }
    return { ...channel, key: this.unseal(channel.keyEncrypted) };
  }
  usable(channel) {
    try { return Boolean(channel.enabled && channel.model && channel.key && endpoint(channel.baseUrl)); } catch { return false; }
  }
  status() {
    return { running: Boolean(this.server?.listening), baseUrl: this.server?.listening ? `http://127.0.0.1:${this.server.address().port}/v1` : '', inflight: this.inflight,
      catalog: CATALOG, channels: this.state.channels.map(c => {
        const v = this.resolved(c); const { keyEncrypted, accountEncrypted, key, ...visible } = v;
        return { ...visible, hasKey: Boolean(key), ready: this.usable(v), cooldownUntil: this.cooldowns.get(c.id) || 0 };
      }), requests: this.state.requests.slice(-40).reverse() };
  }
  save(input) {
    if (!input || typeof input !== 'object') throw fault(400, '无效通道');
    const previous = input.id ? this.state.channels.find(c => c.id === input.id) : null;
    if (input.id && !previous) throw fault(404, '通道不存在');
    if (!previous && this.state.channels.length >= 24) throw fault(400, '最多配置 24 个通道');
    const source = previous?.source || (input.source === 'current' ? 'current' : 'api');
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw fault(400, '请填写通道名称');
    const model = String(input.model || '').trim().slice(0, 150);
    const account = ['workbuddy-cn', 'trae-ide', 'doubao-work', 'qwenwork-cn'].includes(source);
    const baseUrl = account ? previous.baseUrl : source === 'current' ? '' : (input.baseUrl ? endpoint(input.baseUrl) : '');
    const priority = Number(input.priority ?? 50);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) throw fault(400, '优先级应为 0–999 的整数');
    let keyEncrypted = previous?.keyEncrypted || '';
    if (source === 'api' && input.clearKey) keyEncrypted = '';
    if (source === 'api' && input.apiKey) {
      const key = String(input.apiKey).trim();
      if (key.length > 8192 || /[\r\n]/.test(key)) throw fault(400, '密钥格式无效');
      keyEncrypted = this.seal(key);
    }
    const quotaPath = account ? '' : String(input.quotaPath || '').trim();
    const remainingPath = String(input.remainingPath || '').trim();
    const quotaUnit = String(input.quotaUnit || 'credits').trim().slice(0, 30);
    if (quotaPath) {
      if (!baseUrl || !quotaPath.startsWith('/') || quotaPath.startsWith('//') || quotaPath.includes('\\') || new URL(quotaPath, baseUrl).origin !== new URL(baseUrl).origin) throw fault(400, '额度路径必须是同一服务下的 /path，不可跳转到其他站点');
      if (!/^[a-zA-Z0-9_.]{1,100}$/.test(remainingPath)) throw fault(400, '请填写余额字段路径，例如 data.remaining');
    }
    const channel = { id: previous?.id || crypto.randomUUID(), source, provider: CATALOG.some(p => p.id === input.provider) ? input.provider : 'custom', name, model, baseUrl,
      priority, enabled: Boolean(input.enabled), keyEncrypted, quotaPath, remainingPath, quotaUnit,
      quota: previous?.quota || null, stats: previous?.stats || { attempts: 0, completed: 0, failures: 0, inputTokens: 0, outputTokens: 0, usageResponses: 0, since: new Date().toISOString() } };
    if (account) Object.assign(channel, { provider: previous.provider, accountEncrypted: previous.accountEncrypted, accountExpiresAt: previous.accountExpiresAt, models: previous.models || [], accountNote: previous.accountNote || '' });
    if (source === 'trae-ide' && model && !channel.models.includes(model)) throw fault(400, '请使用 TRAE 实际返回的模型');
    if (source === 'doubao-work' && model !== 'doubao-work-auto') throw fault(400, '豆包工作目前仅验证自动模型');
    if (source === 'qwenwork-cn' && !channel.models.includes(model)) throw fault(400, '请选择 QwenWork 实际返回的模型');
    if (channel.enabled && !this.usable(this.resolved(channel))) throw fault(400, '启用前请补全服务地址、模型和密钥');
    if (!account && previous && (previous.baseUrl !== baseUrl || previous.model !== model || previous.quotaPath !== quotaPath || previous.remainingPath !== remainingPath || previous.quotaUnit !== quotaUnit || input.apiKey || input.clearKey)) channel.quota = null;
    this.state.channels = [...this.state.channels.filter(c => c.id !== channel.id), channel]; this.persist(); this.cooldowns.delete(channel.id);
    return this.status();
  }
  remove(id) { this.state.channels = this.state.channels.filter(c => c.id !== id); this.cooldowns.delete(id); this.persist(); return this.status(); }
  doubaoIdentity(channel) {
    let identity; try { identity = JSON.parse(this.unseal(channel.accountEncrypted)); } catch {}
    if (!identity?.fingerprint) throw fault(401, '请重新连接豆包工作');
    return identity;
  }
  qwenIdentity(channel) {
    let identity; try { identity = JSON.parse(this.unseal(channel.accountEncrypted)); } catch {}
    if (!identity?.fingerprint) throw fault(401, '请重新连接 QwenWork');
    return identity;
  }
  async connectQwenWork() {
    const info = await this.qwenwork.inspect();
    const old = this.state.channels.find(c => c.source === 'qwenwork-cn');
    if (!old && this.state.channels.length >= 24) throw fault(400, '通道数量已满');
    const c = { id: old?.id || crypto.randomUUID(), source: 'qwenwork-cn', provider: 'qianwen-work', name: 'QwenWork 国内版', baseUrl: 'https://gateway.qwenwork.cn', model: info.models.includes('flash') ? 'flash' : info.models[0], enabled: false, priority: old?.priority ?? 80,
      accountEncrypted: this.seal(JSON.stringify({ fingerprint: info.fingerprint })), accountExpiresAt: info.expiresAt, keyEncrypted: '', quotaPath: '', remainingPath: '', quotaUnit: 'credits', models: info.models, quota: info.quota,
      accountNote: '只读使用原客户端登录；仅文本，完整回答后返回。过期后请在 QwenWork 刷新登录，账号变化需重新连接。',
      stats: { attempts: 0, completed: 0, failures: 0, inputTokens: 0, outputTokens: 0, usageResponses: 0, since: new Date().toISOString() } };
    this.state.channels = [...this.state.channels.filter(v => v.id !== c.id), c]; this.persist();
    return { ...this.status(), channelId: c.id };
  }
  openDoubao() {
    if (process.platform !== 'win32') throw fault(400, '此启动入口目前支持 Windows');
    const executable = path.join(process.env.LOCALAPPDATA || '', 'DoubaoWork', 'Application', 'DoubaoWork.exe');
    if (!fs.existsSync(executable)) throw fault(404, '未找到豆包工作客户端');
    const child = require('node:child_process').spawn(executable, ['--remote-debugging-port=19223', '--remote-debugging-address=127.0.0.1'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); child.unref(); return this.status();
  }
  async connectDoubao() {
    const info = await this.doubao.inspect();
    const old = this.state.channels.find(c => c.source === 'doubao-work');
    if (!old && this.state.channels.length >= 24) throw fault(400, '通道数量已满');
    const c = { id: old?.id || crypto.randomUUID(), source: 'doubao-work', provider: 'doubao-work', name: '豆包工作', baseUrl: 'https://www.doubao.com', model: 'doubao-work-auto', enabled: false, priority: old?.priority ?? 70,
      accountEncrypted: this.seal(JSON.stringify({ fingerprint: info.fingerprint })), keyEncrypted: '', quotaPath: '', remainingPath: '', quotaUnit: '', models: info.models, quota: info.quota,
      accountNote: '由豆包工作 Agent 执行；客户端权限和确认仍生效。仅文本，历史按文本拼接，等待完整回复后返回；不提供 Token 统计。',
      stats: { attempts: 0, completed: 0, failures: 0, inputTokens: 0, outputTokens: 0, usageResponses: 0, since: new Date().toISOString() } };
    this.state.channels = [...this.state.channels.filter(v => v.id !== c.id), c]; this.persist();
    return { ...this.status(), channelId: c.id };
  }
  traeAuth(channel) {
    let identity; try { identity = JSON.parse(this.unseal(channel.accountEncrypted)); } catch { throw fault(401, 'TRAE 账号绑定无法读取，请重新连接本机 IDE'); }
    if (!identity?.fingerprint) throw fault(401, 'TRAE 账号未绑定');
    return this.trae.localAuth(identity);
  }
  async connectTrae() {
    const auth = this.trae.localAuth();
    const previous = this.state.channels.find(c => c.source === 'trae-ide');
    if (!previous && this.state.channels.length >= 24) throw fault(400, '通道数量已满');
    const channel = { id: previous?.id || crypto.randomUUID(), source: 'trae-ide', provider: 'trae', name: 'TRAE 国际版 IDE',
      baseUrl: auth.region === 'US' ? 'https://coreva-normal.trae.ai' : 'https://coresg-normal.trae.ai', model: '', enabled: false, priority: previous?.priority ?? 60,
      accountEncrypted: this.seal(JSON.stringify({ fingerprint: auth.fingerprint, region: auth.region })), accountExpiresAt: auth.expiresAt,
      keyEncrypted: '', quotaPath: '', remainingPath: '', quotaUnit: '', models: [], quota: null,
      stats: { attempts: 0, completed: 0, failures: 0, inputTokens: 0, outputTokens: 0, usageResponses: 0, since: new Date().toISOString() } };
    this.state.channels = [...this.state.channels.filter(c => c.id !== channel.id), channel]; this.persist();
    await this.refreshTrae(channel.id); return { ...this.status(), channelId: channel.id };
  }
  async refreshTrae(id) {
    const c = this.state.channels.find(v => v.id === id && v.source === 'trae-ide');
    if (!c) throw fault(404, 'TRAE 通道不存在');
    const auth = this.traeAuth(c);
    const [models, quota] = await Promise.allSettled([this.trae.models(auth), this.trae.quota(auth)]);
    if (this.state.channels.find(v => v.id === id) !== c) throw fault(409, '通道已修改，请重新刷新');
    const notes = [];
    if (models.status === 'fulfilled') { c.models = models.value; if (!c.models.includes(c.model)) { c.model = c.models.includes('deepseek-v3.2') ? 'deepseek-v3.2' : c.models[0] || ''; c.enabled = false; } }
    else notes.push('模型目录读取失败');
    if (quota.status === 'fulfilled') c.quota = quota.value; else notes.push('额度查询失败，保留上次数据');
    c.accountExpiresAt = auth.expiresAt; c.accountNote = notes.join('；'); this.persist(); return this.status();
  }
  async loginStart(id) {
    if (id && !this.state.channels.some(c => c.id === id && c.source === 'workbuddy-cn')) throw fault(404, 'WorkBuddy 通道不存在');
    this.seal('storage-availability-check');
    const login = await this.workbuddy.begin(); this.loginTarget = { loginId: login.loginId, id: id || null }; return login;
  }
  loginCancel() { this.workbuddy.cancel(); this.loginTarget = null; return {}; }
  async loginPoll(loginId) {
    const target = this.loginTarget;
    if (!target || target.loginId !== loginId) throw fault(400, '登录已取消');
    const auth = await this.workbuddy.poll(loginId);
    if (!auth) return { loginStatus: 'pending' };
    if (this.loginTarget !== target) throw fault(400, '登录已取消');
    const previous = target.id ? this.state.channels.find(c => c.id === target.id) : null;
    if (target.id && !previous) throw fault(409, '原通道已被删除，未保存本次授权');
    if (!previous && this.state.channels.length >= 24) throw fault(400, '通道数量已满，未保存授权');
    const channel = { id: previous?.id || crypto.randomUUID(), source: 'workbuddy-cn', provider: 'workbuddy', name: previous?.name || 'WorkBuddy 国内版',
      baseUrl: 'https://copilot.tencent.com/v2', model: previous?.model || '', enabled: false, priority: previous?.priority ?? 50,
      accountEncrypted: this.seal(JSON.stringify(auth)), accountExpiresAt: auth.expiresAt, keyEncrypted: '', quotaPath: '', remainingPath: '', quotaUnit: 'credits',
      models: [], quota: null, stats: previous?.stats || { attempts: 0, completed: 0, failures: 0, inputTokens: 0, outputTokens: 0, usageResponses: 0, since: new Date().toISOString() } };
    this.state.channels = [...this.state.channels.filter(c => c.id !== channel.id), channel]; this.persist(); this.loginTarget = null;
    await this.refreshAccount(channel.id);
    return { ...this.status(), loginStatus: 'connected', channelId: channel.id };
  }
  async workbuddyAuth(id) {
    const c = this.state.channels.find(v => v.id === id && v.source === 'workbuddy-cn');
    if (!c) throw fault(404, 'WorkBuddy 通道不存在');
    let auth; try { auth = JSON.parse(this.unseal(c.accountEncrypted)); } catch { throw fault(401, '登录凭据无法解密，请重新登录'); }
    if (auth.expiresAt > Date.now() + 60000) return auth;
    if (!this.renewals.has(id)) {
      const saved = c.accountEncrypted;
      const promise = this.workbuddy.renew(auth).then(next => {
        const current = this.state.channels.find(v => v.id === id);
        if (!current || current.accountEncrypted !== saved) throw fault(409, '通道已修改，请重新请求');
        current.accountEncrypted = this.seal(JSON.stringify(next)); current.accountExpiresAt = next.expiresAt; this.persist(); return next;
      }).finally(() => this.renewals.delete(id));
      this.renewals.set(id, promise);
    }
    return this.renewals.get(id);
  }
  async refreshAccount(id) {
    const c = this.state.channels.find(v => v.id === id && v.source === 'workbuddy-cn');
    if (!c) throw fault(404, 'WorkBuddy 通道不存在');
    const auth = await this.workbuddyAuth(id);
    const [models, quota] = await Promise.allSettled([this.workbuddy.models(auth), this.workbuddy.quota(auth)]);
    if (this.state.channels.find(v => v.id === id) !== c) throw fault(409, '通道已修改，请重新刷新');
    const notes = [];
    if (models.status === 'fulfilled') { c.models = models.value; if (!c.model && c.models.length) c.model = c.models[0]; if (!c.models.length) notes.push('模型列表为空'); }
    else notes.push('模型列表读取失败');
    if (quota.status === 'fulfilled') c.quota = quota.value; else notes.push('额度读取失败，保留上次数据');
    c.accountNote = notes.join('；'); this.persist(); return this.status();
  }
  manualQuota({ id, remaining, unit, resetAt }) {
    const c = this.state.channels.find(v => v.id === id); if (!c) throw fault(404, '通道不存在');
    if (!number(remaining) || !String(unit || '').trim()) throw fault(400, '请输入非负余额和单位');
    if (resetAt && !Number.isFinite(Date.parse(resetAt))) throw fault(400, '重置时间无效');
    c.quota = { remaining, unit: String(unit).trim().slice(0, 30), source: 'manual', updatedAt: new Date().toISOString(), resetAt: resetAt || null }; this.persist(); return this.status();
  }
  async refreshQuota(id) {
    const c = this.state.channels.find(v => v.id === id); if (!c) throw fault(404, '通道不存在');
    if (c.source === 'qwenwork-cn') {
      const info = await this.qwenwork.inspect(this.qwenIdentity(c));
      if (this.state.channels.find(v => v.id === id) !== c) throw fault(409, '通道已修改，请重新刷新');
      c.quota = info.quota; c.models = info.models; c.accountExpiresAt = info.expiresAt;
      if (!c.models.includes(c.model)) { c.model = c.models[0]; c.enabled = false; }
      this.persist(); return this.status();
    }
    if (c.source === 'doubao-work') {
      const info = await this.doubao.inspect(this.doubaoIdentity(c));
      if (this.state.channels.find(v => v.id === id) !== c) throw fault(409, '通道已修改，请重新刷新');
      c.quota = info.quota; this.persist(); return this.status();
    }
    if (c.source === 'workbuddy-cn') return this.refreshAccount(id);
    if (c.source === 'trae-ide') return this.refreshTrae(id);
    const r = this.resolved(c);
    if (!c.quotaPath || !r.key) throw fault(400, '尚未配置可查询的同源额度接口，可先手动记录');
    const url = new URL(c.quotaPath, endpoint(r.baseUrl));
    if (url.origin !== new URL(r.baseUrl).origin) throw fault(400, '额度接口必须与调用服务同源');
    let response;
    try { response = await this.fetch(url, { headers: { Authorization: `Bearer ${r.key}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw fault(502, '额度接口无法访问，旧数据已保留'); }
    if (!response.ok) { await response.body?.cancel(); throw fault(502, `额度接口返回 HTTP ${response.status}，旧数据已保留`); }
    let body; try { body = JSON.parse(await readLimited(response.body, MAX_BODY)); } catch { throw fault(502, '额度接口未返回有效 JSON'); }
    const remaining = at(body, c.remainingPath);
    if (!number(remaining)) throw fault(502, '余额字段不是有效数值，旧数据已保留');
    // Do not overwrite edits/deletions made while the network request was in flight.
    if (this.state.channels.find(v => v.id === id) !== c) throw fault(409, '通道已修改，请重新刷新');
    c.quota = { remaining, unit: c.quotaUnit, source: 'api', updatedAt: new Date().toISOString(), resetAt: null }; this.persist(); return this.status();
  }
  async start(port = 18878) {
    if (this.starting) return this.starting;
    if (this.server?.listening) return this.status();
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault(400, '端口无效');
    this.starting = (async () => {
      this.token = this.unseal(this.state.tokenEncrypted);
      if (!this.token) { this.token = crypto.randomBytes(32).toString('hex'); this.state.tokenEncrypted = this.seal(this.token); this.persist(); }
      const server = http.createServer((req, res) => this.handle(req, res).catch(error => {
        if (res.headersSent) return res.destroy();
        json(res, error.status || 500, { error: { message: error.status ? error.message : '本地网关处理失败', type: 'gateway_error' } });
      }));
      server.requestTimeout = 15000; server.headersTimeout = 10000;
      server.on('clientError', (_error, socket) => socket.destroy());
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      this.server = server; return this.status();
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async stop() {
    if (this.starting) { try { await this.starting; } catch { /* failed start */ } }
    const server = this.server; this.server = null;
    for (const c of this.controllers) c.abort();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    return this.status();
  }
  rotate() { const token = crypto.randomBytes(32).toString('hex'); const encrypted = this.seal(token); this.state.tokenEncrypted = encrypted; this.persist(); this.token = token; return this.status(); }
  async testChannel(id) {
    if (!this.server?.listening) throw fault(400, '请先启动本地网关');
    const response = await fetch(`${this.status().baseUrl}/chat/completions`, { method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'Reply with OK only.' }], max_tokens: this.state.channels.find(c => c.id === id)?.source === 'qwenwork-cn' ? 128 : 32 }), signal: AbortSignal.timeout(this.timeoutMs + 1000) });
    const data = await response.json();
    if (!response.ok) throw fault(response.status, data.error?.message || '测试失败');
    return { ...this.status(), testReply: String(data.choices?.[0]?.message?.content || '请求成功，上游未返回文本').slice(0, 300) };
  }
  record(channel, result, usage, elapsed) {
    const c = this.state.channels.find(v => v.id === channel.id);
    if (c) {
      c.stats.attempts++; c.stats[result === 'ok' ? 'completed' : 'failures']++;
      if (result === 'ok' && usage && (number(usage.prompt_tokens) || number(usage.completion_tokens))) {
        c.stats.inputTokens += number(usage.prompt_tokens) ? usage.prompt_tokens : 0;
        c.stats.outputTokens += number(usage.completion_tokens) ? usage.completion_tokens : 0; c.stats.usageResponses++;
      }
    }
    this.state.requests.push({ at: new Date().toISOString(), channel: channel.name, result, elapsedMs: elapsed });
    this.state.requests = this.state.requests.slice(-100); this.persist();
  }
  async handle(req, res) {
    const expectedHost = `127.0.0.1:${this.server?.address()?.port}`;
    if (![expectedHost, expectedHost.replace('127.0.0.1', 'localhost')].includes(req.headers.host) || req.headers.origin) throw fault(403, '仅接受本机客户端请求');
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (!this.token || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw fault(401, '网关密钥无效');
    const url = new URL(req.url, `http://${expectedHost}`);
    const channels = this.state.channels.map(c => this.resolved(c)).filter(c => this.usable(c)).sort((a, b) => a.priority - b.priority);
    if (req.method === 'GET' && url.pathname === '/v1/models') return json(res, 200, { object: 'list', data: [...(channels.length ? [{ id: 'auto', object: 'model', owned_by: 'toolbox' }] : []), ...channels.map(c => ({ id: c.id, object: 'model', owned_by: c.name }))] });
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') throw fault(404, '接口不存在');
    if (this.inflight >= 4) throw fault(429, '本机并发请求已满，请稍后重试');
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fault(415, '请发送 application/json');
    this.inflight++;
    const controller = new AbortController(); this.controllers.add(controller);
    const onClose = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', onClose);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let body; try { body = JSON.parse(await readLimited(req, MAX_BODY)); } catch (e) { throw e.status ? e : fault(400, '请求不是有效 JSON'); }
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 500 || !body.messages.every(m => m && ['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) || (body.stream !== undefined && typeof body.stream !== 'boolean')) throw fault(400, 'messages 或 stream 格式无效');
      const alias = body.model || 'auto';
      const selected = channels.filter(c => alias === 'auto' || c.id === alias);
      if (!selected.length) throw fault(503, '没有可用通道，请先在额度中枢配置并启用');
      const candidates = selected.filter(c => (this.cooldowns.get(c.id) || 0) <= Date.now());
      if (!candidates.length) { res.setHeader('Retry-After', '30'); throw fault(429, '通道正在限流冷却，请稍后重试'); }
      for (const c of candidates) {
        const begin = Date.now(); let usage = null; let completed = false;
        try {
          const base = endpoint(c.baseUrl);
          if (new URL(base).port === String(this.server.address().port) && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw fault(400, '通道指向了网关自身，请改为上游服务地址');
          const upstream = c.source === 'qwenwork-cn' ? await this.qwenwork.chat(this.qwenIdentity(c), { ...body, model: c.model }, controller.signal) : c.source === 'doubao-work' ? await this.doubao.chat(this.doubaoIdentity(c), { ...body, model: c.model }, controller.signal) : c.source === 'trae-ide' ? await this.trae.chat(this.traeAuth(c), { ...body, model: c.model }, controller.signal) : c.source === 'workbuddy-cn' ? await this.workbuddy.chat(await this.workbuddyAuth(c.id), { ...body, model: c.model }, controller.signal) : await this.fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
            body: JSON.stringify({ ...body, model: c.model }), redirect: 'error', signal: controller.signal });
          if (!upstream.ok) {
            await upstream.body?.cancel();
            this.record(c, `HTTP ${upstream.status}`, null, Date.now() - begin); completed = true;
            if ([429, 502, 503, 504].includes(upstream.status)) {
              const seconds = Number(upstream.headers.get('retry-after'));
              this.cooldowns.set(c.id, Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 30) * 1000);
              continue;
            }
            throw fault(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, `通道「${c.name}」返回 HTTP ${upstream.status}`);
          }
          res.setHeader('X-Toolbox-Channel', c.id);
          if (!body.stream) {
            let result; try { result = JSON.parse(await readLimited(upstream.body, MAX_RESPONSE)); } catch { throw fault(502, '上游未返回有效的 JSON 响应'); }
            if (!Array.isArray(result.choices) || !result.choices.length) throw fault(502, '上游响应不符合 Chat Completions 格式');
            usage = result.usage; result.model = alias; json(res, 200, result);
          } else {
            if (!(upstream.headers.get('content-type') || '').includes('text/event-stream')) { await upstream.body?.cancel(); throw fault(502, '上游未返回流式响应'); }
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
            let pending = ''; let size = 0; let done = false;
            const decoder = new TextDecoder();
            for await (const chunk of upstream.body) {
              size += chunk.length; if (size > MAX_RESPONSE) throw fault(502, '上游响应过大');
              pending += decoder.decode(chunk, { stream: true });
              let end;
              while ((end = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
                if (line.startsWith('data:')) {
                  const value = line.slice(5).trim();
                  if (value === '[DONE]') done = true;
                  else { try { const event = JSON.parse(value); if (event.error || (Number.isInteger(event.code) && event.code !== 0)) throw fault(502, '上游流式返回错误'); if (event.usage) usage = event.usage; } catch (e) { if (e.status) throw e; } }
                }
              }
              if (pending.length > MAX_BODY) throw fault(502, '上游事件过大');
              if (!res.write(chunk)) await new Promise((resolve, reject) => {
                const clean = () => { res.off('drain', onDrain); res.off('close', onEnd); };
                const onDrain = () => { clean(); resolve(); }; const onEnd = () => { clean(); reject(fault(499, '客户端断开')); };
                res.once('drain', onDrain); res.once('close', onEnd);
              });
            }
            if (!done) throw fault(502, '上游流式响应中断');
            res.end();
          }
          this.record(c, 'ok', usage, Date.now() - begin); completed = true; return;
        } catch (error) {
          if (!completed) this.record(c, controller.signal.aborted ? 'cancelled' : 'failed', null, Date.now() - begin);
          if (res.headersSent) { res.destroy(); return; }
          if (controller.signal.aborted) throw fault(504, '请求已取消或超时');
          // Connection errors are ambiguous: the upstream may already have charged the request.
          throw error.status ? error : fault(502, `通道「${c.name}」连接失败；未重复发送该请求`);
        }
      }
      res.setHeader('Retry-After', '30'); throw fault(503, '可用通道均返回限流或暂时不可用，请稍后重试');
    } finally { clearTimeout(timer); this.controllers.delete(controller); this.inflight--; res.off('close', onClose); }
  }
}

function registerAiHubIpc(ipcMain, { app, safeStorage, clipboard, currentApi, markClipboardSecret = () => {} }) {
  let service, loginWindow;
  // Match the main application's Node fetch transport; Chromium inherits the
  // system proxy, which may be stopped even while direct API calls still work.
  const get = () => service ||= new AiHub({ directory: path.join(app.getPath('userData'), 'ai-hub'), safeStorage, currentApi });
  const closeLogin = () => { if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy(); loginWindow = null; };
  const secure = action => async (event, payload) => {
    try {
      const url = new URL(event.senderFrame.url); const root = pathToFileURL(path.join(__dirname, '../renderer') + path.sep).href;
      if (url.protocol !== 'file:' || !url.href.startsWith(root) || !url.pathname.endsWith('.html')) throw fault(403, '仅工具箱本地页面可以管理网关');
      return { ok: true, ...(await action(payload)) };
    } catch (error) { return { ok: false, error: error.status ? error.message : '操作失败，请检查配置文件、端口或系统安全存储' }; }
  };
  ipcMain.handle('aiHub:status', secure(() => get().status()));
  ipcMain.handle('aiHub:connectTrae', secure(() => get().connectTrae()));
  ipcMain.handle('aiHub:connectDoubao', secure(() => get().connectDoubao()));
  ipcMain.handle('aiHub:connectQwenWork', secure(() => get().connectQwenWork()));
  ipcMain.handle('aiHub:openDoubao', secure(() => get().openDoubao()));
  ipcMain.handle('aiHub:save', secure(payload => get().save(payload)));
  ipcMain.handle('aiHub:remove', secure(id => get().remove(id)));
  ipcMain.handle('aiHub:quota', secure(payload => get().manualQuota(payload)));
  ipcMain.handle('aiHub:refresh', secure(id => get().refreshQuota(id)));
  ipcMain.handle('aiHub:test', secure(id => get().testChannel(id)));
  ipcMain.handle('aiHub:start', secure(() => get().start()));
  ipcMain.handle('aiHub:stop', secure(() => get().stop()));
  ipcMain.handle('aiHub:rotate', secure(() => get().rotate()));
  ipcMain.handle('aiHub:copyKey', secure(() => { if (!get().token) throw fault(400, '请先启动网关'); markClipboardSecret(get().token); clipboard.writeText(get().token); return {}; }));
  ipcMain.handle('aiHub:loginStart', secure(async id => {
    closeLogin(); const login = await get().loginStart(id);
    const { BrowserWindow, session } = require('electron');
    const authSession = session.fromPartition('persist:toolbox-ai-hub-workbuddy-cn');
    // Only this dedicated authorization window uses direct access. Original
    // browser/system proxy settings and the Toolbox renderer session are untouched.
    await authSession.setProxy({ mode: 'direct' });
    const webPreferences = { session: authSession, sandbox: true, contextIsolation: true, nodeIntegration: false };
    const win = new BrowserWindow({ width: 960, height: 780, title: 'WorkBuddy 国内版授权', autoHideMenuBar: true, webPreferences });
    loginWindow = win;
    win.webContents.setWindowOpenHandler(({ url }) => /^https:\/\//.test(url) ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences } } : { action: 'deny' });
    win.on('closed', () => { if (loginWindow === win) { loginWindow = null; get().loginCancel(); } });
    try { await win.loadURL(login.authUrl); } catch { closeLogin(); get().loginCancel(); throw fault(502, '授权页面未能加载，请重新登录'); }
    const { authUrl, ...safe } = login; return safe;
  }));
  ipcMain.handle('aiHub:loginPoll', secure(async id => { const result = await get().loginPoll(id); if (result.loginStatus === 'connected') closeLogin(); return result; }));
  ipcMain.handle('aiHub:loginCancel', secure(() => { closeLogin(); return get().loginCancel(); }));
  app.on('before-quit', () => { closeLogin(); service?.loginCancel(); service?.stop().catch(() => {}); });
}
module.exports = { AiHub, CATALOG, endpoint, registerAiHubIpc };
