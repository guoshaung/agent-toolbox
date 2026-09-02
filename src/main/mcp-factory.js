'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

function mcpTargets({ homeDir = os.homedir(), platform = process.platform } = {}) {
  const configRoot = platform === 'darwin'
    ? path.join(homeDir, 'Library', 'Application Support')
    : platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'))
      : path.join(homeDir, '.config');
  return [
    { id: 'claude-desktop', label: 'Claude Desktop', format: 'claude', path: path.join(configRoot, 'Claude', 'claude_desktop_config.json'), hint: 'mcpServers · JSON' },
    { id: 'claude-code', label: 'Claude Code', format: 'claude', path: path.join(homeDir, '.claude.json'), hint: 'mcpServers · JSON' },
    { id: 'opencode', label: 'OpenCode', format: 'opencode', path: path.join(configRoot, 'opencode', 'opencode.json'), hint: 'mcp · JSON' },
    { id: 'codex', label: 'Codex', format: 'codex', path: path.join(homeDir, '.codex', 'config.toml'), hint: 'mcp_servers · TOML' },
  ].map((target) => ({ ...target, exists: fs.existsSync(target.path) }));
}

function parseJson(text) {
  const source = String(text || '').trim();
  if (!source) return {};
  try { return JSON.parse(source); } catch {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(withoutComments);
  }
}

function safeServerName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('MCP 服务名只能使用字母、数字、点、下划线和连字符，最长 64 个字符。');
  }
  return name;
}

function cleanMap(value, label) {
  if (value == null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(String(label) + ' 必须是 JSON 对象。');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) throw new Error(String(label) + ' 的键名无效：' + key);
    result[key] = String(item ?? '');
  }
  return result;
}

