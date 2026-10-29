// 三大模式：研读 / 效率 / 极客乐园。
// 一个模式 = 一套可见工具（allow）+ 左栏默认（pinned）+ 签名皮肤/效果 + 几个开关（装饰、动效、桌宠）。
// 工具一个都不删：模式只是「过滤显示 + 换皮肤 + 开关动效」，全部可逆。
// 配色走现成的 applyTheme/applyEffect（颜色是行内注入的，CSS 盖不动）；
// 装饰显隐 / 动效总闸 / 紧凑布局交给 <body data-mode> + styles/modes.css。

export const MODES = [
  {
    id: 'research',
    label: '研读',
    icon: '📖',
    hint: '学术修道院：深蓝墨冷色、零干扰、关动效',
    theme: 'ocean',
    effect: 'flat',
    clean: true,          // 隐藏女仆装饰
    motion: false,        // 关全屏动效 / 过渡
    pet: false,           // 关桌宠 + 视线追踪
    allowAll: false,
    allow: ['docs', 'research', 'notebook', 'notes', 'terms', 'dsh', 'study', 'coach', 'typing', 'history', 'webtools'],
    pinned: ['docs', 'research', 'notebook', 'notes', 'terms', 'dsh'],
  },
  {
    id: 'work',
    label: '效率',
    icon: '⚡',
    hint: '生产力控制台：现代暗黑、紧凑高频',
    theme: 'silver',
    effect: 'flat',
    clean: true,
    motion: false,
    pet: false,
    allowAll: false,
    allow: ['home', 'tasks', 'tidy', 'ask', 'git', 'api', 'netlog', 'vault', 'webtools', 'container', 'aipexbase', 'appgen', 'skills', 'remote', 'controls', 'dsh', 'history', 'feature-lab'],
    pinned: ['home', 'tasks', 'tidy', 'ask', 'git', 'api', 'netlog'],
  },
  {
    id: 'playground',
    label: '乐园',
    icon: '🎮',
    hint: '极客乐园：女仆霓虹、桌宠、全屏动效，工具放飞',
    theme: 'default',
    effect: 'prism',
    clean: false,         // 装饰全开
    motion: true,
    pet: null,            // 不强制：保留用户原来的桌宠开关
    allowAll: true,       // 所有工具都在
    allow: [],
    pinned: ['home', 'ask', 'terms', 'docs', 'controls', 'avatar-rig', 'voice', 'focus'],
  },
];

export const DEFAULT_MODE = 'playground';   // 默认保持现状，切过去才变样

export const MODE_IDS = MODES.map((m) => m.id);

export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES.find((m) => m.id === DEFAULT_MODE);
}

// 某模式下一个工具可不可见。allowAll 的模式（乐园）全放行。
export function toolInMode(mode, toolId) {
  if (!mode || mode.allowAll) return true;
  return mode.allow.includes(toolId);
}

// 模式专属 pinned 的持久化 key。乐园沿用全局旧 key（保住存量用户当前左栏）；其余模式各自独立。
export function pinnedKeyFor(modeId) {
  return modeId === DEFAULT_MODE ? 'ui.pinnedTools' : `ui.mode.${modeId}.pinnedTools`;
}
export function rightPinnedKeyFor(modeId) {
  return modeId === DEFAULT_MODE ? 'ui.rightPinnedTools' : `ui.mode.${modeId}.rightPinnedTools`;
}
