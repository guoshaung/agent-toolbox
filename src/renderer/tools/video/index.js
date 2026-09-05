import { h, toast } from '../../core/ui.js';

const BILIBILI_STUDY_URL = 'https://www.bilibili.com/v/knowledge/learning/';
const VIDEO_PLUGIN_KEY = 'video.plugins';
const USERSCRIPT_KEY = 'video.userscript';
const VIDEO_PLUGINS = [
  {
    id: 'subtitle-auto-open',
    name: 'B 站字幕自动开启',
    description: '进入视频页后自动检测播放器字幕按钮，并优先选择中文/简体字幕。',
    defaultOn: true,
  },
  {
    id: 'subtitle-ai-fallback',
    name: '无字幕时 AI 字幕兜底',
    description: '官方字幕不存在时，报告模式自动尝试 B 站 AI 字幕；不把第三方扩展源码注入页面。',
    defaultOn: true,
  },
  {
    id: 'playback-speed',
    name: 'B 站倍速控制',
    description: '仿 Btools 的学习控制条，支持 0.5×–3×、快捷键 [ / ]，只作用于当前视频。',
    defaultOn: true,
  },
  {
    id: 'swipe-back',
    name: '双指左滑返回',
    description: '在学习区双指向左滑，返回 B 站上一个页面；只识别明显的横向手势，不影响普通滚动。',
    defaultOn: true,
  },
  {
    id: 'userscript-compat',
    name: '油猴脚本兼容',
    description: '保存并运行你自己的 B 站 userscript；只在当前 B 站页面执行，运行前需要手动点击。',
    defaultOn: false,
  },
  {
    id: 'study-clean-view',
    name: '学习区清爽视图',
    description: '沿用工具箱的站点清理规则，关闭评论干扰并保留页面导航。',
    defaultOn: true,
  },
];

function defaultVideoPlugins() {
  return Object.fromEntries(VIDEO_PLUGINS.map((plugin) => [plugin.id, plugin.defaultOn]));
}

/**
 * 视频报告：贴一个 B 站链接 → 抓公开信息 → 拉字幕（官方优先，AI 兜底）→
 * AI 按字幕写逐集笔记 → 本地存 Markdown，顺手用 lark-cli 发到飞书。
 * 报告文件永远在本地留底，飞书发不出去也不丢。
 *
 * 字幕策略：视频本身有 UP 主上传的官方字幕就直接用；没有才拉 B 站 AI 生成字幕。
 * 都没字幕就退化成「内容地图型」报告（标题/简介/分集大纲）。
 */
