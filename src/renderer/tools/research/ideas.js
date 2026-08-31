import { h, toast } from '../../core/ui.js';

/**
 * 想法区：随手记科研想法，点「AI 拆解」让模型把它落成
 * 可执行的计划（目标 / 分步 / 风险 / 今天就做的第一件事）。
 *
 * - 想法可编辑、可追加补充（追加内容带时间戳附在详情后）；
 * - 想法多了用 ⭐ 聚焦：星标置顶 + 「只看聚焦」过滤，盯住当前要做的；
 * - 想法与拆解结果都存 config，换设备导 config.json 就能带走。
 */
export function createIdeas(root, ctx) {
  const { config, ai } = ctx;

  const listEl = h('div', { class: 'ideas__list' });
  const titleInput = h('input', { class: 'field', placeholder: '想法一句话（如：把 XX 模型用到 YY 数据上）' });
  const detailInput = h('textarea', {
    class: 'field ideas__detail',
    placeholder: '补充细节：背景、已有条件、卡点…（可空）',
  });

  let filter = config.get('research.ideas.filter', 'all'); // all | starred

  function ideas() {
    return config.get('research.ideas') || [];
  }

  async function save(next) {
    await config.set('research.ideas', next);
  }

  async function updateIdea(id, patch) {
    await save(ideas().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addIdea() {
    const title = titleInput.value.trim();
    if (!title) return toast('先写一句话', 'info');
    const next = ideas();
    next.unshift({
      id: `idea-${Date.now()}`,
      title,
      detail: detailInput.value.trim(),
      starred: false,
      createdAt: new Date().toISOString(),
      plan: null,
    });
    save(next);
    titleInput.value = '';
    detailInput.value = '';
    renderList();
    toast('已记下', 'good');
  }

  async function breakdown(idea, card) {
    const planEl = card.querySelector('.ideas__plan');
    planEl.textContent = '';
    planEl.removeAttribute('hidden');
    planEl.appendChild(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ` 正在拆解（${ai.describe()}）…`));
    try {
      const result = await ai.json(
        [
          '把一个科研想法拆成能落地的计划。返回 JSON：',
          '{"goal":"一句话说清这个目标算完成","steps":[{"title":"步骤名","detail":"具体做什么、产出什么","estimate":"预计耗时"}],"risks":["最可能翻车的点"],"firstAction":"今天就能做的第一件事，越小越好"}',
          'steps 给 4-6 步，按执行顺序。不要用 markdown 代码块包裹。',
          '',
          `想法：${idea.title}`,
          idea.detail ? `补充：${idea.detail}` : '',
        ].join('\n'),
        { timeout: 90000 },
      );
      await updateIdea(idea.id, { plan: { ...result, at: new Date().toISOString() } });
      renderList();
    } catch (err) {
      planEl.textContent = '';
      if (err.code === 'need-login') {
        planEl.appendChild(h('div', { class: 'empty' },
          'AI 还没登录。',
          h('button', { class: 'btn btn--primary', onclick: () => ctx.goto('ask') }, '去登录'),
        ));
      } else {
        planEl.appendChild(h('div', { class: 'empty' }, `拆解失败：${err.message}`));
      }
    }
  }

  function renderPlan(plan) {
    const wrap = h('div', {});
    if (plan.goal) wrap.appendChild(h('div', { class: 'ideas__goal' }, h('strong', {}, '完成标准：'), plan.goal));
    if (Array.isArray(plan.steps) && plan.steps.length) {
      wrap.appendChild(h('div', { class: 'ideas__steps' },
        ...plan.steps.map((s, i) => h('div', { class: 'ideas__step' },
          h('span', { class: 'ideas__step-no' }, String(i + 1)),
          h('div', {},
            h('div', { class: 'ideas__step-title' }, s.title || `步骤 ${i + 1}`,
              s.estimate && h('span', { class: 'tag' }, s.estimate)),
            h('div', { class: 'ideas__step-detail faint' }, s.detail || ''),
          ),
        )),
      ));
    }
    if (Array.isArray(plan.risks) && plan.risks.length) {
      wrap.appendChild(h('div', { class: 'ideas__risks' },
        h('strong', {}, '容易翻车：'),
        plan.risks.join('；'),
      ));
    }
    if (plan.firstAction) {
      wrap.appendChild(h('div', { class: 'ideas__first' },
        h('span', { class: 'tag tag--good' }, '现在就做'),
        plan.firstAction,
      ));
    }
    return wrap;
  }

  /** 编辑模式：标题 + 详情换成输入框，保存/取消 */
  function renderEdit(idea, card) {
    const titleEdit = h('input', { class: 'field', value: idea.title });
    const detailEdit = h('textarea', { class: 'field ideas__detail' }, idea.detail || '');
    const bar = h('div', { class: 'ideas__actions' },
      h('button', {
        class: 'btn btn--sm btn--primary',
        onclick: async () => {
          const title = titleEdit.value.trim();
          if (!title) return toast('标题不能空', 'info');
          await updateIdea(idea.id, { title, detail: detailEdit.value.trim() });
          renderList();
          toast('已保存', 'good');
        },
      }, '保存'),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => renderList() }, '取消'),
    );
    card.textContent = '';
    card.append(titleEdit, detailEdit, bar);
    titleEdit.focus();
  }

  /** 追加模式：一行输入框，内容带时间戳附到详情后面 */
  function renderAppend(idea, card) {
    const input = h('input', {
      class: 'field',
      placeholder: '追加一条进展/新想法…',
      onkeydown: async (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') renderList();
      },
    });
    async function commit() {
      const text = input.value.trim();
      if (!text) return renderList();
      const stamp = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      const latest = ideas().find((x) => x.id === idea.id);
      const detail = [latest?.detail, `[${stamp}] ${text}`].filter(Boolean).join('\n');
      await updateIdea(idea.id, { detail });
      renderList();
      toast('已追加', 'good');
    }
    const bar = h('div', { class: 'ideas__append' },
      input,
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => commit() }, '追加'),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => renderList() }, '取消'),
    );
    card.appendChild(bar);
    input.focus();
  }

  function renderFilter() {
    const all = ideas();
    const starredCount = all.filter((x) => x.starred).length;
    return h('div', { class: 'ideas__filter' },
      h('button', {
        class: `btn btn--sm ${filter === 'all' ? 'btn--primary' : 'btn--ghost'}`,
        onclick: () => { filter = 'all'; config.set('research.ideas.filter', filter); renderList(); },
      }, `全部 ${all.length}`),
      h('button', {
        class: `btn btn--sm ${filter === 'starred' ? 'btn--primary' : 'btn--ghost'}`,
        onclick: () => { filter = 'starred'; config.set('research.ideas.filter', filter); renderList(); },
      }, `⭐ 聚焦 ${starredCount}`),
      filter === 'all' && starredCount > 0 && h('span', { class: 'faint ideas__filter-hint' }, '星标想法已置顶；点「⭐ 聚焦」只看这些'),
    );
  }

  function renderList() {
    listEl.textContent = '';
    const all = ideas();
    if (!all.length) {
      listEl.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '💡'),
        '还没有想法。',
        h('br'),
        h('span', { class: 'faint' }, '上面随手记一条，再让 AI 帮你拆成能落地的计划。'),
      ));
      return;
    }
    listEl.appendChild(renderFilter());

    // 星标置顶，其余保持原顺序（新的在前）
    const sorted = [...all].sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
    const items = filter === 'starred' ? sorted.filter((x) => x.starred) : sorted;
    if (!items.length) {
      listEl.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, '⭐'),
        '还没有聚焦的想法。',
        h('br'),
        h('span', { class: 'faint' }, '在想法卡片上点 ☆，把它标成当前要专注的事。'),
      ));
      return;
    }

    for (const idea of items) {
      const planEl = h('div', { class: 'ideas__plan', hidden: !idea.plan });
      const starBtn = h('button', {
        class: `btn btn--sm btn--ghost ideas__star${idea.starred ? ' is-starred' : ''}`,
        title: idea.starred ? '取消聚焦' : '标为聚焦（置顶）',
        onclick: async () => { await updateIdea(idea.id, { starred: !idea.starred }); renderList(); },
      }, idea.starred ? '⭐' : '☆');
      const card = h('div', { class: `card ideas__card${idea.starred ? ' is-starred' : ''}` },
        h('div', { class: 'ideas__head' },
          h('div', { class: 'ideas__title' }, idea.title),
          h('span', { class: 'faint' }, new Date(idea.createdAt).toLocaleDateString('zh-CN')),
        ),
        idea.detail && h('div', { class: 'ideas__detail-text faint' }, idea.detail),
        h('div', { class: 'ideas__actions' },
          h('button', {
            class: 'btn btn--sm btn--primary',
            onclick: (e) => { e.currentTarget.disabled = true; breakdown(idea, card).finally(() => { e.currentTarget.disabled = false; }); },
          }, idea.plan ? '重新拆解' : 'AI 拆解落实'),
          h('button', { class: 'btn btn--sm', onclick: () => renderEdit(idea, card) }, '编辑'),
          h('button', { class: 'btn btn--sm', onclick: () => renderAppend(idea, card) }, '追加'),
          idea.plan && h('button', {
            class: 'btn btn--sm',
            onclick: () => {
              const hidden = planEl.hasAttribute('hidden');
              if (hidden) planEl.removeAttribute('hidden');
              else planEl.setAttribute('hidden', '');
            },
          }, '收起/展开'),
          h('span', { style: { flex: 1 } }),
          starBtn,
          h('button', {
            class: 'btn btn--sm btn--ghost',
            onclick: async () => { await save(ideas().filter((x) => x.id !== idea.id)); renderList(); },
          }, '删除'),
        ),
        planEl,
      );
      if (idea.plan) {
        planEl.textContent = '';
        planEl.appendChild(renderPlan(idea.plan));
      }
      listEl.appendChild(card);
    }
  }

  root.append(
    h('div', { class: 'bar research__viewbar ideas__bar' },
      titleInput,
      h('button', { class: 'btn btn--primary', onclick: () => addIdea() }, '记下来'),
    ),
    h('div', { class: 'ideas__scroll' },
      h('div', { class: 'ideas__detail-wrap' }, detailInput),
      listEl,
    ),
  );
  renderList();
}
