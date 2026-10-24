const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const script = path.join(__dirname, '..', 'src', 'main', 'deepseek-router-mcp.js');

async function connect(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [script], env: { ...process.env, DEEPSEEK_API_KEY: '', ...env } });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  return client;
}

test('DeepSeek 路由：暴露 deepseek / deepseek_usage 两个工具并带路由说明', async () => {
  const c = await connect();
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['deepseek', 'deepseek_usage']);
  assert.match(c.getInstructions() || '', /files/);
  await c.close();
});

test('DeepSeek 路由：拒绝敏感文件和相对路径，没 key 时给出可操作的报错', async () => {
  const c = await connect();
  const call = (args) => c.callTool({ name: 'deepseek', arguments: args });
  const ssh = await call({ task: 'x', files: [path.join(os.homedir(), '.ssh', 'id_rsa')] });
  assert.ok(ssh.isError); assert.match(ssh.content[0].text, /安全/);
  const rel = await call({ task: 'x', files: ['a.txt'] });
  assert.ok(rel.isError); assert.match(rel.content[0].text, /绝对路径/);
  const nokey = await call({ task: 'hi' });
  assert.ok(nokey.isError); assert.match(nokey.content[0].text, /DEEPSEEK_API_KEY/);
  await c.close();
});
