import { h } from './ui.js';
import { iconFor } from './icons.js';

/**
 * 模块切换器（Ctrl+Tab）。
 *
 * 学的是 macOS 的 Cmd+Tab：按住不放能看见「即将切到哪」，松手才真的切。
 *
 * 为什么不是 Fn+Tab：Chromium 不暴露 Fn 键状态，Electron 的修饰键列表里
 * 也只有 shift/control/alt/meta/capsLock/numLock，没有 fn —— Fn+Tab 在程序里
 * 和单独按 Tab 完全一样，分不出来。Cmd+Tab 又被系统占着。Ctrl+Tab 是最接近的。
 *
 * 顺序按「最近用过」排，所以按一次 Ctrl+Tab 就是在最近两个模块之间来回跳，
 * 这才是 Cmd+Tab 真正好用的地方。
 */
export function createSwitcher({ tools, getCurrentId, onPick, config }) {
  let order = [];          // 最近使用顺序，最新的在前
  let open = false;
  let index = 0;
  let cards = [];

  const grid = h('div', { class: 'switcher__grid' });
  const label = h('div', { class: 'switcher__label' });
  const root = h('div', { class: 'switcher', hidden: true },
    h('div', { class: 'switcher__panel' },
      grid,
      label,
      h('div', { class: 'switcher__hint faint' }, '按住 Ctrl 连点 Tab 切换 · ⇧Tab 往回 · 松开 Ctrl 确认 · Esc 取消'),
    ),
  );
  document.body.appendChild(root);

  /** 启动时先用存下来的顺序，没有就按注册顺序。 */
  function loadOrder() {
    const saved = config.get('ui.mru') || [];
    const valid = saved.filter((id) => tools.some((t) => t.id === id));
    const rest = tools.map((t) => t.id).filter((id) => !valid.includes(id));
    order = [...valid, ...rest];
  }

  function noteUse(id) {
    order = [id, ...order.filter((x) => x !== id)];
    config.set('ui.mru', order);
  }

  function render() {
    grid.textContent = '';
    cards = [];
    const list = order.map((id) => tools.find((t) => t.id === id)).filter(Boolean);
    list.forEach((tool, i) => {
      const card = h('button', {
        class: `switcher__card${i === index ? ' is-active' : ''}`,
        onmouseenter: () => { index = i; render(); },
        onclick: () => commit(),
      },
      h('span', { class: 'switcher__icon' }, iconFor(tool.icon)),
      h('span', { class: 'switcher__name' }, tool.title));
      cards.push(card);
      grid.appendChild(card);
    });
    const picked = list[index];
    label.textContent = picked ? (picked.hint || picked.title) : '';
  }

  function show() {
    if (open) return;
    open = true;
    loadOrder();
    // 打开时高亮「上一个用的」，跟 Cmd+Tab 一样：按一次就回到刚才那个
    const current = getCurrentId();
    order = [current, ...order.filter((x) => x !== current)];
    index = order.length > 1 ? 1 : 0;
    root.hidden = false;
    render();
  }

  function step(delta) {
    if (!open) { show(); return; }
    const total = order.length || 1;
    index = (index + delta + total) % total;
    render();
  }

  function close() {
    open = false;
    root.hidden = true;
  }

  function commit() {
    if (!open) return;
    const id = order[index];
    close();
    if (id && id !== getCurrentId()) onPick(id);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
  }, true);

  // 松开 Ctrl 才真正切过去 —— 这就是「按住能看、松手才生效」
  window.addEventListener('keyup', (event) => {
    if (open && (event.key === 'Control' || !event.ctrlKey)) commit();
  }, true);

  // 焦点在 webview（文档、快问、科研那些内嵌页面）里时，键盘事件被 guest 吃掉，
  // 上面这个 window 监听根本收不到。主进程用 before-input-event 截下来转发到这里。
  window.toolbox?.switcher?.onStep?.(({ back }) => step(back ? -1 : 1));
  window.toolbox?.switcher?.onCommit?.(() => commit());

  // 刻意不做「失焦自动关闭」：焦点跑进 webview 时宿主页面的 hasFocus() 就是 false，
  // 用它判断会把刚弹出来的面板立刻关掉；改用主窗口 blur 又会在别的时机误关。
  // 面板本来就有两个出口（松开 Ctrl 确认 / Esc 取消），少一个自作聪明的分支更稳。

  loadOrder();
  return { noteUse, show };
}
