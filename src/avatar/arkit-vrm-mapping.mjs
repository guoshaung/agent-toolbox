/** ARKit/MediaPipe blendshape names to VRM expression presets. */
export const ARKIT_TO_VRM_EXPRESSIONS = Object.freeze({
  jawOpen: [{ name: 'aa', weight: 1 }],
  mouthSmileLeft: [{ name: 'happy', weight: 0.5 }],
  mouthSmileRight: [{ name: 'happy', weight: 0.5 }],
  eyeBlinkLeft: [{ name: 'blinkLeft', weight: 1 }],
  eyeBlinkRight: [{ name: 'blinkRight', weight: 1 }],
  mouthFunnel: [{ name: 'ou', weight: 1 }],
  mouthPucker: [{ name: 'ou', weight: 1 }],
  browDownLeft: [{ name: 'angry', weight: 0.5 }],
  browDownRight: [{ name: 'angry', weight: 0.5 }],
  browInnerUp: [{ name: 'surprised', weight: 0.35 }],
  eyeWideLeft: [{ name: 'surprised', weight: 0.35 }],
  eyeWideRight: [{ name: 'surprised', weight: 0.35 }],
});
export const VRM_EXPRESSION_NAMES = Object.freeze(
  [...new Set(Object.values(ARKIT_TO_VRM_EXPRESSIONS).flat().map(({ name }) => name))],
);
