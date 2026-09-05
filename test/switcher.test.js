'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// ---------- 够用的 DOM 替身：只实现 switcher / ui.h / iconFor 真正碰到的那几个口子 ----------

function makeElement(tag) {
  const el = {
    tag,
    nodeType: 1,   // ui.h 用它区分「元素」和「要包成文本节点的值」
    className: '',
    style: {},
    hidden: false,
    textContent: '',
    innerHTML: '',
    children: [],
    listeners: new Map(),
    attrs: {},
    classList: {
      toggle(name, on) {
        const has = el.className.split(/\s+/).includes(name);
        const want = on === undefined ? !has : Boolean(on);
        if (want === has) return want;
        el.className = want
          ? `${el.className} ${name}`.trim()
          : el.className.split(/\s+/).filter((x) => x && x !== name).join(' ');
        return want;
      },
      contains: (name) => el.className.split(/\s+/).includes(name),
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
      if (name === 'hidden') el.hidden = true;
      if (name === 'class') el.className = value;
    },
    addEventListener(type, fn) {
      if (!el.listeners.has(type)) el.listeners.set(type, []);
      el.listeners.get(type).push(fn);
    },
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    replaceChildren(...nodes) { el.children = [...nodes]; },
    fire(type, event = {}) {
      for (const fn of el.listeners.get(type) || []) fn(event);
    },
  };
  return el;
}

function installDom() {
  const winListeners = new Map();
  global.document = {
    body: makeElement('body'),
    createElement: makeElement,
    createElementNS: (_ns, tag) => makeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  };
  global.window = {
    addEventListener(type, fn, capture) {
      const key = `${type}:${Boolean(capture)}`;
      if (!winListeners.has(key)) winListeners.set(key, []);
      winListeners.get(key).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const key = `${type}:${Boolean(capture)}`;
      const list = winListeners.get(key) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    // 按注册顺序派发；派发中被移除的监听器不再调用，和浏览器一致。
    dispatch(type, event = {}) {
      const list = [...(winListeners.get(`${type}:true`) || [])];
      for (const fn of list) {
        if ((winListeners.get(`${type}:true`) || []).includes(fn)) fn({ type, preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
  };
}

const TOOLS = [
  { id: 'study', title: '学习', icon: 'graduation', hint: '实践敲码' },
  { id: 'tasks', title: '任务', icon: 'checkList' },
  { id: 'focus', title: '专注', icon: 'target' },
  { id: 'video', title: '视频', icon: 'monitor' },
];

async function mount({ current = 'study' } = {}) {
  installDom();
  const { createSwitcher } = await import('../src/renderer/core/switcher.js');
  const picked = [];
  const store = new Map([['ui.mru', TOOLS.map((t) => t.id)]]);
  const api = createSwitcher({
    tools: TOOLS,
    getCurrentId: () => current,
    onPick: (id) => picked.push(id),
    config: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
  });
  const panel = global.document.body.children[0];
  const grid = panel.children[0].children[0];
  const active = () => grid.children.findIndex((card) => card.classList.contains('is-active'));
  return { api, panel, grid, active, picked, win: global.window };
}

const ctrlTab = { key: 'Tab', ctrlKey: true };
const escape = { key: 'Escape', ctrlKey: false };

test('Ctrl+Tab 弹出面板并默认落在「上一个用过的」', async () => {
  const { win, panel, active } = await mount();
  win.dispatch('keydown', ctrlTab);
  assert.equal(panel.hidden, false);
  assert.equal(active(), 1, '打开时应高亮第二项，按一次就能跳回刚才那个');
  win.dispatch('keydown', escape);
});

test('连点 Tab 只挪高亮，不重建卡片', async () => {
  const { win, grid, active } = await mount();
  win.dispatch('keydown', ctrlTab);
  const before = [...grid.children];
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keydown', ctrlTab);
  assert.equal(active(), 3);
  assert.deepEqual(grid.children, before, '翻页重建 DOM 会让快速连点掉帧、按键像丢了');
  win.dispatch('keydown', escape);
});

test('松开 Ctrl 才真正切过去', async () => {
  const { win, panel, picked } = await mount();
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keyup', { key: 'Tab', ctrlKey: true });   // 先松 Tab：还按着 Ctrl，不算数
  assert.equal(panel.hidden, false);
  assert.deepEqual(picked, []);
  win.dispatch('keyup', { key: 'Control', ctrlKey: false });
  assert.equal(panel.hidden, true);
  assert.deepEqual(picked, ['tasks']);
});

test('松开 Ctrl 那一下即使仍上报 ctrlKey=true，也必须立刻切', async () => {
  // 真机上这一下的修饰键状态不一定已经翻成 false（macOS 双 Ctrl、webview 转发都会这样）。
  // 只认 !ctrlKey 的话，「手松开」就没反应，非得再敲个空格才切 —— 正是要防的回归。
  const { win, panel, picked } = await mount();
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keyup', { key: 'Control', ctrlKey: true });
  assert.equal(panel.hidden, true);
  assert.deepEqual(picked, ['tasks']);
});

test('Control 的 keyup 丢了也不会卡住：下一个不带 Ctrl 的输入就收尾', async () => {
  const { win, panel, picked } = await mount();
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keydown', ctrlTab);
  // 焦点在 webview 之间跳时这一下常常收不到 —— 直接跳过，模拟丢失
  win.dispatch('pointermove', { ctrlKey: false });
  assert.equal(panel.hidden, true, '面板必须收起来，不能永远挂在屏幕上');
  assert.deepEqual(picked, ['focus']);
});

test('鼠标没真的动过时，hover 不抢键盘选中的项', async () => {
  const { win, grid, active } = await mount();
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keydown', ctrlTab);
  assert.equal(active(), 2);
  grid.children[0].fire('pointermove', {});          // 卡片刚插进 DOM 时静止光标底下的那一下
  assert.equal(active(), 2, '静止的光标不该改选中项');
  win.dispatch('pointermove', { ctrlKey: true });     // 用户真的动了鼠标（还按着 Ctrl）
  grid.children[0].fire('pointermove', {});
  assert.equal(active(), 0, '真移动之后 hover 才接管');
  win.dispatch('keydown', escape);
});

test('Esc 取消，不切工具', async () => {
  const { win, panel, picked } = await mount();
  win.dispatch('keydown', ctrlTab);
  win.dispatch('keydown', escape);
  assert.equal(panel.hidden, true);
  assert.deepEqual(picked, []);
});

test('松手那下彻底丢失时，兜底计时器收尾', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, panel, picked } = await mount();
  win.dispatch('keydown', ctrlTab);
  t.mock.timers.tick(10001);
  assert.equal(panel.hidden, true);
  assert.deepEqual(picked, ['tasks']);
  t.mock.timers.reset();
});

test('主进程转发：不只认 Control 的 keyUp，任何「Ctrl 已松」的输入都收尾', () => {
  const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  assert.match(main, /switcherHolding\s*=\s*true;[\s\S]{0,200}switcher:step/);
  assert.match(
    main,
    /input\.type === 'keyUp' && input\.key === 'Control'\)\s*\|\|\s*!ctrl\)[\s\S]{0,160}switcher:commit/,
    'Control 的 keyUp 必须无条件收尾，不能只靠 !ctrl —— 那条会让「手松开」失效',
  );
});
