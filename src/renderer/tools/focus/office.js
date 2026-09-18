import { h, toast } from '../../core/ui.js';
import { createScene, lookOf } from './office-scene.js';

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

  function pushHistory(id, role, text) {
    const list = history.get(id) || [];
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
    return [...desks.values()].filter((d) => d.checked && d.installed);
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
    const statusEl = h('span', { class: 'office__desk-status' },
      agent.installed ? '空闲' : '未安装');
    const desk = {
      ...agent,
      checked: false,
      statusEl,
      busy: false,
    };
    const el = h('button', {
      class: `office__desk${agent.installed ? '' : ' is-missing'}`,
      style: { '--desk-accent': style.accent },
      title: agent.installed
        ? `${agent.label} · ${style.role}${WRITE_CAPABLE.has(agent.id) ? '（这家会改文件）' : '（只读 / 计划模式）'}`
        : `${agent.label} 没装或不在 PATH 里`,
      disabled: !agent.installed,
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
        h('span', { class: 'office__desk-role' }, style.role),
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

    const writers = picked.filter((d) => WRITE_CAPABLE.has(d.id));
    if (writers.length) {
      const names = writers.map((d) => d.label).join('、');
      if (!window.confirm(`${names} 不是只读模式，这条任务可能会改动文件。\n\n确定要派给它吗？`)) return;
    }

    const startedAt = Date.now();
    for (const desk of picked) {
      pushHistory(desk.id, 'user', prompt);
      desk.busy = true;
      running += 1;
      setDeskState(desk, '执行中…', 'busy');
      scene?.setState(desk.id, 'working', '干活中…');
      const view = resultCard(desk);
      // 各家并行跑，谁先回来谁先显示 —— 串行等的话多勾几个就要等到天荒地老
      window.toolbox.agentRun.run({ id: desk.id, prompt: composePrompt(desk.id, prompt) }).then((result) => {
        const spent = Math.round((Date.now() - startedAt) / 1000);
        view.timeEl.textContent = `${spent}s`;
        if (result?.ok) {
          view.body.textContent = result.text || '（没有返回文字）';
          pushHistory(desk.id, 'agent', result.text || '');
          if (chatAgent === desk.id) renderChat();
          setDeskState(desk, '已完成', 'good');
          scene?.setState(desk.id, 'idle', '');
        } else {
          view.body.textContent = result?.error || '执行失败';
          view.card.classList.add('is-bad');
          setDeskState(desk, '失败', 'bad');
          scene?.setState(desk.id, 'idle', '');
        }
      }).catch((error) => {
        view.body.textContent = String(error?.message || error);
        view.card.classList.add('is-bad');
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

  // ---------- 点屏幕：展开这家的对话，并且能接着聊 ----------
  const chatTitle = h('strong', {}, '');
  const chatLog = h('div', { class: 'office-chat__log' });
  const chatInput = h('textarea', {
    class: 'office-chat__input', rows: 2,
    placeholder: '接着跟它说…（⌘/Ctrl+Enter 发送）', spellcheck: false,
  });
  let chatAgent = null;

  const chatSend = h('button', { class: 'btn btn--primary btn--sm', onclick: () => sendFollowUp() }, '接着聊');
  const chatPanel = h('div', { class: 'office-chat', hidden: true },
    h('div', { class: 'office-chat__head' },
      chatTitle,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => closeChat() }, '收起'),
    ),
    chatLog,
    chatInput,
    h('div', { class: 'office-chat__actions' }, h('span', { style: { flex: 1 } }), chatSend),
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
  }

  function renderChat() {
    const turns = history.get(chatAgent) || [];
    chatLog.replaceChildren(...(turns.length
      ? turns.map((turn) => h('div', { class: `office-chat__turn is-${turn.role}` },
          h('span', { class: 'office-chat__who' }, turn.role === 'user' ? '我' : desks.get(chatAgent)?.label || 'AI'),
          h('pre', { class: 'office-chat__text' }, turn.text),
        ))
      : [h('div', { class: 'faint office-chat__empty' }, '还没聊过。下面写一句，它就开始干活了。')]));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function openChat(id) {
    const desk = desks.get(id);
    if (!desk) return;
    if (!desk.installed) return toast(`${desk.label} 没装或不在 PATH 里`, 'info');
    chatAgent = id;
    chatTitle.textContent = `${lookOf(id).tag} ${desk.label} 的屏幕`;
    chatPanel.hidden = false;
    renderChat();
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
      if (!agent.installed) scene.setState(agent.id, 'missing', '');
    }

    const installed = list.filter((a) => a.installed).length;
    summary.textContent = `本机装了 ${installed} / ${list.length} 家`;
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

  refresh();
  return { el, refresh };
}
