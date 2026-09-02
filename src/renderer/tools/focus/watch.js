import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

/**
 * 大佬动态：X（Twitter）上的 AI 圈关键人物，一人一个常驻 webview。
 * 登录态存在 persist:focus 分区，登一次之后进来就是登录状态。
 */
const PRESET_WATCHERS = [
  { handle: 'sama', name: 'Sam Altman', note: 'OpenAI CEO（奥特曼）' },
  { handle: 'gdb', name: 'Greg Brockman', note: 'OpenAI 联合创始人' },
  { handle: 'ilyasut', name: 'Ilya Sutskever', note: 'SSI 联合创始人 / 研究者' },
  { handle: 'OpenAI', name: 'OpenAI', note: '官方账号' },
  { handle: 'DarioAmodei', name: 'Dario Amodei', note: 'Anthropic CEO' },
  { handle: 'AnthropicAI', name: 'Anthropic', note: 'Claude 官方' },
  { handle: 'demishassabis', name: 'Demis Hassabis', note: 'Google DeepMind CEO' },
  { handle: 'ylecun', name: 'Yann LeCun', note: 'AI 研究者 / Meta' },
  { handle: 'JeffDean', name: 'Jeff Dean', note: 'Google AI 研究者' },
  { handle: 'drfeifei', name: 'Fei-Fei Li', note: 'AI 研究者 / World Labs' },
  { handle: 'AndrewYNg', name: 'Andrew Ng', note: 'AI 教育与研究者' },
  { handle: 'elonmusk', name: 'Elon Musk', note: 'xAI / Tesla' },
  { handle: 'xAI', name: 'xAI', note: '官方账号' },
  { handle: 'GoogleDeepMind', name: 'Google DeepMind', note: '官方账号' },
  { handle: 'GoogleAI', name: 'Google AI', note: '官方账号' },
  { handle: 'MistralAI', name: 'Mistral AI', note: '官方账号' },
  { handle: 'huggingface', name: 'Hugging Face', note: '开源模型社区' },
  { handle: 'QwenLM', name: 'Qwen', note: '通义千问官方' },
  { handle: 'karpathy', name: 'Andrej Karpathy', note: '前 OpenAI/Tesla' },
  { handle: 'DrJimFan', name: 'Jim Fan', note: 'NVIDIA 研究者' },
];

const PARTITION = 'persist:focus';
const AVATAR_TONES = [
  ['#7c6cf2', '#3a3278'], ['#e58a5d', '#633c32'], ['#5da9d9', '#294b6b'],
  ['#61bd91', '#285847'], ['#d86b9c', '#612f4c'], ['#d2a450', '#654c28'],
];