export default {
  id: 'video',
  title: '视频',
  icon: 'monitor',
  hint: '贴 B 站链接，拉字幕生成内容级总结报告，存本地并可一键发到飞书',

  create(root, ctx) {
    const { config, ai } = ctx;
    const video = window.toolbox.video;
    const clipboard = window.toolbox.clipboard;

    let info = null; // 抓到的视频信息
    let busy = false;
    let currentView = config.get('video.view', 'study');
    let pluginPrefs = { ...defaultVideoPlugins(), ...(config.get(VIDEO_PLUGIN_KEY) || {}) };
    let subtitlePluginTimer = null;
    let subtitlePluginAttempts = 0;
    let userscriptCode = config.get(USERSCRIPT_KEY, {}).code || '';

    const linkInput = h('input', {
      class: 'field video__link',
      placeholder: '粘贴 B 站链接，回车抓取（https://www.bilibili.com/video/BV…）',
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fetchInfo(); }
      },
    });
    const fetchBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => fetchInfo() }, '抓取');

    const aiToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    aiToggle.checked = config.get('video.useAi', true);
    aiToggle.addEventListener('change', () => config.set('video.useAi', aiToggle.checked));

    const publishToggle = h('input', { type: 'checkbox', class: 'switch__input' });
    publishToggle.checked = config.get('video.publish', true);
    publishToggle.addEventListener('change', () => config.set('video.publish', publishToggle.checked));

    const subsScope = h('select', { class: 'field video__scope' },
      h('option', { value: 'p1' }, '字幕：仅第 1 集'),
      h('option', { value: 'p5' }, '字幕：前 5 集'),
      h('option', { value: 'all' }, '字幕：全部集（慢）'),
      h('option', { value: 'none' }, '字幕：不拉取'),
    );
    subsScope.value = config.get('video.subsScope', 'p1');
    subsScope.addEventListener('change', () => config.set('video.subsScope', subsScope.value));

    const body = h('div', { class: 'video__body' });
    const historyEl = h('div', { class: 'video__history' });
    const studyView = h('webview', {
      class: 'video__study-view',
      partition: 'persist:bilibili-study',
      src: BILIBILI_STUDY_URL,
      allowpopups: true,
    });
    const studyStatus = h('span', { class: 'faint video__study-status' }, '固定入口：B 站学习区');
    const subtitleStatus = h('span', { class: 'tag tag--good video__subtitle-status' }, '字幕插件已启用');
    const studyUrl = h('input', {
      class: 'field video__study-url',
      readonly: true,
      spellcheck: false,
      placeholder: '当前页面 URL',
      value: BILIBILI_STUDY_URL,
    });

    function syncStudyUrl(url) {
      studyUrl.value = String(url || BILIBILI_STUDY_URL);
    }

    function pluginEnabled(id) {
      return pluginPrefs[id] !== false;
    }

    async function applySpeedPlugin() {
      if (!pluginEnabled('playback-speed')) {
        try { await studyView.executeJavaScript("document.querySelector('#agent-toolbox-speed-dock')?.remove()", true); } catch {}
        return;
      }
      const url = studyView.getURL();
      if (!/bilibili\.com/i.test(url || '')) return;
      try {
        await studyView.executeJavaScript(`(() => {
          const getVideo = () => document.querySelector('.bpx-player-container video, .bilibili-player-video video, video');
          const video = getVideo();
          if (!video) return { found: false };
          let dock = document.querySelector('#agent-toolbox-speed-dock');
          if (!dock) {
            dock = document.createElement('div');
            dock.id = 'agent-toolbox-speed-dock';
            dock.innerHTML = '<button data-speed-action="down">−</button><strong data-speed-value title="拖动这里移动倍速条">1×</strong><button data-speed-action="up">+</button><select data-speed-select><option>0.5</option><option>0.75</option><option>1</option><option>1.25</option><option>1.5</option><option>2</option><option>3</option></select>';
            dock.style.cssText = 'position:fixed;right:18px;bottom:84px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(18,20,25,.9);box-shadow:0 8px 26px rgba(0,0,0,.35);backdrop-filter:blur(10px);font:600 12px/1 Arial,sans-serif;color:#eef3ff;touch-action:none;user-select:none;cursor:grab;';
            dock.querySelectorAll('button,select').forEach((node) => { node.style.cssText = 'min-width:28px;height:26px;padding:0 7px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;'; });
            dock.querySelector('strong').style.cssText = 'min-width:28px;text-align:center;color:#8eb0ff;';
            document.body.appendChild(dock);
            const update = (rate) => {
              const next = Math.max(.25, Math.min(4, Number(rate) || 1));
              const activeVideo = getVideo();
              if (activeVideo) activeVideo.playbackRate = next;
              dock.querySelector('[data-speed-value]').textContent = next + '×';
              dock.querySelector('[data-speed-select]').value = String(next);
            };
            dock.addEventListener('click', (event) => {
              const action = event.target.closest('[data-speed-action]')?.dataset.speedAction;
              const currentVideo = getVideo();
              if (action === 'down') update((currentVideo?.playbackRate || 1) - .25);
              if (action === 'up') update((currentVideo?.playbackRate || 1) + .25);
            });
            dock.querySelector('[data-speed-select]').addEventListener('change', (event) => update(event.target.value));
          }
          dock.style.touchAction = 'none';
          dock.style.userSelect = 'none';
          dock.style.cursor = 'grab';
          if (!dock.dataset.dragReady) {
            dock.dataset.dragReady = '1';
            const positionKey = 'agent-toolbox-speed-dock-position';
            let savedPosition = null;
            try { savedPosition = JSON.parse(localStorage.getItem(positionKey) || 'null'); } catch {}
            if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
              dock.style.left = String(savedPosition.left) + 'px';
              dock.style.top = String(savedPosition.top) + 'px';
              dock.style.right = 'auto';
              dock.style.bottom = 'auto';
            }
            let dragState = null;
            const clampPosition = (left, top) => ({
              left: Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, left)),
              top: Math.max(8, Math.min(window.innerHeight - dock.offsetHeight - 8, top)),
            });
            dock.addEventListener('pointerdown', (event) => {
              if (event.target.closest('button,select,option')) return;
              const rect = dock.getBoundingClientRect();
              dragState = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
              dock.style.cursor = 'grabbing';
              dock.setPointerCapture?.(event.pointerId);
            });
            dock.addEventListener('pointermove', (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              event.preventDefault();
              const next = clampPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
              dock.style.left = String(next.left) + 'px';
              dock.style.top = String(next.top) + 'px';
              dock.style.right = 'auto';
              dock.style.bottom = 'auto';
            });
            const finishDrag = (event) => {
              if (!dragState || dragState.pointerId !== event.pointerId) return;
              try { dock.releasePointerCapture?.(event.pointerId); } catch {}
              const rect = dock.getBoundingClientRect();
              try { localStorage.setItem(positionKey, JSON.stringify({ left: rect.left, top: rect.top })); } catch {}
              dragState = null;
              dock.style.cursor = 'grab';
            };
            dock.addEventListener('pointerup', finishDrag);
            dock.addEventListener('pointercancel', finishDrag);
          }
          if (!window.__agentToolboxSpeedKeys) {
              window.__agentToolboxSpeedKeys = true;
              document.addEventListener('keydown', (event) => {
                if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
                const current = document.querySelector('.bpx-player-container video, .bilibili-player-video video, video');
                if (!current) return;
                if (event.key === '[') current.playbackRate = Math.max(.25, current.playbackRate - .25);
                if (event.key === ']') current.playbackRate = Math.min(4, current.playbackRate + .25);
              });
            }
          const activeVideo = getVideo();
          dock.querySelector('[data-speed-value]').textContent = (Number(activeVideo?.playbackRate) || 1) + '×';
          return { found: true, rate: activeVideo?.playbackRate || 1 };
        })()`, true);
      } catch {}
    }

    async function applySwipeBackPlugin() {
      try {
        await studyView.executeJavaScript(`(() => {
          const key = '__agentToolboxSwipeBack';
          if (!window[key]) {
            const state = { enabled: true, touchStart: null, wheelX: 0, wheelAt: 0 };
            state.onTouchStart = (event) => {
              if (!state.enabled || event.touches.length !== 2) return;
              state.touchStart = {
                x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
                y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
              };
              state.touchCurrent = { ...state.touchStart };
            };
            state.onTouchMove = (event) => {
              if (!state.enabled || !state.touchStart || event.touches.length !== 2) return;
              state.touchCurrent = {
                x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
                y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
              };
            };
            state.onTouchEnd = (event) => {
              if (!state.enabled || !state.touchStart || event.touches.length > 0) return;
              const end = state.touchCurrent || state.touchStart;
              const dx = end.x - state.touchStart.x;
              const dy = Math.abs(end.y - state.touchStart.y);
              state.touchStart = null;
              state.touchCurrent = null;
              if (dx < -90 && dy < 65) window.history.back();
            };
            state.onWheel = (event) => {
              if (!state.enabled || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.35 || event.deltaX >= -12) return;
              const now = Date.now();
              state.wheelX = now - state.wheelAt < 180 ? state.wheelX + event.deltaX : event.deltaX;
              state.wheelAt = now;
              if (state.wheelX < -120) {
                state.wheelX = 0;
                window.history.back();
              }
            };
            document.addEventListener('touchstart', state.onTouchStart, { passive: true });
            document.addEventListener('touchmove', state.onTouchMove, { passive: true });
            document.addEventListener('touchend', state.onTouchEnd, { passive: true });
            document.addEventListener('wheel', state.onWheel, { passive: true });
            window[key] = state;
          }
          window[key].enabled = ${pluginEnabled('swipe-back')};
          return { enabled: window[key].enabled };
        })()`, true);
      } catch {}
    }

    async function applyStudyPlugins() {
      await applySpeedPlugin();
      await applySwipeBackPlugin();
      if (!pluginEnabled('subtitle-auto-open')) {
        subtitleStatus.textContent = '自动字幕插件已关闭';
        subtitleStatus.className = 'tag tag--warn video__subtitle-status';
        return;
      }
      const url = studyView.getURL();
      if (!/bilibili\.com/i.test(url || '')) return;
      try {
        const result = await studyView.executeJavaScript(`(() => {
          const player = document.querySelector('.bpx-player-container, .bilibili-player-video-wrap, .html5-video-player');
          if (!player) return { found: false, reason: 'player-not-ready' };
          const controls = [...player.querySelectorAll('button,[role="button"],[aria-label]')];
          const subtitleButton = controls.find((node) => /字幕|subtitle/i.test(
            [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].filter(Boolean).join(' '),
          ));
          if (!subtitleButton) return { found: false, reason: 'subtitle-control-not-found' };
          const active = subtitleButton.getAttribute('aria-pressed') === 'true'
            || /active|on|selected/i.test(String(subtitleButton.className || ''));
          if (!active) subtitleButton.click();
          setTimeout(() => {
            const options = [...document.querySelectorAll('[role="menuitem"],button,li,[class*="subtitle"]')];
            const chinese = options.find((node) => /中文|简体|zh[-_]?cn|chinese/i.test(String(node.textContent || node.getAttribute('aria-label') || '')));
            if (chinese && !/active|selected/i.test(String(chinese.className || ''))) chinese.click();
          }, 120);
          return { found: true, enabled: true };
        })()`, true);
        if (result?.enabled) {
          subtitleStatus.textContent = '字幕已自动开启（优先中文）';
          subtitleStatus.className = 'tag tag--good video__subtitle-status';
      } else {
          subtitleStatus.textContent = pluginEnabled('subtitle-ai-fallback') ? '未发现官方字幕 · AI 字幕兜底可用' : '未发现字幕控件';
          subtitleStatus.className = 'tag tag--warn video__subtitle-status';
          if (subtitlePluginAttempts < 12 && pluginEnabled('subtitle-auto-open')) {
            subtitlePluginAttempts += 1;
            clearTimeout(subtitlePluginTimer);
            subtitlePluginTimer = setTimeout(applyStudyPlugins, 1500);
          }
        }
      } catch {
        subtitleStatus.textContent = '字幕插件等待页面就绪…';
        subtitleStatus.className = 'tag tag--warn video__subtitle-status';
      }
    }

    function scheduleStudyPlugins() {
      clearTimeout(subtitlePluginTimer);
      subtitlePluginAttempts = 0;
      subtitlePluginTimer = setTimeout(applyStudyPlugins, 650);
    }

    async function copyStudyUrl() {
      const url = studyView.getURL();
      if (!url || !/^https?:\/\//i.test(url)) return toast('当前页面还没有可复制的 URL', 'info');
      await clipboard.write(url);
      toast('当前页面 URL 已复制', 'good');
    }

    async function captureCurrentPage() {
      const url = studyView.getURL();
      if (!/^https?:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/i.test(url)) {
        return toast('请先在 B 站打开具体视频页面，再抓取当前页', 'info', 5000);
      }
      linkInput.value = url;
      setView('report');
      await fetchInfo();
    }

    function fmtDuration(seconds) {
      const s = Math.max(0, Math.round(seconds));
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
    }

    function fmtCount(n) {
      return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
    }

    function showError(message, needLogin, retry) {
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'empty__icon' }, needLogin ? '🔑' : '⚠️'),
        message,
        retry && h('div', { style: { marginTop: '14px' } },
          h('button', { class: 'btn btn--primary', onclick: retry }, '重试字幕'),
        ),
        needLogin && h('div', { style: { marginTop: '14px' } },
          h('button', { class: 'btn btn--primary', onclick: () => ctx.goto('ask') }, '去登录 DeepSeek'),
        ),
      ));
    }

    function showProgress(text, note) {
      body.textContent = '';
      body.appendChild(h('div', { class: 'empty' },
        h('span', { class: 'spinner' }), ` ${text}`,
        note && h('div', { class: 'faint video__note' }, note),
      ));
    }

    async function fetchInfo() {
      const url = linkInput.value.trim();
      if (!url) return toast('先贴链接', 'info');
      if (busy) return;
      busy = true;
      fetchBtn.disabled = true;
      showProgress('正在抓视频信息…');
      try {
        const result = await video.fetchInfo(url);
        if (!result.ok) return showError(result.error);
        info = result.info;
        renderInfo();
      } catch (err) {
        showError(err.message);
      } finally {
        busy = false;
        fetchBtn.disabled = false;
      }
    }

    function setView(view) {
      currentView = view === 'report' ? 'report' : 'study';
      config.set('video.view', currentView);
      studyShell.hidden = currentView !== 'study';
      reportShell.hidden = currentView !== 'report';
      studyTab.classList.toggle('is-active', currentView === 'study');
      reportTab.classList.toggle('is-active', currentView === 'report');
      if (currentView === 'study') studyView.focus();
    }

    function resetStudyArea() {
      studyView.loadURL(BILIBILI_STUDY_URL);
      syncStudyUrl(BILIBILI_STUDY_URL);
      studyStatus.textContent = '正在回到固定的 B 站学习区…';
      scheduleStudyPlugins();
    }

    async function triggerAiSubtitle() {
      if (!pluginEnabled('subtitle-ai-fallback')) return toast('AI 字幕兜底插件已关闭', 'info');
      const url = studyView.getURL();
      if (!/^https?:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/i.test(url || '')) {
        return toast('请先在 B 站打开具体视频页面', 'info', 5000);
      }
      linkInput.value = url;
      setView('report');
      await fetchInfo();
    }

    async function runUserscript() {
      if (!pluginEnabled('userscript-compat')) return toast('油猴脚本兼容插件已关闭', 'info');
      if (!userscriptCode.trim()) return toast('先在插件库里粘贴一段 userscript', 'info');
      if (!/bilibili\.com/i.test(studyView.getURL() || '')) return toast('请先打开 B 站页面', 'info');
      try {
        await studyView.executeJavaScript(`(() => { const source = ${JSON.stringify(userscriptCode)}; return (0, eval)(source); })()`, true);
        toast('油猴脚本已在当前 B 站页面运行', 'good');
      } catch (err) {
        toast(`油猴脚本运行失败：${err.message}`, 'bad', 5000);
      }
    }

    studyView.addEventListener('did-navigate', (event) => {
      syncStudyUrl(event.url);
      studyStatus.textContent = event.url === BILIBILI_STUDY_URL || /\/c\/knowledge\/?$/i.test(event.url)
        ? '固定入口：B 站学习区'
        : '当前在 B 站学习区内浏览 · 评论已关闭';
      scheduleStudyPlugins();
    });
    studyView.addEventListener('did-navigate-in-page', (event) => { syncStudyUrl(event.url); scheduleStudyPlugins(); });
    studyView.addEventListener('did-finish-load', () => { syncStudyUrl(studyView.getURL()); scheduleStudyPlugins(); });
    studyView.addEventListener('did-fail-load', (event) => {
      if (event.errorCode === -3) return;
      studyStatus.textContent = `B 站学习区加载失败：${event.errorDescription || '网络错误'}`;
    });

    function renderInfo() {
      body.textContent = '';
      body.appendChild(
        h('div', { class: 'card video__info' },
          h('div', { class: 'video__title' }, info.title),
          h('div', { class: 'video__meta faint' },
            `${info.owner || '未知 UP 主'} · ${info.pubdate || '未知日期'} · 共 ${info.pages.length} 集 · 总长 ${fmtDuration(info.duration)} · 播放 ${fmtCount(info.stat.view)}`),
          info.desc && h('div', { class: 'video__desc' }, info.desc.slice(0, 400) + (info.desc.length > 400 ? '…' : '')),
          h('div', { class: 'video__options' },
            subsScope,
            h('label', { class: 'switch' }, aiToggle, h('span', { class: 'switch__track' }), 'AI 写摘要'),
            h('label', { class: 'switch' }, publishToggle, h('span', { class: 'switch__track' }), '同时发到飞书'),
            h('span', { style: { flex: 1 } }),
            h('button', { class: 'btn btn--primary', onclick: () => generate() }, '生成报告'),
          ),
        ),
      );
    }

    function partTitle(page) {
      const p = info.pages.find((x) => x.page === page);
      return p ? p.part : '';
    }

    function buildMarkdown({ aiParts, notes, subsKind, subsPages }) {
      const lines = [];
      lines.push(`# B站视频总结报告：${info.title}`, '');
      lines.push('## 一屏摘要', '');
      lines.push(aiParts?.summary || info.desc || '（无简介）', '');
      lines.push('## 视频基本信息', '');
      lines.push(`- 标题：${info.title}`);
      lines.push(`- BV号：${info.bvid}`);
      lines.push(`- 链接：${info.url}`);
      lines.push(`- UP主：${info.owner || '未知'}`);
      lines.push(`- 发布日期：${info.pubdate || '未知'}`);
      lines.push(`- 总时长：${fmtDuration(info.duration)}（共 ${info.pages.length} 集）`);
      lines.push(`- 播放/弹幕/点赞/投币/收藏：${fmtCount(info.stat.view)} / ${fmtCount(info.stat.danmaku)} / ${fmtCount(info.stat.like)} / ${fmtCount(info.stat.coin)} / ${fmtCount(info.stat.favorite)}`);
      lines.push('');
      if (notes && notes.length) {
        const kindLabel = subsKind === 'official' ? '官方字幕' : subsKind === 'mixed' ? '官方 + B 站 AI 字幕' : 'B 站 AI 生成字幕';
        lines.push(`## 逐集内容笔记（基于${kindLabel}）`, '');
        for (const n of notes) {
          const t = partTitle(n.page);
          lines.push(`### P${n.page}${t ? ` ${t}` : ''}`, '', n.note, '');
        }
        if (subsPages && subsPages < info.pages.length) {
          lines.push(`> 仅拉取并总结了前 ${subsPages} 集的字幕，其余分集见下方大纲。`, '');
        }
      }
      if (info.pages.length > 1) {
        lines.push(`## 分集大纲（${info.pages.length} 集）`, '');
        for (const p of info.pages) {
          lines.push(`${p.page}. ${p.part}（${fmtDuration(p.duration)}）`);
        }
        lines.push('');
      }
      if (aiParts?.path) lines.push('## 学习路径建议', '', aiParts.path, '');
      if (aiParts?.audience) lines.push('## 适合人群', '', aiParts.audience, '');
      lines.push('---');
      lines.push(notes && notes.length
        ? `> 由 Agent 工具箱「视频」生成。内容基于${subsKind === 'official' ? '官方字幕' : subsKind === 'mixed' ? '官方 + B 站 AI 字幕' : 'B 站 AI 字幕'}全文总结，AI 字幕可能有个别错别字。`
        : '> 由 Agent 工具箱「视频」生成。未获取到字幕，本报告为内容地图型摘要（标题/简介/分集大纲），非逐句转写。');
      return lines.join('\n');
    }

    /** 把字幕集按字符数切成批次，控制每次 AI 调用的体量 */
    function makeBatches(episodes) {
      const batches = [];
      let cur = [];
      let chars = 0;
      for (const ep of episodes) {
        if (cur.length && (chars + ep.chars > 30000 || cur.length >= 6)) {
          batches.push(cur);
          cur = [];
          chars = 0;
        }
        cur.push(ep);
        chars += ep.chars;
      }
      if (cur.length) batches.push(cur);
      return batches.slice(0, 10); // 最多 10 批，再多的等不起
    }

    async function askAiOverall(notesDigest) {
      const pagesPreview = info.pages.slice(0, 40).map((p) => `${p.page}. ${p.part}`).join('\n');
      return ai.json(
        [
          '根据下面的 B 站视频信息，写一份视频报告的三个部分。',
          '返回 JSON：{"summary": "一屏摘要，3-5 句话讲清这个视频讲什么、有什么价值", "path": "学习路径建议，分 3-5 步", "audience": "适合人群，2-3 句"}',
          '不要用 markdown 代码块包裹，直接返回 JSON。',
          '',
          `标题：${info.title}`,
          `UP主：${info.owner}`,
          `简介：${info.desc || '（无）'}`,
          `分集大纲（共 ${info.pages.length} 集）：\n${pagesPreview}`,
          notesDigest ? `\n部分内容笔记（基于字幕）：\n${notesDigest}` : '',
        ].join('\n'),
        { timeout: 90000 },
      );
    }

    async function askAiBatchNotes(batch) {
      const parts = batch.map((ep) =>
        `【第 ${ep.page} 集：${partTitle(ep.page)}】\n${ep.text.slice(0, 12000)}`);
      const result = await ai.json(
        [
          '下面是 B 站视频若干集的字幕文本（AI 字幕可能有个别错别字，按上下文理解）。',
          '为每一集写 100-250 字的内容笔记：讲清实际讲了什么、关键技术点/结论，不要泛泛而谈；明显是卖课营销的内容标注（营销内容）并一句话带过。',
          '返回 JSON：{"notes": [{"page": 集数数字, "note": "笔记"}]}，每集一条。不要用 markdown 代码块包裹。',
          '',
          parts.join('\n\n'),
        ].join('\n'),
        { timeout: 120000 },
      );
      return Array.isArray(result?.notes) ? result.notes : [];
    }

    async function generate() {
      if (!info || busy) return;
      busy = true;
      const useSubs = subsScope.value !== 'none';
      showProgress('正在生成报告…', aiToggle.checked ? `AI 摘要走 ${ai.describe()}，要慢一些。` : '未开 AI 摘要，用视频简介顶上。');
      try {
        let subs = null;
        let subtitleError = '';
        if (useSubs) {
          showProgress('正在拉取字幕…', '优先官方字幕，没有再拉 B 站 AI 字幕（借浏览器登录态）。');
          try {
            const result = await video.fetchSubs({ url: info.url, scope: subsScope.value });
            if (result.ok && result.episodes?.length) {
              subs = result;
              showProgress('字幕已获取，正在准备 AI 分析…', `${result.kind === 'ai' ? 'B 站 AI 字幕' : result.kind === 'mixed' ? '官方 + AI 字幕' : '官方字幕'} · ${result.episodes.length} 集`);
            } else {
              subtitleError = result.error || '没有拿到字幕。';
              if (aiToggle.checked) {
                showError(`字幕获取失败，报告未生成空摘要。${subtitleError}`, false, () => generate());
                return;
              }
              toast(`${subtitleError} 当前关闭了 AI 写摘要，将继续生成内容地图。`, 'info', 6000);
            }
          } catch (err) {
            subtitleError = `字幕拉取失败：${err.message}`;
            if (aiToggle.checked) {
              showError(`字幕获取失败，报告未生成空摘要。${subtitleError}`, false, () => generate());
              return;
            }
            toast(`${subtitleError} 当前关闭了 AI 写摘要，将继续生成内容地图。`, 'bad', 6000);
          }
        }

        let aiParts = null;
        let notes = [];
        if (aiToggle.checked) {
          try {
            if (subs) {
              const batches = makeBatches(subs.episodes);
              for (let i = 0; i < batches.length; i += 1) {
                showProgress(`AI 正在读字幕写笔记（${i + 1}/${batches.length}）…`, `走 ${ai.describe()}`);
                const got = await askAiBatchNotes(batches[i]);
                notes.push(...got);
              }
              const digest = notes.slice(0, 12).map((n) => `P${n.page}: ${n.note}`).join('\n');
              showProgress('AI 正在汇总整体摘要…');
              aiParts = await askAiOverall(digest);
            } else {
              aiParts = await askAiOverall(null);
            }
          } catch (err) {
            if (err.code === 'need-login') return showError('AI 还没登录，先去登录一次再来。', true);
            toast(`AI 摘要失败（${err.message}），改用视频简介`, 'bad');
          }
        }
        const markdown = buildMarkdown({
          aiParts,
          notes,
          subsKind: subs?.kind,
          subsPages: subs?.episodes?.length || 0,
        });
        const title = `B站视频总结报告：${info.title}`;
        const result = await video.saveReport({ title, markdown, bvid: info.bvid, publish: publishToggle.checked });
        renderResult(markdown, result);
        renderHistory();
      } catch (err) {
        showError(err.message);
      } finally {
        busy = false;
      }
    }

    /** 极简 Markdown 渲染：标题/列表/加粗/行内代码/引用/分割线/链接，先转义再拼，报告内容来自 AI 也不怕 */
    function mdToHtml(md) {
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const inline = (s) => esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="#" data-url="$2">$1</a>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
      const out = [];
      let list = null;
      const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
      for (const raw of String(md).split('\n')) {
        const line = raw.trimEnd();
        let m;
        if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
        if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
        if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
        if ((m = line.match(/^[-*]\s+(.*)$/))) {
          if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
          out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        if ((m = line.match(/^\d+[.、]\s+(.*)$/))) {
          if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
          out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        if (!line.trim()) { closeList(); continue; }
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
      closeList();
      return out.join('');
    }

    /** 渲染出的文章里的链接走系统浏览器（壳有 CSP 且不让内页导航走） */
    function bindArticleLinks(articleEl) {
      articleEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-url]');
        if (!a) return;
        e.preventDefault();
        window.toolbox.shell.openExternal(a.dataset.url);
      });
    }

    let lastResultView = null; // 记最近一屏，内嵌飞书返回时用
    let feishuLoadTimer = null;

    /** 飞书文档内嵌打开：webview + 独立分区，扫码登录一次后保持 */
    function openFeishuDoc(url) {
      window.toolbox.video.openFeishuWindow(url).then((result) => {
        if (!result?.ok) toast(result?.error || '飞书窗口打开失败', 'bad', 6000);
      }).catch((err) => toast(`飞书窗口打开失败：${err.message}`, 'bad', 6000));
      return;

      clearTimeout(feishuLoadTimer);
      body.textContent = '';
      body.classList.add('video__body--feishu');
      historyEl.setAttribute('hidden', '');
      const view = h('webview', {
        class: 'video__feishu',
        partition: 'persist:feishu',
        src: url,
        allowpopups: true,
      });
      const status = h('span', { class: 'faint video__feishu-status' }, '正在加载飞书报告…');
      const loginBtn = h('button', {
        class: 'btn btn--sm btn--primary',
        title: '在应用内打开飞书官方登录页',
        onclick: () => {
          status.textContent = '请在飞书官方页面扫码或授权登录，完成后再打开报告。';
          view.loadURL('https://www.feishu.cn/');
        },
      }, '飞书登录');
      const reportBtn = h('button', {
        class: 'btn btn--sm',
        title: '登录后重新打开当前报告',
        onclick: () => {
          status.textContent = '正在重新打开飞书报告…';
          view.loadURL(url);
        },
      }, '重新打开报告');
      const fallbackLocal = (message) => {
        const snapshot = lastResultView;
        if (!snapshot) return;
        clearTimeout(feishuLoadTimer);
        toast(message, 'bad', 6000);
        renderResult(snapshot.markdown, { ...snapshot.result, docUrl: '', feishuUrl: url }, { ...snapshot.opts, fromHistory: true });
      };
      view.addEventListener('did-fail-load', (event) => {
        if (event.errorCode === -3) return;
        status.textContent = '飞书报告加载失败，可点击右上角用系统浏览器打开；本地报告仍保存在本机。';
        fallbackLocal(`飞书文档加载失败：${event.errorDescription || '网络错误'}，已退回本地报告。`);
      });
      view.addEventListener('did-finish-load', () => {
        clearTimeout(feishuLoadTimer);
        status.textContent = '飞书页面已打开；如果显示登录页，请在这里扫码或授权，登录态会保存在应用内。';
      });
      feishuLoadTimer = setTimeout(() => {
        status.textContent = '飞书加载较慢；请等待登录页出现，或点击右上角用系统浏览器打开。';
      }, 12000);
      body.appendChild(
        h('div', { class: 'video__reader-bar' },
          h('button', {
            class: 'btn btn--sm',
            onclick: () => {
              const v = lastResultView;
              if (v) renderResult(v.markdown, v.result, v.opts);
            },
          }, '‹ 返回报告'),
          h('span', { class: 'faint' }, '内嵌飞书文档（首次需扫码登录一次，之后保持登录态）'),
          status,
          loginBtn,
          reportBtn,
          h('span', { style: { flex: 1 } }),
          h('button', {
            class: 'btn btn--sm btn--ghost',
            title: '用系统浏览器打开',
            onclick: () => window.toolbox.shell.openExternal(url),
          }, '↗'),
        ),
        view,
      );
      window.toolbox.site.syncCookies('persist:feishu', 'feishu.cn').then((result) => {
        if (result.ok && result.count > 0) {
          status.textContent = `已同步 Edge 飞书登录态（${result.count} 个 Cookie），正在刷新…`;
          view.reload();
        } else if (!result.ok) {
          status.textContent = '未同步到 Edge 登录态；可在此页面扫码登录，或点击右上角用系统浏览器打开。';
        }
      }).catch(() => {});
    }

    function renderResult(markdown, result, opts = {}) {
      const { fromHistory = false } = opts;
      lastResultView = { markdown, result, opts };
      body.textContent = '';
      body.classList.remove('video__body--feishu');
      historyEl.removeAttribute('hidden');
      if (fromHistory) {
        body.appendChild(h('div', { class: 'video__reader-bar' },
          h('button', {
            class: 'btn btn--sm',
            onclick: () => {
              body.textContent = '';
              body.appendChild(h('div', { class: 'empty' },
                h('span', { class: 'empty__icon' }, '📺'),
                '贴一个 B 站视频链接，回车抓取。'));
            },
          }, '‹ 返回'),
          h('span', { class: 'faint' }, '正在阅读历史报告'),
        ));
      }
      body.appendChild(
        h('div', { class: 'card video__result' },
          h('div', { class: 'video__result-head' },
            h('span', { class: 'tag tag--good' }, '已存本地'),
            h('code', { class: 'faint video__path' }, result.localPath),
            h('button', {
              class: 'btn btn--sm',
              onclick: async () => { await clipboard.write(result.localPath); toast('路径已复制', 'good'); },
            }, '复制路径'),
            h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.chat.showInFinder(result.localPath) }, '在访达显示'),
          ),
          result.docUrl && h('div', { class: 'video__result-head' },
            h('span', { class: 'tag tag--good' }, '已发飞书'),
            h('button', {
              class: 'btn btn--sm btn--primary',
              title: '在应用内打开这篇飞书文档',
              onclick: () => openFeishuDoc(result.docUrl),
            }, '打开内置飞书报告'),
            h('a', { class: 'video__doc-link', href: '#', title: result.docUrl, onclick: (e) => { e.preventDefault(); openFeishuDoc(result.docUrl); } }, result.docUrl),
            h('button', {
              class: 'btn btn--sm',
              onclick: async () => { await clipboard.write(result.docUrl); toast('链接已复制', 'good'); },
            }, '复制链接'),
            h('button', {
              class: 'btn btn--sm btn--ghost',
              onclick: async (event) => {
                event.currentTarget.disabled = true;
                const published = await video.publishReport(result.localPath, true);
                if (!published.ok) {
                  event.currentTarget.disabled = false;
                  return toast(published.publishError || '重新发布失败', 'bad', 6000);
                }
                toast('已重新发布到飞书', 'good');
                renderResult(markdown, { ...result, docUrl: published.docUrl }, opts);
                openFeishuDoc(published.docUrl);
              },
            }, '重新发布'),
          ),
          !result.docUrl && result.localPath && h('div', { class: 'video__result-head' },
            h('span', { class: 'tag tag--warn' }, '仅本地'),
            h('span', { class: 'faint' }, '这篇报告还没有飞书版本'),
            result.feishuUrl && h('span', { class: 'faint video__stale-feishu' }, '原飞书链接可能已失效'),
            result.feishuUrl && h('button', {
              class: 'btn btn--sm btn--ghost',
              onclick: () => window.toolbox.shell.openExternal(result.feishuUrl),
            }, '浏览器试打开'),
            h('button', {
              class: 'btn btn--sm btn--primary',
              onclick: async (event) => {
                event.currentTarget.disabled = true;
                const published = await video.publishReport(result.localPath, Boolean(result.feishuUrl));
                if (!published.ok) {
                  event.currentTarget.disabled = false;
                  return toast(published.publishError || '发布失败', 'bad', 6000);
                }
                toast(published.alreadyPublished ? '已找到飞书版本' : '已发布到飞书', 'good');
                renderResult(markdown, { ...result, docUrl: published.docUrl }, opts);
                renderHistory();
              },
            }, result.feishuUrl ? '重新发布到飞书' : '发布到飞书'),
          ),
          result.publishError && h('div', { class: 'video__publish-error' },
            h('span', { class: 'tag tag--warn' }, '飞书未发'), result.publishError),
          result.publishNote && h('div', { class: 'faint video__note' }, result.publishNote),
        ),
        (() => {
          const article = h('div', { class: 'card video__article', html: mdToHtml(markdown) });
          bindArticleLinks(article);
          return article;
        })(),
      );
    }

    async function renderHistory() {
      historyEl.textContent = '';
      let reports = [];
      try {
        reports = await video.listReports();
      } catch { /* 忽略 */ }
      if (!reports.length) return;
      historyEl.appendChild(h('div', { class: 'video__history-head faint' }, '历史报告（本地留底）'));
      for (const r of reports) {
        const cloudBtn = h('button', {
          class: `btn btn--sm ${r.docUrl ? 'btn--primary' : 'btn--ghost'}`,
          title: r.docUrl ? '打开内置飞书报告' : '发布这篇报告到飞书',
          onclick: async (event) => {
            event.stopPropagation();
            if (r.docUrl) return openFeishuDoc(r.docUrl);
            cloudBtn.disabled = true;
            cloudBtn.textContent = '发布中…';
            const published = await video.publishReport(r.name);
            if (!published.ok) {
              cloudBtn.disabled = false;
              cloudBtn.textContent = '发布到飞书';
              return toast(published.publishError || '发布失败', 'bad', 6000);
            }
            toast(published.alreadyPublished ? '已找到飞书版本' : '已发布到飞书', 'good');
            await renderHistory();
            openFeishuDoc(published.docUrl);
          },
        }, r.docUrl ? '打开飞书' : '发布到飞书');
        historyEl.appendChild(h('div', {
          class: 'video__history-item',
          title: r.docUrl ? '点击打开内置飞书报告' : '点击查看本地报告',
          onclick: () => openReport(r, Boolean(r.docUrl)),
        },
          h('div', { class: 'video__history-title' }, r.title),
          h('div', { class: 'faint' },
            new Date(r.mtime).toLocaleString('zh-CN', { hour12: false }),
            r.docUrl && h('span', { class: 'tag tag--good video__history-feishu' }, '点击进入飞书'),
            !r.docUrl && h('span', { class: 'tag tag--warn video__history-feishu' }, '仅本地'),
          ),
          cloudBtn,
          r.docUrl && h('button', {
            class: 'btn btn--sm video__history-local',
            title: '查看本地报告',
            onclick: (event) => { event.stopPropagation(); openReport(r); },
          }, '本地'),
        ));
      }
    }

    async function openReport(r, openFeishu = false) {
      const result = await video.readReport(r.name);
      if (!result.ok) return toast(result.error, 'bad');
      renderResult(
        result.content,
        { localPath: result.path, docUrl: result.docUrl },
        { fromHistory: true },
      );
      if (openFeishu && result.docUrl) openFeishuDoc(result.docUrl);
    }

    const pluginPanel = h('div', { class: 'video__plugin-panel', hidden: true });

    function renderPluginLibrary() {
      pluginPanel.textContent = '';
      const enabledCount = VIDEO_PLUGINS.filter((plugin) => pluginEnabled(plugin.id)).length;
      pluginPanel.append(
        h('div', { class: 'video__plugin-head' },
          h('strong', {}, '学习区插件库'),
          h('span', { class: 'tag tag--good' }, `${enabledCount}/${VIDEO_PLUGINS.length} 已启用`),
          h('span', { class: 'faint' }, 'Edge 能力兼容层 · 不直接加载第三方扩展'),
        ),
        h('div', { class: 'video__plugin-grid' },
          ...VIDEO_PLUGINS.map((plugin) => {
            const toggle = h('input', { type: 'checkbox', class: 'switch__input', checked: pluginEnabled(plugin.id) });
            toggle.addEventListener('change', async () => {
              pluginPrefs = { ...pluginPrefs, [plugin.id]: toggle.checked };
              await config.set(VIDEO_PLUGIN_KEY, pluginPrefs);
              if (['subtitle-auto-open', 'playback-speed', 'swipe-back'].includes(plugin.id)) scheduleStudyPlugins();
              renderPluginLibrary();
            });
            return h('div', { class: 'video__plugin-card' },
              h('div', { class: 'video__plugin-card-top' },
                h('strong', {}, plugin.name),
                h('label', { class: 'switch', title: toggle.checked ? '已启用' : '已关闭' }, toggle),
              ),
              h('div', { class: 'faint video__plugin-desc' }, plugin.description),
              plugin.id === 'subtitle-ai-fallback'
                ? h('button', { class: 'btn btn--sm video__plugin-action', onclick: triggerAiSubtitle }, '当前视频用 AI 字幕') : null,
              plugin.id === 'playback-speed'
                ? h('button', { class: 'btn btn--sm video__plugin-action', onclick: applySpeedPlugin }, '重新显示倍速条') : null,
              plugin.id === 'userscript-compat'
                ? h('button', { class: 'btn btn--sm video__plugin-action', onclick: () => renderPluginLibrary() }, '编辑脚本 ↓') : null,
            );
          }),
        ),
      );
      if (pluginEnabled('userscript-compat')) {
        const scriptInput = h('textarea', { class: 'video__userscript-input', rows: '5', placeholder: '// ==UserScript==\n// 仅在当前 B 站页面运行\n// ==/UserScript==' }, userscriptCode);
        pluginPanel.append(
          h('div', { class: 'video__userscript-box' },
            h('div', { class: 'video__userscript-title' }, '油猴脚本编辑器', h('span', { class: 'faint' }, '只在点击运行后执行')),
            scriptInput,
            h('div', { class: 'video__userscript-actions' },
              h('button', { class: 'btn btn--sm', onclick: async () => { userscriptCode = scriptInput.value; await config.set(USERSCRIPT_KEY, { code: userscriptCode }); toast('油猴脚本已保存', 'good'); } }, '保存脚本'),
              h('button', { class: 'btn btn--sm btn--primary', onclick: async () => { userscriptCode = scriptInput.value; await config.set(USERSCRIPT_KEY, { code: userscriptCode }); await runUserscript(); } }, '保存并运行'),
            ),
          ),
        );
      }
    }

    const pluginBtn = h('button', { class: 'btn btn--sm video__plugin-btn', onclick: () => { pluginPanel.hidden = !pluginPanel.hidden; if (!pluginPanel.hidden) renderPluginLibrary(); } }, '插件库');
    const studyTab = h('button', { class: 'btn btn--sm video__mode-tab', onclick: () => setView('study') }, '学习区');
    const reportTab = h('button', { class: 'btn btn--sm video__mode-tab', onclick: () => setView('report') }, '视频报告');
    const modeBar = h('div', { class: 'bar bar--drag video__modebar' },
      h('strong', {}, '视频'),
      h('div', { class: 'video__mode-tabs' }, studyTab, reportTab),
      pluginBtn,
      h('span', { class: 'faint' }, 'B 站学习、自由浏览与报告抓取'),
    );
    const studyBar = h('div', { class: 'bar video__studybar' },
      h('button', { class: 'btn btn--icon', title: '后退', onclick: () => studyView.goBack() }, '‹'),
      h('button', { class: 'btn btn--icon', title: '前进', onclick: () => studyView.goForward() }, '›'),
      h('button', { class: 'btn btn--icon', title: '刷新学习区', onclick: () => studyView.reload() }, '⟳'),
      h('button', { class: 'btn btn--sm btn--primary', title: '回到固定的 B 站学习区入口', onclick: resetStudyArea }, '回到学习区'),
      studyStatus,
      subtitleStatus,
      h('span', { style: { flex: 1 } }),
      studyUrl,
      h('button', { class: 'btn btn--sm', title: '当前视频无字幕时，尝试 B 站 AI 字幕并进入报告流程', onclick: triggerAiSubtitle }, 'AI字幕兜底'),
      h('button', { class: 'btn btn--sm', title: '复制当前 B 站页面 URL', onclick: copyStudyUrl }, '复制 URL'),
      h('button', { class: 'btn btn--sm btn--primary', title: '抓取当前视频并生成报告', onclick: captureCurrentPage }, '抓取当前页'),
      h('button', { class: 'btn btn--sm btn--ghost', title: '用系统浏览器打开当前 B 站页面', onclick: () => studyView.getURL() && window.toolbox.shell.openExternal(studyView.getURL()) }, '↗'),
    );
    const studyShell = h('div', { class: 'video__study-shell' }, studyBar, studyView);
    const reportBar = h('div', { class: 'bar bar--drag' },
      h('strong', {}, '视频报告'),
      linkInput,
      fetchBtn,
    );
    const reportShell = h('div', { class: 'video__report-shell' },
      reportBar,
      h('div', { class: 'video__scroll' }, body, historyEl),
    );

    root.append(
      modeBar,
      pluginPanel,
      studyShell,
      reportShell,
    );

    body.appendChild(h('div', { class: 'empty' },
      h('span', { class: 'empty__icon' }, '📺'),
      '贴一个 B 站视频链接，回车抓取。',
      h('br'),
      h('span', { class: 'faint' }, '有字幕就按字幕写内容级总结（官方字幕优先，没有再拉 AI 字幕）；报告永远存到本地 reports/ 目录，开了「发飞书」就顺手建一篇飞书文档。'),
    ));
    renderHistory();
    setView(currentView);

    return { activate: () => setTimeout(() => currentView === 'report' && linkInput.focus(), 30) };
  },
};
