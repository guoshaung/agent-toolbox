/**
 * 记忆栈：桌宠「吃掉」的对话片段都存在这儿。
 *
 * 解决的是这么个场景：在 Codex / Claude 里聊出了好东西，
 * 接着往下问，几十轮之后想回头看——只能一路往上翻，翻不到。
 * 与其翻，不如当时就喂给桌宠，之后在这里搜。
 */

const KEY = 'memory.items';
const MAX = 400;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * 列表标题只取第一行，并把 markdown 标记去掉。
 * 直接截前 46 个字符会把「## 三件事」「**加粗**」这些符号一起截进来，列表看着全是噪声。
 */
export function makeTitle(text, maxLen = 46) {
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^[-*_=#>`|\s]+$/.test(line)) || '';
  const clean = firstLine
    .replace(/^#{1,6}\s*/, '')          // 标题号
    .replace(/^[-*+]\s+/, '')           // 列表符
    .replace(/^\d+\.\s+/, '')          // 有序列表
    .replace(/^>\s*/, '')               // 引用
    .replace(/\*\*(.+?)\*\*/g, '$1')   // 加粗
    .replace(/`([^`]+)`/g, '$1')        // 行内代码
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : (clean || '(空)');
}

/** Codex 的转录里混着大量工具调用，喂进来只会把真正的答案淹掉。 */
export function isToolNoise(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return /^\[?(external_agent_)?tool_(call|result)/i.test(t)
    || /^\[external_agent_tool_call:/i.test(t)
    || /^<(system-reminder|command-name|local-command)/i.test(t);
}

export function createMemory(config) {
  let items = [];
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  return {
    async load() {
      items = (await config.get(KEY)) || [];
      emit();
      return items;
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    all: () => items,

    async persist() {
      items = items.slice(0, MAX);
      await config.set(KEY, items);
      emit();
    },

    /** 吃一条。同一段文字重复喂只留一份，省得队列里全是重复。 */
    async eat({ text, title, source = '手动', sessionId = '', role = '', at = Date.now(), cwd = '' }) {
      const body = String(text || '').trim();
      if (!body) return null;
      if (items.some((it) => it.text === body)) return null;
      const item = {
        id: uid(),
        title: title || makeTitle(body),
        text: body,
        source, sessionId, role, cwd,
        at,
        starred: false,
        note: '',
      };
      items = [item, ...items];
      await this.persist();
      return item;
    },

    async eatMany(list) {
      let added = 0;
      for (const one of list) {
        const body = String(one.text || '').trim();
        if (!body || items.some((it) => it.text === body)) continue;
        items = [{
          id: uid(),
          title: one.title || makeTitle(body),
          text: body,
          source: one.source || '手动',
          sessionId: one.sessionId || '',
          role: one.role || '',
          cwd: one.cwd || '',
          at: one.at || Date.now(),
          starred: false,
          note: '',
        }, ...items];
        added += 1;
      }
      if (added) await this.persist();
      return added;
    },

    async remove(id) {
      items = items.filter((it) => it.id !== id);
      await this.persist();
    },

    async toggleStar(id) {
      const item = items.find((it) => it.id === id);
      if (!item) return;
      item.starred = !item.starred;
      await this.persist();
    },

    async setNote(id, note) {
      const item = items.find((it) => it.id === id);
      if (!item) return;
      item.note = note;
      await this.persist();
    },

    /** 搜索就是这东西存在的理由——代替往上翻。标题、正文、来源、备注一起搜。 */
    search(keyword) {
      const needle = String(keyword || '').trim().toLowerCase();
      const starredFirst = (a, b) => Number(b.starred) - Number(a.starred) || b.at - a.at;
      if (!needle) return [...items].sort(starredFirst);
      return items
        .filter((it) => `${it.title} ${it.text} ${it.source} ${it.note}`.toLowerCase().includes(needle))
        .sort(starredFirst);
    },
  };
}

/** 导出成 markdown，交给记事本。 */
export function memoryToMarkdown(list, heading = '记忆栈') {
  const time = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false });
  const out = [`# ${heading}`, ''];
  for (const item of list) {
    out.push(`## ${item.title}`, '');
    out.push(`> ${item.source}${item.role ? ` · ${item.role}` : ''} · ${time(item.at)}`, '');
    if (item.note) out.push(`**我的批注：** ${item.note}`, '');
    out.push('```', item.text, '```', '');
  }
  return out.join('\n');
}
