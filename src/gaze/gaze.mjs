import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * 守望的后台页：开摄像头、跑人脸 478 点模型，把视线要用的十几个点和头部姿态矩阵发给主进程。
 * 这个窗口永远不显示；画面一帧都不出电脑，也不落盘。
 */
const NEEDED = [468, 473, 33, 133, 362, 263, 159, 145, 386, 374, 1, 152, 10];
const FPS = 12;
const video = document.getElementById('cam');
let landmarker = null;
let stream = null;
let running = false;
let lastSent = 0;

const report = (payload) => window.toolbox.gaze.sample(payload);

async function start() {
  if (running) return;
  running = true;
  try {
    const paths = await window.toolbox.gaze.paths();
    const vision = await FilesetResolver.forVisionTasks(paths.wasm);
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: paths.model, delegate: 'GPU' },
      runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false,
    });
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 15 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    report({ ready: true });
    requestAnimationFrame(loop);
  } catch (err) {
    running = false;
    report({ error: err?.message || String(err), name: err?.name || '' });
  }
}

function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  if (now - lastSent < 1000 / FPS || video.readyState < 2) return;
  lastSent = now;
  let result;
  try { result = landmarker.detectForVideo(video, now); } catch { return; }
  const lm = result?.faceLandmarks?.[0];
  if (!lm) { report({ t: Date.now(), present: false }); return; }
  const pts = {};
  for (const i of NEEDED) pts[i] = { x: lm[i].x, y: lm[i].y };
  const m = result.facialTransformationMatrixes?.[0]?.data;
  report({ t: Date.now(), present: true, pts, matrix: m ? Array.from(m) : null });
}

function stop() {
  running = false;
  try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* 已停 */ }
  stream = null;
  try { landmarker?.close(); } catch { /* 已关 */ }
  landmarker = null;
}

window.toolbox.gaze.onControl((cmd) => { if (cmd === 'start') start(); else if (cmd === 'stop') stop(); });
start();
