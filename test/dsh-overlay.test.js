'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const { asInsertPatch, buildOverlay, DSH_WARNING } = require('../src/main/dsh-service');

const base = { userData: '/ud', mcpServer: '/app/src/main/toolbox-mcp-server.js', execPath: '/App.app/Contents/MacOS/App', uvx: '', nodeBin: '/n/bin/node' };

test('DSH overlay：新增条目必须包在 insert 操作里——裸写 - id 对不存在的 id 会被 DSH 当成「修改」静默跳过', () => {
  const doc = yaml.load(buildOverlay(base));
  assert.ok(Array.isArray(doc) && doc.length === 1, 'overlay 是一个 patch 列表，只有一个 insert 操作');
  assert.ok(Array.isArray(doc[0].insert), '顶层必须是 insert');
  assert.ok(!doc[0].id, '不能是裸条目');
  assert.deepEqual(doc[0].insert.map((e) => e.id), ['mcp-agent-toolbox', 'mcp-rea']);
  for (const e of doc[0].insert) assert.equal(e.name, '@deepseek-ai/dsh-mcp-client');
});

test('DSH overlay：工具箱自己的 MCP 用 Electron 以 node 模式跑、启动失败要暴露；REA 失败不拖垮 DSH', () => {
  const [toolbox, rea] = yaml.load(buildOverlay(base))[0].insert;
  assert.equal(toolbox.config.serverName, 'agent_toolbox');
  assert.equal(toolbox.config.transport, 'stdio');
  assert.equal(toolbox.config.command, '/App.app/Contents/MacOS/App');
  assert.deepEqual(toolbox.config.args, ['/app/src/main/toolbox-mcp-server.js']);
  // cwd 不能是脚本所在目录：打包后它在 app.asar 里，对 OS 不是真目录，spawn 会 ENOTDIR（打包态栽过）
  assert.equal(toolbox.config.cwd, '/ud');
  assert.equal(toolbox.config.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(toolbox.config.env.AGENT_TOOLBOX_USER_DATA, '/ud');
  assert.equal(toolbox.config.failOnStartupError, true);
  assert.equal(rea.config.serverName, 'rea');
  assert.equal(rea.config.failOnStartupError, false);
  assert.equal(rea.config.toolCallTimeoutMs, 600000, '逆向分析可能很久');
});

test('DSH overlay：有 uvx 才挂 Blender，顺序 toolbox→blender→rea，serverName 互不重复（mcp-client 重名会抛）', () => {
  const entries = yaml.load(buildOverlay({ ...base, uvx: '/u/bin/uvx' }))[0].insert;
  assert.deepEqual(entries.map((e) => e.id), ['mcp-agent-toolbox', 'mcp-blender', 'mcp-rea']);
  assert.equal(entries[1].config.command, '/u/bin/uvx');
  assert.deepEqual(entries[1].config.args, ['--offline', 'mcp-for-blender']);
  const names = entries.map((e) => e.config.serverName);
  assert.equal(new Set(names).size, names.length);
});

test('DSH overlay：Windows 路径写进 YAML 时统一成正斜杠，解析回来仍是合法字符串', () => {
  const [toolbox] = yaml.load(buildOverlay({ ...base, userData: 'C:\\Users\\x\\AppData\\Roaming\\agent-toolbox', execPath: 'C:\\App\\App.exe' }))[0].insert;
  assert.equal(toolbox.config.command, 'C:/App/App.exe');
  assert.equal(toolbox.config.env.AGENT_TOOLBOX_USER_DATA, 'C:/Users/x/AppData/Roaming/agent-toolbox');
});

test('DSH overlay：asInsertPatch 把每行缩进 4 格、空行保持为空', () => {
  assert.deepEqual(asInsertPatch(['- id: a', '  name: b', '', '- id: c']), ['- insert:', '    - id: a', '      name: b', '', '    - id: c']);
});

test('DSH stderr 警告识别：patch 没生效 / 条目没激活 / mcp 连不上 / bundle 被跳过 都要抓；普通 URL 行不抓', () => {
  for (const line of [
    'dsh: [/x/dsh-toolbox.patch.yml] patch: entry "mcp-agent-toolbox" not found',
    'dsh: warning: 1 entry did not activate',
    'mcp-client(rea): connection attempt failed: spawn ENOENT',
    'dsh: skipping profile bundle "foo": incompatible',
  ]) assert.ok(DSH_WARNING.test(line), line);
  assert.ok(!DSH_WARNING.test('dsh web: http://127.0.0.1:3080/?token=abc'));
});
