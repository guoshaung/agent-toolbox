'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppControls, CTRL_Q, CTRL_TILDE, SAFE_PROCESS_NAMES } = require('../src/main/app-controls');

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    set: (key, value) => { values.set(key, value); return { ok: true }; },
  };
}

function createControls({ platform = 'win32', ownPid = 100, store, exec } = {}) {
  return new AppControls({ store: store || createStore(), platform, ownPid, exec });
}

test('默认禁用：不注册全局快捷键，状态标记未启用', () => {
  const controls = createControls();
  const status = controls.status();
  assert.equal(status.supported, true);
  assert.equal(status.enabled, false);
  assert.equal(status.shortcuts.close, 'Ctrl+Q');
  assert.equal(status.shortcuts.cycle, 'Ctrl+~');
});

test('setEnabled 持久化开关并反映到状态', () => {
  const store = createStore();
  const controls = createControls({ store });
  assert.equal(store.get('appControls.enabled', false), false);
  const after = controls.setEnabled(true);
  assert.equal(after.enabled, true);
  assert.equal(store.get('appControls.enabled', false), true);
  assert.equal(controls.enabled(), true);
});

test('非 Windows 平台不支持且不会注册快捷键', () => {
  const controls = createControls({ platform: 'darwin' });
  assert.equal(controls.status().supported, false);
  const globalShortcut = { register: () => true, unregister: () => {} };
  const result = controls.register(globalShortcut);
  assert.equal(result.registered, false);
});

test('关闭前台窗口跳过工具箱自身进程', async () => {
  let execCalled = false;
  const controls = createControls({
    ownPid: 4242,
    store: createStore(),
    exec: async () => { execCalled = true; throw new Error('不应执行'); },
  });
  controls.run = async () => ({ handle: '1', pid: 4242, title: 'Agent 工具箱' });
  const result = await controls.closeForeground();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(execCalled, false);
});

test('关闭前台窗口跳过受保护系统进程', async () => {
  const controls = createControls({
    ownPid: 4242,
    exec: async () => ({ stdout: '{"Id":4,"ProcessName":"System","MainWindowTitle":"系统进程"}' }),
  });
  controls.run = async () => ({ handle: '2', pid: 4, title: '系统进程' });
  const result = await controls.closeForeground();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.ok(SAFE_PROCESS_NAMES.has('system'));
});

test('关闭前台窗口跳过没有可关闭标题的窗口', async () => {
  let execCalled = false;
  const controls = createControls({
    ownPid: 4242,
    exec: async () => { execCalled = true; throw new Error('不应执行'); },
  });
  controls.run = async () => ({ handle: '3', pid: 5555, title: '' });
  const result = await controls.closeForeground();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(execCalled, false);
});

test('关闭前台窗口对普通应用执行 taskkill 并返回结果', async () => {
  const calls = [];
  const controls = createControls({
    ownPid: 4242,
    exec: async (command, args) => {
      calls.push({ command, args });
      if (command === 'powershell.exe') return { stdout: JSON.stringify({ Id: 7777, ProcessName: 'notepad', MainWindowTitle: '未命名' }) };
      return { stdout: '' };
    },
  });
  controls.run = async () => ({ handle: '4', pid: 7777, title: '未命名' });
  const result = await controls.closeForeground();
  assert.equal(result.ok, true);
  assert.equal(result.pid, 7777);
  assert.equal(result.name, 'notepad');
  const taskkill = calls.find((call) => call.command === 'taskkill.exe');
  assert.ok(taskkill);
  assert.deepEqual(taskkill.args, ['/PID', '7777', '/T', '/F']);
});

test('关闭前台窗口无法识别进程时不执行 taskkill', async () => {
  const commands = [];
  const controls = createControls({
    ownPid: 4242,
    exec: async (command) => { commands.push(command); throw new Error('进程不存在'); },
  });
  controls.run = async () => ({ handle: '5', pid: 8888, title: '神秘窗口' });
  const result = await controls.closeForeground();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.ok(!commands.includes('taskkill.exe'));
});

test('窗口循环：同一进程只有单窗口时跳过', async () => {
  const controls = createControls({ ownPid: 4242 });
  controls.run = async (command) => {
    if (command === 'foreground') return { handle: 'a', pid: 9001, title: 'A' };
    return { windows: [{ handle: 'a', pid: 9001, title: 'A' }] };
  };
  const result = await controls.cycleWindows();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
});

test('窗口循环：排除工具箱自身窗口', async () => {
  const controls = createControls({ ownPid: 4242 });
  controls.run = async (command, args) => {
    if (command === 'foreground') return { handle: 'a', pid: 9002, title: 'A' };
    if (command === 'activate') return { ok: true };
    return { windows: [
      { handle: 'self', pid: 4242, title: 'Agent 工具箱' },
      { handle: 'a', pid: 9002, title: 'A' },
      { handle: 'b', pid: 9002, title: 'B' },
      { handle: 'hidden', pid: 9002, title: '' },
    ] };
  };
  const result = await controls.cycleWindows();
  assert.equal(result.ok, true);
  assert.equal(result.window.handle, 'b');
});

test('窗口循环：同一进程多窗口时依次切到下一个，回绕回到第一个', async () => {
  const handles = ['a', 'b', 'c'];
  let foregroundIndex = 0;
  const activated = [];
  const controls = createControls({ ownPid: 4242 });
  controls.run = async (command, args) => {
    if (command === 'foreground') return { handle: handles[foregroundIndex], pid: 9100, title: 'A' };
    if (command === 'activate') {
      activated.push(args[0]);
      foregroundIndex = handles.indexOf(args[0]);
      return { ok: true };
    }
    return { windows: handles.map((handle) => ({ handle, pid: 9100, title: 'A' })) };
  };
  const first = await controls.cycleWindows();
  assert.equal(first.ok, true);
  assert.equal(first.window.handle, 'b');
  const second = await controls.cycleWindows();
  assert.equal(second.ok, true);
  assert.equal(second.window.handle, 'c');
  const third = await controls.cycleWindows();
  assert.equal(third.ok, true);
  assert.equal(third.window.handle, 'a');
  assert.deepEqual(activated, ['b', 'c', 'a']);
});

test('注册快捷键时按开关状态决定是否注册', () => {
  const registered = [];
  const unregistered = [];
  const globalShortcut = {
    register: (accelerator, fn) => { registered.push({ accelerator, fn }); return true; },
    unregister: (accelerator) => unregistered.push(accelerator),
  };

  const disabled = createControls({ store: createStore({ 'appControls.enabled': false }) });
  const result = disabled.register(globalShortcut);
  assert.equal(result.registered, false);
  assert.ok(unregistered.includes(CTRL_Q));
  assert.ok(unregistered.includes(CTRL_TILDE));
  assert.equal(registered.length, 0);

  const enabled = createControls({ store: createStore({ 'appControls.enabled': true }) });
  const enabledResult = enabled.register(globalShortcut);
  assert.equal(enabledResult.registered, true);
  assert.deepEqual(registered.map((item) => item.accelerator).sort(), [CTRL_Q, CTRL_TILDE].sort());
});

test('快捷键占用冲突时返回未注册状态', () => {
  const globalShortcut = { register: () => false, unregister: () => {} };
  const controls = createControls({ store: createStore({ 'appControls.enabled': true }) });
  const result = controls.register(globalShortcut);
  assert.equal(result.registered, false);
  assert.equal(result.closeRegistered, false);
  assert.equal(result.cycleRegistered, false);
});
