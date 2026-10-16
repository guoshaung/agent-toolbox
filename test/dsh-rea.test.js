'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REA_PACKAGE, reaLocalScript, reaMcpLines } = require('../src/main/dsh-service');

// overlay 里的路径统一写成正斜杠（yamlPath 会把 Windows 的 \ 换成 /），比较时两边都归一——否则 Windows CI 上
// path.join 出来的反斜杠路径和 YAML 里的永远不等（栽过一次）
const fwd = (s) => String(s).replace(/\\/g, '/');
const parse = (lines) => {
  const text = lines.join('\n');
  return {
    text,
    command: JSON.parse(text.match(/command: (".*")/)[1]),
    args: JSON.parse('[' + text.match(/args: \[(.*)\]/)[1] + ']'),
  };
};

test('REA MCP：dsh-runtime 里装好了就显式用 node 跑本地 rea.mjs mcp（最快、离线可用）', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-ud-'));
  const local = reaLocalScript(userData);
  fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, '');
  const { command, args, text } = parse(reaMcpLines({ nodeBin: '/n/bin/node', userData, platform: 'darwin' }));
  assert.equal(command, '/n/bin/node');
  assert.deepEqual(args, [fwd(local), 'mcp']);
  assert.match(text, /serverName: rea/);
  assert.match(text, /failOnStartupError: false/, '首装慢/失败不能拖垮 DSH');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('REA MCP：没装本地包就按官方形状走 npx，但把 npx 软链解到 npx-cli.js 并显式用 node 跑——GUI 下 PATH 没 node 也能起', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-node-'));
  fs.mkdirSync(path.join(dir, 'lib', 'npm', 'bin'), { recursive: true });
  const cli = path.join(dir, 'lib', 'npm', 'bin', 'npx-cli.js'); fs.writeFileSync(cli, '');
  fs.symlinkSync(cli, path.join(dir, 'npx'));   // 和 nvm/官方包一样：bin/npx 是软链，指向 npm/bin/npx-cli.js
  const nodeBin = path.join(dir, 'node'); fs.writeFileSync(nodeBin, '');
  const { command, args } = parse(reaMcpLines({ nodeBin, userData: path.join(dir, 'no-such-userdata'), platform: 'darwin' }));
  assert.equal(command, fwd(nodeBin));
  assert.deepEqual(args, [fwd(fs.realpathSync(cli)), '-y', REA_PACKAGE, 'mcp']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REA MCP：解析不到 node 就退回 PATH 里的 npx；Windows 按 REA 文档包一层 cmd.exe /d /c', () => {
  const none = parse(reaMcpLines({ nodeBin: '', userData: '', platform: 'darwin' }));
  assert.equal(none.command, 'npx');
  assert.deepEqual(none.args, ['-y', REA_PACKAGE, 'mcp']);
  const win = parse(reaMcpLines({ nodeBin: 'C:\\node\\node.exe', userData: '', platform: 'win32' }));
  assert.equal(win.command, 'cmd.exe');
  assert.deepEqual(win.args, ['/d', '/c', 'npx', '-y', REA_PACKAGE, 'mcp']);
});

test('REA MCP：版本固定在 rea-agents@<ver>，不写 latest（可复现、升级要重测 doctor）', () => {
  assert.match(REA_PACKAGE, /^rea-agents@\d+\.\d+\.\d+$/);
});
