'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { RemoteControl } = require('../src/main/remote-control');

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: pathname, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('手机控制服务要求一次性令牌，并执行受控动作', async () => {
  const calls = [];
  const remote = new RemoteControl({ preferredPort: 0, deviceName: 'Test Toolbox', onCommand: async (type, payload) => {
    calls.push({ type, payload });
    return { accepted: true };
  } });
  const state = await remote.start({ token: 'persisted-test-token' });
  try {
    const denied = await request(state.port, '/');
    assert.equal(denied.status, 401);
    const page = await request(state.port, `/?token=${encodeURIComponent(state.token)}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Test Toolbox/);
    assert.ok(state.urls.some((url) => url.includes('persisted-test-token')));
    const result = await request(state.port, `/api/command?token=${encodeURIComponent(state.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clipboard.write', payload: { text: 'hello' } }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(calls, [{ type: 'clipboard.write', payload: { text: 'hello' } }]);
  } finally {
    await remote.stop();
  }
});

test('停止后手机控制端口关闭', async () => {
  const remote = new RemoteControl({ preferredPort: 0, onCommand: async () => ({}) });
  const state = await remote.start();
  await remote.stop();
  await assert.rejects(request(state.port, '/'), /ECONNREFUSED|socket hang up|AggregateError|ECONNRESET/);
});

test('重启服务时可以复用持久化令牌', async () => {
  const remote = new RemoteControl({ preferredPort: 0, onCommand: async () => ({}) });
  const first = await remote.start({ token: 'stable-pairing-token' });
  await remote.stop();
  const second = await remote.start({ token: 'stable-pairing-token' });
  try {
    assert.equal(second.token, first.token);
    assert.ok(second.port > 0);
  } finally {
    await remote.stop();
  }
});
