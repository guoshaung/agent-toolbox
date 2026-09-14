const TAU = Math.PI * 2;

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Produces a deterministic mock frame for a point on a monotonic timeline.
 * Calling it on every animation frame creates smooth head and mouth motion.
 * Its rotation amplitudes stay within HeadRotation bounds by construction.
 * Confidence is omitted because this mock does not measure tracking quality.
 *
 * @param {number} [timestampMs]
 * @returns {import('./avatar-frame.mjs').AvatarFrame}
 */
export function generateMockAvatarFrame(timestampMs = monotonicNow()) {
  if (!Number.isFinite(timestampMs)) {
    throw new TypeError('timestampMs must be a finite number');
  }

  const seconds = timestampMs / 1000;
  const jawOpen = (Math.sin(seconds * TAU * 0.6) + 1) / 2;

  return {
    blendshapes: {
      jawOpen,
      mouthSmileLeft: 0.12,
      mouthSmileRight: 0.12,
    },
    headRotation: {
      pitch: Math.sin(seconds * 0.7) * 0.1,
      yaw: Math.sin(seconds * 0.45) * 0.3,
      roll: Math.sin(seconds * 0.3) * 0.06,
    },
    detected: true,
    timestampMs,
  };
}

/**
 * @param {() => number} [now]
 * @returns {() => import('./avatar-frame.mjs').AvatarFrame}
 */
export function createMockAvatarFrameGenerator(now = monotonicNow) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  return () => generateMockAvatarFrame(now());
}
