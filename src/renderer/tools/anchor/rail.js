import { h, toast } from '../../core/ui.js';
import { toMarkdown } from './store.js';

/**
 * 贴在 AI 网页右边的侧栏。
 * 三段：问题栈（你在第几层）、追问队列（欠自己的）、摘录（捞回来的）。
 * 刻意做得窄，它是给你「瞥一眼」的，不是让你在这儿办公。
 */
export function createRail(store, { fill, toNotebook }) {
  const stackEl = h('div', { class: 'anchor__stack' });
  const queueEl = h('div', { class: 'anchor__queue' });
  const clipsEl = h('div', { class: 'anchor__clips' });
  const titleEl = h('div', { class: 'anchor__title' });

  const diveInput = h('input', {
    class: 'field field--sm',
    placeholder: '往下钻：先写下这个子问题…',
    onkeydown: (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const text = diveInput.value.trim();
      if (!text) return;
      store.push(text);
      diveInput.value = '';
      fill(text);
      toast(`已下钻到第 ${store.depth()} 层，问完点「返回」`, 'good');
    },
  });

  const queueInput = h('input', {
    class: 'field field--sm',
    placeholder: '待会儿还要问…（回车记下，不打断）',
    onkeydown: (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const text = queueInput.value.trim();
      if (!text) return;
      store.enqueue(text);
      queueInput.value = '';
    },
  });

  function renderStack() {
    const thread = store.current();
    titleEl.textContent = thread ? thread.title : '还没有线索';
    stackEl.textContent = '';
    const stack = thread ? thread.stack : [];
    if (!stack.length) {
      stackEl.appendChild(h('div', { class: 'anchor__empty' }, '主线还空着。问第一个问题，或者在下面写下要钻的子问题。'));
      return;
    }
    stack.forEach((item, i) => {
      const isCurrent = i === stack.length - 1;
      stackEl.appendChild(h('div', {
        class: `anchor__level${isCurrent ? ' is-current' : ''}`,
        style: `padding-left:${i * 12}px`,
        title: item.q,
      },
      h('span', { class: 'anchor__level-tag' }, isCurrent ? '现在' : `第${i + 1}层`),
      h('span', { class: 'anchor__level-q' }, item.q),
      isCurrent ? null : h('button', {
        class: 'btn btn--xs btn--ghost', title: '把这一层的问题填回输入框',
        onclick: () => fill(item.q),
      }, '↩')));
    });
  }

  function renderQueue() {
    const thread = store.current();
    const queue = thread ? thread.queue : [];
    queueEl.textContent = '';
    if (!queue.length) {
      queueEl.appendChild(h('div', { class: 'anchor__empty' }, '没有欠着的追问。'));
      return;
    }
    for (const item of queue) {
      queueEl.appendChild(h('div', { class: 'anchor__qitem' },
        h('span', { class: 'anchor__qtext', title: item.q }, item.q),
        h('button', {
          class: 'btn btn--xs', title: '现在就问它',
          onclick: () => {
            const q = store.dequeue(item.id);
            if (q) { store.push(q); fill(q); }
          },
        }, '问'),
        h('button', {
          class: 'btn btn--xs btn--ghost', title: '不问了',
          onclick: () => store.dequeue(item.id),
        }, '×')));
    }
  }

  function renderClips() {
    const thread = store.current();
    const clips = thread ? thread.clips : [];
    clipsEl.textContent = '';
    if (!clips.length) {
      clipsEl.appendChild(h('div', { class: 'anchor__empty' }, '在答案里选中一段文字，选区旁边会冒出「摘」。'));
      return;
    }
    for (const clip of clips) {
      const body = h('div', { class: 'anchor__clip-text' }, clip.text);
      clipsEl.appendChild(h('div', { class: 'anchor__clip' },
        clip.q ? h('div', { class: 'anchor__clip-q', title: clip.q }, `问：${clip.q}`) : null,
        body,
        h('div', { class: 'anchor__clip-ops' },
          h('button', {
            class: 'btn btn--xs btn--ghost',
            onclick: () => { body.classList.toggle('is-open'); },
          }, '展开'),
          h('button', {
            class: 'btn btn--xs btn--ghost',
            onclick: async () => {
              await window.toolbox.clipboard.writeText(clip.text);
              toast('已复制', 'good');
            },
          }, '复制'),
          h('button', {
            class: 'btn btn--xs btn--ghost',
            onclick: () => store.removeClip(clip.id),
          }, '删'))));
    }
  }

  function render() {
    renderStack();
    renderQueue();
    renderClips();
  }

  const root = h('aside', { class: 'anchor' },
    h('div', { class: 'anchor__head' },
      titleEl,
      h('button', {
        class: 'btn btn--xs btn--ghost', title: '新开一条线索',
        onclick: () => { store.newThread(); toast('新线索已开', 'good'); },
      }, '＋')),

    h('div', { class: 'anchor__sec' },
      h('div', { class: 'anchor__sec-head' }, '主线',
        h('button', {
          class: 'btn btn--xs', title: '这一层问完了，回到上一层',
          onclick: () => {
            if (!store.depth()) return toast('已经在最上层了', 'info');
            const parent = store.pop();
            if (parent) { fill(parent); toast('回到上一层，问题已填回输入框', 'good'); }
            else toast('全部问完了，主线清空', 'good');
          },
        }, '↑ 返回')),
      stackEl,
      diveInput),

    h('div', { class: 'anchor__sec' },
      h('div', { class: 'anchor__sec-head' }, '想问还没问'),
      queueEl,
      queueInput),

    h('div', { class: 'anchor__sec anchor__sec--grow' },
      h('div', { class: 'anchor__sec-head' }, '摘录'),
      clipsEl),

    h('div', { class: 'anchor__foot' },
      h('button', {
        class: 'btn btn--sm',
        onclick: () => {
          const thread = store.current();
          if (!thread) return toast('还没有线索可收', 'info');
          toNotebook(thread.title, toMarkdown(thread));
        },
      }, '收束到记事本')),
  );

  store.onChange(render);
  render();

  return { root, render };
}
