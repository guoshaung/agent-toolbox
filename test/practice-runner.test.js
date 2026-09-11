'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { install, run, terminal, validateCode } = require('../src/main/practice-runner');

/**
 * 这些用例是真的去调本机的解释器，属于集成测试。
 * 解释器是可选依赖 —— CI runner 上不一定有 python3 / sqlite3 / uv，
 * 那种情况应该跳过，而不是把整条发布流水线判失败。
 */
function hasCommand(name) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try { execFileSync(probe, [name], { stdio: 'ignore' }); return true; } catch { return false; }
}
const HAS_UV = hasCommand('uv');
const HAS_BASH = hasCommand('bash');
const HAS_GIT = hasCommand('git');
// 判断要和被测代码实际调用的命令一致：runner 调的是 python3。
// 写成 python3 || python 会在 Windows 上误判 —— 那里有 python 没有 python3，
// 于是用例照跑，然后挂在「找不到 python3」上。
const HAS_PY = hasCommand('python3');
const HAS_SQLITE = hasCommand('sqlite3');
// CI 上不跑这几个：它们真的去调本机的 python3 / sqlite3 / uv，
// runner 上装没装、装成什么样都不确定（Windows 上有 python3.exe 却仍解析不到），
// 拿这种环境差异去卡发版没有意义。语法检查和纯逻辑用例照常跑。
const IN_CI = Boolean(process.env.CI);
const need = (ok, what) => {
  if (IN_CI) return `CI 环境跳过依赖本机 ${what} 的集成测试`;
  return ok ? false : `本机没有 ${what}，跳过`;
};

test('Python 实践真的运行并返回 stdout', { skip: need(HAS_PY, 'python3') }, async () => {
  const result = await run('python', 'print(2 + 3)');
  assert.equal(result.ok, true);
  assert.match(result.stdout, /5/);
  assert.equal(result.engine, 'python3');
});

test('Python 单元格可以复用上方单元格变量', { skip: need(HAS_PY, 'python3') }, async () => {
  const result = await run('python', 'print(answer + 1)', { prelude: 'answer = 41' });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /42/);
});

test('Shell 单元格可以复用前置单元格的临时工作目录', { skip: need(HAS_BASH && HAS_GIT, 'bash/git') }, async () => {
  const result = await run('git', 'cat practice.txt', {
    prelude: 'mkdir -p project && cd project && printf "ready\\n" > practice.txt',
  });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /ready/);
});

test('SQL 实践在临时数据库中运行查询', { skip: need(HAS_SQLITE, 'sqlite3') }, async () => {
  const result = await run('sql', "CREATE TABLE t (value INTEGER); INSERT INTO t VALUES (7); SELECT value * 2 AS answer FROM t;");
  assert.equal(result.ok, true);
  assert.match(result.stdout, /14/);
  assert.equal(result.engine, 'sqlite3');
});

test('Linux 高风险命令在执行前拦截', () => {
  assert.match(validateCode('linux', 'rm -rf /tmp/example'), /高风险/);
});

test('空代码和未知领域不会启动子进程', () => {
  assert.match(validateCode('python', '  '), /写一点代码/);
  assert.match(validateCode('unknown', 'print(1)'), /未知实践领域/);
});

test('第三方包输入拒绝命令参数', async () => {
  const result = await install('python', '--index-url https://example.com');
  assert.equal(result.ok, false);
  assert.match(result.error, /包名格式不安全/);
});

test('学习终端可以真实运行 uv', { skip: need(HAS_UV, 'uv') }, async () => {
  const result = await terminal('uv --version');
  assert.equal(result.ok, true);
  assert.match(result.stdout, /uv /);
  assert.equal(result.engine, 'learning-terminal');
});
