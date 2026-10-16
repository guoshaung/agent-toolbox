export const LIMITS = Object.freeze({ width: 160, height: 112, canvasWidth: 800, canvasHeight: 560, maxHeight: 50, damping: 0.985, fixedMs: 1000 / 60, maxFrameSteps: 4, maxDeltaMs: 100, pngBytes: 10 * 1024 * 1024 });
export const PALETTES = Object.freeze({ lagoon: Object.freeze({ name: '青蓝湖面', base: [33, 91, 112], light: [187, 227, 230] }), deep: Object.freeze({ name: '深海暮色', base: [29, 48, 82], light: [146, 184, 224] }), jade: Object.freeze({ name: '浅绿水面', base: [40, 101, 89], light: [191, 230, 206] }) });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function createSurface() {
  let current = new Float32Array(160 * 112), previous = new Float32Array(160 * 112), paused = true, speed = 1, accumulated = 0, steps = 0, inputs = 0, alive = true;
  const live = () => { if (!alive) throw Error('水面已销毁'); };
  function step() {
    for (let y = 1; y < 111; y++) for (let x = 1; x < 159; x++) { const i = y * 160 + x, value = ((current[i - 1] + current[i + 1] + current[i - 160] + current[i + 160]) * 0.5 - previous[i]) * 0.985; previous[i] = clamp(Number.isFinite(value) ? value : 0, -50, 50); }
    [current, previous] = [previous, current]; steps++;
  }
  return {
    get paused() { return paused; }, get steps() { return steps; }, get inputs() { return inputs; }, get speed() { return speed; },
    setPaused(value) { live(); if (typeof value !== 'boolean') throw Error('暂停状态须布尔值'); paused = value; accumulated = 0; },
    setSpeed(value) { live(); if (![1, 0.25].includes(value)) throw Error('速度仅普通1或慢动作0.25'); speed = value; accumulated = 0; },
    inject(x, y, strength) { live(); if (paused) return false; if (!Number.isInteger(x) || x < 0 || x >= 160 || !Number.isInteger(y) || y < 0 || y >= 112 || !Number.isInteger(strength) || strength < 1 || strength > 10) throw Error('落点或强度无效');
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const px = x + dx, py = y + dy, radius2 = dx * dx + dy * dy; if (px < 1 || px > 158 || py < 1 || py > 110 || radius2 > 16) continue; const i = py * 160 + px; current[i] = clamp(current[i] + strength * 4 * Math.exp(-radius2 / 5), -50, 50); } inputs = Math.min(1000000, inputs + 1); return true; },
    tick(deltaMs) { live(); if (!Number.isFinite(deltaMs) || deltaMs < 0) throw Error('帧间隔须有限非负数'); if (paused) return 0; accumulated += Math.min(deltaMs, 100) * speed; let count = 0; while (accumulated + 1e-9 >= LIMITS.fixedMs && count < 4) { step(); accumulated -= LIMITS.fixedMs; count++; } if (count === 4) accumulated = 0; return count; },
    snapshot() { live(); return new Float32Array(current); },
    clear() { live(); current.fill(0); previous.fill(0); accumulated = 0; inputs = 0; },
    dispose() { alive = false; paused = true; accumulated = 0; current.fill(0); previous.fill(0); current = previous = null; }
  };
}
export function renderPixels(field, paletteId = 'lagoon') {
  if (!(field instanceof Float32Array) || field.length !== 160 * 112 || !Object.hasOwn(PALETTES, paletteId)) throw Error('网格或配色无效');
  const palette = PALETTES[paletteId], pixels = new Uint8ClampedArray(field.length * 4);
  for (let y = 0; y < 112; y++) for (let x = 0; x < 160; x++) { const i = y * 160 + x, value = field[i]; if (!Number.isFinite(value) || Math.abs(value) > 50) throw Error('水面高度越界'); const dx = field[y * 160 + Math.max(0, x - 1)] - field[y * 160 + Math.min(159, x + 1)], dy = field[Math.max(0, y - 1) * 160 + x] - field[Math.min(111, y + 1) * 160 + x], light = clamp(0.16 + (1 - y / 112) * 0.08 + dx * 0.07 + dy * 0.095 + value * 0.008, -0.25, 0.85);
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = light >= 0 ? palette.base[c] + (palette.light[c] - palette.base[c]) * light : palette.base[c] * (1 + light); pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
export function pointerPoint(canvas, clientX, clientY) { const rect = canvas.getBoundingClientRect(); if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !rect.width || !rect.height) throw Error('画布坐标不可用'); return [clamp(Math.floor((clientX - rect.left) / rect.width * 160), 0, 159), clamp(Math.floor((clientY - rect.top) / rect.height * 112), 0, 111)]; }
export function pngBlob(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG编码失败')), 'image/png')); }
// Same explicit hash/base64 copy contract as E031; no runtime feature dependency.
export async function binaryPayload(blob, defaultName, { crypto = globalThis.crypto, encode = globalThis.btoa } = {}) {
  if (!blob || blob.type !== 'image/png' || blob.size > LIMITS.pngBytes) throw Error('PNG限10MiB'); const bytes = new Uint8Array(await blob.arrayBuffer()); if (bytes.length !== blob.size || bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) throw Error('PNG字节无效'); const digest = await crypto.subtle.digest('SHA-256', bytes), sha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''); let raw = ''; for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384)); return { copyOnly: true, defaultName, base64: encode(raw), sha256 };
}
