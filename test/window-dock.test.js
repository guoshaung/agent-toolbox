'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowDock } = require('../src/main/window-dock');

function createDock(side = 'left') {
  const mainWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 100, y: 80, width: 900, height: 700 }),
    webContents: { send() {} },
  };
  const values = new Map([['dock.side', side], ['dock.ratio', 0.58]]);
  return new WindowDock({
    app: { getPath: () => '/tmp/agent-toolbox-window-dock-test' },
    BrowserWindow: class {},
    screen: {
      getCursorScreenPoint: () => ({ x: side === 'right' ? 1000 : 100, y: 300 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 } }),
    },
    store: {
      get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      set: (key, value) => values.set(key, value),
    },
    getMainWindow: () => mainWindow,
  });
}

test('回形针布防只识别工具箱指定侧的边缘', () => {
  const leftDock = createDock('left');
  assert.equal(leftDock.isCursorAtDockEdge({ x: 118, y: 300 }), true);
  assert.equal(leftDock.isCursorAtDockEdge({ x: 990, y: 300 }), false);

  const rightDock = createDock('right');
  assert.equal(rightDock.isCursorAtDockEdge({ x: 982, y: 300 }), true);
  assert.equal(rightDock.isCursorAtDockEdge({ x: 120, y: 300 }), false);
});

test('外部窗口按住拖到边缘并松手后自动吸附', async () => {
  const dock = createDock('left');
  dock.armed = true;
  const responses = [
    { ok: true, pid: 22, name: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac', title: 'ChatGPT', buttons: 0, bounds: { x: 0, y: 0, width: 800, height: 700 } },
    { ok: true, pid: 22, name: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac', title: 'ChatGPT', buttons: 0, bounds: { x: 0, y: 0, width: 800, height: 700 } },
    { ok: true, pid: 22, name: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac', title: 'ChatGPT', buttons: 0, bounds: { x: 0, y: 0, width: 800, height: 700 } },
    { ok: true, pid: 99, name: 'Electron', bundleId: 'com.github.Electron', title: 'Agent 工具箱', buttons: 0, bounds: { x: 100, y: 80, width: 900, height: 700 } },
  ];
  dock.run = async () => responses.shift();
  let attached = null;
  dock.attachTarget = async (target) => { attached = target; return { ok: true }; };

  await dock.pollArmedWindow();
  assert.equal(attached, null);
  assert.ok(dock.dragSeenAt > 0);

  await new Promise((resolve) => setTimeout(resolve, 400));
  await dock.pollArmedWindow();
  assert.equal(attached?.name, 'Microsoft Edge');
  assert.equal(dock.armed, false);
});
