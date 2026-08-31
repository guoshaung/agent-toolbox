/**
 * 侧栏上的标记。**这个文件由 scripts/build-logo.js 生成，别手改。**
 * 改造型请改那个脚本，然后跑：npm run logo && npm run icon
 *
 * 这里是无底色版本（只有霓虹芯片），因为侧栏本身就是深色，
 * 再套一层深色圆角底会糊成一团。
 */
export const LOGO_MARK_SVG = `<svg viewBox="0 0 1024 1024" aria-hidden="true">
  <defs>
    <linearGradient id="tbxneon" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#3BFFB4"/>
      <stop offset="0.45" stop-color="#00FF9C"/>
      <stop offset="1" stop-color="#00A867"/>
    </linearGradient>
    <filter id="tbxglow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <mask id="tbxcut">
      <rect width="1024" height="1024" fill="black"/>
      <rect x="262" y="262" width="500" height="500" rx="88" fill="white"/>
      <path d="M512 322 Q529.1 494.9, 702 512 Q529.1 529.1, 512 702 Q494.9 529.1, 322 512 Q494.9 494.9, 512 322 Z" fill="black"/>
    </mask>
  </defs>
  <g filter="url(#tbxglow)" opacity="0.6"><g fill="url(#tbxneon)">
      <rect x="182" y="353" width="114" height="54" rx="27"/>
      <rect x="728" y="353" width="114" height="54" rx="27"/>
      <rect x="353" y="182" width="54" height="114" rx="27"/>
      <rect x="353" y="728" width="54" height="114" rx="27"/>
      <rect x="182" y="617" width="114" height="54" rx="27"/>
      <rect x="728" y="617" width="114" height="54" rx="27"/>
      <rect x="617" y="182" width="54" height="114" rx="27"/>
      <rect x="617" y="728" width="54" height="114" rx="27"/>
    </g>
    <rect x="262" y="262" width="500" height="500" rx="92"
        fill="none" stroke="url(#tbxneon)" stroke-width="84"/>
      <path d="M512 394.2 Q522.602 501.398, 629.8 512 Q522.602 522.602, 512 629.8 Q501.398 522.602, 394.2 512 Q501.398 501.398, 512 394.2 Z" fill="url(#tbxneon)"/></g>
  <g fill="url(#tbxneon)">
      <rect x="182" y="353" width="114" height="54" rx="27"/>
      <rect x="728" y="353" width="114" height="54" rx="27"/>
      <rect x="353" y="182" width="54" height="114" rx="27"/>
      <rect x="353" y="728" width="54" height="114" rx="27"/>
      <rect x="182" y="617" width="114" height="54" rx="27"/>
      <rect x="728" y="617" width="114" height="54" rx="27"/>
      <rect x="617" y="182" width="54" height="114" rx="27"/>
      <rect x="617" y="728" width="54" height="114" rx="27"/>
    </g>
    <rect x="262" y="262" width="500" height="500" rx="92"
        fill="none" stroke="url(#tbxneon)" stroke-width="84"/>
      <path d="M512 394.2 Q522.602 501.398, 629.8 512 Q522.602 522.602, 512 629.8 Q501.398 522.602, 394.2 512 Q501.398 501.398, 512 394.2 Z" fill="url(#tbxneon)"/>
</svg>`;
