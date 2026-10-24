(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToolboxInk = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  function pressure(value, gamma = 1) { return .18 + .82 * Math.pow(clamp(Number.isFinite(value) ? value : .5, 0, 1), clamp(gamma, .35, 2.5)); }
  function smooth(points, amount = .35) {
    if (points.length < 2) return points.map(p => p.slice());
    const result = [points[0].slice()]; let previous = result[0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i], distance = Math.hypot(p[0] - previous[0], p[1] - previous[1]);
      const a = clamp(1 - clamp(amount, 0, .85) * Math.exp(-distance / 7), .15, 1);
      const next = [previous[0] + a * (p[0] - previous[0]), previous[1] + a * (p[1] - previous[1]), previous[2] + .45 * (p[2] - previous[2])];
      if (i === points.length - 1) { next[0] = p[0]; next[1] = p[1]; }
      result.push(next); previous = next;
    }
    return result;
  }
  function ribbon(points, width, gamma = 1, amount = .35) {
    const source = smooth(points, amount), centers = [];
    if (source.length < 3) centers.push(...source);
    else {
      centers.push(source[0]);
      for (let i = 1; i < source.length - 1; i++) {
        const a = source[i - 1], b = source[i], c = source[i + 1];
        const start = i === 1 ? a : a.map((v, k) => (v + b[k]) / 2), end = b.map((v, k) => (v + c[k]) / 2);
        const steps = clamp(Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 3), 2, 12);
        for (let j = 1; j <= steps; j++) { const t = j / steps; centers.push(start.map((v, k) => (1 - t) ** 2 * v + 2 * (1 - t) * t * b[k] + t ** 2 * end[k])); }
      }
      centers.push(source[source.length - 1]);
    }
    const left = [], right = [];
    for (let i = 0; i < centers.length; i++) {
      const p = centers[i], a = centers[Math.max(0, i - 1)], b = centers[Math.min(centers.length - 1, i + 1)];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, radius = width * pressure(p[2], gamma) / 2;
      const nx = -(b[1] - a[1]) / length * radius, ny = (b[0] - a[0]) / length * radius;
      left.push([p[0] + nx, p[1] + ny]); right.push([p[0] - nx, p[1] - ny]);
    }
    return { centers, outline: left.concat(right.reverse()) };
  }
  class InputGuard {
    constructor({ pencilOnly = true, cooldown = 650 } = {}) { this.pencilOnly = pencilOnly; this.cooldown = cooldown; this.pen = null; this.lastPen = -Infinity; this.touches = new Set(); this.blocked = new Set(); }
    begin(e, now) {
      if (e.pointerType === 'pen') { this.pen = e.pointerId; this.lastPen = now; for (const id of this.touches) this.blocked.add(id); this.touches.clear(); return 'pen'; }
      if (e.pointerType !== 'touch') return this.pen !== null ? 'ignore' : 'mouse';
      if (this.pen !== null || now - this.lastPen < this.cooldown || Math.max(e.width || 0, e.height || 0) > 28) { this.blocked.add(e.pointerId); return 'ignore'; }
      this.touches.add(e.pointerId);
      if (this.touches.size > 2) { for (const id of this.touches) this.blocked.add(id); return 'ignore'; }
      if (this.blocked.size) return 'ignore';
      if (this.touches.size === 2) return 'gesture';
      return this.pencilOnly ? 'navigation' : 'touch';
    }
    end(e, now) { this.touches.delete(e.pointerId); this.blocked.delete(e.pointerId); if (e.pointerId === this.pen) { this.pen = null; this.lastPen = now; } }
    reset(now) { this.pen = null; this.touches.clear(); this.blocked.clear(); this.lastPen = now; }
  }
  return { pressure, smooth, ribbon, InputGuard };
});
