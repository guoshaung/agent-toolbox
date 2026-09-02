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
      <rect x="224" y="224" width="576" height="576" rx="88" fill="white"/>
      <path d="M512 276 Q533.24 490.76, 748 512 Q533.24 533.24, 512 748 Q490.76 533.24, 276 512 Q490.76 490.76, 512 276 Z" fill="black"/>
    </mask>
  </defs>
  <g filter="url(#tbxglow)" opacity="0.6"><g fill="url(#tbxneon)">
      <rect x="128" y="332" width="132" height="60" rx="30"/>
      <rect x="764" y="332" width="132" height="60" rx="30"/>
      <rect x="332" y="128" width="60" height="132" rx="30"/>
      <rect x="332" y="764" width="60" height="132" rx="30"/>
      <rect x="128" y="632" width="132" height="60" rx="30"/>
      <rect x="764" y="632" width="132" height="60" rx="30"/>
      <rect x="632" y="128" width="60" height="132" rx="30"/>
      <rect x="632" y="764" width="60" height="132" rx="30"/>
    </g>
    <rect x="224" y="224" width="576" height="576" rx="92"
        fill="none" stroke="url(#tbxneon)" stroke-width="92"/>
      <path d="M512 365.68 Q525.1688 498.8312, 658.3199999999999 512 Q525.1688 525.1688, 512 658.3199999999999 Q498.8312 525.1688, 365.68 512 Q498.8312 498.8312, 512 365.68 Z" fill="url(#tbxneon)"/></g>
  <g fill="url(#tbxneon)">
      <rect x="128" y="332" width="132" height="60" rx="30"/>
      <rect x="764" y="332" width="132" height="60" rx="30"/>
      <rect x="332" y="128" width="60" height="132" rx="30"/>
      <rect x="332" y="764" width="60" height="132" rx="30"/>
      <rect x="128" y="632" width="132" height="60" rx="30"/>
      <rect x="764" y="632" width="132" height="60" rx="30"/>
      <rect x="632" y="128" width="60" height="132" rx="30"/>
      <rect x="632" y="764" width="60" height="132" rx="30"/>
    </g>
    <rect x="224" y="224" width="576" height="576" rx="92"
        fill="none" stroke="url(#tbxneon)" stroke-width="92"/>
      <path d="M512 365.68 Q525.1688 498.8312, 658.3199999999999 512 Q525.1688 525.1688, 512 658.3199999999999 Q498.8312 525.1688, 365.68 512 Q498.8312 498.8312, 512 365.68 Z" fill="url(#tbxneon)"/>
</svg>`;
