import { h, toast } from '../../core/ui.js';

/**
 * 聊天记录迁移：读 Codex / Claude / OpenCode / OMP / DSH / Qwen / Gemini
 * 本机保存的会话，导出成 md/json/html，或打包成一个迁移包 JSON 发给另一个 AI 继续聊。
 */
export default {
  id: 'history',
  title: '记录',
  icon: '🗂',
  hint: '导出各 AI 工具的本地聊天记录，打包给另一个 AI 继续聊',

  create(root, ctx) {
    const { config, clipboard } = { config: ctx.config, clipboard: window.toolbox.clipboard };
    const chat = window.toolbox.chat;

    let sessions = [];
    let sources = { codex: 'Codex' }; // 启动后从主进程拿全量
    let current = null; // 当前选中的会话（预览数据）
    let loading = false;

    const sourceSelect = h('select', { class: 'field field--sm history__source' });
    sourceSelect.addEventListener('change', () => {
      config.set('history.source', sourceSelect.value);
      refresh();
    });

    async function initSources() {
      try {
        sources = await chat.sources();
      } catch { /* 拿不到就用兜底的一项 */ }
      sourceSelect.textContent = '';
      for (const [id, label] of Object.entries(sources)) {
        sourceSelect.appendChild(h('option', { value: id }, label));
      }
      const saved = config.get('history.source', 'codex');
      sourceSelect.value = sources[saved] ? saved : Object.keys(sources)[0];
    }

    const searchInput = h('input', {
      class: 'field field--sm history__search',
      placeholder: '搜索标题…',
      oninput: () => renderList(),
    });

    const refreshBtn = h('button', { class: 'btn btn--sm', onclick: () => refresh() }, '刷新');
    const transferBtn = h('button', { class: 'btn btn--sm', onclick: () => readTransfer() }, '读迁移包');

    const listEl = h('div', { class: 'history__list' });
    const detailEl = h('div', { class: 'history__detail' });

    function fmtTime(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
    }

    async function refresh() {
      if (loading) return;
      loading = true;
      listEl.textContent = '';
      listEl.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 正在扫描本地会话…'));
      try {
        sessions = await chat.list(sourceSelect.value);
        renderList();
      } catch (err) {
        listEl.textContent = '';
        listEl.appendChild(h('div', { class: 'empty' }, `扫描失败：${err.message}`));
      } finally {
        loading = false;
      }
    }

    function renderList() {
      const kw = searchInput.value.trim().toLowerCase();
      const shown = kw ? sessions.filter((s) => (s.title || '').toLowerCase().includes(kw)) : sessions;
      listEl.textContent = '';
      if (!shown.length) {
        listEl.appendChild(h('div', { class: 'empty' },
          h('span', { class: 'empty__icon' }, '🗂'),
          sessions.length ? '没有匹配的会话' : '没扫到本地会话。',
          !sessions.length && h('div', { class: 'faint' }, `确认 ${sources[sourceSelect.value] || sourceSelect.value} 在这台机器上用过`),
        ));
        return;
      }
      listEl.appendChild(h('div', { class: 'history__list-head faint' },
        `共 ${sessions.length} 个会话${kw ? `，匹配 ${shown.length} 个` : ''}`));
      for (const s of shown) {
        const item = h('div', {
          class: `history__item${current && current.id === s.id ? ' is-active' : ''}`,
          onclick: () => openSession(s),
        },
          h('div', { class: 'history__item-title' }, s.title || '未命名'),
          h('div', { class: 'history__item-meta faint' }, `${fmtTime(s.updatedAt)} · ${s.count} 条`),
        );
        listEl.appendChild(item);
      }
    }

    function showDetailIdle() {
      detailEl.textContent = '';
      detailEl.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '🗂'),
        '左边选一个会话。',
        h('br'),
        h('span', { class: 'faint' }, '能导出成文件备份，也能打包发给另一个 AI 继续聊。'),
      ));
    }

    async function openSession(meta) {
      detailEl.textContent = '';
      detailEl.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 正在读取会话…'));
      try {
        current = await chat.load(sourceSelect.value, meta.id);
        if (!current) {
          detailEl.textContent = '';
          detailEl.appendChild(h('div', { class: 'empty' }, '会话读不到，可能被清理了。'));
          return;
        }
        current.path = meta.path;
        renderDetail();
        renderList(); // 更新选中态
      } catch (err) {
        detailEl.textContent = '';
        detailEl.appendChild(h('div', { class: 'empty' }, `读取失败：${err.message}`));
      }
    }

    async function doExport(format) {
      if (!current) return;
      const btn = detailEl.querySelector(`[data-export="${format}"]`);
      if (btn) btn.disabled = true;
      try {
        const result = await chat.export(sourceSelect.value, current.id, format);
        if (result.canceled) return;
        if (!result.ok) return toast(result.error || '导出失败', 'bad');
        toast(`已导出 ${result.count} 条消息`, 'good');
        await chat.showInFinder(result.path);
      } catch (err) {
        toast(`导出失败：${err.message}`, 'bad');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function doTransfer() {
      if (!current) return;
      const result = await chat.transfer(sourceSelect.value, [current.id], `来自 ${sourceSelect.value} 的会话迁移`);
      if (result.canceled) return;
      if (!result.ok) return toast(result.error || '打包失败', 'bad');
      toast(`迁移包已生成：${result.sessions} 个会话 / ${result.count} 条消息`, 'good');
      await chat.showInFinder(result.path);
    }

    async function doCopyAll() {
      if (!current) return;
      toast('正在读取完整会话…', 'info');
      try {
        const full = await chat.load(sourceSelect.value, current.id, true);
        const lines = [`# ${full.title || '未命名会话'}（${full.source}）`, ''];
        for (const m of full.messages) {
          lines.push(`[${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role}]`, m.content, '');
        }
        await clipboard.write(lines.join('\n'));
        toast(`已复制全部 ${full.messages.length} 条消息，直接去新 AI 里粘贴`, 'good');
      } catch (err) {
        toast(`复制失败：${err.message}`, 'bad');
      }
    }

    async function readTransfer() {
      const result = await chat.pickTransfer();
      if (!result) return;
      if (result.error) return toast(result.error, 'bad');
      detailEl.textContent = '';
      detailEl.appendChild(
        h('div', { class: 'history__head card' },
          h('div', { class: 'history__title' }, '迁移包'),
          h('div', { class: 'faint' }, result.path),
          result.note && h('div', { class: 'faint' }, `备注：${result.note}`),
          h('div', { class: 'faint' }, `包含 ${result.sessions.length} 个会话：`),
        ),
        h('div', { class: 'history__transfer-list' },
          ...result.sessions.map((s) => h('div', { class: 'history__transfer-item' },
            h('span', { class: 'tag' }, s.source),
            h('span', { class: 'history__transfer-title' }, s.title || s.id),
            h('span', { class: 'faint' }, `${s.count} 条`),
          )),
        ),
        h('div', { class: 'faint history__note' },
          '把这个 JSON 文件发给另一个 AI（或粘贴它的内容），让它按 messages 里的 role/content 继续聊。'),
      );
    }

    function renderDetail() {
      detailEl.textContent = '';
      const pathRow = current.path && h('div', { class: 'history__path' },
        h('code', { class: 'faint' }, current.path),
        h('button', {
          class: 'btn btn--sm',
          onclick: async () => { await clipboard.write(current.path); toast('路径已复制', 'good'); },
        }, '复制路径'),
        h('button', {
          class: 'btn btn--sm',
          onclick: () => chat.showInFinder(current.path),
        }, '在访达显示'),
      );

      detailEl.appendChild(
        h('div', { class: 'history__head card' },
          h('div', { class: 'history__title' }, current.title || '未命名会话'),
          h('div', { class: 'history__meta faint' },
            `${current.source} · ${fmtTime(current.createdAt)} · 共 ${current.totalMessages} 条` +
            (current.model ? ` · ${current.model}` : '')),
          current.cwd && h('div', { class: 'faint history__cwd' }, `工作目录：${current.cwd}`),
          pathRow,
          h('div', { class: 'history__actions' },
            ...['md', 'json', 'html', 'txt'].map((f) => h('button', {
              class: 'btn btn--sm',
              dataset: { export: f },
              onclick: () => doExport(f),
            }, `导出 ${f.toUpperCase()}`)),
            h('span', { class: 'subbar__sep' }),
            h('button', { class: 'btn btn--sm btn--primary', onclick: () => doTransfer() }, '生成迁移包'),
            h('button', { class: 'btn btn--sm', onclick: () => doCopyAll() }, '复制全文'),
          ),
        ),
      );

      if (current.note) {
        detailEl.appendChild(h('div', { class: 'faint history__note' }, current.note));
      }

      const msgList = h('div', { class: 'history__msgs' });
      for (const m of current.messages) {
        msgList.appendChild(h('div', { class: `history__msg history__msg--${m.role}` },
          h('div', { class: 'history__msg-meta faint' },
            h('span', { class: 'history__msg-role' }, m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role),
            h('span', {}, fmtTime(m.createdAt)),
          ),
          h('div', { class: 'history__msg-content' }, m.content),
        ));
      }
      if (current.truncated) {
        msgList.appendChild(h('div', { class: 'faint history__note' },
          `会话太长，只预览前 ${current.messages.length} 条；导出/复制时是完整的。`));
      }
      detailEl.appendChild(msgList);
    }

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '聊天记录迁移'),
        sourceSelect,
        searchInput,
        h('span', { style: { flex: 1 } }),
        refreshBtn,
        transferBtn,
      ),
      h('div', { class: 'history__body' },
        h('div', { class: 'history__pane' }, listEl),
        h('div', { class: 'history__pane history__pane--detail' }, detailEl),
      ),
    );

    showDetailIdle();
    initSources().then(() => refresh());

    return { activate: () => { if (!sessions.length) refresh(); } };
  },
};
