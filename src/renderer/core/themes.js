const COLOR_VARS = ['--bg','--bg-raised','--bg-sunken','--panel','--panel-glass','--line','--line-soft','--line-glow','--text','--text-dim','--text-faint','--accent','--accent-soft','--accent-glow','--accent-secondary','--accent-secondary-soft','--accent-tertiary','--accent-tertiary-soft','--glow-accent','--good','--warn','--bad'];

const current = {
  '--bg':'#0c0e13','--bg-raised':'#141821','--bg-sunken':'#080a0d','--panel':'#1a1f29','--panel-glass':'rgba(26,31,41,.78)','--line':'#2a3040','--line-soft':'#1e232f','--line-glow':'rgba(91,140,255,.22)','--text':'#eef1f7','--text-dim':'#a4adbe','--text-faint':'#6b7485','--accent':'#5b8cff','--accent-soft':'rgba(91,140,255,.14)','--accent-glow':'rgba(91,140,255,.45)','--accent-secondary':'#c084fc','--accent-secondary-soft':'rgba(192,132,252,.14)','--accent-tertiary':'#f472b6','--accent-tertiary-soft':'rgba(244,114,182,.14)','--glow-accent':'0 0 20px rgba(91,140,255,.28)','--good':'#3fb98a','--warn':'#f0a94f','--bad':'#ef6a65'
};

export const THEMES = [
  { id:'default', name:'女仆霓虹', desc:'当前默认风格，深蓝霓虹与女仆装饰', swatches:['#5b8cff','#c084fc','#f472b6'], vars:current },
  { id:'sakura', name:'樱花校园', desc:'二次元樱花粉与奶油白，轻盈柔和', swatches:['#ec5f8c','#a56cc1','#ffb347'], vars:{...current,'--bg':'#faf3f0','--bg-raised':'#fff7f4','--bg-sunken':'#f3e7e3','--panel':'#ffffff','--panel-glass':'rgba(255,255,255,.84)','--line':'#e8d5d0','--line-soft':'#f0e2de','--line-glow':'rgba(236,95,140,.28)','--text':'#4a3b44','--text-dim':'#8a7582','--text-faint':'#b39aa8','--accent':'#ec5f8c','--accent-soft':'rgba(236,95,140,.14)','--accent-glow':'rgba(236,95,140,.4)','--accent-secondary':'#a56cc1','--accent-secondary-soft':'rgba(165,108,193,.14)','--accent-tertiary':'#ffb347','--accent-tertiary-soft':'rgba(255,179,71,.16)','--glow-accent':'0 0 20px rgba(236,95,140,.25)','--good':'#4dbd8f','--warn':'#e6a23c','--bad':'#e2625a'} },
  { id:'violet', name:'极夜紫罗兰', desc:'深夜紫底与青紫光晕，适合长时间工作', swatches:['#a778ff','#5fc8ff','#ff7bd0'], vars:{...current,'--bg':'#0e0a17','--bg-raised':'#171127','--bg-sunken':'#080511','--panel':'#1e1730','--panel-glass':'rgba(30,23,48,.8)','--line':'#2c2242','--line-soft':'#221a36','--line-glow':'rgba(167,121,255,.25)','--text':'#efeafb','--text-dim':'#b3a8cf','--text-faint':'#7a7096','--accent':'#a778ff','--accent-soft':'rgba(167,120,255,.16)','--accent-glow':'rgba(167,120,255,.45)','--accent-secondary':'#5fc8ff','--accent-secondary-soft':'rgba(95,200,255,.15)','--accent-tertiary':'#ff7bd0','--accent-tertiary-soft':'rgba(255,123,208,.15)','--good':'#46c98c','--warn':'#f0a94f','--bad':'#f06a75'} },
  { id:'cyber', name:'赛博绿', desc:'黑底荧光绿，简洁锐利的终端风格', swatches:['#39ff9a','#5ee7ff','#d6ff5e'], vars:{...current,'--bg':'#080d0b','--bg-raised':'#0e1813','--bg-sunken':'#040806','--panel':'#122219','--panel-glass':'rgba(18,34,25,.82)','--line':'#1d3b2a','--line-soft':'#14291e','--line-glow':'rgba(57,255,154,.25)','--text':'#e5fff1','--text-dim':'#9ccbb1','--text-faint':'#609076','--accent':'#39ff9a','--accent-soft':'rgba(57,255,154,.13)','--accent-glow':'rgba(57,255,154,.45)','--accent-secondary':'#5ee7ff','--accent-secondary-soft':'rgba(94,231,255,.14)','--accent-tertiary':'#d6ff5e','--accent-tertiary-soft':'rgba(214,255,94,.14)','--good':'#4deda0','--warn':'#ffd166','--bad':'#ff6978'} }
];

export function themeById(id) { return THEMES.find((theme) => theme.id === id) || THEMES[0]; }
export function applyTheme(id) {
  const theme = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const name of COLOR_VARS) root.style.setProperty(name, theme.vars[name]);
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
];

export function effectById(id) { return EFFECTS.find((effect) => effect.id === id) || EFFECTS[1]; }
export function applyEffect(id) {
  const effect = effectById(id);
  document.documentElement.dataset.effect = effect.id;
  return effect;
}
export function applyStoredEffect(config) { return applyEffect(config.get('ui.effect', 'glass')); }
