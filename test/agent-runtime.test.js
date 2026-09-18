'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { AGENTS, installedAgents, resolveCommand, validWorkingDirectory } = require('../src/main/agent-runtime');

test('AI office exposes only explicit agent command adapters', () => {
  assert.deepEqual(Object.keys(AGENTS).sort(), ['claude', 'codex', 'dsh', 'gemini', 'opencode']);
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