function normalizeDefinition(input = {}) {
  const transport = ['stdio', 'streamable-http', 'sse'].includes(input.transport) ? input.transport : 'stdio';
  const definition = {
    name: safeServerName(input.name),
    transport,
    command: String(input.command || '').trim(),
    args: Array.isArray(input.args) ? input.args.map((item) => String(item)).filter(Boolean) : [],
    env: cleanMap(input.env, '环境变量'),
    url: String(input.url || '').trim(),
    headers: cleanMap(input.headers, '请求头'),
    enabled: input.enabled !== false,
  };
  if (transport === 'stdio' && !definition.command) throw new Error('stdio 服务需要填写启动命令。');
  if (transport !== 'stdio') {
    let parsed;
    try { parsed = new URL(definition.url); } catch { throw new Error('远程 MCP URL 必须是有效的 http(s) 地址。'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('远程 MCP URL 只支持 http(s)。');
  }
  return definition;
}

function toClientDefinition(definition, format) {
  const item = normalizeDefinition(definition);
  if (format === 'opencode') {
    if (item.transport === 'stdio') return { type: 'local', command: [item.command].concat(item.args), environment: item.env, enabled: item.enabled };
    return { type: 'remote', url: item.url, headers: item.headers, enabled: item.enabled };
  }
  if (format === 'codex') {
    if (item.transport === 'stdio') return { command: item.command, args: item.args, env: item.env, enabled: item.enabled };
    return { url: item.url, http_headers: item.headers, enabled: item.enabled };
  }
  if (item.transport === 'stdio') return { command: item.command, args: item.args, env: item.env };
  return { url: item.url, headers: item.headers };
}

function jsonTargetRoot(format) {
  return format === 'opencode' ? 'mcp' : 'mcpServers';
}

function readJsonTarget(target) {
  try {
    const stat = fs.statSync(target.path);
    if (stat.size > MAX_CONFIG_BYTES) throw new Error('MCP 配置文件超过 2MB，暂不读取。');
    return parseJson(fs.readFileSync(target.path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function listMcpServers(target) {
  if (target.format === 'codex') {
    try {
      const text = fs.readFileSync(target.path, 'utf8');
      return [...text.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gm)].map((match) => match[1]);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  const data = readJsonTarget(target);
  const root = data[jsonTargetRoot(target.format)];
  return root && typeof root === 'object' && !Array.isArray(root) ? Object.keys(root) : [];
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function tomlInlineMap(value) {
  return '{ ' + Object.entries(value).map(([key, item]) => key + ' = ' + tomlString(item)).join(', ') + ' }';
}

function tomlArray(value) {
  return '[' + value.map((item) => tomlString(item)).join(', ') + ']';
}

function codexSection(name, definition) {
  if (String(name).includes('.')) throw new Error('Codex MCP 服务名不能包含点号，请使用连字符或下划线。');
  const item = toClientDefinition(definition, 'codex');
  const lines = ['[mcp_servers.' + safeServerName(name) + ']'];
  if (item.command) lines.push('command = ' + tomlString(item.command));
  if (item.args?.length) lines.push('args = ' + tomlArray(item.args));
  if (Object.keys(item.env || {}).length) lines.push('env = ' + tomlInlineMap(item.env));
  if (item.url) lines.push('url = ' + tomlString(item.url));
  if (Object.keys(item.http_headers || {}).length) lines.push('http_headers = ' + tomlInlineMap(item.http_headers));
  if (item.enabled === false) lines.push('enabled = false');
  return lines.join('\n') + '\n';
}

function sectionPattern(name) {
  const escaped = safeServerName(name).replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|\\n)\\[mcp_servers\\.' + escaped + '\\][^\\n]*\\n[\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)', 'm');
}

function replaceCodexSection(source, name, section) {
  const pattern = sectionPattern(name);
  if (pattern.test(source)) return source.replace(pattern, '\n' + section.trimEnd());
  return source.trimEnd() + '\n\n' + section;
}

function writeAtomic(filePath, content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) throw new Error('MCP 配置文件超过 2MB。');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeMcpServer({ target, definition, overwrite = true }) {
  const item = normalizeDefinition(definition);
  if (!overwrite && listMcpServers(target).includes(item.name)) return { ok: false, code: 'exists', name: item.name };
  let content;
  let backup = null;
  if (target.format === 'codex') {
    const source = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf8') : '';
    content = replaceCodexSection(source, item.name, codexSection(item.name, item));
    if (source) { backup = target.path + '.bak'; fs.copyFileSync(target.path, backup); }
  } else {
    const data = readJsonTarget(target);
    const rootKey = jsonTargetRoot(target.format);
    if (!data[rootKey] || typeof data[rootKey] !== 'object' || Array.isArray(data[rootKey])) data[rootKey] = {};
    data[rootKey][item.name] = toClientDefinition(item, target.format);
    if (fs.existsSync(target.path)) { backup = target.path + '.bak'; fs.copyFileSync(target.path, backup); }
    content = JSON.stringify(data, null, 2) + '\n';
  }
  writeAtomic(target.path, content);
  return {
    ok: true,
    name: item.name,
    path: target.path,
    backup,
    format: target.format,
    snippet: target.format === 'codex' ? codexSection(item.name, item) : JSON.stringify(toClientDefinition(item, target.format), null, 2),
  };
}

function removeMcpServer({ target, name }) {
  const safeName = safeServerName(name);
  if (target.format === 'codex') {
    const source = fs.readFileSync(target.path, 'utf8');
    const pattern = sectionPattern(safeName);
    if (!pattern.test(source)) return { ok: false, error: '没有找到这个 MCP 服务。' };
    const backup = target.path + '.bak';
    fs.copyFileSync(target.path, backup);
    writeAtomic(target.path, source.replace(pattern, '\n').replace(/^\n+/, ''));
    return { ok: true, path: target.path, backup };
  }
  const data = readJsonTarget(target);
  const rootKey = jsonTargetRoot(target);
  if (!data[rootKey]?.[safeName]) return { ok: false, error: '没有找到这个 MCP 服务。' };
  const backup = target.path + '.bak';
  fs.copyFileSync(target.path, backup);
  delete data[rootKey][safeName];
  writeAtomic(target.path, JSON.stringify(data, null, 2) + '\n');
  return { ok: true, path: target.path, backup };
}

function snippet(definition, format) {
  const item = normalizeDefinition(definition);
  return format === 'codex'
    ? codexSection(item.name, item)
    : JSON.stringify({ [jsonTargetRoot(format)]: { [item.name]: toClientDefinition(item, format) } }, null, 2);
}

module.exports = {
  codexSection, listMcpServers, mcpTargets, normalizeDefinition, removeMcpServer,
  safeServerName, snippet, toClientDefinition, writeMcpServer,
};
