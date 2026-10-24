'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const REF = 'TOOLBOX_QUOTA_HUB_API_KEY';
const PACKAGE = 'toolbox-quota-hub-text';
const BRIDGE_URL = 'http://127.0.0.1:18879/v1';
const fail = (status, message) => Object.assign(new Error(message), { status });

function normalizePeerUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw fail(400, '请填写有效的 Chat Completions Base URL'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw fail(400, '远程地址须使用 HTTPS；本机隧道可使用 HTTP，地址不能带账号或查询参数');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/' || /\/(responses|chat\/completions|models)$/.test(url.pathname)) {
    throw fail(400, '请填以 /v1 结尾的 Base URL，不要填 Responses 或具体接口地址');
  }
  return url.href;
}

function probePeerPort(baseUrl) {
  const url = new URL(baseUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(3000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(fail(502, '端口连接超时；请检查隧道或服务端网关')); });
    socket.once('error', () => { socket.destroy(); reject(fail(502, '端口无法连接；请检查隧道或服务端网关')); });
  });
}

async function suggestPeerPort(start = 18880, end = 18920) {
  for (let port = start; port <= end; port++) {
    const free = await new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw fail(409, '未找到空闲的本机网关端口，请手动填写其他端口');
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function limitedJson(response) {
  let size = 0;
  const chunks = [];
  for await (const part of response.body || []) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw fail(502, '远端响应过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function backup(file) {
  if (!fs.existsSync(file)) return '';
  const copy = `${file}.bak-peer-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, copy);
  fs.chmodSync(copy, 0o600);
  return copy;
}

function mergeCredentials(raw, key) {
  const original = raw || 'version: 1\nrefs:\nrecords: {}\n';
  const old = yaml.load(original);
  if (!old || typeof old.refs !== 'object') throw fail(409, 'DSH 凭据文件格式不符合预期，原文件未修改');
  const entry = `  ${REF}: ${JSON.stringify(key)}`;
  const line = new RegExp(`^  ${REF}:.*$`, 'm');
  const updated = line.test(original) ? original.replace(line, entry) : original.replace(/^refs:\s*$/m, `refs:\n${entry}`);
  const checked = yaml.load(updated);
  if (checked?.refs?.[REF] !== key) throw fail(409, 'DSH 凭据校验失败，原文件未修改');
  for (const [name, value] of Object.entries(old.refs)) {
    if (name !== REF && checked.refs[name] !== value) throw fail(409, '现有 DSH 密钥校验失败，原文件未修改');
  }
  return updated;
}

const providerLines = [
  '      toolbox-quota-hub:',
  '        displayName: Toolbox 额度中枢（单轮文本）',
  `        apiKeyEnv: ${REF}`,
  '        api: openai-completions',
  `        baseURL: ${BRIDGE_URL}`,
  '        models:',
  '          - id: auto',
  '            name: Auto · 额度中枢（单轮文本）',
  '            contextWindow: 8192',
  '            maxTokens: 4096',
  '            input: [text]',
  '            reasoningEfforts: false',
  '        retryPolicy:',
  '          mode: normal',
  '          maxRetries: 0',
];

function mergeProviderPatch(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const start = lines.findIndex(line => /^- id: llm-pi-ai\s*$/.test(line));
  if (start < 0) throw fail(409, 'DSH 未配置 pi-ai 提供方，原文件未修改');
  const sectionEnd = lines.findIndex((line, index) => index > start && /^- id: /.test(line));
  const end = sectionEnd < 0 ? lines.length : sectionEnd;
  const providers = lines.findIndex((line, index) => index > start && index < end && /^    providers:\s*$/.test(line));
  if (providers < 0) throw fail(409, 'DSH 提供方配置格式不符合预期，原文件未修改');
  const old = lines.findIndex((line, index) => index > providers && index < end && /^      toolbox-quota-hub:\s*$/.test(line));
  if (old < 0) lines.splice(providers + 1, 0, ...providerLines);
  else {
    let finish = old + 1;
    while (finish < end && (!lines[finish].trim() || /^\s{7,}/.test(lines[finish]))) finish++;
    lines.splice(old, finish - old, ...providerLines);
  }
  const result = lines.join('\n');
  if ((result.match(/^      toolbox-quota-hub:/gm) || []).length !== 1) throw fail(409, 'DSH 提供方合并失败，原文件未修改');
  return result;
}

function dshCredential(dshHome) {
  try { return yaml.load(fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8'))?.refs?.[REF] || ''; }
  catch { return ''; }
}

class AiHubPeer {
  constructor({ directory, safeStorage, fetchImpl = fetch, portProbe = probePeerPort, dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh') }) {
    this.file = path.join(directory, 'peer.json');
    this.safeStorage = safeStorage;
    this.fetch = fetchImpl;
    this.portProbe = portProbe;
    this.dshHome = dshHome;
    this.state = { baseUrl: '', keyEncrypted: '', models: [], checkedAt: '', testedAt: '' };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw fail(409, '使用端配置无法读取，原文件已保留'); }
  }

  seal(key) {
    if (!this.safeStorage?.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw fail(503, '系统安全存储不可用，未保存网关密钥');
    return this.safeStorage.encryptString(key).toString('base64');
  }

  key() {
    try {
      if (this.state.keyEncrypted && this.safeStorage?.isEncryptionAvailable()) return this.safeStorage.decryptString(Buffer.from(this.state.keyEncrypted, 'base64'));
    } catch { /* local key unavailable; try DSH's own credential ref */ }
    return dshCredential(this.dshHome);
  }

  dshStatus() {
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(this.dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
      const patch = fs.readFileSync(path.join(this.dshHome, 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
      return { available: true, installed: Boolean(profile.dependencies?.[PACKAGE] && profile.dsh?.profile?.bundles?.includes(PACKAGE) && patch.includes('      toolbox-quota-hub:') && fs.existsSync(path.join(this.dshHome, 'plugins', PACKAGE, 'index.js')) && fs.existsSync(path.join(this.dshHome, 'profiles', 'web', 'node_modules', PACKAGE, 'package.json'))), hasKey: Boolean(dshCredential(this.dshHome)) };
    } catch { return { available: false, installed: false, hasKey: Boolean(dshCredential(this.dshHome)) }; }
  }

  status() {
    return { baseUrl: this.state.baseUrl, hasKey: Boolean(this.key()), models: this.state.models, checkedAt: this.state.checkedAt, testedAt: this.state.testedAt, dsh: this.dshStatus(), protocol: 'openai-completions', model: 'auto' };
  }

  async connect(input) {
    const baseUrl = normalizePeerUrl(input?.baseUrl);
    const key = String(input?.apiKey || '').trim() || this.key();
    if (!key || /[\r\n]/.test(key) || key.length > 8192) throw fail(400, '请填写网关密钥，或沿用已保存的密钥');
    await this.portProbe(baseUrl);
    let response;
    try { response = await this.fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw fail(502, '无法连接额度中枢。请检查地址、隧道和服务端网关状态'); }
    if (!response.ok) { await response.body?.cancel(); throw fail(response.status === 401 ? 401 : 502, response.status === 401 ? '网关密钥无效或已更换' : `模型列表返回 HTTP ${response.status}`); }
    let data;
    try { data = await limitedJson(response); } catch { throw fail(502, '模型列表未返回有效 JSON 或响应过大'); }
    const models = Array.isArray(data?.data) ? data.data.slice(0, 50).map(item => ({ id: String(item.id || '').slice(0, 150), name: String(item.owned_by || '').slice(0, 80) })).filter(item => item.id) : [];
    if (!models.some(item => item.id === 'auto')) throw fail(502, '模型列表没有 auto，请确认这是工具箱额度中枢');
    const encrypted = this.seal(key);
    this.state = { baseUrl, keyEncrypted: encrypted, models, checkedAt: new Date().toISOString(), testedAt: '' };
    atomicWrite(this.file, JSON.stringify(this.state, null, 2) + '\n');
    return this.status();
  }

  async test() {
    const key = this.key();
    if (!this.state.baseUrl || !key) throw fail(400, '请先检测并保存使用端');
    let response;
    try { response = await this.fetch(`${this.state.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Reply with OK only.' }], stream: false, max_tokens: 4096 }), redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch { throw fail(502, '短文本请求未完成；请检查隧道和服务端通道'); }
    if (!response.ok) { await response.body?.cancel(); throw fail(502, `短文本请求返回 HTTP ${response.status}`); }
    let result;
    try { result = await limitedJson(response); } catch { throw fail(502, '短文本请求未返回 Chat Completions JSON'); }
    const reply = result?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw fail(502, '请求成功但没有可见回答；该通道可能把输出预算耗在思考上');
    this.state.testedAt = new Date().toISOString();
    atomicWrite(this.file, JSON.stringify(this.state, null, 2) + '\n');
    return { ...this.status(), reply: reply.trim().slice(0, 120), channelSelected: Boolean(response.headers.get('x-toolbox-channel')) };
  }

  async verifyDshBridge() {
    let response;
    try { response = await this.fetch(`${BRIDGE_URL}/models`, { headers: { Authorization: `Bearer ${this.key()}` }, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { throw fail(502, 'DSH 已启动，但文本桥未监听；请检查 18879 端口是否被占用'); }
    if (!response.ok) { await response.body?.cancel(); throw fail(502, `DSH 文本桥验证返回 HTTP ${response.status}`); }
    let data;
    try { data = await limitedJson(response); } catch { throw fail(502, 'DSH 文本桥未返回有效模型列表'); }
    if (!Array.isArray(data?.data) || !data.data.some(item => item?.id === 'auto')) throw fail(502, 'DSH 文本桥未提供 auto 模型');
    return true;
  }

  installDsh({ pluginSource, dshCommand, nodeCommand }) {
    if (!this.state.baseUrl || !this.key()) throw fail(400, '请先检测并保存使用端');
    const profileDir = path.join(this.dshHome, 'profiles', 'web');
    const packageFile = path.join(profileDir, 'package.json');
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    if (!fs.existsSync(packageFile) || !fs.existsSync(patchFile)) throw fail(400, '本机尚未初始化 DSH Web；请先启动一次 DSH');
    const packageBefore = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const patchBefore = fs.readFileSync(patchFile, 'utf8');
    const credentialsFile = path.join(this.dshHome, '.credentials.yaml');
    const credentialsBefore = fs.existsSync(credentialsFile) ? fs.readFileSync(credentialsFile, 'utf8') : '';
    const pluginDir = path.join(this.dshHome, 'plugins', PACKAGE);
    const mergedPatch = mergeProviderPatch(patchBefore);
    const mergedCredentials = mergeCredentials(credentialsBefore, this.key());
    if (!fs.existsSync(path.join(pluginSource, 'index.js'))) throw fail(503, '工具箱缺少 DSH 文本适配插件文件');
    const configFile = path.join(this.dshHome, `${PACKAGE}.json`);
    const lockFile = path.join(profileDir, 'pnpm-lock.yaml');
    const needsPackage = !packageBefore.dependencies?.[PACKAGE] || !fs.existsSync(path.join(profileDir, 'node_modules', PACKAGE, 'package.json'));
    const pluginFiles = ['index.js', 'package.json', 'cordis.patch.yml', 'README.md'].map(file => ({ source: path.join(pluginSource, file), target: path.join(pluginDir, file) }));
    const expectedConfig = JSON.stringify({ baseUrl: this.state.baseUrl }, null, 2) + '\n';
    const same = file => fs.existsSync(file.target) && fs.readFileSync(file.target).equals(fs.readFileSync(file.source));
    if (!needsPackage && packageBefore.dsh?.profile?.bundles?.includes(PACKAGE)
        && mergedPatch === patchBefore && mergedCredentials === credentialsBefore
        && fs.existsSync(configFile) && fs.readFileSync(configFile, 'utf8') === expectedConfig
        && pluginFiles.every(same)) return { ...this.status(), installed: true, restartNeeded: false };

    const files = [packageFile, patchFile, credentialsFile, configFile, lockFile, ...pluginFiles.map(file => file.target)];
    const originals = new Map(files.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
    try {
      for (const file of files) backup(file);
      fs.mkdirSync(pluginDir, { recursive: true });
      for (const file of pluginFiles) if (!same(file)) atomicWrite(file.target, fs.readFileSync(file.source));
      atomicWrite(configFile, expectedConfig);
      if (needsPackage) {
        if (!dshCommand) throw fail(400, '未找到 DSH 命令，先启动一次 DSH 后重试');
        const args = ['plugin', '--profile', 'web', 'add', pluginDir];
        const useNode = nodeCommand && !/\.(cmd|exe|bat)$/i.test(dshCommand);
        const command = useNode ? nodeCommand : dshCommand;
        const env = { ...process.env, DSH_HOME: this.dshHome };
        if (nodeCommand) env.PATH = [path.dirname(nodeCommand), env.PATH || ''].join(path.delimiter);
        const result = spawnSync(command, useNode ? [dshCommand, ...args] : args, { cwd: profileDir, env, encoding: 'utf8', timeout: 120000, windowsHide: true, shell: process.platform === 'win32' });
        if (result.status !== 0) throw fail(502, 'DSH 插件安装失败；原有配置已恢复，备份已保留');
      }
      const installedPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      const bundles = installedPackage.dsh?.profile?.bundles;
      if (!Array.isArray(bundles)) throw fail(409, 'DSH profile 缺少 bundles 列表');
      if (!bundles.includes(PACKAGE)) bundles.push(PACKAGE);
      atomicWrite(packageFile, JSON.stringify(installedPackage, null, 2) + '\n');
      atomicWrite(patchFile, mergedPatch);
      atomicWrite(credentialsFile, mergedCredentials);
      if (!this.dshStatus().installed) throw fail(502, 'DSH 插件写入后未通过检查');
      return { ...this.status(), installed: true, restartNeeded: true };
    } catch (error) {
      for (const [file, original] of originals) {
        try { if (original === null) fs.unlinkSync(file); else atomicWrite(file, original); }
        catch { /* keep the backup if automatic rollback is unavailable */ }
      }
      throw error;
    }
  }
}

module.exports = { AiHubPeer, normalizePeerUrl, probePeerPort, suggestPeerPort, mergeCredentials, mergeProviderPatch, BRIDGE_URL };
