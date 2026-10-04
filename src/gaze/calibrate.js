'use strict';
/**
 * 13 点校准：3×3 网格 + 四个四分之一点。每个点：先亮 1.1 秒让眼睛到位，再收缩 1.4 秒 —— 收缩期间主进程收样本。
 * 坐标全用 0～1，主进程按这块屏幕的尺寸换算。
 */
const POINTS = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
const SETTLE = 1100; const COLLECT = 1400;
const intro = document.getElementById('intro'); const stage = document.getElementById('stage'); const result = document.getElementById('result');
const dot = document.getElementById('dot'); const progress = document.getElementById('progress'); const camstate = document.getElementById('camstate');
let cancelled = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.toolbox.gaze.onCalib((msg) => {
  if (msg.type === 'camera') camstate.textContent = msg.ok ? '摄像头就绪，能看到你的脸' : (msg.text || '摄像头还没准备好…');
});

async function run() {
  cancelled = false;
  intro.hidden = true; result.hidden = true; stage.hidden = false;
  await window.toolbox.gaze.calibStep({ type: 'begin' });
  for (let i = 0; i < POINTS.length; i += 1) {
    if (cancelled) return;
    const [x, y] = POINTS[i];
    dot.classList.remove('is-collect');
    dot.style.left = `${x * 100}%`; dot.style.top = `${y * 100}%`;
    progress.textContent = `${i + 1} / ${POINTS.length} · 只动眼睛，盯住它`;
    await sleep(SETTLE);
    if (cancelled) return;
    await window.toolbox.gaze.calibStep({ type: 'collect', index: i, x, y });
    dot.style.setProperty('--dur', `${COLLECT}ms`);
    dot.classList.add('is-collect');
    await sleep(COLLECT);
    await window.toolbox.gaze.calibStep({ type: 'pause' });
  }
  const r = await window.toolbox.gaze.calibStep({ type: 'finish' });
  stage.hidden = true; result.hidden = false;
  document.getElementById('result-title').textContent = r.ok ? '校准完成' : '没校成';
  document.getElementById('result-text').textContent = r.ok
    ? `收了 ${r.samples} 个样本，平均误差约 ${r.errorPx} 像素（光圈就是这么大）。误差超过 200 像素建议重来：坐正、光线亮一点、头别动。`
    : (r.error || '样本太少，多半是摄像头没看清脸。');
  document.getElementById('done').hidden = !r.ok;
}

document.getElementById('start').onclick = run;
document.getElementById('redo').onclick = run;
document.getElementById('cancel').onclick = () => window.toolbox.gaze.calibStep({ type: 'cancel' });
document.getElementById('done').onclick = () => window.toolbox.gaze.calibStep({ type: 'close' });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cancelled = true; window.toolbox.gaze.calibStep({ type: 'cancel' }); } });
