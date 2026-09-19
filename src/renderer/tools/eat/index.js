import { h, toast } from '../../core/ui.js';

/**
 * 今天吃什么。
 *
 * 美团、淘宝闪购（饿了么）、京东到家都没有公开接口能读订单，所以这里嵌它们的
 * 手机网页版：你在里面登录一次（会话按站点隔离、长期保留），点「读取」时工具箱
 * 把当前页面的文字抓回来交给 AI 整理成「最近吃过」和「附近店铺」。
 *
 * 抓的是 body.innerText 而不是钻 DOM 结构：网站一改版选择器就全废，
 * 纯文字 + AI 整理反而最扛改版，只在登录墙面前会失效 —— 那时候手动补。
 */

const SITES = [
  { id: 'meituan', label: '美团', home: 'https://h5.waimai.meituan.com/', orders: 'https://h5.waimai.meituan.com/waimai/mindex/orderlist', accent: '#ffc300' },
  { id: 'eleme',   label: '淘宝闪购', home: 'https://h5.ele.me/', orders: 'https://h5.ele.me/order/', accent: '#0e8dff' },
  { id: 'jd',      label: '京东到家', home: 'https://daojia.jd.com/', orders: 'https://daojia.jd.com/html/index.html#/orderList', accent: '#e4393c' },
];

const MOODS = ['随便', '想吃点好的', '清淡一点', '重口味', '快一点', '省钱'];

