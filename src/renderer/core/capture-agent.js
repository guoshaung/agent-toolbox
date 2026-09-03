/**
 * 注入到 AI 网页里的「摘录探针」。
 *
 * 只做两件事，都刻意不依赖站点的 class 名——那些名字每次发版都在变：
 *   1. 记住你最近一次按回车发出去的问题（盯输入框，不盯消息气泡）；
 *   2. 你一选中文字，就在选区旁边冒一个「摘」，点了把文字连同上面那个问题一起收进暂存区。
 *
 * 宿主（快问工具）每隔几百毫秒调一次 drain() 把暂存区取走。
 * 不用 ipcRenderer 是因为 ask 的 webview 没挂 preload，
 * executeJavaScript 轮询已经够用，而且少一层耦合。
 */
export const CAPTURE_AGENT = String.raw`
(() => {
  if (window.__tbxCap && window.__tbxCap.version === 1) return 'already';

  const CHIP_ID = '__tbx_clip_chip';

  const agent = {
    version: 1,
    lastQ: '',
    pending: [],

    /** 找输入框：优先 contenteditable，其次可见的 textarea。和 page-agent 保持同一套启发式。 */
    input() {
      const editables = [...document.querySelectorAll('[contenteditable="true"]')]
        .filter((el) => el.getBoundingClientRect().width > 20);
      if (editables[0]) return editables[0];
      const areas = [...document.querySelectorAll('textarea')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 10;
        });
      return areas[0] || null;
    },

    drain() {
      const out = this.pending;
      this.pending = [];
      return { clips: out, lastQ: this.lastQ };
    },
  };

  /** 回车发送的一刹那把输入框内容抄下来——发出去之后框就被清空了，抄不到了。 */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const el = agent.input();
    if (!el) return;
    const text = (el.value !== undefined ? el.value : el.innerText || '').trim();
    if (text) agent.lastQ = text.slice(0, 400);
  }, true);

  const removeChip = () => {
    const old = document.getElementById(CHIP_ID);
    if (old) old.remove();
  };

  const showChip = (rect, text) => {
    removeChip();
    const chip = document.createElement('div');
    chip.id = CHIP_ID;
    chip.textContent = '摘';
    Object.assign(chip.style, {
      position: 'fixed',
      left: Math.max(8, rect.left + rect.width / 2 - 18) + 'px',
      top: Math.max(8, rect.top - 38) + 'px',
      zIndex: '2147483647',
      width: '36px', height: '28px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#10b981', color: '#04120c',
      font: '600 13px/1 system-ui, -apple-system, sans-serif',
      borderRadius: '8px', cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,.35)',
      userSelect: 'none',
    });
    // 用 mousedown 而不是 click：click 之前浏览器会先清掉选区，
    // 而且 mousedown 里 preventDefault 能保住选区不被点没。
    chip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      agent.pending.push({
        text: text.slice(0, 8000),
        q: agent.lastQ,
        at: Date.now(),
        url: location.href,
      });
      chip.textContent = '✓';
      chip.style.background = '#34d399';
      setTimeout(removeChip, 500);
    }, true);
    document.body.appendChild(chip);
  };

  document.addEventListener('mouseup', () => {
    // 延一帧，等浏览器把选区定下来
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? String(sel).trim() : '';
      if (!text || text.length < 8) { removeChip(); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { removeChip(); return; }
      showChip(rect, text);
    }, 10);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (e.target && e.target.id === CHIP_ID) return;
    removeChip();
  }, true);

  document.addEventListener('scroll', removeChip, true);

  window.__tbxCap = agent;
  return 'installed';
})()
`;
