'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = '../src/renderer/tools/gesture/gesture-state.js';

function fist(x = 10, y = 20, confidence = 0.9) {
  return { gesture: 'fist', x, y, confidence };
}
function open(x = 10, y = 20, confidence = 0.9) {
  return { gesture: 'open', x, y, confidence };
}
function none() {
  return { gesture: 'none', confidence: 0 };
}

async function runMachine(options, frames, onEvent) {
  const { GestureStateMachine } = await import(modulePath);
  const machine = new GestureStateMachine({ ...options, onEvent });
  const events = [];
  for (const frame of frames) events.push(...machine.update(frame));
  return { machine, events };
}

const load = () => import(modulePath);

test('isSnapTransition 只把 fist->open 视为 snap', async () => {
  const state = await load();
  assert.equal(state.isSnapTransition('fist', 'open'), true);
  assert.equal(state.isSnapTransition('open', 'fist'), false);
  assert.equal(state.isSnapTransition('fist', 'pointing'), false);
  assert.equal(state.isSnapTransition('none', 'fist'), false);
  assert.equal(state.isFistGesture('fist'), true);
  assert.equal(state.isOpenGesture('open'), true);
});

test('抖动序列达不到稳定帧数时不产生任何事件', async () => {
  const { events, machine } = await runMachine({}, [fist(), open(), fist(), open()]);
  assert.deepEqual(events, []);
  assert.equal(machine.state.gesture, 'none');
});

test('快速 fist->open 触发一次 snap 并带上稳定坐标', async () => {
  const { events } = await runMachine({ stableFrames: 2 }, [fist(), fist(), open(), open()]);
  const snaps = events.filter((event) => event.type === 'snap');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].frame, 4);
  assert.deepEqual(snaps[0].position, { x: 10, y: 20 });
  const changes = events.filter((event) => event.type === 'gesture-change');
  assert.deepEqual(changes.map((event) => [event.from, event.to]), [['none', 'fist'], ['fist', 'open']]);
});

test('反向 open->fist 以及非 fist 起始不会产生 snap', async () => {
  const { events } = await runMachine({ stableFrames: 2 }, [open(), open(), fist(), fist()]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 0);
  assert.equal(events.filter((event) => event.type === 'gesture-change').length, 2);
});

test('fist 后手短暂消失（宽容帧内）再张开仍算 snap', async () => {
  const { events } = await runMachine({ stableFrames: 2, graceFrames: 3 }, [
    fist(), fist(), none(), none(), open(), open(),
  ]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 1);
  assert.equal(events.filter((event) => event.type === 'gesture-change' && event.to === 'none').length, 0);
});

test('冷却期内快速 fist->open->fist->open 只响一次 snap', async () => {
  const { events } = await runMachine({ stableFrames: 2, cooldownFrames: 6 }, [
    fist(), fist(), open(), open(), fist(), fist(), open(), open(),
  ]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 1);
});

test('冷却期过后第二次 snap 正常触发', async () => {
  const { events } = await runMachine({ stableFrames: 2, cooldownFrames: 2 }, [
    fist(), fist(), open(), open(), fist(), fist(), open(), open(),
  ]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 2);
});

test('低置信度的 open 不会把 held fist 误判为 snap', async () => {
  const { events, machine } = await runMachine({ stableFrames: 2 }, [
    fist(), fist(), { gesture: 'open', x: 10, y: 20, confidence: 0.1 },
  ]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 0);
  assert.equal(machine.state.gesture, 'fist');
});

test('拳头保持 holdAfterFrames 后发出一次 fist-hold', async () => {
  const { events } = await runMachine({ stableFrames: 2, holdAfterFrames: 2 }, [
    fist(), fist(), fist(), fist(), fist(),
  ]);
  const holds = events.filter((event) => event.type === 'fist-hold');
  assert.equal(holds.length, 1);
  assert.equal(holds[0].frame, 4);
  assert.equal(holds[0].heldFrames >= 2, true);
});

test('reset 会清空状态重新开始', async () => {
  const { machine, events } = await runMachine({ stableFrames: 2 }, [fist(), fist(), open(), open()]);
  assert.equal(events.filter((event) => event.type === 'snap').length, 1);
  machine.reset();
  assert.equal(machine.state.gesture, 'none');
  assert.equal(machine.state.frame, 0);
  const empty = machine.update({ gesture: 'unknown', x: 0, y: 0, confidence: 0.9 });
  assert.deepEqual(empty, []);
});

test('onEvent 回调会同步收到事件', async () => {
  const received = [];
  const { events } = await runMachine({ stableFrames: 2 }, [fist(), fist(), open(), open()], (event) => received.push(event));
  assert.equal(received.length, events.length);
  assert.ok(received.every((event, index) => event === events[index]));
});

test('纯模块不依赖 DOM 或 Electron', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tools', 'gesture', 'gesture-state.js'), 'utf8');
  const forbidden = [
    /window\./, /document\./, /documentElement/, /getElementById/, /querySelector/,
    /addEventListener/, /navigator\./, /localStorage/, /new Image/, /canvas/i,
    /require\(/, /from['"]electron['"]/, /setTimeout/, /setInterval/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `不应包含 ${pattern}`);
  }
});