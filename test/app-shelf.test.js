const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');

const { start, stop, status } = require('../src/main/app-shelf');

function waitForStopped(id) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const check = () => {
      if (!status()[id]?.running) return resolve();
      if (Date.now() >= deadline) return reject(new Error('工具架子进程停止超时'));
      setTimeout(check, 30);
    };
    check();
  });
}

test('工具架允许同一个项目在退出后再次启动', async () => {
  const id = `${os.tmpdir()}/agent-toolbox-shelf-${process.pid}-${Date.now()}`;
  const command = `${process.execPath} -e "setTimeout(() => {}, 350)"`;
  try {
    assert.equal(start({ id, cwd: os.tmpdir(), command }).ok, true);
    assert.equal(start({ id, cwd: os.tmpdir(), command }).ok, false);
    assert.equal(stop(id).ok, true);
    await waitForStopped(id);
    assert.equal(start({ id, cwd: os.tmpdir(), command }).ok, true);
    assert.equal(stop(id).ok, true);
    await waitForStopped(id);
  } finally {
    stop(id);
  }
});

test('闲鱼自动回复种子：点 ▶ 跑 run.py，且不带任何本机密码', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { probe } = require('../src/main/app-shelf');
  const dir = path.join(__dirname, '..', 'container-seed', '闲鱼自动回复');
  const info = probe(dir);
  assert.equal(info.kind, 'Python');
  assert.match(info.command, /run\.py$/);
  // 密码在第一次运行时生成到 .runtime/xianyu.env，种子里绝不能有
  assert.deepEqual(fs.readdirSync(dir).sort(), ['README-放进容器后怎么用.md', 'run.py']);
});
