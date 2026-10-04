/**
 * 主窗口开合的「粒子」动效（黑洞那套仍在 app.js + base.css 里，作为另一种可选风格）。
 *  - 开（expand）：四散在屏幕各处的粒子朝中心汇聚、成型，末尾一记白光，像应用被「聚」出来。
 *  - 关（collapse）：中心先攒一颗亮核，随即大爆炸——粒子带拖尾四射，外加一圈冲击波。
 * 纯 canvas，全屏覆盖、不拦点击；和 #app 的缩放/淡入淡出（base.css 的 is-pfx-* 类）配合。
 * done() 在动画放完后调用：关窗时用它通知主进程可以真的关了。
 */
export function playParticleFx(mode, done) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = innerWidth, H = innerHeight, CX = W / 2, CY = H / 2;
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.className = 'pfx';
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  // canvas 是替换元素，inset:0 压不住它的固有尺寸，必须显式给 CSS 尺寸，否则画布会溢出、中心跑偏
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  document.body.appendChild(canvas);

  const css = getComputedStyle(document.documentElement);
  const pick = (v, f) => (css.getPropertyValue(v).trim() || f);
  const palette = [pick('--accent', '#5b8cff'), pick('--accent-secondary', '#c084fc'), '#ffffff', pick('--accent', '#5b8cff')];

  const converge = mode === 'expand';
  const DUR = reduce ? 140 : (converge ? 1100 : 680);
  const maxR = Math.hypot(W, H) / 2;
  const N = reduce ? 36 : Math.max(70, Math.min(240, Math.round((W * H) / 8600)));
  const rnd = (a, b) => a + Math.random() * (b - a);

  const ps = [];
  for (let i = 0; i < N; i++) {
    const ang = rnd(0, Math.PI * 2);
    const col = palette[i % palette.length];
    const size = rnd(1.3, 3.8);
    if (converge) {
      const r = rnd(0.45, 1.2) * maxR;
      ps.push({ sx: CX + Math.cos(ang) * r, sy: CY + Math.sin(ang) * r,
        tx: CX + rnd(-16, 16), ty: CY + rnd(-16, 16), delay: Math.random() * 0.28, col, size });
    } else {
      const spd = rnd(4, 15) * (0.6 + Math.random());
      ps.push({ x: CX + rnd(-8, 8), y: CY + rnd(-8, 8),
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, col, size: size * 1.1, life: rnd(0.72, 1) });
    }
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  let start = 0, last = 0;

  function frame(ts) {
    if (!start) start = ts;
    const p = Math.min(1, (ts - start) / DUR);
    const dt = last ? Math.min(40, ts - last) : 16; last = ts;
    const k = dt / 16;

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const q of ps) {
      let x, y, a, s;
      if (converge) {
        const local = Math.max(0, Math.min(1, (p - q.delay) / (1 - q.delay)));
        const e = easeOut(local);
        x = q.sx + (q.tx - q.sx) * e;
        y = q.sy + (q.ty - q.sy) * e;
        a = local < 0.75 ? 1 : Math.max(0, 1 - (local - 0.75) / 0.25);
        s = q.size * (1 - 0.35 * e);
        const e2 = easeOut(Math.min(1, local + 0.06));
        ctx.strokeStyle = q.col; ctx.globalAlpha = a * 0.5; ctx.lineWidth = s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(q.sx + (q.tx - q.sx) * e2, q.sy + (q.ty - q.sy) * e2); ctx.stroke();
      } else {
        q.vx *= Math.pow(0.985, k); q.vy *= Math.pow(0.985, k);
        q.x += q.vx * k; q.y += q.vy * k;
        x = q.x; y = q.y; s = q.size;
        a = Math.max(0, 1 - p / q.life);
        ctx.strokeStyle = q.col; ctx.globalAlpha = a * 0.6; ctx.lineWidth = s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - q.vx * 2.6, y - q.vy * 2.6); ctx.stroke();
      }
      ctx.globalAlpha = a; ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.4, s), 0, 6.2832); ctx.fill();
    }

    // 中心光晕：汇聚末尾一记白光；爆炸开头一颗亮核
    if (converge && p > 0.72) {
      const f = (p - 0.72) / 0.28, rr = 4 + f * 100;
      const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, rr);
      g.addColorStop(0, `rgba(255,255,255,${(1 - f) * 0.95})`);
      g.addColorStop(0.5, palette[0]); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, rr, 0, 6.2832); ctx.fill();
    }
    if (!converge) {
      if (p < 0.32) {
        const f = 1 - p / 0.32, rr = 12 + (1 - f) * 70;
        const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, rr);
        g.addColorStop(0, `rgba(255,255,255,${f})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, rr, 0, 6.2832); ctx.fill();
      }
      // 冲击波圆环
      const rr = easeOut(p) * maxR * 1.1;
      ctx.globalAlpha = Math.max(0, 0.6 * (1 - p)); ctx.strokeStyle = palette[0]; ctx.lineWidth = 3 + (1 - p) * 4;
      ctx.beginPath(); ctx.arc(CX, CY, rr, 0, 6.2832); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (p < 1) requestAnimationFrame(frame);
    else { canvas.remove(); done && done(); }
  }
  requestAnimationFrame(frame);
}
