/**
 * 对话锚点的数据层。
 *
 * 一条「线索」= 一次有价值的对话。里面三样东西各治一个病：
 *   stack  问题栈——治「钻下去就回不来」。最后一项是你此刻在问的，前面是欠着的。
 *   queue  追问队列——治「当时想到待会儿要问，后来忘了」。
 *   clips  摘录——治「好答案被冲走」。
 */

const KEY = 'anchor.threads';
const CUR = 'anchor.currentId';
const MAX_THREADS = 40;
const MAX_CLIPS = 300;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// 同一毫秒内连着压几层是常事，Date.now() 会全相等，排序就乱。
// 单独给一个只增不减的序号，专门用来还原「先后」。
let seq = 0;
const nextSeq = () => (seq += 1);

export function createStore(config) {
  let threads = config.get(KEY) || [];
  let currentId = config.get(CUR) || (threads[0] && threads[0].id) || null;
  const listeners = new Set();

  const save = () => {
    threads = threads.slice(0, MAX_THREADS);
    config.set(KEY, threads);
    config.set(CUR, currentId);
    for (const fn of listeners) fn();
  };

  const api = {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    all: () => threads,
    current: () => threads.find((t) => t.id === currentId) || null,

    /** 没有线索时先开一条，不然摘录无处可去。标题先用第一个问题顶着，随时可改。 */
    ensure(title = '') {
      let thread = api.current();
      if (!thread) {
        thread = {
          id: uid(),
          title: title || '未命名线索',
          createdAt: Date.now(),
          stack: [],
          queue: [],
          clips: [],
        };
        threads = [thread, ...threads];
        currentId = thread.id;
        save();
      }
      return thread;
    },

    newThread(title = '') {
      const thread = {
        id: uid(),
        title: title || `线索 ${threads.length + 1}`,
        createdAt: Date.now(),
        stack: [],
        queue: [],
        clips: [],
      };
      threads = [thread, ...threads];
      currentId = thread.id;
      save();
      return thread;
    },

    select(id) {
      if (!threads.some((t) => t.id === id)) return;
      currentId = id;
      save();
    },

    remove(id) {
      threads = threads.filter((t) => t.id !== id);
      if (currentId === id) currentId = threads[0] ? threads[0].id : null;
      save();
    },

    rename(id, title) {
      const thread = threads.find((t) => t.id === id);
      if (!thread) return;
      thread.title = title.trim() || thread.title;
      save();
    },

    // ---- 问题栈 ----

    /** 下钻：把新问题压上去。之前那个不动，它就是你的返回地址。 */
    push(question) {
      const thread = api.ensure(question);
      // 还没问过东西、名字又是自动起的，就拿第一个问题当标题——收束进记事本时才认得出是哪条。
      if (!thread.stack.length && /^(未命名线索|线索 \d+)$/.test(thread.title)) {
        thread.title = question.slice(0, 40);
      }
      // d 记录压栈那一刻的层深：收束时按它缩进，兄弟问题才不会被排成父子。
      thread.stack.push({ id: uid(), q: question.trim(), at: Date.now(), seq: nextSeq(), d: thread.stack.length });
      save();
    },

    /** 返回：弹掉当前这层，把父问题还给你。返回值就是父问题，供填回输入框。 */
    pop() {
      const thread = api.current();
      if (!thread || !thread.stack.length) return null;
      const done = thread.stack.pop();
      thread.answered = thread.answered || [];
      thread.answered.push({ ...done, doneAt: Date.now() });
      save();
      const parent = thread.stack[thread.stack.length - 1];
      return parent ? parent.q : null;
    },

    depth() {
      const thread = api.current();
      return thread ? thread.stack.length : 0;
    },

    // ---- 追问队列 ----

    enqueue(question) {
      const thread = api.ensure();
      thread.queue.push({ id: uid(), q: question.trim(), at: Date.now() });
      save();
    },

    dequeue(id) {
      const thread = api.current();
      if (!thread) return null;
      const idx = thread.queue.findIndex((q) => q.id === id);
      if (idx < 0) return null;
      const [item] = thread.queue.splice(idx, 1);
      save();
      return item.q;
    },

    // ---- 摘录 ----

    addClip(clip) {
      const thread = api.ensure(clip.q || '');
      thread.clips.unshift({ id: uid(), ...clip });
      thread.clips = thread.clips.slice(0, MAX_CLIPS);
      save();
      return thread.clips[0];
    },

    removeClip(id) {
      const thread = api.current();
      if (!thread) return;
      thread.clips = thread.clips.filter((c) => c.id !== id);
      save();
    },
  };

  return api;
}

/**
 * 收束：把一条线索摊成 markdown。
 * 问题栈写成缩进大纲，是为了能直接喂给记事本的 \outline 转成结构树。
 */
export function toMarkdown(thread) {
  if (!thread) return '';
  const time = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false });
  const lines = [`# ${thread.title}`, '', `> 起于 ${time(thread.createdAt)}`, ''];

  const asked = [...(thread.answered || []), ...thread.stack]
    .sort((a, b) => (a.seq || 0) - (b.seq || 0) || a.at - b.at);
  if (asked.length) {
    lines.push('## 问过的路径', '');
    for (const item of asked) lines.push(`${'  '.repeat(item.d || 0)}${item.q}`);
    lines.push('');
  }

  if (thread.stack.length) {
    lines.push('## 还欠着的问题', '');
    for (const item of thread.stack) lines.push(`- [ ] ${item.q}`);
    lines.push('');
  }

  if (thread.queue.length) {
    lines.push('## 想问还没问', '');
    for (const item of thread.queue) lines.push(`- [ ] ${item.q}`);
    lines.push('');
  }

  if (thread.clips.length) {
    lines.push('## 摘录', '');
    for (const clip of [...thread.clips].reverse()) {
      if (clip.q) lines.push(`**问：** ${clip.q}`, '');
      lines.push(clip.text.split('\n').map((l) => `> ${l}`).join('\n'), '');
      lines.push(`<sub>${time(clip.at)}</sub>`, '', '---', '');
    }
  }

  return lines.join('\n');
}
