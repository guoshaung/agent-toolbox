import { h, toast } from '../../core/ui.js';
import { analyzeFrame } from './hand-cv.js';
import { GestureStateMachine } from './gesture-state.js';

const DEFAULT_MUSIC = 'https://search.bilibili.com/all?keyword=%E5%93%88%E5%9F%BA%E7%B1%B3';

export default {
  id: 'gesture',
  title: '手势识别',
  icon: 'hand',
  hint: '摄像头识别手势，控制窗口与播放音乐',

  create(root, ctx) {
    const { config } = ctx;
    let stream = null;
    let timer = 0;
    let enabled = false;
    const video = h('video', { class: 'gesture__video', autoplay: true, muted: true, playsinline: true });
    const canvas = h('canvas', { class: 'gesture__canvas', width: 160, height: 120 });
    const floatStatus = h('span', { class: 'tag tag--good' }, '准备就绪');
    const diag = h('span', { class: 'gesture__diag' }, '—');
    const float = h('div', { class: 'gesture__float', hidden: true },
      h('div', { class: 'gesture__float-head' }, h('strong', {}, '手势识别'), floatStatus,
        h('button', { class: 'btn btn--icon', title: '关闭摄像头', onclick: stop }, '×')),
      h('div', { class: 'gesture__preview' }, video, canvas),
      diag,
    );
    document.body.appendChild(float);

    const musicInput = h('input', { class: 'field', type: 'url', value: config.get('gesture.musicUrl', DEFAULT_MUSIC), placeholder: 'https://…' });
    const status = h('span', { class: 'tag' }, '未启动');
    const startBtn = h('button', { class: 'btn btn--sm btn--primary', onclick: start }, '开启摄像头');

    function setStatus(text, kind = '') { status.textContent = text; status.className = `tag ${kind ? `tag--${kind}` : ''}`; floatStatus.textContent = text; }
    async function action(action, side) {
      const result = action === 'music'
        ? await window.toolbox.gesture.playMusic(musicInput.value)
        : await window.toolbox.gesture.control(action, side);
      if (!result?.ok) toast(result?.error || '手势动作执行失败', 'bad');
      else toast(action === 'music' ? '已打开哈基米音乐' : '窗口动作已执行', 'good', 1600);
    }
    async function start() {
      if (enabled) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
        video.srcObject = stream;
        enabled = true; float.hidden = false; startBtn.textContent = '关闭摄像头'; setStatus('识别中', 'good');
        runLoop();
      } catch (error) { setStatus(`摄像头不可用：${error.message}`, 'bad'); toast('摄像头权限未开启或设备不可用', 'bad', 5000); }
    }
    function stop() {
      enabled = false; clearTimeout(timer); timer = 0;
      stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null;
      float.hidden = true; startBtn.textContent = '开启摄像头'; setStatus('未启动');
    }
    const machine = new GestureStateMachine({ onEvent: (event) => {
      if (event.type === 'gesture-change') setStatus(`识别到：${event.to}`, 'good');
      if (event.type === 'snap') action('music');
    } });
    let lastCenter = null;
    let lastSwipeAt = 0;
    let busy = false;
    function scheduleLoop() {
      if (!enabled) return;
      clearTimeout(timer);
      timer = setTimeout(runLoop, 70);
    }
    function runLoop() {
      if (!enabled || busy) return;
      busy = true;
      try {
      if (video.readyState >= 2) {
        const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
        ctx2.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = analyzeFrame(ctx2.getImageData(0, 0, canvas.width, canvas.height));
        const fingerCount = result.fingertips?.length || 0;
        diag.textContent = result.present
          ? `指尖 ${fingerCount} · ${result.gesture} · ${(result.confidence * 100).toFixed(0)}%`
          : '未检测到手';
        const center = result.region?.centroid;
        let gesture = fingerCount >= 3 ? 'open' : result.gesture;
        if (center && lastCenter) {
          const dx = center.x - lastCenter.x;
          const dy = center.y - lastCenter.y;
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
            gesture = dx < 0 ? 'swipeLeft' : 'swipeRight';
            const now = Date.now();
            if (now - lastSwipeAt > 1800) {
              lastSwipeAt = now;
              action('snap', dx < 0 ? 'left' : 'right').catch((error) => toast(`手势动作失败：${error.message}`, 'bad'));
              setStatus(dx < 0 ? '向左挥：窗口靠左' : '向右挥：窗口靠右', 'good');
            }
          }
        }
        if (center) lastCenter = center;
        const events = machine.update({ gesture, confidence: result.confidence || 0, x: center?.x, y: center?.y });
        for (const event of events) {
          if (event.type === 'gesture-change' && event.to === 'open') action('fullscreen');
          if (event.type === 'gesture-change' && event.to === 'swipeLeft') action('snap', 'left');
          if (event.type === 'gesture-change' && event.to === 'swipeRight') action('snap', 'right');
        }
      }
      } finally {
        busy = false;
        scheduleLoop();
      }
    }
    const saveMusic = h('button', { class: 'btn btn--sm', onclick: async () => { await config.set('gesture.musicUrl', musicInput.value); toast('音乐网址已保存', 'good'); } }, '保存音乐网址');
    const testMusic = h('button', { class: 'btn btn--sm', onclick: () => action('music') }, '试听');
    root.append(
      h('div', { class: 'bar bar--drag' }, h('strong', {}, '手势识别'), h('span', { class: 'faint' }, '本地摄像头分析，不上传画面'), h('span', { style: { flex: 1 } }), status, startBtn),
      h('div', { class: 'settings__body gesture__body' },
        h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '手势控制'),
          h('p', { class: 'faint settings__hint' }, '五指张开：全屏；向左/右挥手：窗口靠左/右；握拳后快速张开：播放音乐（打响指的轻量近似）。'),
          h('div', { class: 'gesture__actions' },
            h('button', { class: 'btn btn--sm', onclick: () => action('fullscreen') }, '测试全屏'),
            h('button', { class: 'btn btn--sm', onclick: () => action('snap', 'left') }, '测试靠左'),
            h('button', { class: 'btn btn--sm', onclick: () => action('snap', 'right') }, '测试靠右'),
          )),
        h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '哈基米音乐'), h('p', { class: 'faint settings__hint' }, '打响指近似动作会打开这个网址；可替换成任意 HTTPS 音乐页面。'), musicInput, h('div', { class: 'gesture__actions' }, saveMusic, testMusic)),
        h('section', { class: 'card' }, h('h3', { class: 'card__title' }, '隐私与使用说明'), h('p', { class: 'faint settings__hint' }, '摄像头只在点击开启后工作，画面仅在本机内存分析；关闭栏目或点击浮窗 × 会立即停止摄像头。窗口动作可能影响当前前台应用，请先使用测试按钮。')),
      ),
    );
    return { deactivate: () => { /* 摄像头浮窗按用户操作关闭，切换栏目不打断识别 */ } };
  },
};
