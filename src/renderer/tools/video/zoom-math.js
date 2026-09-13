/**
 * 视频「智能尺寸 + 缩放」的纯数值逻辑。
 * 不依赖 DOM，便于单测；tools/video/index.js 注入到 B 站页面的脚本共享这些常量与公式。
 */

export const ZOOM_MIN = 0.5;         // 最小缩放：50%
export const ZOOM_MAX = 2;           // 最大缩放：200%
export const ZOOM_STEP = 0.15;       // 每个按键步进：±15%
export const SMART_WIDTH_RATIO = 0.92; // 智能尺寸时播放器铺满窗口宽度的比例
export const MAX_VIEWPORT_RATIO = 1.5; // 缩放后允许超出视口的最大倍数
export const MIN_PLAYER_WIDTH = 220;   // 播放器最小宽度（px）
export const WHEEL_SENSITIVITY = 0.0015; // 滚轮/触控板捏合灵敏度（每像素指数系数）

/** 夹取到合法缩放区间（默认 [ZOOM_MIN, ZOOM_MAX]） */
export function clamp(value, min = ZOOM_MIN, max = ZOOM_MAX) {
  return Math.max(min, Math.min(max, value));
}

/** 步进缩放：direction = +1 放大 / -1 缩小 */
export function zoomStep(scale, direction, step = ZOOM_STEP) {
  return clamp(scale + step * (direction > 0 ? 1 : -1));
}

/** 把不同 deltaMode 的滚轮增量统一成像素 */
export function wheelDeltaPixels(deltaY, deltaMode) {
  if (deltaMode === 1) return deltaY * 33;   // DOM_DELTA_LINE
  if (deltaMode === 2) return deltaY * 800;  // DOM_DELTA_PAGE
  return deltaY;                             // DOM_DELTA_PIXEL
}

/** 一次滚轮/捏合事件的缩放系数（>1 放大，<1 缩小，=1 不变） */
export function wheelZoomFactor(deltaY, deltaMode = 0, sensitivity = WHEEL_SENSITIVITY) {
  return Math.exp(-wheelDeltaPixels(deltaY, deltaMode) * sensitivity);
}

/** 只有 Ctrl/Cmd+滚轮或触控板捏合才进入缩放，普通上下滚动留给页面。 */
export function isZoomGesture({ ctrlKey = false, metaKey = false } = {}) {
  return Boolean(ctrlKey || metaKey);
}

/** 应用一个缩放系数并夹取到合法区间 */
export function applyZoom(scale, factor) {
  return clamp(scale * factor);
}

/** 智能尺寸基准宽度 = 窗口宽度 × SMART_WIDTH_RATIO */
export function smartBaseWidth(viewportWidth, ratio = SMART_WIDTH_RATIO) {
  return Math.max(1, Math.round(viewportWidth * ratio));
}

/**
 * 最终播放器宽度：
 * - 智能尺寸开启：以窗口宽 × SMART_WIDTH_RATIO 为基准再乘缩放；
 * - 关闭：以播放器原始宽度为基准乘缩放。
 * 结果夹在 [minWidth, max(natural×ZOOM_MAX, viewport×MAX_VIEWPORT_RATIO)] 内。
 */
export function playerWidth({
  naturalWidth,
  viewportWidth,
  scale,
  smart,
  minWidth = MIN_PLAYER_WIDTH,
  maxViewportRatio = MAX_VIEWPORT_RATIO,
}) {
  const base = smart ? smartBaseWidth(viewportWidth) : naturalWidth;
  const wanted = base * scale;
  const max = Math.max(naturalWidth * ZOOM_MAX, viewportWidth * maxViewportRatio);
  return Math.max(minWidth, Math.min(max, Math.round(wanted)));
}

/** 按播放器原始宽高比由宽度推高度；未知宽高比时按 16:9 兜底 */
export function playerHeight(width, naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return Math.round((width / 16) * 9);
  return Math.round((width * naturalHeight) / naturalWidth);
}

/** 缩放比例的百分比文案，如 1 → "100%" */
export function formatPercent(scale) {
  return `${Math.round(scale * 100)}%`;
}
