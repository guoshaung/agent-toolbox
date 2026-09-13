const assert = require('node:assert/strict');
const test = require('node:test');

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
  const id = `/tmp/agent-toolbox-shelf-${process.pid}-${Date.now()}`;
  const command = `${process.execPath} -e "setTimeout(() => {}, 350)"`;
  try {
    assert.equal(start({ id, cwd: '/tmp', command }).ok, true);
    assert.equal(start({ id, cwd: '/tmp', command }).ok, false);
    assert.equal(stop(id).ok, true);
    await waitForStopped(id);
    assert.equal(start({ id, cwd: '/tmp', command }).ok, true);
    assert.equal(stop(id).ok, true);
    await waitForStopped(id);
  } finally {
    stop(id);
  }
});
