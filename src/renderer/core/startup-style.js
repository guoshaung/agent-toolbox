const FONT_MODES = new Set(['system', 'q-headings', 'q-all', 'handwritten']);
const UI_SCALE_MODES = Object.freeze({ standard: 1, large: 1.16, xlarge: 1.32 });

export function applyUiScale(config) {
  const mode = String(config.get('ui.scale', 'standard'));
  const scale = UI_SCALE_MODES[mode] || UI_SCALE_MODES.standard;
  document.documentElement.dataset.uiScale = mode in UI_SCALE_MODES ? mode : 'standard';
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export function applyTypography(config) {
  const value = config.get('ui.typography', 'q-all');
  document.documentElement.dataset.typography = FONT_MODES.has(value) ? value : 'system';
}

function eye(cx, mirrored) {
  return `<g class="awakening-eye" style="--delay:${mirrored ? '.12s' : '0s'}" transform="translate(${cx} 120)">
    <g class="awakening-lids"><path d="M-124 0 Q0-108 124 0 Q0 108-124 0" fill="#e5d8df" stroke="#8e163c" stroke-width="5"/>
    <svg x="-122" y="-53" width="244" height="106" viewBox="-122 -53 244 106">
      <defs><clipPath id="eye-${cx}"><path d="M-124 0 Q0-108 124 0 Q0 108-124 0"/></clipPath></defs>
      <g clip-path="url(#eye-${cx})"><circle r="59" fill="#ca1835"/><circle r="46" fill="none" stroke="#4c071c" stroke-width="2"/>
      <g class="awakening-iris"><circle r="14" fill="#140912"/>${[0,120,240].map(a=>`<g transform="rotate(${a})"><path d="M0-40 C18-47 22-20 7-18 C13-25 10-32 4-32 C-7-28-13-40 0-40Z" fill="#140912"/></g>`).join('')}</g></g>
    </svg></g></g>`;
}

export function showStartup(config, { preview = false } = {}) {
  if (!preview && config.get('ui.startupSkin', 'sharingan') !== 'sharingan') return () => {};
  const overlay = document.createElement('div');
  overlay.className = 'awakening';
  overlay.setAttribute('role', 'region');
  overlay.setAttribute('aria-label', '写轮眼启动动画');
  overlay.innerHTML = `<div class="awakening-orbit" aria-hidden="true"></div><svg class="awakening-eyes" viewBox="0 0 620 240" aria-hidden="true">${eye(165,false)}${eye(455,true)}</svg><div class="awakening-brand">AGENT <strong>TOOLBOX</strong></div><p class="awakening-caption">睁眼 · 开始你的下一步</p><button class="awakening-skip" type="button">跳过动画 · Esc</button>`;
  let timer;
  const close = () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  overlay.querySelector('button').addEventListener('click', close, { once: true });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  timer = setTimeout(close, matchMedia('(prefers-reduced-motion: reduce)').matches ? 700 : 2900);
  return close;
}
