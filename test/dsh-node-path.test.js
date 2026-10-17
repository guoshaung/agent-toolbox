'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { withNodeOnPath, dshSpawnSpec } = require('../src/main/dsh-service');

const D = path.delimiter;

test('DSH 子进程 PATH：把 node 目录放到最前面，launchd 那套没 node 的 PATH 也能跑 env node 脚本', () => {
  const env = withNodeOnPath({ PATH: ['/usr/bin', '/bin'].join(D), HOME: '/Users/x' }, '/Users/x/.nvm/versions/node/v22.23.1/bin/node');
  assert.equal(env.PATH, ['/Users/x/.nvm/versions/node/v22.23.1/bin', '/usr/bin', '/bin'].join(D));
  assert.equal(env.HOME, '/Users/x', '其他环境变量原样保留');
});

test('DSH 子进程 PATH：node 目录已经在 PATH 里就挪到最前、不重复；没解析到 node 就原样返回', () => {
  const env = withNodeOnPath({ PATH: ['/usr/bin', '/opt/node/bin', '/bin'].join(D) }, '/opt/node/bin/node');
  assert.equal(env.PATH, ['/opt/node/bin', '/usr/bin', '/bin'].join(D));
  assert.deepEqual(withNodeOnPath({ PATH: '/usr/bin' }, ''), { PATH: '/usr/bin' });
  assert.equal(withNodeOnPath({}, '/opt/node/bin/node').PATH, '/opt/node/bin', 'PATH 为空也能给出');
});

test('DSH 启动命令：mac/linux 上显式用 node 跑 dsh 脚本；Windows 的 .cmd 原样交给 shell', () => {
  assert.deepEqual(dshSpawnSpec('/x/bin/dsh', '/x/bin/node', ['--profile', 'web']), { command: '/x/bin/node', args: ['/x/bin/dsh', '--profile', 'web'] });
  assert.deepEqual(dshSpawnSpec('C:\\npm\\dsh.cmd', 'C:\\node\\node.exe', ['--profile', 'web']), { command: 'C:\\npm\\dsh.cmd', args: ['--profile', 'web'] });
  assert.deepEqual(dshSpawnSpec('/x/bin/dsh', '', ['--profile', 'web']), { command: '/x/bin/dsh', args: ['--profile', 'web'] }, '没有 node 就退回老行为');
});
