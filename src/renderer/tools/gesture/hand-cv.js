'use strict';

const TAU = Math.PI * 2;

export const GESTURES = Object.freeze({
  NONE: 'none',
  FIST: 'fist',
  OPEN: 'open',
  POINTING: 'pointing',
  SCISSOR: 'scissor',
  UNKNOWN: 'unknown',
});

const SKIN_DEFAULTS = {
  method: 'any', yMin: 40, yMax: 250, cbMin: 77, cbMax: 127, crMin: 133, crMax: 173,
  rgbMin: 95, rgbGreenMin: 40, rgbBlueMin: 20, rgbRedGreenGap: 15, rgbRangeGap: 15,
};

const FINGERTIP_DEFAULTS = {
  bins: 72, smooth: 1, maxRadius: 0, minRadius: 10, minProminence: 12,
  mergeAngleDeg: 28, maxSweepDeg: 35, minSweepDeg: 4, sweepMarginPx: 2,
};

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function ycbcr(r, g, b) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
    cr: 0.5 * r - 0.418688 * g - 0.081312 * b + 128,
  };
}

function rgbSkin(r, g, b, options) {
  return r > options.rgbMin && g > options.rgbGreenMin && b > options.rgbBlueMin
    && r > g && r > b && r - g > options.rgbRedGreenGap
    && Math.max(r, g, b) - Math.min(r, g, b) > options.rgbRangeGap;
}

export function isSkin(r, g, b, options = {}) {
  const o = { ...SKIN_DEFAULTS, ...options };
  r = +r; g = +g; b = +b;
  if (![r, g, b].every(Number.isFinite)) return false;
  const c = ycbcr(r, g, b);
  const yc = c.y >= o.yMin && c.y <= o.yMax && c.cb >= o.cbMin && c.cb <= o.cbMax
    && c.cr >= o.crMin && c.cr <= o.crMax;
  const rgb = rgbSkin(r, g, b, o);
  if (o.method === 'ycbcr') return yc;
  if (o.method === 'rgb') return rgb;
  if (o.method === 'both') return yc && rgb;
  return yc || rgb;
}

export function createSkinMask(pixels, width, height, options = {}) {
  width = Math.max(0, Math.floor(Number(width) || 0));
  height = Math.max(0, Math.floor(Number(height) || 0));
  const count = width * height;
  const channels = options.channels === 3 || options.channels === 4
    ? options.channels : (pixels && pixels.length >= count * 4 ? 4 : 3);
  const data = new Uint8Array(count);
  let detected = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * channels;
    if (isSkin(pixels?.[offset], pixels?.[offset + 1], pixels?.[offset + 2], options)) {
      data[i] = 1;
      detected += 1;
    }
  }
  return { width, height, data, count: detected };
}

export function handRegion(mask, width, height) {
  let count = 0; let sumX = 0; let sumY = 0;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      count += 1; sumX += x; sumY += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!count) return null;
  const boxWidth = maxX - minX + 1; const boxHeight = maxY - minY + 1;
  const cx = sumX / count; const cy = sumY / count;
  return {
    present: true, count, cx, cy, centroid: { x: cx, y: cy },
    bbox: { x: minX, y: minY, width: boxWidth, height: boxHeight },
    area: boxWidth * boxHeight, solidity: count / (boxWidth * boxHeight),
    diagonal: Math.hypot(boxWidth, boxHeight),
  };
}

