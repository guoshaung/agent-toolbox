'use strict';

/**
 * 视线估计的数学部分，纯函数：
 *  - 从人脸关键点（MediaPipe 478 点 + 头部姿态矩阵）里抠特征
 *  - 用你本人的校准样本做岭回归，把特征映射到屏幕坐标（0~1）
 *  - 一欧元滤波：静止时稳、转头时跟得上
 *  - 注意力状态机：在看 / 走神 / 看手机 / 离开 / 眼睛累
 *
 * 精度上限是摄像头视线估计本身的：校准后一般 1.5～3 度，落到屏幕上是一个手掌大的光圈。
 */

// MediaPipe FaceLandmarker 的点位
const IDX = {
  leftIris: 468, rightIris: 473,
  leftOuter: 33, leftInner: 133, rightInner: 362, rightOuter: 263,
  leftUp: 159, leftDown: 145, rightUp: 386, rightDown: 374,
  noseTip: 1, chin: 152, forehead: 10,
};

/** 4x4 列主序矩阵 → 欧拉角（度）+ 平移 */
function poseFromMatrix(m) {
  if (!m || m.length < 16) return { yaw: 0, pitch: 0, roll: 0, tx: 0, ty: 0, tz: 0, ok: false };
  // 列主序：m[0..3] 是第一列
  const r00 = m[0]; const r10 = m[1]; const r20 = m[2];
  const r01 = m[4]; const r11 = m[5]; const r21 = m[6];
  const r22 = m[10];
  const pitch = Math.atan2(-r20, Math.sqrt(r00 * r00 + r10 * r10)) * 180 / Math.PI;
  const yaw = Math.atan2(r10, r00) * 180 / Math.PI;
  const roll = Math.atan2(r21, r22) * 180 / Math.PI;
  return { yaw, pitch, roll, tx: m[12], ty: m[13], tz: m[14], ok: true };
}

/**
 * 关键点 → 特征。
 * 虹膜相对眼眶的位置用眼宽 / 眼高归一，左右眼分开；再加头部姿态和位置，模型自己学「头转了要补多少」。
 */
function featuresFrom(landmarks, matrix) {
  if (!landmarks || landmarks.length < 478) return null;
  const p = (i) => landmarks[i];
  const eye = (outer, inner, up, down, iris) => {
    const o = p(outer); const n = p(inner); const u = p(up); const d = p(down); const c = p(iris);
    const w = Math.hypot(n.x - o.x, n.y - o.y) || 1e-6;
    const hgt = Math.hypot(u.x - d.x, u.y - d.y) || 1e-6;
    const cx = (o.x + n.x) / 2; const cy = (u.y + d.y) / 2;
    return { dx: (c.x - cx) / w, dy: (c.y - cy) / w, open: hgt / w };
  };
  const L = eye(IDX.leftOuter, IDX.leftInner, IDX.leftUp, IDX.leftDown, IDX.leftIris);
  const R = eye(IDX.rightInner, IDX.rightOuter, IDX.rightUp, IDX.rightDown, IDX.rightIris);
  const pose = poseFromMatrix(matrix);
  const nose = p(IDX.noseTip);
  const faceW = Math.hypot(p(IDX.rightOuter).x - p(IDX.leftOuter).x, p(IDX.rightOuter).y - p(IDX.leftOuter).y) || 1e-6;
  const dx = (L.dx + R.dx) / 2; const dy = (L.dy + R.dy) / 2;
  const yaw = pose.yaw / 45; const pitch = pose.pitch / 45; const roll = pose.roll / 45;
  return {
    vec: [1, dx, dy, L.dx, L.dy, R.dx, R.dy, yaw, pitch, roll, nose.x - 0.5, nose.y - 0.5, faceW, dx * yaw, dy * pitch, dx * dx, dy * dy],
    eyeOpen: (L.open + R.open) / 2,
    yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll,
    noseX: nose.x, noseY: nose.y, faceW,
  };
}

// ---------- 岭回归 ----------

function transposeMul(X, Y) {   // X^T · Y
  const n = X.length; const p = X[0].length; const q = Y[0].length;
  const out = Array.from({ length: p }, () => new Array(q).fill(0));
  for (let i = 0; i < n; i += 1) for (let a = 0; a < p; a += 1) { const xa = X[i][a]; if (!xa) continue; for (let b = 0; b < q; b += 1) out[a][b] += xa * Y[i][b]; }
  return out;
}

function solve(A, B) {   // 高斯消元解 A·W = B（A 方阵）
  const n = A.length; const m = B[0].length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-9;
    for (let k = c; k < n + m; k += 1) M[c][k] /= d;
    for (let r = 0; r < n; r += 1) { if (r === c) continue; const f = M[r][c]; if (!f) continue; for (let k = c; k < n + m; k += 1) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row) => row.slice(n));
}

/**
 * samples: [{ x: featureVec, y: [sx, sy] }] → { W, mu, sigma }。
 * 特征先按列标准化再做岭回归：虹膜偏移这种数值只有 ±0.05 的特征，不标准化的话正则一压
 * 系数就被压扁，预测整体缩向屏幕中间 —— 用户看到的就是「往右看光圈到不了右边」。
 */
