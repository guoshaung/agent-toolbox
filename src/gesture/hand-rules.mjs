/**
 * 手势判定规则，纯函数，不碰 DOM / MediaPipe，好写测试。
 * 输入是 MediaPipe 的 21 个手部关键点（归一化坐标）。
 */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- 手势判定 ----------

/** 每根手指伸没伸：指尖离手腕比第二关节离手腕远得多，就是伸着 */
export function fingers(lm) {
  const wrist = lm[0];
  const palm = dist(wrist, lm[9]) || 1e-6;
  const ext = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) + 0.12 * palm;
  return {
    palm,
    // 真人录的数据：五指张开时拇指尖离中指根只有 0.46–0.61 个手掌、离食指根 0.36–0.46；
    // 收着（比 1/2/3）时离食指根 ≤ 0.25。原来要 0.95 / 0.45，五指张开永远只算 4。
    thumb: dist(lm[4], lm[9]) > 0.4 * palm && dist(lm[4], lm[5]) > 0.32 * palm,
    index: ext(8, 6), middle: ext(12, 10), ring: ext(16, 14), pinky: ext(20, 18),
    // 9：食指根节伸着、末节勾回来
    // 握拳时四根手指的第二关节也都翘着，光看食指会把拳头认成 9 —— 得要求食指关节明显高过中指关节
    indexHooked: dist(lm[6], wrist) > dist(lm[5], wrist) + 0.25 * palm
      && dist(lm[6], wrist) > dist(lm[10], wrist) + 0.15 * palm
      && dist(lm[8], wrist) < dist(lm[6], wrist) + 0.05 * palm,
    // 7：拇指、食指、中指三个指尖捏到一起
    pinch3: dist(lm[4], lm[8]) < 0.45 * palm && dist(lm[4], lm[12]) < 0.5 * palm && dist(lm[8], lm[12]) < 0.4 * palm,
  };
}

export function numberOf(f) {
  const { thumb: t, index: i, middle: m, ring: r, pinky: p } = f;
  if (f.pinch3 && !r && !p) return 7;
  if (!t && !i && !m && !r && !p && f.indexHooked) return 9;
  if (!t && i && !m && !r && !p) return 1;
  if (!t && i && m && !r && !p) return 2;
  if (!t && i && m && r && !p) return 3;
  if (!t && i && m && r && p) return 4;
  if (t && i && m && r && p) return 5;
  if (t && !i && !m && !r && p) return 6;
  if (t && i && !m && !r && !p) return 8;
  return 0;
}

export const isFist = (f) => !f.thumb && !f.index && !f.middle && !f.ring && !f.pinky && !f.indexHooked;

/**
 * 打响指：拇指和中指先捏住，然后中指瞬间弹开、往掌心方向甩。
 * 也接受「食指中指并拢横着快速一扫」—— 你说的两根手指擦过。
 */
const snap = { primedAt: 0, primedMid: null, lastAt: -1e9 };
const sweep = { samples: [] };
export function detectSnap(lm, f, now) {
  const palm = f.palm;
  // 真人打响指：拇指其实先按在食指/中指尖上（离指尖 0.16–0.3 个手掌，远没到 0.32 以下），
  // 弹开后拇指离中指尖 ≥ 0.9、离食指尖 ≥ 0.6。摄像头识别只有 5 帧/秒左右，窗口放宽到 700ms。
  const dMid = dist(lm[4], lm[12]);
  const dIdx = dist(lm[4], lm[8]);
  const folded = !f.middle && !f.ring && !f.pinky;
  if (Math.min(dMid, dIdx) < 0.4 * palm && folded) { snap.primedAt = now; snap.primedMid = { ...lm[12] }; }
  else if (snap.primedAt && now - snap.primedAt < 700 && dMid > 0.85 * palm && dIdx > 0.6 * palm) {
    snap.primedAt = 0;
    if (now - snap.lastAt > 1200) { snap.lastAt = now; return true; }
  }
  if (snap.primedAt && now - snap.primedAt > 900) snap.primedAt = 0;

  // 两指横扫：食指中指伸着并拢，250ms 内横向位移超过 1.6 个手掌
  if (f.index && f.middle && !f.ring && !f.pinky && dist(lm[8], lm[12]) < 0.35 * palm) {
    sweep.samples.push({ t: now, x: lm[8].x });
    sweep.samples = sweep.samples.filter((s) => now - s.t <= 250);
    const dx = Math.abs(lm[8].x - sweep.samples[0].x);
    if (sweep.samples.length >= 3 && dx > 1.6 * palm && now - snap.lastAt > 1200) {
      snap.lastAt = now; sweep.samples = []; return true;
    }
  } else sweep.samples = [];
  return false;
}


/** 测试用：把响指状态清零 */
export function resetSnap() { snap.primedAt = 0; snap.primedMid = null; snap.lastAt = -1e9; sweep.samples = []; }
