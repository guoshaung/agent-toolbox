import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

const PLATFORM_LABELS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

export default {
  id: 'voicebox',
  title: 'Voicebox',
  icon: 'waveform',
  hint: '打开官方开源 Voicebox 语音工作台',

  create(root) {
    root.classList.add('voicebox');
    let current = null;

    const statusTag = h('span', { class: 'tag voicebox__status' }, '正在检查');
    const statusCopy = h('p', { class: 'voicebox__status-copy' }, '正在检查本机是否安装官方 Voicebox…');
    const pathCopy = h('code', { class: 'voicebox__path', hidden: true });
    const startButton = h('button', { class: 'btn btn--primary', onclick: launchVoicebox }, '启动官方 Voicebox');
    const downloadButton = h('button', { class: 'btn', onclick: openDownload }, '下载官方版本');
    const projectButton = h('button', { class: 'btn', onclick: openProject }, '打开 GitHub 项目');
    const docsButton = h('button', { class: 'btn', onclick: openDocs }, '查看官方文档');
    const mark = h('div', { class: 'voicebox__hero-mark', 'aria-hidden': 'true' }, iconFor('waveform'));

    function applyState(next) {
      current = next || {};
      const installed = Boolean(current.installed);
      statusTag.textContent = installed ? '已检测到' : '尚未安装';
      statusTag.className = `tag voicebox__status ${installed ? 'tag--good' : 'tag--warn'}`;
      statusCopy.textContent = installed
        ? '官方 Voicebox 已安装。点击“启动官方 Voicebox”会打开它自己的 Tauri 应用，不会被工具箱替换图标或界面。'
        : '工具箱这里只是启动壳：先下载并安装 GitHub 对应的官方 Voicebox，之后点击启动即可打开原应用。';
      pathCopy.hidden = !installed;
      pathCopy.textContent = installed ? current.appPath : '';
      startButton.disabled = !installed;
      startButton.textContent = '启动官方 Voicebox';
      startButton.title = installed ? '打开已安装的官方 Voicebox 应用' : '安装官方 Voicebox 后才能启动';
    }

    async function refresh() {
      try { applyState(await window.toolbox.voicebox.status()); }
      catch (error) { applyState({ installed: false, error: error.message }); }
    }

    async function launchVoicebox() {
      if (!current?.installed) return openDownload();
      startButton.disabled = true;
      try {
        const result = await window.toolbox.voicebox.start();
        if (!result.ok) toast(result.error || '官方 Voicebox 启动失败', 'bad', 6000);
        else toast('已打开官方 Voicebox', 'good', 3500);
      } catch (error) {
        toast(`官方 Voicebox 启动失败：${error.message}`, 'bad', 6000);
      } finally {
        startButton.disabled = false;
      }
    }

    async function openAction(action, successMessage) {
      try {
        const result = await action();
        if (!result.ok) toast(result.error || '打开失败', 'bad', 5000);
        else toast(successMessage, 'good', 3500);
      } catch (error) {
        toast(`打开失败：${error.message}`, 'bad', 5000);
      }
    }

    function openDownload() { return openAction(() => window.toolbox.voicebox.openDownload(), '已打开官方 Voicebox 下载页'); }
    function openProject() { return openAction(() => window.toolbox.voicebox.openProject(), '已打开 Voicebox GitHub 项目'); }
    function openDocs() { return openAction(() => window.toolbox.voicebox.openDocs(), '已打开 Voicebox 官方文档'); }

    root.append(
      h('header', { class: 'voicebox__hero' },
        h('div', { class: 'voicebox__hero-copy' },
          h('span', { class: 'voicebox__eyebrow' }, 'OFFICIAL OPEN-SOURCE APP'),
          h('h1', {}, 'Voicebox'),
          h('p', {}, '这里不是另做一个语音工具，而是官方 Voicebox 的启动壳。它负责检测、下载和启动，真正的应用图标、界面、模型与权限都属于官方项目。'),
        ),
        mark,
      ),
      h('section', { class: 'voicebox__status-card' },
        h('div', { class: 'voicebox__status-head' }, h('span', { class: 'voicebox__status-orb' }), h('span', {}, '官方应用状态'), statusTag),
        statusCopy,
        pathCopy,
        h('div', { class: 'voicebox__actions' }, startButton, downloadButton, projectButton, docsButton),
      ),
      h('section', { class: 'voicebox__guide-card voicebox__official-card' },
        h('span', { class: 'voicebox__eyebrow' }, 'ABOUT THE PROJECT'),
        h('h2', {}, '它打开的才是 Voicebox 本体'),
        h('p', {}, '官方项目是本地优先的 AI 语音工作台，支持语音克隆、TTS、Whisper 转写、全局听写，以及给 MCP Agent 提供语音输出。工具箱不会复制它的代码，也不会把自己的 logo 注入官方应用。'),
        h('div', { class: 'voicebox__feature-list' },
          h('span', {}, '开源 MIT'), h('span', {}, 'Tauri 原生应用'), h('span', {}, 'macOS / Windows / Linux'), h('span', {}, '本地模型与 MCP'),
        ),
      ),
      h('section', { class: 'voicebox__guide-card' },
        h('span', { class: 'voicebox__eyebrow' }, 'FIRST RUN'),
        h('h2', {}, '第一次使用'),
        h('div', { class: 'voicebox__guide-list' },
          h('div', {}, h('strong', {}, '01'), h('p', {}, '点击“下载官方版本”，从 voicebox.sh 获取与你系统对应的安装包。')),
          h('div', {}, h('strong', {}, '02'), h('p', {}, `安装后回到这里，工具箱会自动检测 ${PLATFORM_LABELS[current?.platform] || '当前系统'} 的官方应用。`)),
          h('div', {}, h('strong', {}, '03'), h('p', {}, '点击“启动官方 Voicebox”，打开它自己的应用；模型下载、麦克风和辅助功能权限在官方应用中完成。')),
        ),
      ),
    );

    window.toolbox.voicebox.onStatus(applyState);
    refresh();
    return { deactivate() {} };
  },
};
