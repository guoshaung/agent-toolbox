import { h, toast } from '../../core/ui.js';
import { createScene, lookOf } from './office-scene.js';
import { WEB_CHAT, createWebPool } from './office-web.js';

/**
 * AI 派发台。
 *
 * 上一版只能看：把各家 AI 最近的会话摆成一排「工位」，看完还是得切到对应的
 * 界面里自己敲一遍。真正费事的从来不是「看看它们在干嘛」，而是「把同一件事
 * 交给它们」—— 所以这一版的重点是派活：在这里写一次，勾几个，一起发出去，
 * 结果并排回来。
 */

const AGENT_STYLE = {
  codex: { avatar: '⌘', accent: '#68c59b', role: '写代码 / 改代码' },
  claude: { avatar: '✦', accent: '#e89b68', role: '想问题 / 讲清楚' },
  opencode: { avatar: '◈', accent: '#ba86ed', role: '开放工作区' },
  dsh: { avatar: '◆', accent: '#4e8cff', role: 'Harness' },
  gemini: { avatar: '✧', accent: '#8d9cf6', role: '长上下文' },
  omp: { avatar: '◎', accent: '#d5ad4d', role: 'OMP' },
  qwen: { avatar: '◌', accent: '#56b8d9', role: 'Qwen' },
};

// 只读 / 计划模式的那几家，派出去不会动你的文件。另外两家会，得说清楚。
const WRITE_CAPABLE = new Set(['opencode', 'dsh']);

const PRESETS = [
  ['解释这段报错', '解释下面这段报错的根因，给出最小修复；不要改文件。\n\n'],
  ['读一下最近改动', '看一下当前目录最近一次改动做了什么，用中文讲清楚动机和风险。'],
  ['找找有没有 bug', '在当前目录里找出最可能出问题的 3 个地方，说清楚复现路径，不要动文件。'],
  ['写个测试思路', '针对当前目录的核心逻辑，列出值得写的测试用例，说明每条在防什么。'],
];

const relative = (iso) => {
  const at = new Date(iso || '').getTime();
  if (!Number.isFinite(at)) return '';
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
};

