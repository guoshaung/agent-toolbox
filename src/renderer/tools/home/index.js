import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';
import { TOOLS } from '../../core/registry.js';
import { colorOf } from '../../core/tool-colors.js';
import { md } from '../../core/md.js';

/**
 * 今天：打开工具箱先看这一屏。
 *
 * 四块：
 *  - 刚建的：最近三天你在主目录下新建的东西（找不到东西时先来这）
 *  - 该归位的：桌面 / 下载 / 主目录顶层散落了多少，一键去收纳
 *  - 讲过的项目：点一下回到那份讲解
 *  - 没做完的任务 + 最近用的工具
 *
 * 全是别处已有数据的摘要，不新存任何东西。
 */

const short = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
const greet = () => { const hr = new Date().getHours(); return hr < 5 ? '还没睡？' : hr < 11 ? '早' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好'; };
// 懒得读 README 的人靠这个知道有什么：每天换一条
const TIPS = [
  '按 ⌘K 打字就能到任何地方：工具、皮肤、刚建的文件夹都能搜。',
  '在任何应用里选中一段代码，按 ⌘⇧L，桌宠直接给四行解释。',
  '把文件或文件夹拖到这个窗口任何地方，它会问你想干嘛。',
  '⌘K 里打「+ 事情」直接记一条任务。',
  '收纳 → 看懂项目：拖个项目进来，AI 讲它是什么、怎么跑、从哪读起，还能一站一站带你读。',
  '关掉窗口应用还在菜单栏；⌘⇧A 随时叫回来。',
  '皮肤里能开「跟随系统深浅色」，白天白纸晚上银河。',
  '选中微信里对方那句话按 ⌘⇧M，内心独白告诉你她到底想说什么。',
];
const tipOfDay = () => TIPS[Math.floor(Date.now() / 86400000) % TIPS.length];

export default {
  id: 'home',
  title: '今天',
  icon: 'zap',
  hint: '刚建的东西、该归位的、讲过的项目、没做完的任务，一屏看完',

  create(root, ctx) {
    const { config, goto } = ctx;
    const body = h('div', { class: 'settings__body settings__body--wide home' });
    const startToggle = h('label', { class: 'home__toggle faint', title: '关掉就回到上次用的工具' },
      h('input', { type: 'checkbox', checked: config.get('ui.startHome', true) !== false, onchange: (e) => config.set('ui.startHome', e.target.checked) }), '打开工具箱先到这页');
    root.append(h('div', { class: 'bar bar--drag' }, h('strong', {}, '今天'), h('span', { class: 'faint' }, new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })), h('span', { style: { flex: 1 } }), startToggle), body);

    const section = (title, extra, ...kids) => h('section', { class: 'card home__card' }, h('div', { class: 'home__head' }, h('h3', { class: 'card__title' }, title), extra), ...kids);
    const empty = (text) => h('div', { class: 'faint home__empty' }, text);

    async function render() {
      const tasks = (config.get('tasks.items', []) || []).filter((t) => !t.done).slice(0, 6);
      const mru = (config.get('ui.mru') || []).filter((id) => id !== 'home').slice(0, 6).map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
      const [recent, scan, overviews, activity, journal] = await Promise.all([
        window.toolbox.tidy.recent({ days: 3, limit: 8 }).catch(() => ({ items: [] })),
        window.toolbox.tidy.scan({ ai: false }).catch(() => ({ items: [] })),
        window.toolbox.tidy.overviewList().catch(() => []),
        window.toolbox.tidy.activity({ days: 7, limit: 6 }).catch(() => ({ items: [] })),
        window.toolbox.learn?.journal?.({ limit: 6 }).catch(() => ({ items: [], week: { total: 0, byKind: {} } })) || { items: [], week: { total: 0, byKind: {} } },
      ]);
      const ago = (t) => { const d = (Date.now() - t) / 3600000; return d < 1 ? '刚刚' : d < 24 ? `${Math.round(d)} 小时前` : `${Math.round(d / 24)} 天前`; };
      const stray = (scan.items || []).filter((x) => x.action !== 'keep');
      const careless = stray.filter((x) => x.careless).length;

      body.replaceChildren(
        h('div', { class: 'home__hero' },
          h('div', {}, h('div', { class: 'home__greet' }, `${greet()}，`), (() => { let k = Math.floor(Date.now() / 86400000) % TIPS.length; const el = h('div', { class: 'faint home__tip', title: '点一下换一条', onclick: () => { k = (k + 1) % TIPS.length; el.textContent = `💡 ${TIPS[k]}`; } }, `💡 ${TIPS[k]}`); return el; })()),
          h('div', { class: 'home__quick' },
            h('button', { class: 'btn btn--sm btn--primary', onclick: () => document.querySelector('.atelier-banner__k')?.click() }, '⌘K 搜'),
            h('button', { class: 'btn btn--sm', onclick: () => goto('tidy') }, '收纳'),
            h('button', { class: 'btn btn--sm', onclick: () => goto('ask') }, '快问'),
          ),
        ),
        h('div', { class: 'home__grid' },
          section('刚建的', h('button', { class: 'btn btn--sm', onclick: () => goto('tidy') }, '全部'),
            ...(recent.items?.length ? recent.items.map((it) => h('div', { class: 'home__row' },
              h('span', { class: 'home__name', title: it.path }, `${it.isDir ? '📁' : '📄'} ${it.name}`),
              h('span', { class: 'faint home__meta' }, it.where),
              h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.tidy.reveal(it.path) }, '显示'),
              it.isDir ? h('button', { class: 'btn btn--sm', onclick: async () => { await config.set('tidy.pending', it.path); goto('tidy'); } }, '看懂') : null,
            )) : [empty('最近三天没新建什么')]),
          ),
          section('该归位的', h('div', { class: 'home__quick' },
            h('button', { class: 'btn btn--sm', title: '只搬一眼就能认出来的：图片、文档、压缩包、安装包、视频、音频。项目和认不出的不动。可撤销', onclick: async () => {
              const SAFE = new Set(['image', 'images', 'doc', 'docs', 'archive', 'installer', 'video', 'videos', 'audio']);
              const moves = stray.filter((x) => x.action === 'move' && SAFE.has(x.kind)).map((x) => ({ path: x.path, to: x.to, action: 'move' }));
              if (!moves.length) return toast('没有明显该搬的', 'info');
              if (!window.confirm(`把 ${moves.length} 项图片 / 文档 / 压缩包 / 安装包搬到 ~/收纳 下对应文件夹？\n项目和认不出的不动，搬完可以在收纳里撤销。`)) return;
              const r = await window.toolbox.tidy.apply(moves);
              toast(r.errors.length ? `搬了 ${r.done.length} 项，${r.errors.length} 项失败` : `搬好了 ${r.done.length} 项（收纳里可撤销）`, r.errors.length ? 'bad' : 'good', 5000);
              render();
            } }, '把明显的都归位'),
            h('button', { class: 'btn btn--sm btn--primary', onclick: () => goto('tidy') }, '去挑着归位')),
            h('div', { class: 'home__big' }, h('b', {}, String(stray.length)), h('span', { class: 'faint' }, ' 项散落在桌面 / 下载 / 主目录')),
            careless ? h('div', { class: 'faint' }, `其中 ${careless} 个一看就是随手建的（数字名、未命名、test…）`) : null,
            h('div', { class: 'home__chips' }, ...Object.entries(stray.reduce((m, x) => { m[x.reason] = (m[x.reason] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => h('span', { class: 'tag' }, `${k} ${n}`))),
          ),
          section('这周在写的', null,
            ...(activity.items?.length ? activity.items.map((it) => h('div', { class: 'home__row' },
              h('span', { class: 'home__name', title: `${it.path}\n最近一次：${it.last.message}` }, `🛠 ${it.name}`),
              h('span', { class: 'faint home__meta' }, `${it.count} 次提交 · ${ago(it.last.at)}`),
              h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.tidy.reveal(it.path) }, '显示'),
              h('button', { class: 'btn btn--sm', onclick: async () => { await config.set('tidy.pending', it.path); goto('tidy'); } }, '看懂'),
            )) : [empty('这周还没有提交过东西（只看桌面 / 下载 / 主目录下的仓库）')]),
          ),
          section('讲过的项目', null,
            ...(() => {
              const prog = config.get('tidy.readProgress', {}) || {};
              const cont = Object.entries(prog).sort((a, b) => b[1].at - a[1].at)[0];
              const rows = [];
              if (cont) {
                const [root, p] = cont;
                const next = p.index + 1 < p.total ? p.index + 1 : p.index;
                rows.push(h('div', { class: 'home__row' }, h('span', { class: 'home__name' }, `📖 ${root.split('/').pop()}：读到第 ${p.index + 1}/${p.total} 站（${p.rel.split('/').pop()}）`),
                  h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { await config.set('tidy.pendingStop', next); await config.set('tidy.pending', root); goto('tidy'); } }, p.index + 1 < p.total ? '接着读' : '再看一遍')));
              }
              rows.push(overviews.length ? h('div', { class: 'home__chips' }, ...overviews.slice(0, 10).map((o) => h('button', { class: 'btn btn--sm', title: short(o.root), onclick: async () => { await config.set('tidy.pending', o.root); goto('tidy'); } }, o.name))) : empty('还没让 AI 讲过项目。把一个文件夹拖进「收纳 → 看懂项目」试试'));
              return rows;
            })(),
          ),
          section('没做完的', h('button', { class: 'btn btn--sm', onclick: () => goto('tasks') }, '任务'),
            (() => {
              const input = h('input', { class: 'field field--sm', placeholder: '记一笔，回车就进清单', style: { width: '100%' } });
              input.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter' || !input.value.trim()) return;
                const title = input.value.trim().slice(0, 120); input.value = '';
                const list = config.get('tasks.items', []) || [];
                await config.set('tasks.items', [{ id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title, done: false, priority: 'normal', due: '', createdAt: Date.now(), completedAt: null }, ...list]);
                toast(`记下了：${title}`, 'good'); render();
              });
              return input;
            })(),
            ...(tasks.length ? tasks.map((t) => h('div', { class: 'home__row' }, h('span', { class: `home__dot home__dot--${t.priority || 'normal'}` }), h('span', { class: 'home__name' }, t.title), t.due ? h('span', { class: 'faint home__meta' }, t.due) : null)) : [empty('任务清单是空的 —— 要么很闲，要么没写')]),
          ),
          section('这周学了什么', h('button', { class: 'btn btn--sm', title: '让模型按记录写三段：学了什么、做了什么、下周先干嘛', onclick: async (e) => {
              const btn = e.currentTarget; btn.disabled = true; btn.textContent = '在写…';
              const r = await window.toolbox.learn.weekly({});
              btn.disabled = false; btn.textContent = '本周小结';
              if (!r.ok) return toast(r.error || '没写出来', 'bad');
              const box = h('section', { class: 'card' }, h('div', { class: 'home__head' }, h('h3', { class: 'card__title' }, `本周小结${r.cached ? '（这周写过的）' : ''}`), h('div', { class: 'home__quick' },
                h('button', { class: 'btn btn--sm', onclick: async () => { const f = await window.toolbox.learn.weekly({ fresh: true }); if (f.ok) box.replaceChild(md(f.markdown), box.lastChild); } }, '重写'),
                h('button', { class: 'btn btn--sm', onclick: () => navigator.clipboard.writeText(r.markdown).then(() => toast('已复制', 'good')) }, '复制'),
                h('button', { class: 'btn btn--sm', onclick: () => box.remove() }, '收起'))), md(r.markdown));
              body.querySelector('.home__grid')?.before(box);
            } }, '本周小结'),
            h('div', { class: 'home__big' }, h('b', {}, String(journal.week.total)), h('span', { class: 'faint' }, ' 次 · ' + (Object.entries(journal.week.byKind).map(([k, n]) => `${{ explain: '解释', overview: '看懂项目', file: '带我读', quiz: '考考我', note: '记' }[k] || k} ${n}`).join(' · ') || '还没开始') + (journal.week.quizAvg != null ? ` · 考试平均 ${journal.week.quizAvg}%` : ''))),
            ...(journal.items.length ? journal.items.slice(0, 5).map((it) => h('div', { class: 'home__row' },
              h('span', { class: 'home__name', title: it.title }, `${{ explain: '💬', overview: '🎓', file: '📄', quiz: '📝' }[it.kind] || '•'} ${it.title}${it.kind === 'quiz' ? `（${it.score}/${it.total}）` : ''}`),
              h('span', { class: 'faint home__meta' }, ago(it.at)))) : [empty('⌘⇧L 解释一段代码、或去收纳看懂一个项目，都会记在这里')]),
          ),
          section('最近用的', null,
            h('div', { class: 'home__tools' }, ...(mru.length ? mru : TOOLS.slice(1, 7)).map((t) => h('button', { class: 'home__tool', style: { '--tool-color': colorOf(t.id) }, onclick: () => goto(t.id) }, iconFor(t.icon || 'more'), h('span', {}, t.title)))),
          ),
        ),
      );
    }

    render().catch((error) => toast(error.message, 'bad'));
    return { activate: () => render().catch(() => {}) };
  },
};
