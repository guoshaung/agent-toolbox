/**
 * 一片会转的旋涡星系。开摄像头时整页滑进来，关掉滑走。
 * 纯 2D canvas：三条对数螺旋臂 + 核心光晕 + 背景散星，慢慢旋转、带一点视差。
 */
export function createGalaxy(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let t0 = 0;
  let stars = [];
  let far = [];

  function seed() {
    stars = [];
    const ARMS = 3;
    for (let i = 0; i < 1500; i += 1) {
      const arm = i % ARMS;
      const r = Math.pow(Math.random(), 0.7) * 1.0;                 // 0..1，核心密
      const theta = arm * (Math.PI * 2 / ARMS) + r * 4.2 + (Math.random() - 0.5) * (0.35 + r * 0.6);
      const hue = 235 + Math.random() * 60 + (r < 0.2 ? 40 : 0);   // 核心偏暖，外围偏蓝紫
      stars.push({ r, theta, size: Math.random() < 0.06 ? 2.2 : 1.1, hue, alpha: 0.35 + Math.random() * 0.65, tw: Math.random() * Math.PI * 2 });
    }
    far = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.3, a: Math.random() * 0.5 + 0.2 }));
  }

  function fit() {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * d));
    canvas.height = Math.max(1, Math.round(r.height * d));
  }

  function frame(now) {
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.52;
    const ease = 1 - Math.pow(1 - Math.min(1, t / 1.6), 3);         // 从远处推进来
    const scale = (0.35 + 0.65 * ease) * Math.min(W, H) * 0.46;
    const rot = t * 0.05;

    ctx.fillStyle = '#07061a';
    ctx.fillRect(0, 0, W, H);
    // 远景散星
    for (const s of far) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfd6ff';
      ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
    }
    // 核心光晕
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.55);
    glow.addColorStop(0, 'rgba(255,236,200,.75)');
    glow.addColorStop(0.25, 'rgba(201,167,255,.35)');
    glow.addColorStop(1, 'rgba(120,90,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
    // 螺旋臂（压扁一点，像斜着看）
    for (const s of stars) {
      const a = s.theta + rot;
      const x = cx + Math.cos(a) * s.r * scale;
      const y = cy + Math.sin(a) * s.r * scale * 0.62;
      const twinkle = 0.75 + 0.25 * Math.sin(t * 2 + s.tw);
      ctx.globalAlpha = s.alpha * twinkle * (0.5 + 0.5 * ease);
      ctx.fillStyle = `hsl(${s.hue} 90% ${s.r < 0.15 ? 88 : 78}%)`;
      ctx.fillRect(x, y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  return {
    start() { if (raf) return; seed(); fit(); t0 = 0; raf = requestAnimationFrame(frame); addEventListener('resize', fit); },
    stop() { cancelAnimationFrame(raf); raf = 0; removeEventListener('resize', fit); },
  };
}
