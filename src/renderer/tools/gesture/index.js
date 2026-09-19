import { h, toast } from '../../core/ui.js';
import { createGalaxy } from './galaxy.js';

/**
 * 手势识别。
 *
 * 开摄像头后这一页滑进一片银河（有点仪式感，也是「现在在看手」的信号）；
 * 真正的识别在右下角那个置顶小窗里跑（src/gesture），切到别的应用它也在。
 * 打响指唤出带编号的切换栏，比 1–9 就切到那个应用 —— 不用再 ⌘Tab 连点好几下。
 */
const DEFAULT_MUSIC = 'https://search.bilibili.com/all?keyword=%E5%93%88%E5%9F%BA%E7%B1%B3';

export default {
  id: 'gesture',
  title: '手势识别',
  icon: 'hand',
  hint: '摄像头识别手势，比数字切换应用',

  create(root, ctx) {
    const { config } = ctx;
    let enabled = false;

    const musicInput = h('input', { class: 'field', type: 'url', value: config.get('gesture.musicUrl', DEFAULT_MUSIC), placeholder: 'https://…' });
    const status = h('span', { class: 'tag' }, '未启动');
    const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: () => (enabled ? stop() : start()) }, '开启摄像头');
    function setStatus(text, kind = '') { status.textContent = text; status.className = `tag ${kind ? `tag--${kind}` : ''}`; }

    async function action(name, side) {
      const result = name === 'music'
        ? await window.toolbox.gesture.playMusic(musicInput.value)
        : await window.toolbox.gesture.control(name, side);
      if (!result?.ok) toast(result?.error || '手势动作执行失败', 'bad');
      else toast(name === 'music' ? '已打开哈基米音乐' : '窗口动作已执行', 'good', 1600);
    }

    // ---------- 银河 ----------
    const galaxyCanvas = h('canvas', { class: 'gesture__galaxy-canvas' });
    // 银河页上直接列出现在开着的应用和编号 —— 不然比数字前根本不知道几号是谁
    const appsRow = h('div', { class: 'gesture__apps' });
    let appsTimer = 0;
    async function refreshApps() {
      let apps = [];
      try { apps = await window.toolbox.gesture.listApps(); } catch { apps = []; }
      appsRow.replaceChildren(...(apps.length ? apps.map((a, i) => h('button', {
        class: 'gesture__app', title: `比 ${i + 1} 或点这里切到 ${a.name}`,
        onclick: () => window.toolbox.switcher?.pick?.(i + 1) ?? window.toolbox.gesture.showSwitcher(),
      },
        h('span', { class: 'gesture__app-n' }, String(i + 1)),
        a.icon ? h('img', { class: 'gesture__app-icon', src: a.icon, alt: '' }) : h('span', { class: 'gesture__app-icon' }),
        h('span', { class: 'gesture__app-name' }, a.name),
      )) : [h('span', { class: 'faint' }, '没扫到开着的应用')]));
    }
    const hud = h('div', { class: 'gesture__hud' },
      h('div', { class: 'gesture__hud-title' }, '手势模式 · 比数字切到这些应用'),
      appsRow,
      h('div', { class: 'gesture__hud-steps' },
        h('span', {}, h('b', {}, '比 1 – 9'), '直接切到对应编号的应用'),
        h('span', {}, h('b', {}, '打响指'), '在任何应用上方唤出这张表'),
        h('span', {}, h('b', {}, '握拳'), '收起'),
      ),
      h('div', { class: 'gesture__hud-note faint' }, '识别窗在屏幕右下角，切到别的应用也一直在。'),
      h('div', { class: 'gesture__hud-actions' },
        h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.gesture.showSwitcher() }, '先看看切换栏'),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: () => stop() }, '关闭摄像头'),
      ),
    );
    const galaxy = h('div', { class: 'gesture__galaxy', hidden: true }, galaxyCanvas, hud);
    const body = h('div', { class: 'settings__body gesture__body' });
    const sky = createGalaxy(galaxyCanvas);

    async function start() {
      if (enabled) return;
      const r = await window.toolbox.gesture.openWindow();
      if (!r?.ok) return toast('手势窗打不开', 'bad');
      enabled = true;
      startBtn.textContent = '关闭摄像头';
      setStatus('识别中', 'good');
      galaxy.hidden = false;
      body.classList.add('is-away');
      requestAnimationFrame(() => { galaxy.classList.add('is-in'); sky.start(); });
      refreshApps();
      clearInterval(appsTimer);
      appsTimer = setInterval(refreshApps, 5000);
    }
    function stop() {
      if (!enabled) return;
      enabled = false;
      window.toolbox.gesture.closeWindow();
      leaveGalaxy();
    }
    function leaveGalaxy() {
      startBtn.textContent = '开启摄像头';
      setStatus('未启动');
      galaxy.classList.remove('is-in');
      body.classList.remove('is-away');
      clearInterval(appsTimer);
      setTimeout(() => { if (!enabled) { galaxy.hidden = true; sky.stop(); } }, 700);
    }
    // 小窗那边点了 ×，这边也退出银河
    window.toolbox.gesture.onWindowClosed?.(() => { if (enabled) { enabled = false; leaveGalaxy(); } });

    const saveMusic = h('button', { class: 'btn btn--sm', onclick: async () => { await config.set('gesture.musicUrl', musicInput.value); toast('音乐网址已保存', 'good'); } }, '保存音乐网址');
    const testMusic = h('button', { class: 'btn btn--sm', onclick: () => action('music') }, '试听');
    body.append(
      h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '比数字切应用'),
        h('p', { class: 'faint settings__hint' }, '开摄像头后：打响指（拇指中指弹开，或两指并拢横着快扫）唤出带编号的切换栏，单手比 1–9 就切到那个应用，握拳收起。识别窗常驻右下角，切走了也能继续比。'),
        h('div', { class: 'gesture__actions' },
          h('button', { class: 'btn btn--sm', onclick: () => window.toolbox.gesture.showSwitcher() }, '看看切换栏长什么样'),
        )),
      h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '窗口动作（按钮触发）'),
        h('p', { class: 'faint settings__hint' }, '把前台窗口全屏 / 靠左 / 靠右。' ),
        h('div', { class: 'gesture__actions' },
          h('button', { class: 'btn btn--sm', onclick: () => action('fullscreen') }, '测试全屏'),
          h('button', { class: 'btn btn--sm', onclick: () => action('snap', 'left') }, '测试靠左'),
          h('button', { class: 'btn btn--sm', onclick: () => action('snap', 'right') }, '测试靠右'),
        )),
      h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '哈基米音乐'), h('p', { class: 'faint settings__hint' }, '可替换成任意 HTTPS 音乐页面。'), musicInput, h('div', { class: 'gesture__actions' }, saveMusic, testMusic)),
      h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '隐私与使用说明'), h('p', { class: 'faint settings__hint' }, '摄像头只在点击开启后工作，画面只在本机内存里分析，不上传。关闭小窗的 × 会立即停止摄像头。')),
    );

    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '手势识别'), h('span', { class: 'faint' }, '本地摄像头分析，不上传画面'), h('span', { style: { flex: 1 } }), status, startBtn),
      h('div', { class: 'gesture__stage' }, body, galaxy),
    );
    window.toolbox.gesture.isOpen?.().then((open) => { if (open) start(); });
    return { deactivate: () => { /* 小窗独立于这一页，切栏目不打断识别 */ } };
  },
};
