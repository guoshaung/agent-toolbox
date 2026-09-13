const clamp01 = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const average = (...values) => values.reduce((sum, value) => sum + clamp01(value), 0) / values.length;
const maximum = (...values) => Math.max(...values.map(clamp01));

function dominantVowel(blendshapes) {
  // ARKit has no vowel labels. These features compress its detailed lip/jaw
  // controls into the five mutually competing VRM mouth presets:
  // - jawOpen and lip lift/lower drive an open "aa";
  // - funnel plus an open jaw forms "oh";
  // - pucker or a nearly closed funnel forms "ou";
  // - horizontal stretch/smile separates the wide "ee" and milder "ih".
  // Closing, rolling, and pressing the lips suppress every vowel. Selecting
  // only the strongest score avoids stacking incompatible vowel morphs.
  const closure = maximum(
    blendshapes.mouthClose,
    average(blendshapes.mouthRollLower, blendshapes.mouthRollUpper),
    average(blendshapes.mouthPressLeft, blendshapes.mouthPressRight),
  );
  const open = clamp01(blendshapes.jawOpen) * (1 - closure * 0.8);
  const funnel = clamp01(blendshapes.mouthFunnel);
  const pucker = clamp01(blendshapes.mouthPucker);
  const round = maximum(funnel, pucker);
  const wide = maximum(
    average(blendshapes.mouthStretchLeft, blendshapes.mouthStretchRight),
    average(blendshapes.mouthSmileLeft, blendshapes.mouthSmileRight) * 0.55,
  );
  const lipOpening = average(
    blendshapes.mouthLowerDownLeft,
    blendshapes.mouthLowerDownRight,
    blendshapes.mouthUpperUpLeft,
    blendshapes.mouthUpperUpRight,
  );
  const scores = {
    aa: maximum(open, lipOpening * 0.55) * (1 - round * 0.7) * (1 - wide * 0.35),
    oh: maximum(funnel * (0.35 + open * 0.65), open * round * 0.75),
    ou: maximum(pucker * (1 - open * 0.35), funnel * (1 - open) * 0.65),
    ee: wide * (0.25 + open * 0.75) * (1 - round * 0.75),
    ih: wide * (1 - open * 0.55) * (1 - round * 0.6) * 0.75,
  };

  const [name, weight] = Object.entries(scores).reduce(
    (best, candidate) => candidate[1] > best[1] ? candidate : best,
    ['aa', 0],
  );
  return weight >= 0.02 ? { [name]: clamp01(weight) } : {};
}

/**
 * Collapses MediaPipe's 52 ARKit-compatible blendshapes into the small VRM
 * preset vocabulary. Paired inputs are averaged so a one-sided twitch does
 * not fully trigger a whole-face emotion; directional eye and blink signals
 * remain directional when VRM provides the corresponding presets.
 *
 * @param {Readonly<Record<string, number>>} blendshapes
 * @returns {Readonly<Record<string, number>>}
 */
export function collapseArkitBlendshapes(blendshapes = {}) {
  const smile = average(blendshapes.mouthSmileLeft, blendshapes.mouthSmileRight);
  const dimple = average(blendshapes.mouthDimpleLeft, blendshapes.mouthDimpleRight);
  const cheekSquint = average(blendshapes.cheekSquintLeft, blendshapes.cheekSquintRight);
  const frown = average(blendshapes.mouthFrownLeft, blendshapes.mouthFrownRight);
  const browDown = average(blendshapes.browDownLeft, blendshapes.browDownRight);
  const noseSneer = average(blendshapes.noseSneerLeft, blendshapes.noseSneerRight);
  const press = average(blendshapes.mouthPressLeft, blendshapes.mouthPressRight);
  const eyeWide = average(blendshapes.eyeWideLeft, blendshapes.eyeWideRight);
  const browOuterUp = average(blendshapes.browOuterUpLeft, blendshapes.browOuterUpRight);

  const weights = {
    ...dominantVowel(blendshapes),
    blinkLeft: clamp01(blendshapes.eyeBlinkLeft),
    blinkRight: clamp01(blendshapes.eyeBlinkRight),
    happy: clamp01(maximum(smile, dimple * 0.7) + cheekSquint * 0.2),
    angry: clamp01(browDown * 0.65 + maximum(noseSneer, press) * 0.35),
    sad: clamp01(frown * 0.75 + clamp01(blendshapes.browInnerUp) * 0.25),
    surprised: clamp01(maximum(eyeWide, browOuterUp) * 0.7 + clamp01(blendshapes.jawOpen) * 0.3),
    relaxed: clamp01(average(blendshapes.mouthShrugLower, blendshapes.mouthShrugUpper) * 0.35),
    lookLeft: average(blendshapes.eyeLookOutLeft, blendshapes.eyeLookInRight),
    lookRight: average(blendshapes.eyeLookInLeft, blendshapes.eyeLookOutRight),
    lookUp: average(blendshapes.eyeLookUpLeft, blendshapes.eyeLookUpRight),
    lookDown: average(blendshapes.eyeLookDownLeft, blendshapes.eyeLookDownRight),
  };

  return Object.fromEntries(Object.entries(weights).filter(([, weight]) => weight > 0));
}
