const COLOR_VARS = ['--glow-a','--glow-b','--bg','--bg-raised','--bg-sunken','--panel','--panel-glass','--line','--line-soft','--line-glow','--text','--text-dim','--text-faint','--accent','--accent-soft','--accent-glow','--accent-secondary','--accent-secondary-soft','--accent-tertiary','--accent-tertiary-soft','--glow-accent','--good','--warn','--bad'];

const current = {
  '--bg':'#13161d','--bg-raised':'#1c212b','--bg-sunken':'#0f1216','--panel':'#222833','--panel-glass':'rgba(26,31,41,.78)','--line':'#2a3040','--line-soft':'#1e232f','--line-glow':'rgba(91,140,255,.22)','--text':'#d3d9e4','--text-dim':'#a3abbb','--text-faint':'#6b7485','--accent':'#5b8cff','--accent-soft':'rgba(91,140,255,.14)','--accent-glow':'rgba(91,140,255,.45)','--accent-secondary':'#c084fc','--accent-secondary-soft':'rgba(192,132,252,.14)','--accent-tertiary':'#f472b6','--accent-tertiary-soft':'rgba(244,114,182,.14)','--glow-accent':'0 0 20px rgba(91,140,255,.28)','--good':'#3fb98a','--warn':'#f0a94f','--bad':'#ef6a65'
};

// 三套深色皮肤原本都是「近乎纯黑 + 接近纯白」：赛博绿 18.6:1、极夜紫 16.6:1、
// 女仆霓虹 17.1:1，背景亮度都不到 1%。对比越高越"清晰"是错觉 —— VSCode Dark+
// 只有 11.25:1。这里统一把底抬起来、字压下去，落在 12~14:1。
/**
 * 一套皮肤只要给 8 个关键色，其余（soft/glow/line）按规律派生。
 * dark: 深色底；bg/panel/text 三个层级；a/b/c 三个强调色。
 */
