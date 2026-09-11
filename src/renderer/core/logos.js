import { LOGO_MARK_SVG } from './logo.js';

const SAKURA_CAT = `<svg viewBox="0 0 1024 1024" aria-hidden="true">
  <defs>
    <linearGradient id="sklogo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb3cd"/><stop offset="1" stop-color="#ec5f8c"/>
    </linearGradient>
    <linearGradient id="skface" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf4"/><stop offset="1" stop-color="#ffdbe6"/>
    </linearGradient>
  </defs>
  <path d="M272 420 L196 168 L424 268 Z" fill="url(#sklogo)" stroke="url(#sklogo)" stroke-width="64" stroke-linejoin="round"/>
  <path d="M752 420 L828 168 L600 268 Z" fill="url(#sklogo)" stroke="url(#sklogo)" stroke-width="64" stroke-linejoin="round"/>
  <rect x="226" y="264" width="572" height="560" rx="150" fill="url(#sklogo)"/>
  <ellipse cx="512" cy="520" rx="348" ry="330" fill="url(#skface)"/>
  <path d="M352 470 Q352 392 436 392" fill="none" stroke="#4a3b44" stroke-width="40" stroke-linecap="round"/>
  <path d="M672 470 Q672 392 588 392" fill="none" stroke="#4a3b44" stroke-width="40" stroke-linecap="round"/>
  <path d="M336 470 L336 476" stroke="#4a3b44" stroke-width="34" stroke-linecap="round"/>
  <path d="M688 470 L688 476" stroke="#4a3b44" stroke-width="34" stroke-linecap="round"/>
  <path d="M512 588 Q560 640 512 700 Q464 640 512 588 Z" fill="#ec5f8c"/>
  <circle cx="398" cy="742" r="34" fill="#ffb3cd"/>
  <circle cx="626" cy="742" r="34" fill="#ffb3cd"/>
  <path d="M790 760 q14 -18 28 0 q-14 24 -28 0 Z" fill="#ffb3cd"/>
  <path d="M860 700 q10 -13 20 0 q-10 17 -20 0 Z" fill="#ffb3cd"/>
  <path d="M700 840 q12 -15 24 0 q-12 20 -24 0 Z" fill="#ffb3cd"/>
</svg>`;

const PIXEL_HEART = `<svg viewBox="0 0 1024 1024" aria-hidden="true">
  <g fill="#ff6f9c">
    <rect x="192" y="288" width="128" height="128"/><rect x="704" y="288" width="128" height="128"/>
    <rect x="128" y="416" width="128" height="128"/><rect x="768" y="416" width="128" height="128"/>
    <rect x="192" y="544" width="128" height="128"/><rect x="704" y="544" width="128" height="128"/>
    <rect x="256" y="672" width="128" height="128"/><rect x="640" y="672" width="128" height="128"/>
    <rect x="320" y="800" width="128" height="128"/><rect x="576" y="800" width="128" height="128"/>
    <rect x="384" y="928" width="128" height="128"/><rect x="512" y="928" width="128" height="128"/>
    <rect x="256" y="160" width="128" height="128"/><rect x="640" y="160" width="128" height="128"/>
    <rect x="384" y="64" width="128" height="128"/><rect x="512" y="64" width="128" height="128"/>
  </g>
  <g fill="#ffe9a3">
    <rect x="320" y="288" width="128" height="128"/><rect x="448" y="288" width="128" height="128"/><rect x="576" y="288" width="128" height="128"/>
    <rect x="256" y="416" width="128" height="128"/><rect x="384" y="416" width="128" height="128"/><rect x="512" y="416" width="128" height="128"/><rect x="640" y="416" width="128" height="128"/>
    <rect x="320" y="544" width="128" height="128"/><rect x="448" y="544" width="128" height="128"/><rect x="576" y="544" width="128" height="128"/>
    <rect x="384" y="672" width="128" height="128"/><rect x="512" y="672" width="128" height="128"/>
    <rect x="448" y="800" width="128" height="128"/>
  </g>
  <g fill="#5ee7ff">
    <rect x="832" y="544" width="96" height="96"/><rect x="96" y="608" width="96" height="96"/>
  </g>
</svg>`;

const CRYSTAL = `<svg viewBox="0 0 1024 1024" aria-hidden="true">
  <defs>
    <linearGradient id="crlogo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5ee7ff"/><stop offset=".5" stop-color="#a778ff"/><stop offset="1" stop-color="#ff7bd0"/>
    </linearGradient>
  </defs>
  <path d="M512 128 L840 512 L512 896 L184 512 Z" fill="url(#crlogo)" stroke="#eef1f7" stroke-opacity=".4" stroke-width="30" stroke-linejoin="round"/>
  <path d="M512 128 L512 896" stroke="#0e0a17" stroke-opacity=".45" stroke-width="20"/>
  <path d="M184 512 L840 512" stroke="#0e0a17" stroke-opacity=".45" stroke-width="20"/>
  <path d="M184 512 L512 896 L840 512 Z" fill="#ffffff" opacity=".16"/>
  <path d="M512 128 L184 512 L512 512 Z" fill="#ffffff" opacity=".32"/>
</svg>`;

export const LOGOS = [
  { id: 'neon', name: '霓虹芯片', svg: LOGO_MARK_SVG },
  { id: 'sakura-cat', name: '樱花猫娘', svg: SAKURA_CAT },
  { id: 'pixel', name: '像素爱心', svg: PIXEL_HEART },
  { id: 'crystal', name: '渐变晶石', svg: CRYSTAL },
];

export function logoById(id) { return LOGOS.find((logo) => logo.id === id) || LOGOS[0]; }

/** SVG 转 CSS url() 可用的 data URI（编码 # " 空格等，避免截断 url()）。 */
export function svgToCssUrl(svg) {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export function applyLogo(id) {
  const logo = logoById(id);
  const host = document.querySelector('.rail__logo');
  if (host) host.innerHTML = logo.svg;
  // 右下角品牌纹章跟随当前 logo 一起变（.stage::after 读这个变量）。
  // 默认 neon 是“当前这一套”，右下角保持原女仆底章不覆盖。
  const root = document.documentElement;
  if (logo.id === 'neon') root.style.removeProperty('--stage-emb-svg');
  else root.style.setProperty('--stage-emb-svg', svgToCssUrl(logo.svg));
  return logo;
}
export function applyStoredLogo(config) { return applyLogo(config.get('ui.logo', 'neon')); }

/** 把内联 SVG 渲染成 256px PNG data URL（renderer 主线程 canvas，离线可用）。 */
export function svgToPngDataUrl(svg, size = 256) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('logo 渲染失败'));
    image.src = url;
  });
}

/** 切换某个 logo 时，除了侧栏标记，同时把应用窗口/任务栏图标（mac 的 Dock）也换掉。 */
export async function applyAppIcon(id) {
  if (typeof document === 'undefined' || !window.toolbox?.app?.setAppIcon) return null;
  const svg = logoById(id).svg;
  const png = await svgToPngDataUrl(svg);
  return window.toolbox.app.setAppIcon(png);
}