export function createWatch(root, ctx) {
  const { config } = ctx;
  const views = new Map(); // handle -> webview
  let activeHandle = null;

  const chipsEl = h('div', { class: 'news__chips' });
  const viewHost = h('div', { class: 'research__views', hidden: true });
  const emptyEl = h('div', { class: 'faint watch__empty', hidden: true },
    '还没有关注对象，先在上面添加一个 X 用户名。');
  const profileGrid = h('div', { class: 'watch__profiles' });
  const profileCards = h('div', { class: 'watch__profile-grid' });

  function allWatchers() {
    return [...PRESET_WATCHERS, ...(config.get('focus.watchExtra') || [])];
  }

  const address = h('input', { class: 'field mono research__address', readonly: true });
  const profileBack = h('button', {
    class: 'btn btn--icon', title: '返回头像墙', onclick: () => showProfiles(),
  }, iconFor('arrowLeft'));
  const viewBar = h('div', { class: 'bar research__viewbar', hidden: true },
    profileBack,
    h('button', { class: 'btn btn--icon', title: '后退', onclick: () => views.get(activeHandle)?.goBack() }, iconFor('arrowLeft')),
    h('button', { class: 'btn btn--icon', title: '刷新', onclick: () => views.get(activeHandle)?.reload() }, iconFor('refresh')),
    address,
    h('button', {
      class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开',
      onclick: () => activeHandle && window.toolbox.shell.openExternal(`https://x.com/${activeHandle}`),
    }, iconFor('external')),
  );

  function initials(watcher) {
    const source = String(watcher.name || watcher.handle || '?').replace(/^@/, '').trim();
    const parts = source.split(/[\s·-]+/).filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  function avatarFor(watcher, index) {
    const tone = AVATAR_TONES[index % AVATAR_TONES.length];
    const avatar = h('span', {
      class: 'watch__avatar',
      style: { background: `linear-gradient(145deg, ${tone[0]}, ${tone[1]})` },
    }, h('span', { class: 'watch__avatar-fallback' }, initials(watcher)));
    const loadAvatar = window.toolbox.watch?.avatar;
    if (loadAvatar) {
      loadAvatar(watcher.handle).then((dataUrl) => {
        if (!dataUrl) return;
        const image = h('img', { src: dataUrl, alt: '', class: 'watch__avatar-image' });
        image.addEventListener('error', () => image.remove());
        avatar.appendChild(image);
      }).catch(() => {});
    }
    return avatar;
  }

  function renderProfiles() {
    profileCards.textContent = '';
    for (const [index, watcher] of allWatchers().entries()) {
      const custom = !PRESET_WATCHERS.includes(watcher);
      const openButton = h('button', {
        class: `watch__profile${activeHandle === watcher.handle ? ' is-active' : ''}`,
        dataset: { handle: watcher.handle },
        onclick: () => select(watcher),
      },
        avatarFor(watcher, index),
        h('span', { class: 'watch__profile-copy' },
          h('strong', {}, watcher.name),
          h('span', { class: 'watch__profile-handle' }, `@${watcher.handle}`),
          h('span', { class: 'watch__profile-note' }, watcher.note || 'X 用户'),
        ),
        h('span', { class: 'watch__profile-arrow' }, '→'),
      );
      const card = h('div', { class: 'watch__profile-card' }, openButton);
      if (custom) card.appendChild(h('button', {
        class: 'watch__profile-del', title: '移除这个关注对象',
        onclick: async (event) => {
          event.stopPropagation();
          const list = (config.get('focus.watchExtra') || []).filter((x) => x.handle !== watcher.handle);
          await config.set('focus.watchExtra', list);
          renderChips();
          renderProfiles();
        },
      }, '×'));
      profileCards.appendChild(card);
    }
  }

  function showProfiles() {
    viewBar.setAttribute('hidden', '');
    viewHost.setAttribute('hidden', '');
    profileGrid.removeAttribute('hidden');
    emptyEl.setAttribute('hidden', '');
  }

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
    profileGrid.setAttribute('hidden', '');
    viewBar.removeAttribute('hidden');
    viewHost.removeAttribute('hidden');
    for (const chip of chipsEl.querySelectorAll('[data-handle]')) {
      chip.classList.toggle('is-active', chip.dataset.handle === watcher.handle);
    }
    for (const card of profileCards.querySelectorAll('[data-handle]')) {
      card.classList.toggle('is-active', card.dataset.handle === watcher.handle);
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
        renderProfiles();
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
        renderProfiles();
        select(watcher);
      },
    });
    chipsEl.appendChild(input);
  }

  root.append(
    h('div', { class: 'bar' },
      h('strong', { class: 'watch__heading' }, iconFor('x', 'ui-icon'), h('span', {}, '关注对象')),
      chipsEl,
    ),
    viewBar,
    profileGrid,
    emptyEl,
    viewHost,
  );

  renderChips();
  profileGrid.append(
    h('div', { class: 'watch__profiles-intro' },
      h('div', { class: 'watch__profiles-mark' }, 'X'),
      h('div', {},
        h('strong', {}, 'AI 圈关注墙'),
        h('p', { class: 'faint' }, '点击头像直接进入对应账号的 X 动态。登录一次，之后就能持续追踪。'),
      ),
      h('span', { class: 'watch__profiles-count faint' }, `${allWatchers().length} 个账号`),
    ),
    profileCards,
  );
  renderProfiles();
}
