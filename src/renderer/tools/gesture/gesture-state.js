'use strict';

const DEFAULT_OPTIONS = {
  stableFrames: 2,
  graceFrames: 3,
  cooldownFrames: 6,
  snapWindowFrames: 30,
  minConfidence: 0.5,
  holdAfterFrames: 0,
  smoothing: 0.5,
  onEvent: null,
};

export function clamp01(value) { return Math.max(0, Math.min(1, value)); }

export function isSnapTransition(from, to) {
  return from === 'fist' && to === 'open';
}

export function isFistGesture(gesture) { return gesture === 'fist'; }
export function isOpenGesture(gesture) { return gesture === 'open'; }

export class GestureStateMachine {
  constructor(options = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.confirmed = 'none';
    this.confirmedAt = 0;
    this.observer = { gesture: null, frames: 0 };
    this.missingFrames = 0;
    this.lastSnapAt = -Number.MAX_SAFE_INTEGER;
    this.holdNotifiedAt = -Number.MAX_SAFE_INTEGER;
    this.smoothed = null;
  }

  get state() {
    return {
      gesture: this.confirmed,
      frame: this.frame,
      heldFrames: this.confirmed === 'fist' ? this.frame - this.confirmedAt : 0,
      position: this.smoothed ? { x: this.smoothed.x, y: this.smoothed.y } : null,
    };
  }

  update(detection = {}) {
    this.frame += 1;
    const events = [];
    let observed = detection && detection.gesture ? String(detection.gesture) : 'none';
    const confidence = Number(detection && detection.confidence);
    const hasPosition = detection && Number.isFinite(+detection.x) && Number.isFinite(+detection.y);
    const position = hasPosition ? { x: +detection.x, y: +detection.y } : null;
    if (observed === 'none' || !Number.isFinite(confidence) || confidence < this.opts.minConfidence) observed = 'none';

    if (observed !== 'none' && position) {
      if (!this.smoothed) this.smoothed = { x: position.x, y: position.y };
      else {
        const strength = clamp01(this.opts.smoothing);
        this.smoothed.x += (position.x - this.smoothed.x) * strength;
        this.smoothed.y += (position.y - this.smoothed.y) * strength;
      }
    }

    if (observed !== 'none') {
      this.observer = observed === this.observer.gesture
        ? { gesture: observed, frames: this.observer.frames + 1 }
        : { gesture: observed, frames: 1 };
      this.missingFrames = 0;
    } else if (this.confirmed !== 'none') {
      this.missingFrames += 1;
      if (this.missingFrames > this.opts.graceFrames) {
        events.push(this.emit('gesture-change', { from: this.confirmed, to: 'none' }));
        this.confirmed = 'none';
      }
    }

    const candidate = this.observer.gesture;
    if (candidate !== null && candidate !== this.confirmed && this.observer.frames >= this.opts.stableFrames) {
      const from = this.confirmed;
      events.push(this.emit('gesture-change', { from, to: candidate }));
      if (isSnapTransition(from, candidate)) {
        const quick = this.frame - this.confirmedAt <= Math.max(1, this.opts.snapWindowFrames);
        const ready = this.frame - this.lastSnapAt >= this.opts.cooldownFrames;
        if (quick && ready) {
          events.push(this.emit('snap', { position: this.smoothed ? { x: this.smoothed.x, y: this.smoothed.y } : null }));
          this.lastSnapAt = this.frame;
        }
      }
      this.confirmed = candidate;
      this.confirmedAt = this.frame;
    }

    if (this.confirmed === 'fist') {
      const heldFrames = this.frame - this.confirmedAt;
      if (heldFrames >= this.opts.holdAfterFrames && this.holdNotifiedAt < this.confirmedAt) {
        events.push(this.emit('fist-hold', {
          heldFrames,
          position: this.smoothed ? { x: this.smoothed.x, y: this.smoothed.y } : null,
        }));
        this.holdNotifiedAt = this.frame;
      }
    }
    return events;
  }

  emit(type, payload = {}) {
    const event = { type, frame: this.frame, ...payload };
    if (typeof this.opts.onEvent === 'function') this.opts.onEvent(event);
    return event;
  }
}

export { DEFAULT_OPTIONS };