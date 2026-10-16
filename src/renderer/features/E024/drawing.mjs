export const WIDTH = 640;
export const HEIGHT = 400;
export const MAX_STROKES = 200;
export const MAX_POINTS = 10000;
export const POINTS_PER_STROKE = 400;
export const UNDO_LIMIT = 20;
export const COLORS = Object.freeze(['#182335', '#ce3f46', '#306fd1', '#298351', '#8e49af', '#da872f', '#ffffff']);
export const BRUSHES = Object.freeze([2, 5, 10, 18]);
const point = (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('画笔坐标无效。');
  return Object.freeze({ x: Math.max(0, Math.min(WIDTH, x)), y: Math.max(0, Math.min(HEIGHT, y)) });
};

export class Sketch {
  #strokes = []; #current = null; #undo = []; #points = 0;
  #remember() { this.#undo.push([...this.#strokes]); if (this.#undo.length > UNDO_LIMIT) this.#undo.shift(); }
  begin(x, y, color, width) {
    if (!COLORS.includes(color) || !BRUSHES.includes(width)) throw new RangeError('画笔颜色或粗细无效。');
    if (this.#current || this.#strokes.length >= MAX_STROKES || this.#points >= MAX_POINTS) return false;
    this.#current = { color, width, points: [point(x, y)] }; return true;
  }
  add(x, y) {
    if (!this.#current) return false;
    if (this.#current.points.length >= POINTS_PER_STROKE || this.#points + this.#current.points.length >= MAX_POINTS) return false;
    this.#current.points.push(point(x, y)); return true;
  }
  commit() {
    if (!this.#current) return false;
    this.#remember(); this.#strokes.push(Object.freeze({ ...this.#current, points: Object.freeze([...this.#current.points]) }));
    this.#points += this.#current.points.length; this.#current = null; return true;
  }
  clear() { this.commit(); if (!this.#strokes.length) return false; this.#remember(); this.#strokes = []; this.#points = 0; return true; }
  undo() { this.commit(); if (!this.#undo.length) return false; this.#strokes = this.#undo.pop(); this.#points = this.#strokes.reduce((n, s) => n + s.points.length, 0); return true; }
  view() { return [...this.#strokes, ...(this.#current ? [Object.freeze({ ...this.#current, points: Object.freeze([...this.#current.points]) })] : [])]; }
  stats() { return { strokes: this.#strokes.length, points: this.#points, undo: this.#undo.length, drawing: this.#current !== null }; }
}

export function paint(context, strokes) {
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, WIDTH, HEIGHT);
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineWidth = stroke.width; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(stroke.points[0].x, stroke.points[0].y);
    if (stroke.points.length === 1) { context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2); context.fill(); }
    else { for (const p of stroke.points.slice(1)) context.lineTo(p.x, p.y); context.stroke(); }
  }
}

export function albumSize(rounds) {
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 8) throw new RangeError('画册须有 2–8 轮。');
  const columns = 2; return { columns, width: columns * WIDTH + 60, height: Math.ceil(rounds / columns) * 480 + 90 };
}
