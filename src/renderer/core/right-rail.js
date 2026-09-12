/**
 * 右侧收藏栏的纯分配逻辑：左侧固定栏满员后，收藏溢出到右侧栏。
 * 不依赖 DOM，便于单测；app.js 只负责渲染和交互。
 */

export const LEFT_MAX = 7;
export const RIGHT_MAX = 7;

/** 清洗一组 id：只保留可收藏工具、去重、截断到上限。 */
export function sanitize(ids, eligible, max) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (out.length >= max) break;
    if (!eligible.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 点击星标后的状态转移。
 * 返回 { left, right, overflow }；overflow=true 表示左侧已满、需要询问是否固定到右侧栏。
 */
export function togglePinned({ left, right }, id, eligible, leftMax = LEFT_MAX, rightMax = RIGHT_MAX) {
  const safeLeft = sanitize(left, eligible, leftMax);
  const safeRight = sanitize(right, eligible, rightMax);
  if (safeLeft.includes(id)) return { left: safeLeft.filter((item) => item !== id), right: safeRight, overflow: false };
  if (safeRight.includes(id)) return { left: safeLeft, right: safeRight.filter((item) => item !== id), overflow: false };
  if (safeLeft.length < leftMax) return { left: [...safeLeft, id], right: safeRight, overflow: false };
  return { left: safeLeft, right: safeRight, overflow: true };
}

/** 左侧已满、用户确认后把 id 固定到右侧栏。返回 { left, right, full }。 */
export function addToRight({ left, right }, id, eligible, leftMax = LEFT_MAX, rightMax = RIGHT_MAX) {
  const safeRight = sanitize(right, eligible, rightMax);
  if (safeRight.length >= rightMax) return { left, right: safeRight, full: true };
  return { left, right: [...safeRight, id], full: false };
}

/** 从任意栏移除收藏。 */
export function removePinned({ left, right }, id) {
  return { left: (left || []).filter((item) => item !== id), right: (right || []).filter((item) => item !== id) };
}
