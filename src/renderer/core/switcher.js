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
 *
 * ── 两个必须守住的点（都踩过坑）──
 *
 * 1. 翻页只改 class，不重建 DOM。卡片带 SVG 图标，十几个卡片每按一下 Tab
 *    全量重建，快速连点时渲染排在 IPC 消息后面，按键看着就「丢了」。
 *
 * 2. 不能只靠 Control 的 keyup 收尾。焦点在 webview 之间跳、窗口被别的
 *    应用抢走时，那一下 keyup 收不到，面板就永远挂在屏幕上（表现为「松开后
 *    停住了」）。所以改成：只要之后任何一个输入事件显示 Ctrl 已经不在按下
 *    状态，就当作松手 —— 键盘、鼠标移动、滚轮都算。
 */

// 极端情况（松手那下丢了、之后也没有任何输入）的兜底。切工具本身没有破坏性，
// 到点就按用户本来的意图切过去，比把遮罩永远挂在屏幕上强。
const STUCK_TIMEOUT_MS = 10000;

export function createSwitcher({ tools, getCurrentId, onPick, config }) {
  let order = [];          // 最近使用顺序，最新的在前
  let open = false;
  let index = 0;
  let cards = [];
  let list = [];           // 当前面板上的工具，和 cards 一一对应
  let pointerArmed = false; // 鼠标真的动过之前，不让 hover 抢走键盘选中的项
  let stuckTimer = 0;

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

  /** 建卡片。只在面板打开时跑一次，翻页不碰这里。 */
  function build() {
    list = order.map((id) => tools.find((t) => t.id === id)).filter(Boolean);
    cards = list.map((tool, i) => h('button', {
      class: 'switcher__card',
      // 用 pointermove 而不是 mouseenter：卡片刚插进 DOM 时，静止的光标底下
      // 也会收到一次 enter，那会把键盘刚选中的项抢走。
      onpointermove: () => { if (pointerArmed && index !== i) { index = i; paint(); } },
      onclick: () => { index = i; commit(); },
    },
    h('span', { class: 'switcher__icon' }, iconFor(tool.icon)),
    h('span', { class: 'switcher__name' }, tool.title)));
    grid.replaceChildren(...cards);
  }

  /** 翻页只做这件事：挪高亮 + 换说明文字。 */
  function paint() {
    cards.forEach((card, i) => card.classList.toggle('is-active', i === index));
    const picked = list[index];
    label.textContent = picked ? (picked.hint || picked.title) : '';
  }

  function show() {
    if (open) return;
    open = true;
    pointerArmed = false;
    loadOrder();
    // 打开时高亮「上一个用的」，跟 Cmd+Tab 一样：按一次就回到刚才那个
    const current = getCurrentId();
    order = [current, ...order.filter((x) => x !== current)];
    index = order.length > 1 ? 1 : 0;
    build();
    paint();
    root.hidden = false;
    watchRelease(true);
  }

  function step(delta) {
    if (!open) { show(); return; }
    const total = list.length || 1;
    index = (index + delta + total) % total;
    paint();
    armStuckTimer();
  }

  function close() {
    open = false;
    root.hidden = true;
    watchRelease(false);
  }

  function commit() {
    if (!open) return;
    const id = order[index];
    close();
    if (id && id !== getCurrentId()) onPick(id);
  }

  // ---------- 松手检测 ----------
  //
  // Chromium 在**所有**键盘 / 鼠标事件上都带 ctrlKey，所以不用等 Control 那一下
  // keyup：面板开着的时候，任何一个「Ctrl 没按住」的事件都说明手已经松了。
  // 少收到一个 keyup 不再等于面板卡死。

  function onAnyInput(event) {
    if (!open) return;
    if (event.type === 'pointermove') pointerArmed = true;
    // 两条收尾路径，缺一不可：
    //   1) Control 自己那一下 keyup —— 不看 ctrlKey。松开左 Ctrl 时右 Ctrl 还按着、
    //      或者事件带的修饰键状态是「按下那一刻」的快照，ctrlKey 都可能还是 true，
    //      只认 !ctrlKey 会让「手松开」这条主路径失效，非得再敲个键才切。
    //   2) 之后任何一个显示 Ctrl 已松的输入 —— 兜住 keyup 整个丢掉的情况。
    if (event.type === 'keyup' && event.key === 'Control') { commit(); return; }
    if (event.ctrlKey || event.metaKey) { armStuckTimer(); return; }
    // Tab 自己的 keyup 会在 Ctrl 还按着时到，被上面挡掉；能走到这里就是真松手了。
    commit();
  }

  function armStuckTimer() {
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => { if (open) commit(); }, STUCK_TIMEOUT_MS);
  }

  const RELEASE_EVENTS = ['keyup', 'keydown', 'pointermove', 'pointerdown', 'wheel'];

  function watchRelease(on) {
    for (const name of RELEASE_EVENTS) {
      if (on) window.addEventListener(name, onAnyInput, true);
      else window.removeEventListener(name, onAnyInput, true);
    }
    if (on) armStuckTimer();
    else clearTimeout(stuckTimer);
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

  // 焦点在 webview（文档、快问、科研那些内嵌页面）里时，键盘事件被 guest 吃掉，
  // 上面这个 window 监听根本收不到。主进程用 before-input-event 截下来转发到这里。
  window.toolbox?.switcher?.onStep?.(({ back }) => step(back ? -1 : 1));
  window.toolbox?.switcher?.onCommit?.(() => commit());

  // 刻意不做「失焦自动关闭」：焦点跑进 webview 时宿主页面的 hasFocus() 就是 false，
  // 用它判断会把刚弹出来的面板立刻关掉；改用主窗口 blur 又会在别的时机误关。
  // 卡死由上面的松手检测 + 兜底计时器负责，不靠焦点状态猜。

  loadOrder();
  return { noteUse, show };
}
