'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mcp = require('../src/main/mcp-factory');

function tempTarget(format, initial = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolbox-mcp-test-'));
  const file = path.join(dir, format === 'codex' ? 'config.toml' : 'config.json');
  if (initial) fs.writeFileSync(file, initial, 'utf8');
  return { id: 'test', label: 'test', format, path: file };
}

test('Claude JSON MCP writes stdio server and preserves existing keys', () => {
  const target = tempTarget('claude', '{"preferences":{"theme":"dark"}}\n');
  const result = mcp.writeMcpServer({
    target,
    definition: { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', 'server-fs'], env: { ROOT: '/tmp' } },
  });
  const data = JSON.parse(fs.readFileSync(target.path, 'utf8'));
  assert.equal(data.preferences.theme, 'dark');
  assert.deepEqual(data.mcpServers.filesystem, { command: 'npx', args: ['-y', 'server-fs'], env: { ROOT: '/tmp' } });
  assert.equal(result.backup, target.path + '.bak');
  assert.deepEqual(mcp.listMcpServers(target), ['filesystem']);
});

test('OpenCode JSON uses local and remote MCP schemas', () => {
  const local = mcp.toClientDefinition({ name: 'local', transport: 'stdio', command: 'node', args: ['server.js'], env: {} }, 'opencode');
  const remote = mcp.toClientDefinition({ name: 'remote', transport: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } }, 'opencode');
  assert.deepEqual(local, { type: 'local', command: ['node', 'server.js'], environment: {}, enabled: true });
  assert.deepEqual(remote, { type: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' }, enabled: true });
});

test('Codex TOML MCP section is added, replaced, listed, and backed up', () => {
  const target = tempTarget('codex', 'model = "custom"\n\n[mcp_servers.old]\ncommand = "old"\n\n[mcp_servers.old.env]\nTOKEN = "secret"\n');
  mcp.writeMcpServer({ target, definition: { name: 'new-server', transport: 'stdio', command: 'uvx', args: ['demo'] } });
  const result = mcp.writeMcpServer({ target, definition: { name: 'new-server', transport: 'stdio', command: 'npx', args: ['new'] } });
  const content = fs.readFileSync(target.path, 'utf8');
  assert.match(content, /\[mcp_servers\.old\]/);
  assert.match(content, /command = "npx"/);
  assert.doesNotMatch(content, /command = "uvx"/);
  assert.deepEqual(mcp.listMcpServers(target), ['old', 'new-server']);
  assert.equal(result.backup, target.path + '.bak');
  const removed = mcp.removeMcpServer({ target, name: 'new-server' });
  assert.equal(removed.ok, true);
  assert.deepEqual(mcp.listMcpServers(target), ['old']);
});

test('MCP definitions reject invalid names, maps, and remote URLs', () => {
  assert.throws(() => mcp.normalizeDefinition({ name: 'bad name', command: 'npx' }), /服务名/);
  assert.throws(() => mcp.normalizeDefinition({ name: 'demo', command: 'npx', env: [] }), /JSON 对象/);
  assert.throws(() => mcp.normalizeDefinition({ name: 'demo', transport: 'sse', url: 'file:///tmp/mcp' }), /http\(s\)/);
});
