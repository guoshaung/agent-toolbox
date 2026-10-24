/** Runs inside the DeepSeek webview. No site class names or Node APIs are needed. */
export const ASK_READER_AGENT = String.raw`
(() => {
  if (window.__tbxReader?.version === 1) return;

  const state = { enabled: false, speed: 0.7, scroller: null, top: 0, userUntil: 0, animating: false, frame: 0, lastKey: 0 };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 180 && rect.height > 180 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const findScroller = () => {
    const candidates = [...document.querySelectorAll('*')].filter((el) => {
      if (!visible(el) || el.scrollHeight <= el.clientHeight + 20) return false;
      const overflow = getComputedStyle(el).overflowY;
      return overflow === 'auto' || overflow === 'scroll';
    });
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const score = (r) => r.width * r.height * (r.right > innerWidth * 0.55 ? 1 : 0.2);
      return score(rb) - score(ra);
    });
    return candidates[0] || document.scrollingElement;
  };
  const maxTop = (el) => Math.max(0, el.scrollHeight - el.clientHeight);
  const observer = new MutationObserver(() => {
    if (!state.enabled || state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      const el = bindScroller();
      if (el && !state.animating && Date.now() >= state.userUntil) {
        state.top = clamp(state.top, 0, maxTop(el));
        if (Math.abs(el.scrollTop - state.top) > 2) el.scrollTop = state.top;
      }
    });
  });
  function bindScroller() {
    if (state.scroller?.isConnected && state.scroller !== document.scrollingElement && state.scroller.scrollHeight > state.scroller.clientHeight + 20) return state.scroller;
    const el = findScroller();
    if (el !== state.scroller) {
      state.scroller = el;
      state.top = el?.scrollTop || 0;
      observer.disconnect();
      if (state.enabled && el) observer.observe(el, { subtree: true, childList: true, characterData: true });
    }
    return el;
  }
  const markManual = () => { state.userUntil = Date.now() + 260; };
  document.addEventListener('wheel', markManual, true);
  document.addEventListener('touchstart', markManual, true);
  document.addEventListener('pointerdown', markManual, true);
  document.addEventListener('scroll', (event) => {
    if (!state.enabled || !state.scroller) return;
    if (event.target !== state.scroller && !(state.scroller === document.scrollingElement && event.target === document)) return;
    const el = state.scroller;
    if (state.animating || Date.now() < state.userUntil) {
      state.top = el.scrollTop;
    } else if (Math.abs(el.scrollTop - state.top) > 2) {
      el.scrollTop = clamp(state.top, 0, maxTop(el));
    }
  }, true);

  function page(direction) {
    const el = bindScroller();
    if (!el) return false;
    cancelAnimationFrame(state.frame);
    const start = el.scrollTop;
    const target = clamp(start + direction * Math.max(160, el.clientHeight * state.speed), 0, maxTop(el));
    const started = performance.now();
    state.animating = true;
    const move = (now) => {
      const fraction = clamp((now - started) / 240, 0, 1);
      const eased = 1 - Math.pow(1 - fraction, 3);
      state.top = start + (target - start) * eased;
      el.scrollTop = state.top;
      if (fraction < 1 && state.enabled) state.frame = requestAnimationFrame(move);
      else { state.animating = false; state.frame = 0; state.top = el.scrollTop; }
    };
    state.frame = requestAnimationFrame(move);
    return true;
  }
  const editing = (node) => node?.closest?.('input, textarea, [contenteditable="true"], [role="textbox"]') || node?.isContentEditable;
  window.addEventListener('keydown', (event) => {
    if (!state.enabled || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (editing(event.target) || editing(document.activeElement)) return;
    const key = event.key.toLowerCase();
    if (key !== 'j' && key !== 'k') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const now = performance.now();
    if (now - state.lastKey < 190) return;
    state.lastKey = now;
    page(key === 'j' ? 1 : -1);
  }, true);

  window.__tbxReader = {
    version: 1,
    setEnabled(value) {
      state.enabled = Boolean(value);
      if (!state.enabled) { observer.disconnect(); cancelAnimationFrame(state.frame); state.frame = 0; state.animating = false; }
      else bindScroller();
      return state.enabled;
    },
    setSpeed(value) { state.speed = clamp(Number(value) || 0.7, 0.4, 1.1); return state.speed; },
    page,
    snapshot() { return { enabled: state.enabled, speed: state.speed, top: state.scroller?.scrollTop || 0, desiredTop: state.top, scrollHeight: state.scroller?.scrollHeight || 0, clientHeight: state.scroller?.clientHeight || 0 }; },
  };
})();
`;
