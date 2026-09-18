import { h, toast } from '../../core/ui.js';

const AGENTS = {
  dsh: { accent: '#4e8cff', avatar: '◆', role: 'Harness' },
  codex: { accent: '#68c59b', avatar: '⌘', role: 'Code agent' },
  claude: { accent: '#e89b68', avatar: '✦', role: 'Thinking partner' },
  opencode: { accent: '#ba86ed', avatar: '◈', role: 'Open workspace' },
  omp: { accent: '#d5ad4d', avatar: '◎', role: 'OMP agent' },
  qwen: { accent: '#56b8d9', avatar: '◌', role: 'Qwen' },
  gemini: { accent: '#8d9cf6', avatar: '✧', role: 'Gemini' },
};

function relativeTime(iso) {
  const at = new Date(iso || '').getTime();
  if (!Number.isFinite(at)) return '本地记录';
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60000) return '刚刚更新';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function shortText(text, limit = 46) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean || '未命名会话';
}

/** 本机 AI 会话办公室：状态来自各工具已落盘的最近会话，而非伪造在线状态。 */
export function createOffice(ctx) {
  const chat = window.toolbox.chat;
  let agents = [];
  let active = null;
  let loading = false;
  let detailRequest = 0;

  const countEl = h('span', { class: 'focus-office__count' }, '扫描本机 AI…');
  const floor = h('div', { class: 'focus-office__floor', 'aria-live': 'polite' });
  const detail = h('aside', { class: 'focus-office__detail', hidden: true });
  const refreshBtn = h('button', { class: 'btn btn--sm focus-office__refresh', onclick: () => refresh() }, '刷新工位');

  function closeDetail() {
    detailRequest += 1;
    active = null;
    detail.hidden = true;
    detail.textContent = '';
    floor.querySelectorAll('.focus-office__desk').forEach((desk) => desk.classList.remove('is-selected'));
  }

  async function openSession(agent, desk) {
    if (!agent.session) return;
    const requestId = ++detailRequest;
    active = agent;
    floor.querySelectorAll('.focus-office__desk').forEach((item) => item.classList.toggle('is-selected', item === desk));
    detail.hidden = false;
    detail.textContent = '';
    detail.append(h('div', { class: 'focus-office__detail-loading' }, h('span', { class: 'spinner' }), ' 正在打开最近会话…'));
    try {
      const session = await chat.load(agent.source, agent.session.id, false, true);
      if (requestId !== detailRequest) return;
      if (!session) throw new Error('这段会话已被原工具清理。');
      renderDetail(agent, session);
    } catch (error) {
      if (requestId !== detailRequest) return;
      detail.textContent = '';
      detail.append(
        h('button', { class: 'focus-office__close', onclick: closeDetail, title: '关闭会话' }, '×'),
        h('strong', {}, agent.label),
        h('p', { class: 'faint' }, `读取会话失败：${error.message}`),
      );
    }
  }

  function renderDetail(agent, session) {
    detail.textContent = '';
    const meta = AGENTS[agent.source] || { accent: '#6e88a8', avatar: '•', role: agent.label };
    const messages = (session.messages || []).slice(-6);
    detail.append(
      h('button', { class: 'focus-office__close', onclick: closeDetail, title: '关闭会话' }, '×'),
      h('div', { class: 'focus-office__detail-head' },
        h('span', { class: 'focus-office__mini-avatar', style: { '--agent-accent': meta.accent } }, meta.avatar),
        h('div', {}, h('strong', {}, agent.label), h('span', { class: 'faint' }, `${session.totalMessages || session.count || 0} 条消息 · ${relativeTime(session.updatedAt)}`)),
      ),
      h('h3', {}, shortText(session.title, 90)),
      session.cwd && h('div', { class: 'focus-office__cwd' }, session.cwd),
      h('div', { class: 'focus-office__messages' }, ...messages.map((message) => h('div', { class: `focus-office__message focus-office__message--${message.role}` },
        h('span', {}, message.role === 'user' ? '你' : agent.label),
        h('p', {}, shortText(message.content, 220)),
      ))),
      session.truncated && h('p', { class: 'faint focus-office__hint' }, '这是预览。完整会话可在「记录」工具中导出。'),
      h('button', { class: 'btn btn--sm', onclick: () => ctx.goto('history') }, '去「记录」查看全部'),
    );
  }

  function render() {
    floor.textContent = '';
    const installed = agents.filter((agent) => agent.installed).length;
    const available = agents.filter((agent) => agent.available).length;
    countEl.textContent = installed || available ? `已安装 ${installed} · 有记录 ${available}` : '还没发现本机 AI';
    for (const agent of agents) {
      const meta = AGENTS[agent.source] || { accent: '#6e88a8', avatar: '•', role: agent.label };
      const desk = h('article', {
        class: `focus-office__desk${agent.available ? ' has-session' : ''}${agent.installed ? ' is-installed' : ' is-empty'}`,
        style: { '--agent-accent': meta.accent },
      });
      const computer = h('button', {
        class: 'focus-office__computer',
        disabled: !agent.available,
        title: agent.available ? `打开 ${agent.label} 最近会话` : `${agent.label} 尚未发现本地会话`,
        onclick: () => openSession(agent, desk),
      }, h('span', { class: 'focus-office__screen' }, agent.available ? shortText(agent.session.title, 22) : '待命'), h('span', { class: 'focus-office__keyboard' }));
      desk.append(
        h('div', { class: 'focus-office__lamp' }),
        h('div', { class: 'focus-office__worker' },
          h('span', { class: 'focus-office__avatar' }, meta.avatar),
          h('span', { class: 'focus-office__torso' }),
        ),
        computer,
        h('div', { class: 'focus-office__desk-info' },
          h('strong', {}, agent.label),
          h('span', {}, agent.available ? relativeTime(agent.session.updatedAt) : agent.installed ? '已安装 · 暂无会话' : '未安装'),
        ),
      );
      floor.append(desk);
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    countEl.textContent = '正在扫描本机 AI 会话…';
    try {
      agents = await chat.latest();
      render();
      if (active) closeDetail();
    } catch (error) {
      countEl.textContent = '扫描失败';
      toast(`AI 办公室扫描失败：${error.message}`, 'bad');
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  const root = h('section', { class: 'focus-office card' },
    h('div', { class: 'focus-office__head' },
      h('div', {}, h('div', { class: 'focus__card-kicker' }, 'LOCAL AI OFFICE'), h('h2', {}, 'AI 办公室'), h('p', { class: 'faint' }, '点击亮着的电脑，查看各 AI 在本机保存的最近会话。')),
      h('div', { class: 'focus-office__actions' }, countEl, refreshBtn),
    ),
    h('div', { class: 'focus-office__scene' }, floor, detail),
  );
  refresh();
  return { root, refresh };
}