export default {
  id: 'eat',
  title: '今天吃什么',
  icon: 'bowl',
  hint: '读最近的外卖订单和附近店铺，让 AI 推荐今天吃什么（手机上也能点）',

  create(root, ctx) {
    const { config, ai } = ctx;

    // ---------- 状态 ----------
    let recent = config.get('eat.recent', []);         // [{dish, shop, when, source}]
    let nearby = config.get('eat.nearby', []);         // [{name, note, source}]
    let prefs = config.get('eat.prefs', { taste: '', budget: '', avoid: '', location: '' });
    let activeSite = config.get('eat.site', 'meituan');
    let lastAdvice = config.get('eat.lastAdvice', null);

    const save = () => {
      config.set('eat.recent', recent.slice(0, 60));
      config.set('eat.nearby', nearby.slice(0, 60));
      config.set('eat.prefs', prefs);
    };

    // ---------- 三家网页 ----------
    const views = new Map();
    const viewHost = h('div', { class: 'eat__views' });
    for (const site of SITES) {
      const view = h('webview', {
        partition: `persist:eat-${site.id}`,   // 每家单独会话，登录一次长期有效
        src: site.home,
        allowpopups: true,
        class: 'eat__view',
      });
      view.hidden = site.id !== activeSite;
      views.set(site.id, view);
      viewHost.append(view);
    }
    const currentView = () => views.get(activeSite);

    const siteTabs = h('div', { class: 'eat__tabs' },
      ...SITES.map((site) => {
        const btn = h('button', {
          class: `btn btn--sm eat__tab${site.id === activeSite ? ' is-on' : ''}`,
          onclick: () => switchSite(site.id),
        }, site.label);
        btn.style.setProperty('--site-accent', site.accent);
        return btn;
      }),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--sm', title: '跳到这家的订单列表页', onclick: () => {
        const site = SITES.find((s) => s.id === activeSite);
        currentView().src = site.orders;
      } }, '去订单页'),
      h('button', { class: 'btn btn--sm', title: '刷新当前页', onclick: () => currentView().reload() }, '刷新'),
    );

    function switchSite(id) {
      activeSite = id;
      config.set('eat.site', id);
      for (const [sid, v] of views) v.hidden = sid !== id;
      for (const b of siteTabs.querySelectorAll('.eat__tab')) {
        b.classList.toggle('is-on', b.textContent === SITES.find((s) => s.id === id)?.label);
      }
    }

    // ---------- 从页面抓文字 ----------
    async function grabPageText() {
      const view = currentView();
      const text = await view.executeJavaScript(`(() => {
        const t = document.body ? document.body.innerText : '';
        return t.replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 7000);
      })()`, true);
      return String(text || '');
    }

    async function readOrders() {
      const site = SITES.find((s) => s.id === activeSite);
      readBtn.disabled = true;
      readBtn.textContent = '读取中…';
      try {
        const text = await grabPageText();
        if (text.length < 80) throw new Error('页面上几乎没有文字，可能还没登录或还没打开订单页。');
        // 让 AI 从页面文字里挑出「吃过什么」；抓不到就明说，不硬编
        const result = await ai.json([
          `下面是「${site.label}」某个页面的可见文字。如果这是订单/历史记录页，把最近的外卖或餐饮订单整理出来；`,
          '如果页面明显是登录页、首页或与订单无关，返回空数组，不要编造。',
          '返回 JSON：{"orders": [{"dish": "菜品/套餐名", "shop": "店名", "when": "时间（原样，没有就空串）"}]}，最多 15 条，不要用 markdown 代码块。',
          '', text,
        ].join('\n'), { timeout: 60000 });
        const orders = Array.isArray(result?.orders) ? result.orders.filter((o) => o?.dish) : [];
        if (!orders.length) {
          toast(`${site.label} 这一页没认出订单 —— 先登录并打开「去订单页」，或者下面手动补。`, 'info', 6000);
          return;
        }
        const stamp = new Date().toISOString().slice(0, 10);
        for (const o of orders) {
          const dup = recent.some((r) => r.dish === o.dish && r.shop === o.shop);
          if (!dup) recent.unshift({ dish: o.dish, shop: o.shop || '', when: o.when || stamp, source: site.label });
        }
        save();
        renderRecent();
        toast(`从 ${site.label} 读到 ${orders.length} 条`, 'good');
      } catch (error) {
        toast(error.message, 'bad', 6000);
      } finally {
        readBtn.disabled = false;
        readBtn.textContent = '读取这页的订单';
      }
    }

    async function readNearby() {
      const site = SITES.find((s) => s.id === activeSite);
      nearBtn.disabled = true;
      nearBtn.textContent = '读取中…';
      try {
        const text = await grabPageText();
        if (text.length < 80) throw new Error('页面上几乎没有文字。');
        const result = await ai.json([
          `下面是「${site.label}」某个页面的可见文字。如果里面列了店铺（外卖/餐厅），把店名和一句话特点整理出来；`,
          '不是店铺列表就返回空数组，不要编造。',
          '返回 JSON：{"shops": [{"name": "店名", "note": "评分/距离/招牌，原样摘，没有就空串"}]}，最多 20 条，不要用 markdown 代码块。',
          '', text,
        ].join('\n'), { timeout: 60000 });
        const shops = Array.isArray(result?.shops) ? result.shops.filter((s) => s?.name) : [];
        if (!shops.length) {
          toast(`${site.label} 这一页没认出店铺 —— 在里面翻到「附近」或首页列表再读。`, 'info', 6000);
          return;
        }
        for (const s of shops) {
          if (!nearby.some((n) => n.name === s.name)) nearby.unshift({ name: s.name, note: s.note || '', source: site.label });
        }
        save();
        renderNearby();
        toast(`读到 ${shops.length} 家店`, 'good');
      } catch (error) {
        toast(error.message, 'bad', 6000);
      } finally {
        nearBtn.disabled = false;
        nearBtn.textContent = '读取这页的店铺';
      }
    }

    const readBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: readOrders }, '读取这页的订单');
    const nearBtn = h('button', { class: 'btn btn--sm', onclick: readNearby }, '读取这页的店铺');

    // ---------- 左栏：偏好 / 最近吃过 / 附近 ----------
    const tasteInput = h('input', { class: 'field field--sm', placeholder: '口味（如：辣、清淡、面食）', value: prefs.taste || '', oninput: () => { prefs.taste = tasteInput.value; save(); } });
    const budgetInput = h('input', { class: 'field field--sm', placeholder: '预算（如：30 以内）', value: prefs.budget || '', oninput: () => { prefs.budget = budgetInput.value; save(); } });
    const avoidInput = h('input', { class: 'field field--sm', placeholder: '忌口（如：不吃香菜、海鲜过敏）', value: prefs.avoid || '', oninput: () => { prefs.avoid = avoidInput.value; save(); } });
    const locInput = h('input', { class: 'field field--sm', placeholder: '位置（如：公司、学校南门）', value: prefs.location || '', oninput: () => { prefs.location = locInput.value; save(); } });
    let mood = MOODS[0];
    const moodRow = h('div', { class: 'eat__moods' },
      ...MOODS.map((m) => h('button', {
        class: `btn btn--sm${m === mood ? ' btn--primary' : ''}`,
        onclick: (e) => {
          mood = m;
          for (const b of moodRow.children) b.classList.toggle('btn--primary', b === e.currentTarget);
        },
      }, m)));

    const recentList = h('ul', { class: 'eat__list' });
    const recentInput = h('input', { class: 'field field--sm', placeholder: '手动记一条：菜名 @店名', onkeydown: (e) => { if (e.key === 'Enter') addRecentManual(); } });
    function addRecentManual() {
      const raw = recentInput.value.trim();
      if (!raw) return;
      const [dish, shop = ''] = raw.split('@').map((s) => s.trim());
      recent.unshift({ dish, shop, when: new Date().toISOString().slice(0, 10), source: '手动' });
      recentInput.value = '';
      save();
      renderRecent();
    }
    function renderRecent() {
      recentList.replaceChildren(...(recent.length ? recent.slice(0, 20).map((r, i) => h('li', { class: 'eat__item' },
        h('span', { class: 'eat__item-main' }, r.dish, r.shop ? h('span', { class: 'faint' }, ` · ${r.shop}`) : null),
        h('span', { class: 'faint eat__item-meta' }, `${r.when || ''} ${r.source || ''}`.trim()),
        h('button', { class: 'btn btn--sm btn--ghost eat__del', title: '删掉', onclick: () => { recent.splice(i, 1); save(); renderRecent(); } }, '×'),
      )) : [h('li', { class: 'faint eat__empty' }, '还没有记录。登录右边任意一家，打开订单页，点「读取这页的订单」；或者在上面手动记一条。')]));
    }

    const nearbyList = h('ul', { class: 'eat__list' });
    const nearbyInput = h('input', { class: 'field field--sm', placeholder: '手动加一家：店名 @备注', onkeydown: (e) => { if (e.key === 'Enter') addNearbyManual(); } });
    function addNearbyManual() {
      const raw = nearbyInput.value.trim();
      if (!raw) return;
      const [name, note = ''] = raw.split('@').map((s) => s.trim());
      nearby.unshift({ name, note, source: '手动' });
      nearbyInput.value = '';
      save();
      renderNearby();
    }
    function renderNearby() {
      nearbyList.replaceChildren(...(nearby.length ? nearby.slice(0, 20).map((n, i) => h('li', { class: 'eat__item' },
        h('span', { class: 'eat__item-main' }, n.name, n.note ? h('span', { class: 'faint' }, ` · ${n.note}`) : null),
        h('span', { class: 'faint eat__item-meta' }, n.source || ''),
        h('button', { class: 'btn btn--sm btn--ghost eat__del', title: '删掉', onclick: () => { nearby.splice(i, 1); save(); renderNearby(); } }, '×'),
      )) : [h('li', { class: 'faint eat__empty' }, '还没有店铺。在右边翻到「附近」列表点「读取这页的店铺」，或手动加。')]));
    }

    // ---------- 推荐 ----------
    const adviceEl = h('div', { class: 'eat__advice' });
    const recommendBtn = h('button', { class: 'btn btn--primary', onclick: () => recommend() }, '🍽 今天吃什么');

    function renderAdvice(advice) {
      if (!advice) { adviceEl.replaceChildren(h('p', { class: 'faint' }, '点上面按钮，AI 会结合最近吃过的、附近的店和你的偏好给出三个选择。')); return; }
      adviceEl.replaceChildren(
        h('div', { class: 'eat__advice-head' }, h('strong', {}, advice.headline || '今天的建议'), h('span', { class: 'faint' }, advice.at ? new Date(advice.at).toLocaleString('zh-CN', { hour12: false }) : '')),
        ...(advice.picks || []).map((p, i) => h('div', { class: 'eat__pick' },
          h('div', { class: 'eat__pick-title' }, `${i + 1}. ${p.name}`, p.shop ? h('span', { class: 'faint' }, ` · ${p.shop}`) : null),
          h('div', { class: 'eat__pick-why' }, p.why || ''),
        )),
        advice.avoid ? h('p', { class: 'faint eat__advice-avoid' }, `今天先别：${advice.avoid}`) : null,
      );
    }

    /**
     * 出推荐。手机端按下去也走这个：返回结构化结果，由 app.js 回给手机。
     */
    async function recommend({ fromRemote = false } = {}) {
      recommendBtn.disabled = true;
      recommendBtn.textContent = 'AI 在想…';
      try {
        const recentLines = recent.slice(0, 15).map((r) => `- ${r.dish}${r.shop ? `（${r.shop}）` : ''}${r.when ? ` ${r.when}` : ''}`).join('\n') || '（没有记录）';
        const nearbyLines = nearby.slice(0, 20).map((n) => `- ${n.name}${n.note ? `：${n.note}` : ''}`).join('\n') || '（没有记录）';
        const now = new Date();
        const hour = now.getHours();
        const meal = hour < 10 ? '早饭' : hour < 15 ? '午饭' : hour < 20 ? '晚饭' : '夜宵';
        const result = await ai.json([
          `帮我决定今天${meal}吃什么。给 3 个具体选择，按推荐程度排序。`,
          '规则：最近三天吃过的不要重复推；优先从「附近店铺」里挑，没有合适的再给通用建议并说明；',
          '严格遵守忌口；理由要具体（比如"上周吃了两次辣的，今天换清淡"），不要空话。',
          '返回 JSON：{"headline": "一句话总结", "picks": [{"name": "吃什么", "shop": "哪家（附近列表里有就写，没有就空串）", "why": "一两句理由"}], "avoid": "今天该避开的，一句话，没有就空串"}',
          '不要用 markdown 代码块。',
          '',
          `现在时间：${now.toLocaleString('zh-CN', { hour12: false })}`,
          `心情/需求：${mood}`,
          `口味：${prefs.taste || '未填'}；预算：${prefs.budget || '未填'}；忌口：${prefs.avoid || '无'}；位置：${prefs.location || '未填'}`,
          '', '最近吃过：', recentLines,
          '', '附近店铺：', nearbyLines,
        ].join('\n'), { timeout: 90000 });
        const advice = {
          headline: String(result?.headline || '').trim(),
          picks: Array.isArray(result?.picks) ? result.picks.slice(0, 3) : [],
          avoid: String(result?.avoid || '').trim(),
          at: Date.now(),
        };
        if (!advice.picks.length) throw new Error('AI 没给出可用的推荐。');
        lastAdvice = advice;
        config.set('eat.lastAdvice', advice);
        renderAdvice(advice);
        if (!fromRemote) toast('推荐好了', 'good');
        return advice;
      } catch (error) {
        if (!fromRemote) toast(`推荐失败：${error.message}`, 'bad', 6000);
        throw error;
      } finally {
        recommendBtn.disabled = false;
        recommendBtn.textContent = '🍽 今天吃什么';
      }
    }

    // 手机端按「今天吃什么」时，app.js 会调这个
    window.__toolRemote = window.__toolRemote || {};
    window.__toolRemote['eat.recommend'] = async (payload) => {
      // 手机上选的心情要同步到桌面端的按钮，两边看到的是同一个状态
      const wanted = String(payload?.mood || '');
      if (MOODS.includes(wanted) && wanted !== mood) {
        mood = wanted;
        for (const b of moodRow.children) b.classList.toggle('btn--primary', b.textContent === wanted);
      }
      const advice = await recommend({ fromRemote: true });
      const lines = [advice.headline, '', ...advice.picks.map((p, i) => `${i + 1}. ${p.name}${p.shop ? `（${p.shop}）` : ''}\n   ${p.why}`)];
      if (advice.avoid) lines.push('', `今天先别：${advice.avoid}`);
      return { text: lines.join('\n'), advice };
    };
    window.__toolRemote['eat.record'] = async (payload) => {
      const dish = String(payload?.dish || '').trim();
      if (!dish) throw new Error('没有菜名。');
      recent.unshift({ dish, shop: String(payload?.shop || '').trim(), when: new Date().toISOString().slice(0, 10), source: '手机' });
      save();
      renderRecent();
      return { count: recent.length };
    };

    // ---------- 组装 ----------
    root.append(
      h('div', { class: 'bar' },
        h('strong', {}, '今天吃什么'),
        h('span', { class: 'faint' }, '登录右边的网页，读订单和店铺，AI 帮你定'),
        h('span', { style: { flex: 1 } }),
        recommendBtn,
      ),
      h('div', { class: 'eat__body' },
        h('aside', { class: 'eat__side' },
          h('section', { class: 'card' },
            h('h3', { class: 'card__title' }, '今天'),
            moodRow,
            h('div', { class: 'eat__prefs' }, tasteInput, budgetInput, avoidInput, locInput),
            adviceEl,
          ),
          h('section', { class: 'card' },
            h('div', { class: 'eat__section-head' }, h('h3', { class: 'card__title' }, '最近吃过'), h('span', { class: 'faint' }, `${recent.length} 条`)),
            recentInput,
            recentList,
          ),
          h('section', { class: 'card' },
            h('div', { class: 'eat__section-head' }, h('h3', { class: 'card__title' }, '附近店铺'), h('span', { class: 'faint' }, `${nearby.length} 家`)),
            nearbyInput,
            nearbyList,
          ),
        ),
        h('div', { class: 'eat__main' },
          siteTabs,
          h('div', { class: 'eat__actions' }, readBtn, nearBtn,
            h('span', { class: 'faint' }, '先在网页里登录并翻到订单页 / 附近列表，再点读取')),
          viewHost,
        ),
      ),
    );

    renderRecent();
    renderNearby();
    renderAdvice(lastAdvice);
    return {};
  },
};
