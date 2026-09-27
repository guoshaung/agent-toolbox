import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

/**
 * 密码本：账号密码、网址、API key、备注，什么都能存。
 *
 * 名字和网站都不用填 —— 自动从网址 / 账号起名；整段粘贴自动拆字段。
 * 密文由主进程用系统钥匙串加密，列表里只有标题 / 网址 / 账号；
 * 密码和 key 点「显示」才解一次，「复制」的值根本不经过这个页面。
 */

const KIND_LABEL = { account: '账号', apikey: 'API Key', url: '网址', note: '备注', other: '其他' };
const KIND_FILTERS = [['all', '全部'], ['account', '账号'], ['apikey', 'API Key'], ['url', '网址'], ['note', '备注']];

export default {
  id: 'vault',
  title: '密码本',
  icon: 'lock',
  hint: '账号密码、网址、API key 加密存起来，⌘K 搜到就能复制',

  create(root, ctx) {
    const { config } = ctx;
    const api = window.toolbox.vault;
    let entries = [];
    let available = true;
    let query = '';
    let kindFilter = config.get('vault.filter', 'all');
    let editing = null;          // { id? , ...fields } 正在编辑的
    let revealed = new Map();    // id -> 解出来的条目（点过「显示」）

    const list = h('div', { class: 'vault__list' });
    const side = h('div', { class: 'vault__side' });
    const searchInput = h('input', { class: 'field vault__search', placeholder: '搜名字 / 网址 / 账号 / 标签', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderList(); } });
    const filterBar = h('div', { class: 'vault__filters' });
    const countLabel = h('span', { class: 'faint vault__count' });

    root.append(
      h('div', { class: 'bar bar--drag' },
        h('strong', {}, '密码本'),
        searchInput,
        filterBar,
        countLabel,
        h('span', { class: 'vault__spacer' }),
        h('button', { class: 'btn btn--sm btn--primary', onclick: () => startEdit(null) }, '＋ 新增'),
        h('button', { class: 'btn btn--sm btn--ghost', title: '密文文件在哪（备份用）', onclick: () => api.openFolder() }, '文件位置'),
      ),
      h('div', { class: 'vault__body' }, list, side),
    );

    async function refresh() {
      const r = await api.list();
      available = r.available;
      entries = r.entries;
      renderFilters(); renderList();
      if (!editing) renderSide();
    }

    function renderFilters() {
      filterBar.replaceChildren(...KIND_FILTERS.map(([id, label]) => h('button', {
        class: `btn btn--sm ${kindFilter === id ? 'is-active' : ''}`,
        onclick: () => { kindFilter = id; config.set('vault.filter', id); renderFilters(); renderList(); },
      }, label)));
    }

    function visible() {
      return entries.filter((e) => (kindFilter === 'all' || e.kind === kindFilter)
        && (!query || `${e.title} ${e.url} ${e.username} ${(e.tags || []).join(' ')}`.toLowerCase().includes(query)));
    }

    function copyBtn(e, field, label) {
      return h('button', {
        class: 'btn btn--sm', title: `复制${label}`,
        onclick: async (ev) => { ev.stopPropagation(); const r = await api.copy(e.id, field); toast(r.ok ? `已复制${label}${r.cleared ? `，${r.cleared} 秒后自动清空剪贴板` : ''}` : r.error, r.ok ? 'good' : 'bad'); },
      }, label);
    }

    function renderList() {
      const items = visible();
      countLabel.textContent = entries.length ? `${items.length} / ${entries.length} 条` : '';
      if (!available) { list.replaceChildren(h('div', { class: 'empty' }, '系统安全存储不可用，密码本没法加密保存。macOS 上通常是钥匙串被锁了。')); return; }
      if (!entries.length) { list.replaceChildren(h('div', { class: 'vault__empty' }, h('div', { class: 'vault__empty-title' }, '还是空的'), h('div', { class: 'faint' }, '右边直接粘贴一段（账号、密码、网址、key 混在一起也行），会自动拆好；或者点「新增」一项项填。'), h('div', { class: 'faint' }, '密文只存在本机，用系统钥匙串加密；「导出设置」不会带走它。'))); return; }
      if (!items.length) { list.replaceChildren(h('div', { class: 'vault__empty faint' }, '没有匹配的')); return; }
      list.replaceChildren(...items.map((e) => {
        const rv = revealed.get(e.id);
        return h('div', { class: `vault__item ${editing?.id === e.id ? 'is-editing' : ''}`, onclick: () => startEdit(e.id) },
          h('div', { class: 'vault__item-icon' }, iconFor(e.kind === 'apikey' ? 'plug' : e.kind === 'url' ? 'globe' : e.kind === 'note' ? 'pen' : 'lock')),
          h('div', { class: 'vault__item-body' },
            h('div', { class: 'vault__item-title' }, e.title, h('span', { class: 'tag vault__kind' }, KIND_LABEL[e.kind] || '其他'), ...(e.tags || []).map((t) => h('span', { class: 'tag' }, t))),
            h('div', { class: 'vault__item-sub faint' }, [e.username, e.url].filter(Boolean).join(' · ') || (e.has?.key ? 'key' : e.has?.notes ? '备注' : '')),
            rv ? h('div', { class: 'vault__secrets' },
              rv.password ? h('div', { class: 'vault__secret' }, h('span', { class: 'faint' }, '密码 '), h('code', {}, rv.password)) : null,
              rv.key ? h('div', { class: 'vault__secret' }, h('span', { class: 'faint' }, 'key '), h('code', {}, rv.key)) : null,
              rv.notes ? h('div', { class: 'vault__secret vault__secret--notes' }, rv.notes) : null,
            ) : null,
          ),
          h('div', { class: 'vault__item-actions', onclick: (ev) => ev.stopPropagation() },
            e.username ? copyBtn(e, 'username', '账号') : null,
            e.has?.password ? copyBtn(e, 'password', '密码') : null,
            e.has?.key ? copyBtn(e, 'key', 'key') : null,
            e.url ? h('button', { class: 'btn btn--sm btn--ghost', title: '打开网址', onclick: () => window.toolbox.shell.openExternal(/^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`) }, '↗') : null,
            (e.has?.password || e.has?.key || e.has?.notes) ? h('button', {
              class: 'btn btn--sm btn--ghost', title: rv ? '隐藏' : '显示密码 / key',
              onclick: async () => {
                if (rv) { revealed.delete(e.id); renderList(); return; }
                const r = await api.reveal(e.id);
                if (!r.ok) return toast(r.error, 'bad');
                revealed.set(e.id, r.entry); renderList();
                setTimeout(() => { if (revealed.has(e.id)) { revealed.delete(e.id); renderList(); } }, 60000);   // 一分钟后自动收起
              },
            }, rv ? '隐藏' : '显示') : null,
          ),
        );
      }));
    }

    // ---------- 右侧：新增 / 编辑 ----------
    function startEdit(id) {
      if (id) {
        const e = entries.find((x) => x.id === id);
        if (!e) return;
        editing = { id, title: e.title, url: e.url, username: e.username, tags: (e.tags || []).join(', '), password: undefined, key: undefined, notes: undefined, has: e.has || {} };
      } else editing = { id: null, title: '', url: '', username: '', tags: '', password: '', key: '', notes: '', has: {} };
      renderList(); renderSide();
    }

    function renderSide() {
      if (!editing) {
        const dump = h('textarea', { class: 'field vault__dump', rows: 7, placeholder: '把一段东西粘在这里，比如：\n网址 https://example.com\n账号 me@x.com\n密码 xxxx\n或者一条 sk-… 的 key' });
        side.replaceChildren(
          h('div', { class: 'vault__card' },
            h('div', { class: 'vault__card-title' }, '快速粘贴'),
            h('div', { class: 'faint vault__card-hint' }, '不用起名、不用管是什么网站，粘进来自动拆成账号 / 密码 / 网址 / key，拆错了下一步还能改。'),
            dump,
            h('div', { class: 'vault__row' },
              h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { const text = dump.value; if (!text.trim()) return toast('先粘点东西', 'info'); const p = await api.parse(text); editing = { id: null, ...p, tags: (p.tags || []).join(', '), has: {} }; renderSide(); } }, '拆开看看'),
              h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { const text = await window.toolbox.clipboard.read?.(); if (!text) return toast('剪贴板是空的', 'info'); dump.value = text; } }, '从剪贴板粘'),
            ),
          ),
          h('div', { class: 'vault__card vault__card--soft' },
            h('div', { class: 'vault__card-title' }, '这里的东西安全吗'),
            h('div', { class: 'faint vault__card-hint' }, '密码和 key 用系统钥匙串派生的密钥加密后写在本机 vault.json 里，列表只显示名字 / 网址 / 账号。复制密码 40 秒后剪贴板自动清空，也不会进 ⌘K 的剪贴板历史。「导出设置」不包含它，换电脑要自己备份那个文件（换机器后解不开，因为密钥在钥匙串里）。'),
          ),
        );
        return;
      }
      const f = editing;
      const field = (key, label, opts = {}) => {
        const isSecret = ['password', 'key', 'notes'].includes(key);
        const untouched = isSecret && f[key] === undefined;
        const input = opts.textarea
          ? h('textarea', { class: 'field vault__textarea', rows: opts.rows || 3, placeholder: untouched ? '（已保存，留空不改）' : (opts.placeholder || ''), oninput: (e) => { f[key] = e.target.value; } }, untouched ? '' : (f[key] || ''))
          : h('input', { class: 'field', type: key === 'password' && !f.show ? 'password' : 'text', value: untouched ? '' : (f[key] || ''), placeholder: untouched ? '（已保存，留空不改）' : (opts.placeholder || ''), oninput: (e) => { f[key] = e.target.value; if (key === 'password') updateStrength(); } });
        return h('label', { class: 'vault__field' }, h('span', { class: 'vault__field-label' }, label, opts.extra || null), input);
      };
      const strengthEl = h('span', { class: 'vault__strength' });
      async function updateStrength() { if (!f.password) { strengthEl.textContent = ''; return; } const s = await api.strength(f.password); strengthEl.textContent = s.label ? `强度：${s.label}` : ''; strengthEl.dataset.score = s.score; }
      const genBtn = h('button', { class: 'btn btn--sm btn--ghost vault__gen', onclick: async (e) => { e.preventDefault(); const r = await api.generate({ length: 20, symbols: true }); f.password = r.password; f.show = true; renderSide(); toast('生成了一个 20 位的，记得保存', 'info'); } }, '生成一个');
      const showBtn = h('button', { class: 'btn btn--sm btn--ghost', onclick: (e) => { e.preventDefault(); f.show = !f.show; renderSide(); } }, f.show ? '隐藏' : '显示');
      side.replaceChildren(
        h('div', { class: 'vault__card' },
          h('div', { class: 'vault__card-title' }, f.id ? '编辑' : '新增', h('span', { class: 'faint vault__card-sub' }, '名字和网址都可以不填')),
          field('title', '名字（可空，自动从网址 / 账号起）'),
          field('url', '网址（可空）', { placeholder: 'example.com' }),
          field('username', '账号 / 邮箱 / 手机（可空）'),
          field('password', '密码', { extra: h('span', { class: 'vault__field-tools' }, strengthEl, genBtn, showBtn) }),
          field('key', 'API key / token / 密钥', { placeholder: 'sk-…' }),
          field('notes', '备注（也加密）', { textarea: true, rows: 3 }),
          field('tags', '标签（逗号分开）', { placeholder: '工作, 学校' }),
          h('div', { class: 'vault__row' },
            h('button', { class: 'btn btn--sm btn--primary', onclick: save }, '保存'),
            h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { editing = null; renderList(); renderSide(); } }, '取消'),
            h('span', { class: 'vault__spacer' }),
            f.id ? h('button', { class: 'btn btn--sm btn--danger', onclick: async () => { if (!window.confirm(`删除「${f.title || '这条'}」？删了就找不回来。`)) return; await api.remove(f.id); revealed.delete(f.id); editing = null; toast('删了', 'info'); refresh(); } }, '删除') : null,
          ),
        ),
      );
      if (f.password) updateStrength();
    }

    async function save() {
      const f = editing;
      const payload = { id: f.id || undefined, title: f.title, url: f.url, username: f.username, tags: String(f.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean), password: f.password, key: f.key, notes: f.notes };
      const r = await api.save(payload);
      if (!r.ok) return toast(r.error, 'bad');
      revealed.delete(r.id);
      editing = null;
      toast('存好了', 'good');
      refresh();
    }

    refresh();
    return { activate: () => { if (!editing) refresh(); }, deactivate: () => { revealed.clear(); } };
  },
};
