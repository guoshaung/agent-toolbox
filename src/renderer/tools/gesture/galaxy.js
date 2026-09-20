/**
 * 一片会转的旋涡星系。开摄像头时整页滑进来，关掉滑走。
 *
 * 坐标一律按 CSS 像素算，画之前用 setTransform 把 dpr 乘上去。
 * 上一版忘了这件事：画布是 2600×1680 的设备像素，而星星大小写的是 1.1 —— 在 2 倍屏上
 * 只有 0.55 个 CSS 像素，加上一共才 1500 颗铺满两千多像素宽，看起来就是一片灰，
 * 根本没有银河。
 */
const ARMS = 3;
const STAR_COUNT = 2600;

export function createGalaxy(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let t0 = 0;
  let stars = [];
  let dust = [];
  let far = [];
  let W = 0;
  let H = 0;

  function seed() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const arm = i % ARMS;
      // r 往核心挤：核心亮、外围疏，才像旋涡星系而不是均匀撒点
      const r = Math.pow(Math.random(), 0.62);
      // 越往外旋臂缠得越开，同时给一点横向抖动，旋臂才有厚度
      const spread = 0.26 + r * 0.55;
      const theta = arm * ((Math.PI * 2) / ARMS) + r * 4.6 + (Math.random() - 0.5) * spread;
      const core = r < 0.22;
      stars.push({
        r,
        theta,
        // 核心偏暖黄，外围偏蓝紫
        hue: core ? 38 + Math.random() * 18 : 232 + Math.random() * 62,
        sat: core ? 85 : 78,
        light: core ? 84 : 70 + Math.random() * 18,
        size: Math.random() < 0.08 ? 1.9 + Math.random() * 1.3 : 0.8 + Math.random() * 0.9,
        alpha: 0.45 + Math.random() * 0.55,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.6 + Math.random() * 1.8,
      });
    }
    // 旋臂之间的暗尘带，让旋臂的形状看得出来
    dust = Array.from({ length: 520 }, (_, i) => {
      const arm = i % ARMS;
      const r = 0.25 + Math.random() * 0.75;
      return {
        r,
        theta: arm * ((Math.PI * 2) / ARMS) + r * 4.6 + 0.42 + (Math.random() - 0.5) * 0.3,
        size: 6 + Math.random() * 16,
        alpha: 0.05 + Math.random() * 0.09,
      };
    });
    far = Array.from({ length: 420 }, () => ({
      x: Math.random(), y: Math.random(),
      s: Math.random() * 1.3 + 0.4,
      a: Math.random() * 0.45 + 0.12,
      tw: Math.random() * Math.PI * 2,
    }));
  }

  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // 关键：之后所有坐标都按 CSS 像素写，交给这里换算成设备像素
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;
    const ease = 1 - (1 - Math.min(1, t / 1.8)) ** 3;      // 从远处推进来
    const cx = W / 2;
    const cy = H * 0.5;
    const radius = (0.4 + 0.6 * ease) * Math.max(W, H) * 0.46;
    const rot = t * 0.045;
    const squash = 0.68;                                    // 压扁一点，像斜着看

    ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, W, H);

    // 背景远星
    for (const s of far) {
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 0.9 + s.tw));
      ctx.fillStyle = '#d6dcff';
      ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
    }

    // 星系整体的光晕
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    halo.addColorStop(0, 'rgba(255,238,205,.42)');
    halo.addColorStop(0.16, 'rgba(210,175,255,.24)');
    halo.addColorStop(0.55, 'rgba(120,96,240,.10)');
    halo.addColorStop(1, 'rgba(80,60,200,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, squash);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const place = (item, extraRot = 0) => {
      const a = item.theta + rot + extraRot;
      return [cx + Math.cos(a) * item.r * radius, cy + Math.sin(a) * item.r * radius * squash];
    };

    // 暗尘带压在旋臂一侧
    ctx.globalCompositeOperation = 'source-over';
    for (const d of dust) {
      const [x, y] = place(d);
      ctx.globalAlpha = d.alpha * ease;
      ctx.fillStyle = '#05040f';
      ctx.beginPath();
      ctx.ellipse(x, y, d.size, d.size * squash, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 旋臂上的星星：叠加混合，密处自然发亮
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const [x, y] = place(s);
      const twinkle = 0.72 + 0.28 * Math.sin(t * s.twSpeed + s.tw);
      ctx.globalAlpha = s.alpha * twinkle * ease;
      ctx.fillStyle = `hsl(${s.hue} ${s.sat}% ${s.light}%)`;
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 核心
    ctx.globalAlpha = 1;
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.26);
    coreGlow.addColorStop(0, 'rgba(255,250,235,.85)');
    coreGlow.addColorStop(0.35, 'rgba(255,214,150,.42)');
    coreGlow.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, squash);
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (raf) return;
      seed();
      fit();
      t0 = 0;
      raf = requestAnimationFrame(frame);
      window.addEventListener('resize', fit);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', fit);
    },
  };
}