export function findFingertips(mask, width, height, region, options = {}) {
  if (!region) return { points: [], coreRadius: 0, spreadRatio: 0, profile: [] };
  const o = { ...FINGERTIP_DEFAULTS, ...options };
  const bins = Math.max(8, Math.round(o.bins));
  const maxRadius = Math.max(1, o.maxRadius > 0 ? Math.min(o.maxRadius, region.diagonal) : region.diagonal);
  const furthest = Array.from({ length: bins }, () => ({ dist: -1, x: 0, y: 0 }));
  const histogram = new Uint32Array(Math.ceil(maxRadius) + 2);
  let total = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask[y * width + x]) continue;
    const dist = Math.hypot(x - region.cx, y - region.cy);
    if (dist > maxRadius) continue;
    let bin = Math.round((Math.atan2(y - region.cy, x - region.cx) / TAU) * bins);
    bin = ((bin % bins) + bins) % bins;
    if (dist > furthest[bin].dist) furthest[bin] = { dist, x, y };
    histogram[Math.min(histogram.length - 1, dist | 0)] += 1;
    total += 1;
  }
  if (!total) return { points: [], coreRadius: 0, spreadRatio: 0, profile: [] };

  let coreRadius = 1; let best = -1;
  for (let i = 1; i < histogram.length - 1; i += 1) {
    const value = histogram[i - 1] + 2 * histogram[i] + histogram[i + 1];
    if (value > best) { best = value; coreRadius = i; }
  }
  let beyond = 0;
  for (let i = coreRadius + 1; i < histogram.length; i += 1) beyond += histogram[i];
  const spreadRatio = beyond / total;
  const raw = furthest.map((entry) => entry.dist);
  const radius = Math.max(0, Math.min(bins - 1, Math.round(o.smooth)));
  const profile = raw.map((_, index) => {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += raw[((index + offset) % bins + bins) % bins];
    }
    return sum / (radius * 2 + 1);
  });
  const candidates = [];
  for (let bin = 0; bin < bins; bin += 1) {
    const previous = profile[(bin - 1 + bins) % bins];
    const next = profile[(bin + 1) % bins];
    if (profile[bin] < previous || profile[bin] <= next) continue;
    const prominence = profile[bin] - coreRadius;
    if (profile[bin] < o.minRadius || prominence < o.minProminence) continue;
    // Smoothing flattens a sharp finger peak into a plateau; recover the true
    // direction by picking the raw-maximum bin inside the smoothing window so
    // the reported point comes from the actual farthest (tip) pixel.
    let peakBin = bin;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const nb = ((bin + offset) % bins + bins) % bins;
      if (raw[nb] > raw[peakBin]) peakBin = nb;
    }
    candidates.push({ bin: peakBin, prominence });
  }
  candidates.sort((a, b) => b.prominence - a.prominence);
  const mergeBins = Math.max(1, Math.round(o.mergeAngleDeg * bins / 360));
  const kept = [];
  for (const candidate of candidates) {
    if (kept.some((entry) => Math.min(Math.abs(entry.bin - candidate.bin), bins - Math.abs(entry.bin - candidate.bin)) < mergeBins)) continue;
    kept.push(candidate);
  }
  const points = [];
  for (const peak of kept) {
    if (o.maxSweepDeg > 0) {
      let sweep = 0; const threshold = coreRadius + o.sweepMarginPx;
      for (const sign of [-1, 1]) {
        for (let offset = 1; offset < bins; offset += 1) {
          const index = ((peak.bin + sign * offset) % bins + bins) % bins;
          if (profile[index] <= threshold) break;
          sweep += 1;
        }
      }
      const sweepDeg = (sweep + 1) * 360 / bins;
      if (sweepDeg > o.maxSweepDeg || sweepDeg < o.minSweepDeg) continue;
    }
    const entry = furthest[peak.bin];
    points.push({ x: entry.x, y: entry.y, distance: entry.dist, angle: peak.bin * TAU / bins,
      angleDeg: peak.bin * 360 / bins, prominence: peak.prominence });
  }
  return { points, coreRadius, spreadRatio, profile };
}

export function classifyGesture(region, fingerInfo, options = {}) {
  if (!region) return { gesture: GESTURES.NONE, confidence: 0, reasons: {} };
  const info = Array.isArray(fingerInfo) ? { points: fingerInfo, spreadRatio: 0, coreRadius: 0 } : (fingerInfo || {});
  const points = info.points || []; const count = points.length;
  const spread = Number.isFinite(info.spreadRatio) ? info.spreadRatio : 0;
  const reasons = { fingerCount: count, spreadRatio: spread, coreRadius: info.coreRadius || 0, solidity: region.solidity };
  const openMin = options.openMinFingers ?? 4;
  if (count >= openMin) return { gesture: GESTURES.OPEN, confidence: Math.min(1, 0.5 + count * 0.1), reasons };
  if (count === 1) {
    const ratio = points[0].prominence / Math.max(1, info.coreRadius || 1);
    if (ratio >= (options.pointingMinProminence ?? 0.45)) {
      return { gesture: GESTURES.POINTING, confidence: Math.min(1, 0.5 + ratio * 0.25), reasons };
    }
  }
  if (count === 2) return { gesture: GESTURES.SCISSOR, confidence: 0.7, reasons };
  if (count <= 1 && spread < (options.fistMaxSpread ?? 0.5)) {
    return { gesture: GESTURES.FIST, confidence: clamp01(0.9 - spread * 1.4 - count * 0.08), reasons };
  }
  return { gesture: GESTURES.UNKNOWN, confidence: 0.4, reasons };
}

/** 保留最大连通块，过滤背景中零散的肤色噪点。 */
export function keepLargestComponent(mask, width, height) {
  const out = new Uint8Array(mask.length);
  const seen = new Uint8Array(mask.length);
  let best = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; const cells = []; seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; cells.push(index);
      const x = index % width; const y = (index / width) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const next of neighbors) if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
    }
    if (cells.length > best.length) best = cells;
  }
  for (const index of best) out[index] = 1;
  return out;
}

export function analyzeFrame(input, width, height, options = {}) {
  const frame = input && input.data && input.width && input.height
    ? input : { data: input, width, height };
  const skin = createSkinMask(frame.data, frame.width, frame.height, options);
  const data = keepLargestComponent(skin.data, skin.width, skin.height);
  const mask = { ...skin, data };
  const region = handRegion(mask.data, mask.width, mask.height);
  if (!region) return { present: false, gesture: GESTURES.NONE, confidence: 0, region: null, fingertips: [], fingerInfo: null, mask };
  const fingerInfo = findFingertips(mask.data, mask.width, mask.height, region, options);
  const classification = classifyGesture(region, fingerInfo, options);
  return { present: true, ...classification, region, fingertips: fingerInfo.points, fingerInfo, mask };
}

export { SKIN_DEFAULTS, FINGERTIP_DEFAULTS };
