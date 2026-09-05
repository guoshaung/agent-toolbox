'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { install, run, terminal, validateCode } = require('../src/main/practice-runner');

test('Python 实践真的运行并返回 stdout', async () => {
  const result = await run('python', 'print(2 + 3)');
  assert.equal(result.ok, true);
  assert.match(result.stdout, /5/);
  assert.equal(result.engine, 'python3');
});

test('Python 单元格可以复用上方单元格变量', async () => {
  const result = await run('python', 'print(answer + 1)', { prelude: 'answer = 41' });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /42/);
});

test('SQL 实践在临时数据库中运行查询', async () => {
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

test('学习终端可以真实运行 uv', async () => {
  const result = await terminal('uv --version');
  assert.equal(result.ok, true);
  assert.match(result.stdout, /uv /);
  assert.equal(result.engine, 'learning-terminal');
});
