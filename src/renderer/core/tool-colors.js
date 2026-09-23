'use strict';

/**
 * 每个工具一个颜色。
 *
 * 原来整条侧栏是同一个 --text-faint，27 个图标长得一样，每次切换都得读一遍
 * 文字才知道点哪个。按用途分组上色：同一类颜色相近，挨着的不撞色，
 * 扫一眼就能凭颜色定位。
 *
 * 亮度都压在中高段：侧栏底色很暗，太深的颜色在上面看不出区别，
 * 而全部拉满又会变成一条霓虹灯带。
 *
 * 排完以后量过一遍相邻两项的色相差，小于 28° 的都挪开了 —— 第一版
 * 「代码」和「笔记」挨着且都是紫（色相差 15°、RGB 距离 26），等于白分。
 */
export const TOOL_COLORS = {
  // 左栏可见的这 14 个按「相邻色相差 >= 60°」排过，顺序就是侧栏从上到下。
  // 第一版是按语义分组配的，结果「代码 / 笔记」挨着且都是紫（色相差 15°）、
  // 「Voicebox / 快问」都是蓝（8°）—— 分了等于没分。
  tasks:          '#5fd3a0',   // 绿
  voicebox:       '#7aa8ff',   // 蓝
  ask:            '#f0b93d',   // 金
  focus:          '#c9a7ff',   // 紫
  research:       '#3fbf87',   // 青绿
  notebook:       '#ff9a6b',   // 橙
  notes:          '#4fd1e8',   // 青
  video:          '#ef6b8a',   // 洋红
  study:          '#a8d84f',   // 黄绿
  settings:       '#98a2b3',   // 灰（设置就该低调）
  tavern:         '#d9737a',   // 砖红
  pet:            '#5ec8d8',   // 湖蓝
  appearance:     '#e6a5e0',   // 粉紫
  dsh:            '#7ed36b',   // 草绿

  // 下面这些平时收在「更多」里，彼此不相邻，按用途给色就行
  eat:            '#ff9b5c',   // 暖橙，吃饭的颜色
  api:            '#4ecdc4',   // 青绿，收发数据
  netlog:         '#8ab4f8',
  monologue:      '#e08fd0',   // 粉紫，读心思   // 淡蓝，像抓包软件的配色
  git:            '#f0883e',   // git 橙
  docs:           '#4fb3d9',
  terms:          '#43c6c6',
  coach:          '#5ec8a8',
  typing:         '#e879c7',
  skills:         '#f2b33d',
  container:      '#e8a33d',
  tidy:           '#f5b04c',   // 暖橙，像收纳箱
  voice:          '#6ad5c0',
  'digital-human':'#b59cf5',
  controls:       '#8fa3c4',
  gesture:        '#9bd17a',
  dock:           '#7d93b8',
  remote:         '#63c7e8',
  history:        '#a0aec8',
};

const FALLBACK = '#9aa4b5';

export const colorOf = (id) => TOOL_COLORS[id] || FALLBACK;
