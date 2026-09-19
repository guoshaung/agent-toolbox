/**
 * 手势小窗：摄像头 + MediaPipe 手部关键点 + 手势判定。
 *
 * 常驻右下角、置顶。识别到的动作发给主进程，由它去唤出切换栏、切应用；
 * 这个窗口自己只管看手、画点、报数。
 *
 * 之前的手势识别是肤色阈值 + 轮廓凸点数指头，光线一变就乱。这里换成 21 个关键点，
 * 单手比 1–9（中国手势：6 是拇指小指、7 是三指捏、8 是手枪、9 是勾食指）都能分。
 */
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { fingers, numberOf, isFist, detectSnap } from './hand-rules.mjs';

const WASM = new URL('../../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url).href.replace(/\/$/, '');
const MODEL = new URL('../../assets/models/hand_landmarker.task', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const hint = $('hint');
const dot = $('dot');
const big = $('big');
const api = window.toolbox?.gestureWin;

let landmarker = null;
let stream = null;
let running = false;
let switcherOpen = false;

// 数字要稳住几帧才算数；报过一次就锁住，直到手换了姿势
const stable = { value: 0, frames: 0, locked: 0 };
function settleNumber(n) {
  if (n === stable.value) stable.frames += 1; else { stable.value = n; stable.frames = 1; }
  if (n === 0 && stable.frames >= 3) stable.locked = 0;
  if (n && stable.frames >= 5 && stable.locked !== n) { stable.locked = n; return n; }
  return 0;
}
let fistFrames = 0;

// ---------- 画点 ----------
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const TIPS = new Set([4, 8, 12, 16, 20]);
function draw(lm) {
  const w = overlay.width, h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  // object-fit: cover 的视频，画布要按同样的方式对齐
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.max(w / vw, h / vh);
  const ox = (w - vw * scale) / 2, oy = (h - vh * scale) / 2;
  const P = (p) => [ox + p.x * vw * scale, oy + p.y * vh * scale];
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(201,167,255,.55)';
  ctx.beginPath();
  for (const [a, b] of BONES) { const [x1, y1] = P(lm[a]); const [x2, y2] = P(lm[b]); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
  ctx.imageSmoothingEnabled = false;
  lm.forEach((p, i) => {
    const [x, y] = P(p);
    const s = TIPS.has(i) ? 7 : 4;                  // 像素点：方的，指尖大一号
    ctx.fillStyle = TIPS.has(i) ? '#5fd3a0' : '#c9a7ff';
    if (TIPS.has(i)) { ctx.shadowColor = '#5fd3a0'; ctx.shadowBlur = 10; } else ctx.shadowBlur = 0;
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  });
  ctx.shadowBlur = 0;
}

function showBig(n, locked) {
  if (!n) { big.classList.remove('on'); return; }
  big.textContent = String(n);
  big.classList.toggle('locked', Boolean(locked));
  big.classList.add('on');
}

// ---------- 主循环 ----------
let lastVideoTime = -1;
let lastHandAt = 0;
function loop() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let lm = null;
    try { lm = landmarker.detectForVideo(video, now).landmarks?.[0] || null; } catch { lm = null; }
    draw(lm);
    if (lm) {
      lastHandAt = now;
      dot.className = 'dot hand';
      const f = fingers(lm);
      if (detectSnap(lm, f, now)) {
        hint.textContent = '响指 → 切换栏';
        api?.event({ type: 'snap' });
        stable.locked = 0;
      }
      const n = numberOf(f);
      const fired = settleNumber(n);
      showBig(n, stable.locked === n && n);
      if (fired) { hint.textContent = `比了 ${fired}`; api?.event({ type: 'number', value: fired }); }
      fistFrames = isFist(f) ? fistFrames + 1 : 0;
      if (fistFrames === 12) { hint.textContent = '握拳 → 收起'; api?.event({ type: 'fist' }); }
      if (!fired && n === 0 && !isFist(f)) hint.textContent = switcherOpen ? '比数字选应用' : '看到手了';
    } else {
      showBig(0);
      if (now - lastHandAt > 600) { dot.className = 'dot on'; hint.textContent = '把手抬到镜头前'; }
    }
  }
  requestAnimationFrame(loop);
}

function fit() {
  const r = overlay.getBoundingClientRect();
  overlay.width = Math.max(1, Math.round(r.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.round(r.height * devicePixelRatio));
}

async function start() {
  try {
    hint.textContent = '打开摄像头…';
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    hint.textContent = '加载手部模型…';
    const vision = await FilesetResolver.forVisionTasks(WASM);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    running = true;
    dot.className = 'dot on';
    hint.textContent = '把手抬到镜头前';
    fit();
    requestAnimationFrame(loop);
  } catch (error) {
    dot.className = 'dot bad';
    const denied = /NotAllowed|Permission|denied|拒绝/i.test(`${error.name} ${error.message}`);
    hint.textContent = denied ? '摄像头没权限' : `启动失败：${error.message}`;
    // 说清楚去哪开，并给一个直达按钮；顺手把主窗口叫回来
    const foot = $('foot');
    foot.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = denied
      ? (navigator.platform.startsWith('Win') ? 'Windows：设置 → 隐私 → 相机 → 允许桌面应用访问相机' : 'macOS：系统设置 → 隐私与安全性 → 摄像头 → 打开「Agent 工具箱」')
      : error.message;
    const btn = document.createElement('button');
    btn.textContent = '打开设置';
    btn.className = 'foot-btn';
    btn.onclick = () => api?.openCameraSettings();
    const back = document.createElement('button');
    back.textContent = '回到工具箱';
    back.className = 'foot-btn';
    back.onclick = () => api?.showMain();
    foot.append(msg, btn, back);
    api?.event({ type: 'error', value: error.message });
  }
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  landmarker?.close?.();
  landmarker = null;
}

addEventListener('resize', fit);
$('close').onclick = () => { stop(); api?.close(); };
addEventListener('beforeunload', stop);
api?.onState?.((state) => { switcherOpen = Boolean(state?.switcherOpen); if (switcherOpen) hint.textContent = '比数字选应用'; });
start();
