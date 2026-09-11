import { h, toast } from '../../core/ui.js';

const AGNES_HINTS = {
  baseUrl: 'https://apihub.agnes-ai.cn/v1',
  model: 'agnes-2.5-flash',
};

export default {
  id: 'tavern',
  title: '酒馆',
  icon: 'flask',
  hint: 'SillyTavern 角色扮演：内嵌运行，角色与世界观本地保存',

  create(root, ctx) {
    const status = h('span', { class: 'faint tavern__status' }, '正在连接酒馆…');
    let currentUrl = '';
    const view = h('webview', { class: 'tavern__view', partition: 'persist:tavern', src: 'about:blank', allowpopups: true });
    const openExternal = h('button', { class: 'btn btn--sm', title: '在系统浏览器中打开（调试用）', onclick: () => currentUrl && window.toolbox.shell.openExternal(currentUrl) }, '浏览器打开');
    const reload = h('button', {
      class: 'btn btn--sm',
      title: '忽略缓存重新加载酒馆前端',
      onclick: () => { view.reloadIgnoringCache(); status.textContent = '正在刷新酒馆…'; },
    }, '刷新');
    const stopBtn = h('button', { class: 'btn btn--sm', title: '停止酒馆服务（进程树会一起收掉）', onclick: async () => {
      const result = await window.toolbox.tavern.stop();
      if (result.ok) toast('酒馆已停止', 'info');
    } }, '停止');
    const start = h('button', { class: 'btn btn--sm btn--primary', onclick: startTavern }, '启动酒馆');

    function applyState(state) {
      const running = state?.status === 'running';
      if (running) currentUrl = state.url;
      const text = running ? `已运行 · ${state.url}`
        : state?.status === 'installing' ? '正在安装酒馆依赖（首次较久）…'
          : state?.status === 'starting' ? '正在启动酒馆（首次初始化 1-2 分钟）…'
            : state?.status === 'stopping' ? '正在停止…'
              : state?.error || '酒馆尚未启动';
      status.textContent = text;
      status.className = `tag tavern__status ${running ? 'tag--good' : state?.status === 'error' ? 'tag--bad' : 'tag--warn'}`;
      status.title = state?.log || '';
      start.disabled = running || ['installing', 'starting', 'stopping'].includes(state?.status);
      stopBtn.disabled = !running;
      if (running && currentUrl) view.src = currentUrl;
      // 配置提示只在未运行时展示，运行后让出空间给页面。
      if (running) setupHint.hidden = true;
    }

    async function startTavern() {
      start.disabled = true;
      const result = await window.toolbox.tavern.start();
      applyState(result);
      if (!result.ok) toast(result.error || '酒馆启动失败', 'bad', 6000);
    }

    view.addEventListener('dom-ready', () => { status.textContent = '酒馆正在渲染…'; });
    view.addEventListener('did-fail-load', (event) => {
      if (event.errorCode === -3) return;
      status.textContent = `酒馆加载失败：${event.errorDescription || event.errorCode}`;
      toast(status.textContent, 'bad', 6000);
    });
    view.addEventListener('console-message', (event) => {
      if (event.level >= 2) console.error('[tavern webview]', event.message, event.sourceId, event.line);
    });

    // ---------- 模型配置提示：酒馆设置存在它自己的 localStorage，
    // 不能从外部安全写入，这里只给可复制的连接信息 + 跳转 AI 设置。 ----------
    const copy = (text, label) => () => {
      navigator.clipboard.writeText(text).then(() => toast(`${label}已复制`, 'good')).catch(() => toast('复制失败', 'bad'));
    };
    const setupHint = h('div', { class: 'tavern__hint' },
      h('strong', {}, '首次使用：接入免费模型（Agnes）'),
      h('p', { class: 'faint' }, '在酒馆右上角进入扩展设置：API Connections 选择 Chat Completion，填入下面的 Base URL 和模型名，API Key 在工具箱「设置 → AI 接口」里查看。Agnes 免费，无需绑卡。'),
      h('div', { class: 'tavern__hint-row' },
        h('button', { class: 'btn btn--xs', onclick: copy(AGNES_HINTS.baseUrl, 'Base URL ') }, `复制 Base URL：${AGNES_HINTS.baseUrl}`),
        h('button', { class: 'btn btn--xs', onclick: copy(AGNES_HINTS.model, '模型名') }, `复制模型名：${AGNES_HINTS.model}`),
        h('button', { class: 'btn btn--xs', onclick: () => ctx.goto('settings') }, '打开 AI 设置'),
      ),
    );

    root.append(
      h('div', { class: 'bar bar--drag tavern__bar' },
        h('strong', {}, '酒馆 · SillyTavern'),
        status,
        h('span', { style: { flex: 1 } }),
        start, stopBtn, reload, openExternal),
      setupHint,
      view,
    );
    window.toolbox.tavern.onStatus(applyState);
    window.toolbox.tavern.status().then(applyState);
    return { activate: startTavern };
  },
};