function fitRidge(samples, lambda = 0.5) {
  if (!samples || samples.length < 8) return null;
  const p = samples[0].x.length;
  const mu = new Array(p).fill(0); const sigma = new Array(p).fill(1);
  for (let j = 1; j < p; j += 1) {
    let s = 0; for (const smp of samples) s += smp.x[j]; mu[j] = s / samples.length;
    let v = 0; for (const smp of samples) v += (smp.x[j] - mu[j]) ** 2; sigma[j] = Math.sqrt(v / samples.length) || 1;
  }
  const X = samples.map((s) => standardize(s.x, mu, sigma)); const Y = samples.map((s) => s.y);
  const XtX = transposeMul(X, X); const XtY = transposeMul(X, Y);
  for (let i = 1; i < XtX.length; i += 1) XtX[i][i] += lambda;   // 截距不正则
  return { W: solve(XtX, XtY), mu, sigma };
}

function standardize(x, mu, sigma) { return x.map((v, j) => (j === 0 || !mu ? v : (v - mu[j]) / (sigma[j] || 1))); }

/** model 可以是 { W, mu, sigma }，也兼容旧的裸 W */
function predict(model, x) {
  if (!model || !x) return null;
  const W = Array.isArray(model) ? model : model.W;
  const z = Array.isArray(model) ? x : standardize(x, model.mu, model.sigma);
  if (!W) return null;
  let sx = 0; let sy = 0;
  for (let i = 0; i < z.length && i < W.length; i += 1) { sx += z[i] * W[i][0]; sy += z[i] * W[i][1]; }
  return [sx, sy];
}

/** 校准点的残差：平均离目标多少（屏幕归一坐标） */
function residual(model, samples) {
  if (!model || !samples?.length) return null;
  let sum = 0;
  for (const s of samples) { const p = predict(model, s.x); sum += Math.hypot(p[0] - s.y[0], p[1] - s.y[1]); }
  return sum / samples.length;
}

// ---------- 一欧元滤波 ----------

class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dxRaw = (v - this.x) / dt;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = ad * dxRaw + (1 - ad) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuro.alpha(cutoff, dt);
    this.x = a * v + (1 - a) * this.x;
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

// ---------- 注意力状态 ----------

/**
 * 每帧喂一次，返回当前状态。阈值都按秒算，用 t（毫秒）推进。
 * 状态：looking / distracted（视线出屏或转头）/ phone（低头）/ away（没人）/ tired（眼睛半闭）
 */
class Attention {
  constructor({ awaySec = 3, distractSec = 6, phoneSec = 3, tiredSec = 4 } = {}) {
    Object.assign(this, { awaySec, distractSec, phoneSec, tiredSec });
    this.state = 'looking'; this.since = 0; this.lastSeen = 0; this.offSince = 0; this.phoneSince = 0; this.tiredSince = 0; this.openBase = null;
  }
  update({ t, present, gaze, yaw, pitch, eyeOpen }) {
    if (!this.since) this.since = t;   // 第一帧才知道时间从哪起算
    let next = 'looking';
    if (!present) {
      if (!this.lastSeen) this.lastSeen = t;
      next = t - this.lastSeen > this.awaySec * 1000 ? 'away' : this.state === 'away' ? 'away' : 'looking';
      if (next === 'looking' && this.state !== 'looking') next = this.state;
    } else {
      this.lastSeen = t;
      // 睁眼基线：用自己平时的睁眼程度做参照，半闭 = 低于 55%
      if (eyeOpen != null) { this.openBase = this.openBase == null ? eyeOpen : Math.max(this.openBase * 0.995, eyeOpen); }
      const tired = eyeOpen != null && this.openBase && eyeOpen < this.openBase * 0.55;
      const headDown = pitch != null && pitch < -22;
      const gazeOff = gaze ? (gaze[0] < -0.12 || gaze[0] > 1.12 || gaze[1] < -0.15 || gaze[1] > 1.2) : false;
      const headOff = yaw != null && Math.abs(yaw) > 32;
      const phoneLike = headDown && (!gaze || gaze[1] > 0.9);
      this.phoneSince = phoneLike ? (this.phoneSince || t) : 0;
      this.offSince = (gazeOff || headOff) && !phoneLike ? (this.offSince || t) : 0;
      this.tiredSince = tired ? (this.tiredSince || t) : 0;
      if (this.phoneSince && t - this.phoneSince > this.phoneSec * 1000) next = 'phone';
      else if (this.offSince && t - this.offSince > this.distractSec * 1000) next = 'distracted';
      else if (this.tiredSince && t - this.tiredSince > this.tiredSec * 1000) next = 'tired';
      else if (this.state !== 'looking' && (this.phoneSince || this.offSince || this.tiredSince)) next = this.state;   // 还在同一段里，别抖
    }
    if (next !== this.state) { this.state = next; this.since = t; }
    return { state: this.state, sinceMs: t - this.since };
  }
}

module.exports = { IDX, poseFromMatrix, featuresFrom, fitRidge, predict, residual, OneEuro, Attention };
