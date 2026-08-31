import { h, toast } from '../../core/ui.js';

/**
 * 大佬动态：X（Twitter）上的 AI 圈关键人物，一人一个常驻 webview。
 * 登录态存在 persist:focus 分区，登一次之后进来就是登录状态。
 */
const PRESET_WATCHERS = [
  { handle: 'sama', name: 'Sam Altman', note: 'OpenAI CEO（奥特曼）' },
  { handle: 'OpenAI', name: 'OpenAI', note: '官方账号' },
  { handle: 'DarioAmodei', name: 'Dario Amodei', note: 'Anthropic CEO' },
  { handle: 'AnthropicAI', name: 'Anthropic', note: 'Claude 官方' },
  { handle: 'elonmusk', name: 'Elon Musk', note: 'xAI / Tesla' },
  { handle: 'karpathy', name: 'Andrej Karpathy', note: '前 OpenAI/Tesla' },
];

const PARTITION = 'persist:focus';

export function createWatch(root, ctx) {
  const { config } = ctx;
  const views = new Map(); // handle -> webview
  let activeHandle = null;

  const chipsEl = h('div', { class: 'news__chips' });
  const viewHost = h('div', { class: 'research__views', hidden: true });
  const emptyEl = h('div', { class: 'faint', style: { padding: '32px 18px' } },
    '上面选一个关注对象，动态直接在这里看。X 需要登录，登录一次后状态会保留。');

  function allWatchers() {
    return [...PRESET_WATCHERS, ...(config.get('focus.watchExtra') || [])];
  }

  const address = h('input', { class: 'field mono research__address', readonly: true });
  const viewBar = h('div', { class: 'bar research__viewbar', hidden: true },
    h('button', { class: 'btn btn--icon', title: '后退', onclick: () => views.get(activeHandle)?.goBack() }, '←'),
    h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => views.get(activeHandle)?.reload() }, '⟳'),
    address,
    h('button', {
      class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
      onclick: () => activeHandle && window.toolbox.shell.openExternal(`https://x.com/${activeHandle}`),
    }, '↗'),
  );

  function select(watcher) {
    activeHandle = watcher.handle;
    if (!views.has(watcher.handle)) {
      const view = h('webview', { partition: PARTITION, src: `https://x.com/${watcher.handle}` });
      view.addEventListener('did-navigate', (e) => { if (activeHandle === watcher.handle) address.value = e.url; });
      view.addEventListener('did-navigate-in-page', (e) => { if (activeHandle === watcher.handle) address.value = e.url; });
      views.set(watcher.handle, view);
      viewHost.appendChild(view);
    }
    for (const [handleKey, view] of views) {
      view.style.display = handleKey === watcher.handle ? 'flex' : 'none';
    }
    address.value = `https://x.com/${watcher.handle}`;
    emptyEl.setAttribute('hidden', '');
    viewBar.removeAttribute('hidden');
    viewHost.removeAttribute('hidden');
    for (const chip of chipsEl.querySelectorAll('[data-handle]')) {
      chip.classList.toggle('is-active', chip.dataset.handle === watcher.handle);
    }
  }

  function renderChips() {
    chipsEl.textContent = '';
    for (const watcher of allWatchers()) {
      const custom = !PRESET_WATCHERS.includes(watcher);
      chipsEl.appendChild(h('span', { class: 'watch__chip-wrap' },
        h('button', {
          class: 'btn btn--sm',
          dataset: { handle: watcher.handle },
          title: watcher.note || `@${watcher.handle}`,
          onclick: () => select(watcher),
        }, watcher.name),
        custom && h('button', {
          class: 'watch__chip-del', title: '移除',
          onclick: async () => {
            const list = (config.get('focus.watchExtra') || []).filter((x) => x.handle !== watcher.handle);
            await config.set('focus.watchExtra', list);
            renderChips();
          },
        }, '×'),
      ));
    }
    const input = h('input', {
      class: 'field field--sm watch__add',
      placeholder: '＋ X 用户名',
      onkeydown: async (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const handle = input.value.trim().replace(/^@/, '');
        if (!/^[A-Za-z0-9_]{1,20}$/.test(handle)) return toast('用户名格式不对（字母/数字/下划线）', 'bad');
        if (allWatchers().some((w) => w.handle.toLowerCase() === handle.toLowerCase())) {
          return toast('这个人已经在列表里了', 'info');
        }
        const list = config.get('focus.watchExtra') || [];
        const watcher = { handle, name: `@${handle}`, note: '' };
        list.push(watcher);
        await config.set('focus.watchExtra', list);
        input.value = '';
        renderChips();
        select(watcher);
      },
    });
    chipsEl.appendChild(input);
  }

  root.append(
    h('div', { class: 'bar' },
      h('strong', {}, 'X 关注'),
      chipsEl,
    ),
    viewBar,
    emptyEl,
    viewHost,
  );

  renderChips();
}
