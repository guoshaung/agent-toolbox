'use strict';

/**
 * Calculate a safe destination rectangle for a window gesture. This module is
 * deliberately independent of Electron so it can be used by the main process
 * and tested on every platform.
 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function rectangle(value, name = 'bounds') {
  if (!value || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)
      || value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function computeBounds(gesture, display, options = {}) {
  const area = rectangle(display?.workArea || display, 'workArea');
  if (!area) return null;
  const fullArea = rectangle(display?.bounds) || area;
  const inset = Math.max(0, finite(options.inset) ? options.inset : 0);
  const gap = Math.max(0, finite(options.gap) ? options.gap : 0);
  const minimum = Math.max(1, finite(options.minimumSize) ? options.minimumSize : 120);
  let result;
  switch (String(gesture || '').toLowerCase()) {
    case 'fullscreen':
    case 'full-screen':
      result = fullArea;
      break;
    case 'snap-left':
    case 'left':
      result = { x: area.x, y: area.y, width: (area.width - gap) / 2, height: area.height };
      break;
    case 'snap-right':
    case 'right':
      result = { x: area.x + (area.width + gap) / 2, y: area.y, width: (area.width - gap) / 2, height: area.height };
      break;
    default:
      return null;
  }
  result = { x: result.x + inset, y: result.y + inset, width: result.width - inset * 2, height: result.height - inset * 2 };
  if (!finite(result.x) || !finite(result.y) || result.width < minimum || result.height < minimum) return null;
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Math.round(value)]));
}

function isProtectedWindow(windowInfo, options = {}) {
  if (!windowInfo || typeof windowInfo !== 'object') return true;
  if (options.allowProtected === true) return false;
  if (finite(options.currentPid) && Number(windowInfo.pid) === options.currentPid) return true;
  const identity = [windowInfo.name, windowInfo.bundleId, windowInfo.title, windowInfo.appId]
    .filter((value) => value != null).join(' ').toLowerCase();
  const patterns = options.protectedPatterns || [/agent[\s-_.]?toolbox/i, /com\.openai\.agent-toolbox/i];
  return patterns.some((pattern) => pattern instanceof RegExp ? pattern.test(identity) : identity.includes(String(pattern).toLowerCase()));
}

function canApplyGesture(windowInfo, options = {}) {
  return !isProtectedWindow(windowInfo, options) && Boolean(computeBounds(options.gesture, options.display, options));
}

module.exports = { computeBounds, isProtectedWindow, canApplyGesture };
