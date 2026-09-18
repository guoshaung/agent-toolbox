'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { AGENTS, installedAgents, resolveCommand, validWorkingDirectory } = require('../src/main/agent-runtime');

test('AI office exposes only explicit agent command adapters', () => {
  assert.deepEqual(Object.keys(AGENTS).sort(),
    ['claude', 'codex', 'dsh', 'gemini', 'glm', 'grok', 'kimi', 'opencode']);
  // 新加的三家也不许带绕过审批的参数 —— 这条用例的意义就在这儿，
  // 名单变长不要紧，变长时每一家都得重新过一遍这个检查。
  for (const id of ['kimi', 'glm', 'grok']) {
    const args = AGENTS[id].args('test', '/tmp');
    assert.equal(args.some((a) => /dangerous|bypass|skip-permission|--yes|--auto/i.test(a)), false,
      `${id} 不该带绕过审批的参数`);
  }
  assert.equal(AGENTS.codex.args('test', '/tmp').includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.deepEqual(AGENTS.codex.args('test', '/tmp').slice(1, 3), ['--sandbox', 'read-only']);
  assert.equal(AGENTS.claude.args('test').includes('--dangerously-skip-permissions'), false);
  assert.equal(AGENTS.claude.args('test').includes('plan'), true);
  assert.equal(AGENTS.opencode.args('test', '/tmp').includes('--auto'), false);
  assert.equal(AGENTS.gemini.args('test').includes('plan'), true);
});

test('installed agent detection returns stable public fields', () => {
  for (const agent of installedAgents()) {
    assert.equal(typeof agent.id, 'string');
    assert.equal(typeof agent.label, 'string');
    assert.equal(typeof agent.installed, 'boolean');
  }
});

test('working directory falls back to home for invalid paths', () => {
  const missing = path.join(os.tmpdir(), `missing-agent-office-${Date.now()}`);
  assert.equal(validWorkingDirectory(missing), os.homedir());
  assert.equal(validWorkingDirectory(os.tmpdir()), os.tmpdir());
});

test('command resolver does not claim unknown executables are installed', () => {
  assert.equal(resolveCommand(`agent-toolbox-missing-${Date.now()}`), '');
});

// ---- 坏桩不能被当成能用的命令 ----
// 实测：npm 包卸载不干净会留下一个没有 shebang 的文本桩（本机的
// /usr/local/bin/claude 就是），existsSync 为真、X_OK 也为真，但 spawn 直接
// ENOEXEC（Unknown system error -8）。派发台上看着「已安装」，一点就失败。
test('isRunnable：只认 shebang 脚本和真可执行文件', (t) => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const { isRunnable } = require('../src/main/agent-runtime.js');
  if (process.platform === 'win32') return t.skip('Windows 上不看魔数');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runnable-'));
  const write = (name, content) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    fs.chmodSync(file, 0o755);
    return file;
  };

  // 卸载残留的那种桩：可执行位有、内容是没有 shebang 的 shell 文本
  assert.equal(isRunnable(write('stub', 'echo "Error: not installed" >&2\nexit 1\n')), false);
  assert.equal(isRunnable(write('script', '#!/bin/sh\necho hi\n')), true);
  assert.equal(isRunnable(write('elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]))), true);
  assert.equal(isRunnable(write('macho', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c]))), true);
  assert.equal(isRunnable(path.join(dir, '不存在')), false);
  // 没有可执行位的即使内容对也不算
  const noExec = path.join(dir, 'noexec');
  fs.writeFileSync(noExec, '#!/bin/sh\n');
  fs.chmodSync(noExec, 0o644);
  assert.equal(isRunnable(noExec), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
