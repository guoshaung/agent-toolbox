'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GitDesk, COMBOS, argsOk, describeGitError } = require('../src/main/git-desk');

test('只允许白名单里的 git 子命令', () => {
  assert.equal(argsOk(['status', '--short']), true);
  assert.equal(argsOk(['daemon']), false, '没列进白名单的不许跑');
  assert.equal(argsOk([]), false);
});

test('强推只准 --force-with-lease，-f / --force 一律拒', () => {
  assert.equal(argsOk(['push', '--force-with-lease']), true);
  assert.equal(argsOk(['push', '--force']), false);
  assert.equal(argsOk(['push', '-f']), false);
});

test('参数原样传给 git，不过 shell —— 分支名里带分号也拼不出第二条命令', async () => {
  const calls = [];
  const desk = new GitDesk({ execFile: async (file, args, opts) => { calls.push({ file, args, cwd: opts.cwd }); return { stdout: '', stderr: '' }; } });
  await desk.run('/repo', ['switch', '-c', 'evil; rm -rf /']);
  assert.deepEqual(calls[0].args, ['switch', '-c', 'evil; rm -rf /']);
  assert.equal(calls[0].file, 'git');
  assert.equal(calls[0].cwd, '/repo');
});

test('每套组合拳的每一步都过得了白名单', () => {
  const p = { main: 'main', branch: 'x', message: 'm', name: 'n', count: 2, file: 'a.js', hasUpstream: true, rebasing: false };
  for (const combo of COMBOS) {
    for (const args of combo.steps(p)) {
      assert.equal(argsOk(args), true, `${combo.id} 里的 git ${args.join(' ')} 不合法`);
    }
  }
});

test('「提交并推送」在没有上游分支时自动 push -u', () => {
  const ship = COMBOS.find((c) => c.id === 'ship');
  assert.deepEqual(ship.steps({ message: 'm', hasUpstream: false }).at(-1), ['push', '-u', 'origin', 'HEAD']);
  assert.deepEqual(ship.steps({ message: 'm', hasUpstream: true }).at(-1), ['push']);
});

test('会丢东西的那几套都标了 danger，界面才会先问一遍', () => {
  for (const id of ['discard', 'squash', 'forcepush', 'abort', 'cleanbranch']) {
    assert.equal(COMBOS.find((c) => c.id === id).danger, true, `${id} 应该标 danger`);
  }
  assert.ok(!COMBOS.find((c) => c.id === 'save').danger, '存一笔不该弹确认');
});

test('组合拳跑到哪步失败就停在哪步，前面的输出都带回来', async () => {
  let n = 0;
  const desk = new GitDesk({
    store: { get: () => [], set: () => {} },
    execFile: async (file, args) => {
      if (args[0] === 'status' || args[0] === 'rev-parse' || args[0] === 'log' || args[0] === 'symbolic-ref' || args[0] === 'branch') return { stdout: '', stderr: '' };
      n += 1;
      if (args[0] === 'rebase') { const e = new Error('x'); e.stderr = 'CONFLICT (content): Merge conflict in a.js'; throw e; }
      return { stdout: `ok ${args[0]}`, stderr: '' };
    },
  });
  const result = await desk.runCombo('/repo', 'sync', {});
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 2, 'fetch 成功、rebase 失败，就停在第二步');
  assert.match(result.error, /冲突/);
  assert.ok(!result.steps.some((s) => s.args[0] === 'push'), '失败之后不许继续往下推');
});

test('git 的报错挑有用的那句说人话', () => {
  assert.match(describeGitError({ stderr: 'fatal: not a git repository (or any of the parent directories)' }), /不是 git 仓库/);
  assert.match(describeGitError({ stderr: 'error: failed to push some refs (non-fast-forward)' }), /先「同步主线」/);
  assert.match(describeGitError({ stderr: 'nothing to commit, working tree clean' }), /没有任何改动/);
});