export function createOffice(ctx) {
  const { config } = ctx;
  /** @type {Map<string, {id,label,installed,checked,el,statusEl,resultEl,busy}>} */
  const desks = new Map();
  /** agentId -> [{role:'user'|'agent', text}]，多轮靠它接上下文 */
  const history = new Map();
  let scene = null;
  let running = 0;
  const web = createWebPool();

  // ---------- 每家走哪条路 ----------
  //
  // 网页版：内嵌它的官网对话框，登录一次长期有效，字直接塞进输入框（默认）
  // 窗口：你屏幕上已经开着的那个 Claude Code / Codex 终端窗口，粘贴 + 回车
  // 命令行：另起一个 CLI 进程 —— 这就是之前每次都要你登录的那条路，留着但不默认
  const CHANNELS = [['window', '桌面应用 / 窗口'], ['web', '网页版'], ['cli', '命令行']];
  /** 本机装了的 AI 桌面客户端：{ codex: 'ChatGPT', ... }。refresh 时填。 */
  let desktopApps = {};
  // 默认送进桌面客户端（ChatGPT.app / Claude.app…）—— 你平时聊天的上下文和登录态都在那里；
  // 没装客户端的才退到网页版
  const channelOf = (id) => {
    const saved = config.get(`focus.channel.${id}`, '');
    if (CHANNELS.some(([k]) => k === saved)) return saved;
    if (desktopApps[id]) return 'window';
    return WEB_CHAT[id] ? 'web' : 'window';
  };
  const targetOf = (id) => config.get(`focus.handoffTarget.${id}`, '') || desktopApps[id] || '';
  const channelLabel = (key) => CHANNELS.find(([k]) => k === key)?.[1] || key;

  function pushHistory(id, role, text) {
    const list = history.get(id) || [];
    list.push({ role, text: String(text || '').slice(0, 4000) });
    history.set(id, list.slice(-12));
  }

  /**
   * 把最后那条「正在执行…」换成真正的结果。
   *
   * 以前只有成功才往历史里写，失败就什么都不写 —— 于是对话面板上只剩你发的那句，
   * 看着就是「点了接着聊没反应」，而真正的报错跑到下面派发台的结果卡里去了。
   */
  function settleHistory(id, role, text) {
    const list = history.get(id) || [];
    if (list[list.length - 1]?.role === 'pending') list.pop();
    list.push({ role, text: String(text || '').slice(0, 4000) });
    history.set(id, list.slice(-12));
  }

  const promptInput = h('textarea', {
    class: 'office__prompt',
    rows: 3,
    placeholder: '写一句要做的事，勾上要交给谁，⌘/Ctrl+Enter 发出去…',
    spellcheck: false,
  });

  const summary = h('span', { class: 'office__summary faint' }, '正在看本机装了哪些…');
  const grid = h('div', { class: 'office__grid' });
  const roomHost = h('div', { class: 'office__room-host' });
  const results = h('div', { class: 'office__results' });

  const sendBtn = h('button', {
    class: 'btn btn--primary office__send',
    onclick: () => dispatch(),
  }, '派发');

  const presetRow = h('div', { class: 'office__presets' },
    ...PRESETS.map(([label, text]) => h('button', {
      class: 'btn btn--sm btn--ghost',
      title: text.trim().slice(0, 60),
      onclick: () => {
        promptInput.value = text;
        promptInput.focus();
        promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
      },
    }, label)),
  );

  promptInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    dispatch();
  });

  function selected() {
    return [...desks.values()].filter((d) => d.checked && (d.installed || d.web));
  }

  function syncSend() {
    const picked = selected();
    sendBtn.disabled = running > 0 || !picked.length;
    sendBtn.textContent = running > 0
      ? `执行中… ${running}`
      : picked.length > 1 ? `派发给 ${picked.length} 个` : '派发';
  }

  function makeDesk(agent) {
    const style = AGENT_STYLE[agent.id] || { avatar: '●', accent: 'var(--accent)', role: '' };
    const hasWeb = Boolean(WEB_CHAT[agent.id]);
    const usable = agent.installed || hasWeb || Boolean(desktopApps[agent.id]);
    const statusEl = h('span', { class: 'office__desk-status' },
      desktopApps[agent.id] ? `→ ${desktopApps[agent.id]}` : agent.installed ? '空闲' : hasWeb ? '网页版' : '未安装');
    const desk = {
      ...agent,
      web: hasWeb,
      checked: false,
      statusEl,
      busy: false,
    };
    const el = h('button', {
      class: `office__desk${usable ? '' : ' is-missing'}`,
      style: { '--desk-accent': style.accent },
      title: usable
        ? `${agent.label} · ${style.role || (hasWeb ? WEB_CHAT[agent.id].who : '')} · 走「${channelLabel(channelOf(agent.id))}」`
        : `${agent.label} 没装、也没有网页版`,
      disabled: !usable,
      onclick: () => {
        desk.checked = !desk.checked;
        el.classList.toggle('is-on', desk.checked);
        syncSend();
        config.set('focus.officePicked', [...desks.values()].filter((d) => d.checked).map((d) => d.id));
      },
    },
      h('span', { class: 'office__desk-avatar' }, style.avatar),
      h('span', { class: 'office__desk-main' },
        h('strong', {}, agent.label),
        h('span', { class: 'office__desk-role' }, style.role || (hasWeb ? `网页版 ${WEB_CHAT[agent.id].who}` : '')),
      ),
      statusEl,
      WRITE_CAPABLE.has(agent.id) && agent.installed
        ? h('span', { class: 'office__desk-warn', title: '这家不是只读模式，派出去可能会改文件' }, '会动文件')
        : null,
    );
    desk.el = el;
    return desk;
  }

  function setDeskState(desk, text, kind = '') {
    desk.statusEl.textContent = text;
    desk.statusEl.className = `office__desk-status${kind ? ` is-${kind}` : ''}`;
  }

  function resultCard(desk) {
    const body = h('pre', { class: 'office__result-body' }, '正在执行…');
    const card = h('article', { class: 'office__result' },
      h('header', { class: 'office__result-head' },
        h('strong', {}, desk.label),
        h('span', { class: 'faint office__result-time' }, '刚刚派出'),
        h('span', { style: { flex: 1 } }),
        h('button', {
          class: 'btn btn--sm btn--ghost', title: '复制这段输出',
          onclick: async () => {
            await navigator.clipboard.writeText(body.textContent || '');
            toast('已复制', 'good');
          },
        }, '复制'),
      ),
      body,
    );
    results.prepend(card);
    return { card, body, timeEl: card.querySelector('.office__result-time') };
  }

  /**
   * 拼出带上下文的提示词。
   *
   * 这些 CLI 都是发一次、跑完就退，没有常驻会话可接。所以「接着聊」是把前几轮
   * 原样带回去 —— 只带最近 6 轮，再多提示词会迅速膨胀，agent 反而抓不住重点。
   */
  function composePrompt(id, next) {
    const past = (history.get(id) || []).slice(-6);
    if (!past.length) return next;
    const lines = past.map((turn) => (turn.role === 'user' ? `我：${turn.text}` : `你上次答：${turn.text}`));
    return `${lines.join('\n\n')}\n\n我：${next}`;
  }

  async function dispatch() {
    const prompt = promptInput.value.trim();
    if (!prompt) return toast('先写一句要做的事', 'info');
    const picked = selected();
    if (!picked.length) return toast('先勾一个 AI', 'info');

    const writers = picked.filter((d) => WRITE_CAPABLE.has(d.id) && channelOf(d.id) === 'cli');
    if (writers.length) {
      const names = writers.map((d) => d.label).join('、');
      if (!window.confirm(`${names} 不是只读模式，这条任务可能会改动文件。\n\n确定要派给它吗？`)) return;
    }

    const startedAt = Date.now();
    for (const desk of picked) {
      pushHistory(desk.id, 'user', prompt);
      pushHistory(desk.id, 'pending', '正在执行…');
      if (chatAgent === desk.id) renderChat();
      desk.busy = true;
      running += 1;
      setDeskState(desk, '执行中…', 'busy');
      scene?.setState(desk.id, 'working', '干活中…');
      const view = resultCard(desk);
      // 各家并行跑，谁先回来谁先显示 —— 串行等的话多勾几个就要等到天荒地老
      deliver(desk, prompt).then((result) => {
        const spent = Math.round((Date.now() - startedAt) / 1000);
        view.timeEl.textContent = `${spent}s`;
        if (result?.ok) {
          view.body.textContent = result.text || '（没有返回文字）';
          settleHistory(desk.id, 'agent', result.text || '（没有返回文字）');
          if (chatAgent === desk.id) renderChat();
          setDeskState(desk, '已完成', 'good');
          scene?.setState(desk.id, 'idle', '');
        } else {
          view.body.textContent = result?.error || '执行失败';
          view.card.classList.add('is-bad');
          settleHistory(desk.id, 'error', result?.error || '执行失败');
          if (chatAgent === desk.id) renderChat();
          setDeskState(desk, '失败', 'bad');
          scene?.setState(desk.id, 'idle', '');
        }
      }).catch((error) => {
        view.body.textContent = String(error?.message || error);
        view.card.classList.add('is-bad');
        settleHistory(desk.id, 'error', String(error?.message || error));
        if (chatAgent === desk.id) renderChat();
        setDeskState(desk, '失败', 'bad');
        scene?.setState(desk.id, 'idle', '');
      }).finally(() => {
        desk.busy = false;
        running -= 1;
        syncSend();
      });
    }
    syncSend();
  }

  /**
   * 按这家选的路把话送出去。
   * 网页版和窗口都是「送到就算完」—— 回答在它自己的屏幕里，不会回到这里；
   * 只有命令行那条路会把输出带回来。
   */
  async function deliver(desk, prompt) {
    const channel = channelOf(desk.id);
    if (channel === 'web') {
      const r = await web.send(desk.id, prompt);
      if (!r.ok) {
        if (r.needsLogin && chatAgent !== desk.id) openChat(desk.id);   // 把它的屏幕亮出来，登录就在那儿登
        return { ok: false, error: r.error };
      }
      return { ok: true, text: `已送进 ${WEB_CHAT[desk.id].who} 网页版的对话框（${r.how === 'button' ? '点了发送' : '按了回车'}），回答在它的屏幕里看。` };
    }
    if (channel === 'window') {
      const app = targetOf(desk.id);
      if (!app) return { ok: false, error: '还没选它在哪个应用里 —— 点它的屏幕，在「桌面应用 / 窗口」里选一个。' };
      const r = await window.toolbox.agentRun.handoff({ app, text: prompt });
      if (r?.needsPermission) {
        window.toolbox.agentRun.openAccessibility();
        return { ok: false, error: '还没授权控制其它应用（系统设置 → 隐私与安全性 → 辅助功能），已帮你打开设置。' };
      }
      if (!r?.ok) return { ok: false, error: r?.error || '投送失败' };
      return { ok: true, text: `已丢进「${app}」窗口并回车，回答在那边看。` };
    }
    if (!desk.installed) return { ok: false, error: `${desk.label} 的命令行没装，换「网页版」或「已开着的窗口」。` };
    return window.toolbox.agentRun.run({ id: desk.id, prompt: composePrompt(desk.id, prompt) });
  }

  // ---------- 点屏幕：展开这家的对话，并且能接着聊 ----------
  const chatTitle = h('strong', {}, '');
  // 下面 chatPanel 组装时要用到这两个，声明必须在它前面。
  // 放在后面会落进暂时性死区，整个专注页直接白屏（实测报
  // "Cannot access 'chatSessionSelect' before initialization"）。
  const chatPast = h('div', { class: 'office-chat__past' });
  const chatSessionSelect = h('select', { class: 'field field--sm office-chat__sessions', onchange: () => loadPast() });
  const chatLog = h('div', { class: 'office-chat__log' });
  const chatInput = h('textarea', {
    class: 'office-chat__input', rows: 2,
    placeholder: '接着跟它说…（⌘/Ctrl+Enter 发送）', spellcheck: false,
  });
  let chatAgent = null;

  const chatSend = h('button', { class: 'btn btn--primary btn--sm', onclick: () => sendFollowUp() }, '发送');

  // ---------- 走哪条路 ----------
  const channelSelect = h('select', {
    class: 'field field--sm office-chat__channel', title: '这家的话从哪里送出去',
    onchange: () => {
      config.set(`focus.channel.${chatAgent}`, channelSelect.value);
      syncChannelUi();
    },
  }, ...CHANNELS.map(([key, label]) => h('option', { value: key }, label)));

  // 「已开着的窗口」：你屏幕上那个登录好的终端。每家各记各的。
  const targetSelect = h('select', {
    class: 'field field--sm office-chat__target',
    title: '把文字丢进哪个已经开着的窗口',
    onchange: () => { config.set(`focus.handoffTarget.${chatAgent}`, targetSelect.value); chatSend.textContent = `发进 ${targetSelect.value || '应用'} ⏎`; },
  });
  const webBar = h('div', { class: 'office-chat__webbar' },
    h('span', { class: 'faint' }, '第一次用先在下面的屏幕里登录一次，之后就不用了'),
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn btn--sm btn--ghost', onclick: () => web.openHome(chatAgent) }, '回到首页'),
    h('button', { class: 'btn btn--sm btn--ghost', onclick: () => web.reload(chatAgent) }, '刷新'),
  );

  function syncChannelUi() {
    const channel = channelOf(chatAgent);
    channelSelect.value = channel;
    const desk = desks.get(chatAgent);
    const hasWeb = Boolean(WEB_CHAT[chatAgent]);
    channelSelect.querySelector('option[value="web"]').disabled = !hasWeb;
    channelSelect.querySelector('option[value="cli"]').disabled = !desk?.installed;
    targetSelect.hidden = channel !== 'window';
    webBar.hidden = channel !== 'web';
    if (channel === 'web') web.show(chatAgent); else web.close();
    chatSend.textContent = channel === 'web' ? '发到网页版 ⏎' : channel === 'window' ? `发进 ${targetOf(chatAgent) || '应用'} ⏎` : '跑命令行';
    if (channel === 'window') loadTargets();
  }

  async function loadTargets() {
    let apps = [];
    try { apps = await window.toolbox.agentRun.apps(); } catch { /* 列不出来就留空 */ }
    // 装了但没开的客户端也列进去 —— 投送时 activate 会把它拉起来
    const preferred = desktopApps[chatAgent];
    if (preferred && !apps.includes(preferred)) apps.unshift(preferred);
    targetSelect.replaceChildren(h('option', { value: '' }, '选应用…'),
      ...apps.map((name) => h('option', { value: name }, name === preferred ? `${name}（它的客户端）` : name)));
    const remembered = targetOf(chatAgent);
    if (remembered && apps.includes(remembered)) targetSelect.value = remembered;
    chatSend.textContent = `发进 ${targetSelect.value || '应用'} ⏎`;
  }
  const chatPanel = h('div', { class: 'office-chat', hidden: true },
    h('div', { class: 'office-chat__head' },
      chatTitle,
      chatSessionSelect,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => loadSessionList() }, '刷新'),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => closeChat() }, '收起'),
    ),
    chatPast,
    chatLog,
    chatInput,
    h('div', { class: 'office-chat__actions' },
      channelSelect, targetSelect,
      h('span', { style: { flex: 1 } }),
      chatSend,
    ),
    webBar,
    web.host,
  );

  chatInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    sendFollowUp();
  });

  function closeChat() {
    chatAgent = null;
    chatPanel.hidden = true;
    web.close();
  }

  /**
   * 读这家 AI 在本机真正的历史会话。
   *
   * 之前点屏幕只显示「在这个办公室里聊过的」几轮 —— 那是我这边自己记的，
   * 跟它平时在终端里的对话完全是两回事。真正要看的是它自己那份记录，
   * 所以这里走 chat.list / chat.load 把它读出来（tail=true 取最近那几十条）。
   */
  async function loadPast() {
    const id = chatAgent;
    const sessionId = chatSessionSelect.value;
    if (!id || !sessionId) { chatPast.replaceChildren(); return; }
    chatPast.replaceChildren(h('div', { class: 'faint office-chat__empty' }, '正在读它的历史记录…'));
    let data = null;
    try {
      data = await window.toolbox.chat.load(id, sessionId, false, true);
    } catch (error) {
      chatPast.replaceChildren(h('div', { class: 'faint office-chat__empty' }, `读不到：${error.message}`));
      return;
    }
    if (chatAgent !== id) return;                       // 期间换人了，丢掉这次结果
    const msgs = (data?.messages || []).filter((m) => String(m.content || '').trim());
    if (!msgs.length) {
      chatPast.replaceChildren(h('div', { class: 'faint office-chat__empty' }, '这段会话里没有可显示的内容。'));
      return;
    }
    chatPast.replaceChildren(
      h('div', { class: 'office-chat__sep' }, `本机历史 · 共 ${data.totalMessages || msgs.length} 条${data.truncated ? '（只显示最近的）' : ''}`),
      ...msgs.map((m) => bubble(id, m.role === 'user' ? 'user' : 'agent', String(m.content).slice(0, 4000))),
    );
    // 打开就停在最近那几句，不是从头翻
    chatPast.scrollTop = chatPast.scrollHeight;
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.scrollIntoView({ block: 'nearest' });
  }

  async function loadSessionList() {
    const id = chatAgent;
    chatSessionSelect.replaceChildren();
    let list = [];
    try {
      list = await window.toolbox.chat.list(id);
    } catch { /* 读不到就只剩办公室里的那几轮 */ }
    if (chatAgent !== id) return;
    if (!list.length) {
      chatSessionSelect.hidden = true;
      chatPast.replaceChildren(h('div', { class: 'faint office-chat__empty' }, '本机还没有它的会话记录。'));
      return;
    }
    chatSessionSelect.hidden = false;
    for (const session of list.slice(0, 40)) {
      const when = String(session.updatedAt || '').slice(5, 16).replace('T', ' ');
      chatSessionSelect.append(h('option', { value: session.id },
        `${when} · ${String(session.title || '未命名').slice(0, 30)}（${session.count || 0} 条）`));
    }
    await loadPast();
  }

  /**
   * 一条消息 = 头像 + 气泡。
   *
   * 之前是「52px 标签 + 一块 pre」的表格排法，全宽等宽字、没有气泡，读起来像
   * 日志不像对话。现在我的靠右、对方靠左，头像用它自己的配色和记号，
   * 气泡宽度跟着内容走（最多 78%），一眼能看出谁说的、说了多长。
   */
  function bubble(agentId, role, text) {
    const mine = role === 'user';
    const look = lookOf(agentId);
    const label = mine ? '我' : role === 'pending' ? '…' : desks.get(agentId)?.label || 'AI';
    const avatar = h('span', { class: 'office-chat__avatar' }, mine ? '我' : look.tag);
    if (!mine) avatar.style.setProperty('--who-color', look.accent);

    const body = h('div', { class: 'office-chat__bubble' },
      h('span', { class: 'office-chat__name' }, label),
      h('div', { class: 'office-chat__text' }, text),
    );
    if (!mine) body.style.setProperty('--who-color', look.accent);
    return h('div', { class: `office-chat__turn is-${role}${mine ? ' is-mine' : ''}` }, avatar, body);
  }

  function renderChat() {
    const turns = history.get(chatAgent) || [];
    chatLog.replaceChildren(...(turns.length
      ? [h('div', { class: 'office-chat__sep' }, '刚在这里聊的'),
         ...turns.map((turn) => bubble(chatAgent, turn.role, turn.text))]
      : []));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function openChat(id) {
    const desk = desks.get(id);
    if (!desk) return;
    if (!desk.installed && !desk.web) return toast(`${desk.label} 没装、也没有网页版`, 'info');
    chatAgent = id;
    chatTitle.textContent = `${lookOf(id).tag} ${desk.label} 的屏幕`;
    chatPanel.hidden = false;
    renderChat();
    loadSessionList();
    syncChannelUi();
    chatInput.focus();
  }

  function sendFollowUp() {
    if (!chatAgent) return;
    const text = chatInput.value.trim();
    if (!text) return toast('先写一句', 'info');
    const desk = desks.get(chatAgent);
    if (desk?.busy) return toast(`${desk.label} 还在忙上一轮`, 'info');
    chatInput.value = '';
    // 走同一条派发通路：只勾这一家、内容是刚写的这句
    for (const d of desks.values()) { d.checked = d.id === chatAgent; d.el.classList.toggle('is-on', d.checked); }
    promptInput.value = text;
    dispatch().then(() => renderChat());
    renderChat();
  }

  async function refresh() {
    summary.textContent = '正在看本机装了哪些…';
    let list = [];
    try {
      list = await window.toolbox.agentRun.list();
    } catch (error) {
      summary.textContent = `读不到本机 AI：${error.message}`;
      return;
    }
    try { desktopApps = (await window.toolbox.agentRun.desktopApps?.()) || {}; } catch { desktopApps = {}; }
    let recent = {};
    try {
      const latest = await window.toolbox.chat.latest();
      for (const item of latest || []) recent[item.source || item.id] = item;
    } catch { /* 会话记录读不到不影响派发 */ }

    desks.clear();
    grid.replaceChildren();
    const remembered = new Set(config.get('focus.officePicked', []) || []);
    for (const agent of list) {
      const desk = makeDesk(agent);
      if (agent.installed && remembered.has(agent.id)) {
        desk.checked = true;
        desk.el.classList.add('is-on');
      }
      const seen = recent[agent.id];
      if (seen?.updatedAt) setDeskState(desk, `${relative(seen.updatedAt)}用过`, '');
      desks.set(agent.id, desk);
      grid.append(desk.el);
    }
    scene?.stop();
    scene = createScene(list, openChat);
    roomHost.replaceChildren(scene.el);
    for (const agent of list) {
      if (!agent.installed && !WEB_CHAT[agent.id] && !desktopApps[agent.id]) scene.setState(agent.id, 'missing', '');
    }

    const installed = list.filter((a) => a.installed).length;
    const apps = Object.values(desktopApps);
    summary.textContent = `命令行 ${installed} / ${list.length} 家${apps.length ? ` · 桌面客户端：${apps.join('、')}` : ''}`;
    syncSend();
  }

  const el = h('section', { class: 'card office' },
    h('div', { class: 'office__head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, 'DISPATCH'),
        h('h3', { class: 'card__title' }, 'AI 派发台'),
      ),
      summary,
      h('button', { class: 'btn btn--sm', onclick: () => refresh() }, '重新扫描'),
    ),
    roomHost,
    chatPanel,
    grid,
    promptInput,
    h('div', { class: 'office__actions' }, presetRow, h('span', { style: { flex: 1 } }), sendBtn),
    results,
  );

  // 手机端派活也走这里：按这家选的路送，命令行那条路让主进程自己跑（它有确认框和输出回传）
  window.__toolRemote = window.__toolRemote || {};
  window.__toolRemote['office.send'] = async ({ id, prompt } = {}) => {
    const desk = desks.get(String(id || ''));
    const text = String(prompt || '').trim();
    if (!desk || !text || channelOf(desk.id) === 'cli') return { handled: false };
    pushHistory(desk.id, 'user', text);
    const result = await deliver(desk, text);
    settleHistory(desk.id, result.ok ? 'agent' : 'error', result.ok ? result.text : result.error);
    if (chatAgent === desk.id) renderChat();
    return { handled: true, ...result };
  };

  refresh();
  return { el, refresh };
}