function make({ id, name, desc, dark = true, bg, raised, sunken, panel, line, text, dim, faint, a, b, c, good = '#3fb98a', warn = '#f0a94f', bad = '#ef6a65', clean = true, glow = .1 }) {
  const rgba = (hex, alpha) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`; };
  return {
    id, name, desc, clean, swatches: [a, b, c],
    vars: {
      ...current,
      '--glow-a': rgba(a, glow), '--glow-b': rgba(b, glow * .8),
      '--bg': bg, '--bg-raised': raised, '--bg-sunken': sunken, '--panel': panel,
      '--panel-glass': rgba(panel, dark ? .8 : .86),
      '--line': line, '--line-soft': dark ? raised : sunken, '--line-glow': rgba(a, .25),
      '--text': text, '--text-dim': dim, '--text-faint': faint,
      '--accent': a, '--accent-soft': rgba(a, .14), '--accent-glow': rgba(a, .42),
      '--accent-secondary': b, '--accent-secondary-soft': rgba(b, .14),
      '--accent-tertiary': c, '--accent-tertiary-soft': rgba(c, .14),
      '--glow-accent': `0 0 20px ${rgba(a, .28)}`,
      '--good': good, '--warn': warn, '--bad': bad,
    },
  };
}

export const THEMES = [
  { id:'default', name:'女仆霓虹', desc:'当前默认风格，深蓝霓虹与女仆装饰', swatches:['#5b8cff','#c084fc','#f472b6'], vars:{...current,'--glow-a':'rgba(91,140,255,.08)','--glow-b':'rgba(192,132,252,.07)'} },
  { id:'sakura', name:'樱花校园', desc:'二次元樱花粉与奶油白，轻盈柔和', swatches:['#ec5f8c','#a56cc1','#ffb347'], vars:{...current,'--glow-a':'rgba(236,95,140,.1)','--glow-b':'rgba(255,179,71,.08)','--bg':'#faf3f0','--bg-raised':'#fff7f4','--bg-sunken':'#f3e7e3','--panel':'#ffffff','--panel-glass':'rgba(255,255,255,.84)','--line':'#e8d5d0','--line-soft':'#f0e2de','--line-glow':'rgba(236,95,140,.28)','--text':'#4a3b44','--text-dim':'#8a7582','--text-faint':'#b39aa8','--accent':'#ec5f8c','--accent-soft':'rgba(236,95,140,.14)','--accent-glow':'rgba(236,95,140,.4)','--accent-secondary':'#a56cc1','--accent-secondary-soft':'rgba(165,108,193,.14)','--accent-tertiary':'#ffb347','--accent-tertiary-soft':'rgba(255,179,71,.16)','--glow-accent':'0 0 20px rgba(236,95,140,.25)','--good':'#4dbd8f','--warn':'#e6a23c','--bad':'#e2625a'} },
  { id:'violet', name:'极夜紫罗兰', desc:'深夜紫底与青紫光晕，适合长时间工作', swatches:['#a778ff','#5fc8ff','#ff7bd0'], clean:true, vars:{...current,'--glow-a':'rgba(167,120,255,.1)','--glow-b':'rgba(95,200,255,.08)','--bg':'#171226','--bg-raised':'#201a33','--bg-sunken':'#120e1f','--panel':'#272040','--panel-glass':'rgba(30,23,48,.8)','--line':'#2c2242','--line-soft':'#221a36','--line-glow':'rgba(167,121,255,.25)','--text':'#d6d0e6','--text-dim':'#b3a8cf','--text-faint':'#7a7096','--accent':'#a778ff','--accent-soft':'rgba(167,120,255,.16)','--accent-glow':'rgba(167,120,255,.45)','--accent-secondary':'#5fc8ff','--accent-secondary-soft':'rgba(95,200,255,.15)','--accent-tertiary':'#ff7bd0','--accent-tertiary-soft':'rgba(255,123,208,.15)','--good':'#46c98c','--warn':'#f0a94f','--bad':'#f06a75'} },
  // ---- 金属 ----
  make({ id:'gold', name:'镀金黑金', desc:'黑檀底、24K 金边，主按钮和标题拉丝金属渐变', bg:'#141210', raised:'#1c1915', sunken:'#0e0c0a', panel:'#221e18', line:'#3d3320', text:'#eadfc4', dim:'#b9ab8a', faint:'#7d7259', a:'#d4af37', b:'#f6e27a', c:'#b8860b', good:'#8fc98a', warn:'#f0c45f', bad:'#e0716a' }),
  make({ id:'rosegold', name:'玫瑰金', desc:'暖白底、玫瑰金描边，柔和高级', dark:false, bg:'#faf5f3', raised:'#fffaf8', sunken:'#f2e9e6', panel:'#ffffff', line:'#e9d5d2', text:'#3d2b2f', dim:'#7d6468', faint:'#987f83', a:'#b76e79', b:'#e8a0a0', c:'#d4af37', good:'#4dbd8f', warn:'#e6a23c', bad:'#e2625a' }),
  make({ id:'silver', name:'钛银', desc:'石墨底、冷银强调，像一台 MacBook 的内部', bg:'#15171a', raised:'#1d2024', sunken:'#101214', panel:'#23272c', line:'#343a41', text:'#dfe4ea', dim:'#a7b0bb', faint:'#6f7883', a:'#c0c7d1', b:'#8fa3b8', c:'#e6ebf0' }),
  // ---- 深色 ----
  make({ id:'ocean', name:'深海', desc:'墨蓝海底与青绿光，安静', bg:'#0f1a24', raised:'#15232f', sunken:'#0a131a', panel:'#1a2b39', line:'#233b4d', text:'#d3e3ee', dim:'#9fb7c8', faint:'#647d8e', a:'#38bdf8', b:'#2dd4bf', c:'#818cf8' }),
  make({ id:'forest', name:'森林', desc:'苔绿底、嫩芽绿与琥珀', bg:'#121a14', raised:'#18231b', sunken:'#0d130f', panel:'#1e2c22', line:'#2b4030', text:'#d7e6d9', dim:'#a3bba8', faint:'#6b8471', a:'#6ee7a0', b:'#a3e635', c:'#fbbf24' }),
  make({ id:'sunset', name:'落日', desc:'暖黑底、橘红到玫紫的晚霞', bg:'#1a1416', raised:'#241a1d', sunken:'#130f10', panel:'#2c2024', line:'#43303a', text:'#f1e2e4', dim:'#c2a9ae', faint:'#856e74', a:'#fb7185', b:'#fb923c', c:'#c084fc', glow:.14 }),
  make({ id:'lava', name:'熔岩', desc:'炭黑底、岩浆红，给需要肾上腺素的时候', bg:'#161010', raised:'#1f1515', sunken:'#0f0a0a', panel:'#291b1b', line:'#472828', text:'#f0dcdc', dim:'#c09a9a', faint:'#805f5f', a:'#ef4444', b:'#f97316', c:'#fbbf24', glow:.14 }),
  make({ id:'nord', name:'北欧', desc:'Nord 配色：蓝灰底，克制的冰蓝与青', bg:'#2e3440', raised:'#3b4252', sunken:'#272c36', panel:'#434c5e', line:'#4c566a', text:'#eceff4', dim:'#d8dee9', faint:'#8b95a7', a:'#88c0d0', b:'#81a1c1', c:'#b48ead', good:'#a3be8c', warn:'#ebcb8b', bad:'#bf616a' }),
  make({ id:'galaxy', name:'银河', desc:'深空紫蓝底，星云粉与电光蓝', bg:'#0e0d1f', raised:'#161430', sunken:'#090818', panel:'#1d1a3d', line:'#2d2860', text:'#dcd8f5', dim:'#aba4d6', faint:'#6e689a', a:'#818cf8', b:'#f472b6', c:'#22d3ee', glow:.16 }),
  make({ id:'amber', name:'复古琥珀终端', desc:'CRT 时代的黑底琥珀字', bg:'#141008', raised:'#1c160c', sunken:'#0d0a05', panel:'#241d10', line:'#3f3318', text:'#f2d9a6', dim:'#c4a86f', faint:'#836f45', a:'#ffb000', b:'#ffcc55', c:'#ff8800', good:'#c5d35a', warn:'#ffcc55', bad:'#ff6b57' }),
  make({ id:'mocha', name:'摩卡', desc:'咖啡棕底、奶泡与焦糖', bg:'#1e1a17', raised:'#27221e', sunken:'#171310', panel:'#2f2925', line:'#463c35', text:'#efe4d8', dim:'#c4b3a3', faint:'#87786a', a:'#d4a373', b:'#e9c46a', c:'#f4a261' }),
  // ---- 浅色 ----
  make({ id:'paper', name:'白纸', desc:'极简白，黑字、一点点靛蓝', dark:false, bg:'#f7f7f8', raised:'#ffffff', sunken:'#eeeef1', panel:'#ffffff', line:'#e2e3e8', text:'#1f2328', dim:'#59606b', faint:'#7a8190', a:'#4f46e5', b:'#0ea5e9', c:'#f59e0b', good:'#16a34a', warn:'#d97706', bad:'#dc2626', glow:.06 }),
  make({ id:'eink', name:'墨水屏', desc:'暖灰纸感、几乎没有颜色，最护眼', dark:false, bg:'#ecebe6', raised:'#f4f3ee', sunken:'#e2e1db', panel:'#f8f7f2', line:'#d3d1c9', text:'#2b2a26', dim:'#5f5d56', faint:'#918f86', a:'#3b3a35', b:'#6b6a63', c:'#8a5a2b', good:'#3f7d4f', warn:'#9a6a1f', bad:'#a33c33', glow:.03 }),
  make({ id:'ice', name:'冰川', desc:'冷白底、冰蓝强调，清爽', dark:false, bg:'#f2f7fb', raised:'#ffffff', sunken:'#e6eff6', panel:'#ffffff', line:'#d5e3ee', text:'#1e2f3d', dim:'#5b7082', faint:'#7690a3', a:'#0284c7', b:'#06b6d4', c:'#6366f1', good:'#16a34a', warn:'#d97706', bad:'#dc2626', glow:.08 }),
  make({ id:'mint', name:'薄荷奶油', desc:'奶油白底、薄荷绿与蜜桃', dark:false, bg:'#f6faf6', raised:'#ffffff', sunken:'#e9f2ea', panel:'#ffffff', line:'#d6e6d9', text:'#20302a', dim:'#5f7268', faint:'#7b9184', a:'#10b981', b:'#34d399', c:'#fb923c', good:'#16a34a', warn:'#d97706', bad:'#dc2626', glow:.08 }),
  make({ id:'lavender', name:'薰衣草', desc:'淡紫底、紫与粉，温柔', dark:false, bg:'#f7f4fb', raised:'#fdfbff', sunken:'#ede7f5', panel:'#ffffff', line:'#e1d8ec', text:'#302742', dim:'#6c5f82', faint:'#8a7ea3', a:'#7c3aed', b:'#ec4899', c:'#06b6d4', good:'#16a34a', warn:'#d97706', bad:'#dc2626', glow:.08 }),
  { id:'cyber', name:'赛博绿', desc:'黑底荧光绿，简洁锐利的终端风格', swatches:['#39ff9a','#5ee7ff','#d6ff5e'], clean:true, vars:{...current,'--glow-a':'rgba(57,255,154,.07)','--glow-b':'rgba(94,231,255,.06)','--bg':'#111815','--bg-raised':'#18231d','--bg-sunken':'#0d1311','--panel':'#1b2a21','--panel-glass':'rgba(18,34,25,.82)','--line':'#1d3b2a','--line-soft':'#14291e','--line-glow':'rgba(57,255,154,.25)','--text':'#cfe8db','--text-dim':'#93b3a2','--text-faint':'#678373','--accent':'#39ff9a','--accent-soft':'rgba(57,255,154,.13)','--accent-glow':'rgba(57,255,154,.45)','--accent-secondary':'#5ee7ff','--accent-secondary-soft':'rgba(94,231,255,.14)','--accent-tertiary':'#d6ff5e','--accent-tertiary-soft':'rgba(214,255,94,.14)','--good':'#4deda0','--warn':'#ffd166','--bad':'#ff6978'} }
];

export function themeById(id) { return THEMES.find((theme) => theme.id === id) || THEMES[0]; }
/**
 * 强调色上该压黑字还是白字。
 *
 * 主按钮一律白字是不行的：#5b8cff 上白字没问题，但赛博绿的 #39ff9a
 * 亮度 80%，白字几乎看不见。按相对亮度选，跟 WCAG 的算法一致。
 */
export function inkOn(color) {
  const hex = String(color || '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const channel = (value) => {
    const v = parseInt(value, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(hex.slice(0, 2))
    + 0.7152 * channel(hex.slice(2, 4))
    + 0.0722 * channel(hex.slice(4, 6));
  // 黑白各算一遍，谁对比度高用谁。
  // 别用固定亮度阈值：默认皮肤的 #5b8cff 看着挺深，配白字却只有 3.16:1，
  // 比 4.5 的及格线还低 —— 主按钮上的字一直是糊的。
  const dark = '#0b1410';
  const light = '#ffffff';
  const darkLum = 0.2126 * channel('0b') + 0.7152 * channel('14') + 0.0722 * channel('10');
  const against = (other) => {
    const hi = Math.max(luminance, other); const lo = Math.min(luminance, other);
    return (hi + 0.05) / (lo + 0.05);
  };
  return against(darkLum) >= against(1) ? dark : light;
}

export function applyTheme(id) {
  const theme = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.clean = theme.clean ? '1' : '';
  for (const name of COLOR_VARS) root.style.setProperty(name, theme.vars[name] ?? '');
  root.style.setProperty('--accent-ink', inkOn(theme.vars['--accent']));
  return theme;
}
export function applyStoredTheme(config) { return applyTheme(config.get('ui.theme', 'default')); }
export { COLOR_VARS };

/** 外观效果与主题正交：主题只改颜色变量，效果控制玻璃/发光/背景动画这类质感。 */
export const EFFECTS = [
  { id: 'flat', name: '经典平面', desc: '不透明卡片与工具条，最省性能，极简' },
  { id: 'glass', name: '磨砂玻璃', desc: '半透明组件 + 背景模糊，通透的玻璃质感（默认）' },
  { id: 'aurora', name: '极光流动', desc: '磨砂玻璃之上叠加缓慢流动的极光背景' },
  { id: 'neon', name: '霓虹辉光', desc: '强调色发光边框与文字辉光，赛博风格' },
  { id: 'prism', name: '炫彩紫流光', desc: '紫 / 洋红 / 电蓝三色光带在背景里缓慢流转、变色，磨砂卡片浮在上面' },
];

export function effectById(id) { return EFFECTS.find((effect) => effect.id === id) || EFFECTS[1]; }
export function applyEffect(id) {
  const effect = effectById(id);
  document.documentElement.dataset.effect = effect.id;
  return effect;
}
export function applyStoredEffect(config) { return applyEffect(config.get('ui.effect', 'glass')); }
