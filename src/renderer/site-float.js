const ball = document.getElementById('ball');
const expanded = document.getElementById('expanded');
const siteView = document.getElementById('site-view');
const siteName = document.getElementById('site-name');
const siteIcon = document.getElementById('site-icon');
const modeLabel = document.getElementById('site-mode');
let state = null;
let dragging = false;
let moved = false;
let lastPoint = null;

function render(next) {
  state = { ...state, ...next };
  const site = state.site || {};
  ball.hidden = Boolean(state.expanded);
  expanded.hidden = !state.expanded;
  siteName.textContent = site.name || '科研网站';
  siteIcon.textContent = site.emoji || '🔬';
  document.getElementById('ball-icon').textContent = site.emoji || '🔬';
  modeLabel.textContent = state.mode === 'pc' ? 'PC 端' : '手机端';
  document.body.dataset.mode = state.mode || 'mobile';
  document.getElementById('mobile').classList.toggle('is-active', state.mode !== 'pc');
  document.getElementById('pc').classList.toggle('is-active', state.mode === 'pc');
  if (state.expanded && siteView.getAttribute('src') !== site.url) {
    siteView.setAttribute('src', site.url);
  }
}

function expandBall() {
  if (!moved && state?.id) window.siteFloat.expand(state.id);
}

ball.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !state?.id) return;
  dragging = true;
  moved = false;
  lastPoint = { x: event.clientX, y: event.clientY };
  ball.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
ball.addEventListener('pointermove', (event) => {
  if (!dragging || !lastPoint || !state?.id) return;
  const deltaX = event.clientX - lastPoint.x;
  const deltaY = event.clientY - lastPoint.y;
  if (Math.abs(event.clientX - lastPoint.x) + Math.abs(event.clientY - lastPoint.y) > 4) moved = true;
  lastPoint = { x: event.clientX, y: event.clientY };
  if (moved) window.siteFloat.move(state.id, deltaX, deltaY);
});
ball.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  ball.releasePointerCapture?.(event.pointerId);
  lastPoint = null;
  if (!moved) expandBall();
  setTimeout(() => { moved = false; }, 0);
});
ball.addEventListener('pointercancel', () => { dragging = false; lastPoint = null; moved = false; });
ball.addEventListener('dblclick', expandBall);
document.getElementById('mobile').addEventListener('click', () => state?.id && window.siteFloat.setMode(state.id, 'mobile'));
document.getElementById('pc').addEventListener('click', () => state?.id && window.siteFloat.setMode(state.id, 'pc'));
document.getElementById('back').addEventListener('click', () => state?.id && window.siteFloat.collapse(state.id));
document.getElementById('close').addEventListener('click', () => state?.id && window.siteFloat.close(state.id));
document.getElementById('external').addEventListener('click', () => {
  if (siteView.getURL()) window.siteFloat.openExternal(siteView.getURL());
});
siteView.addEventListener('did-navigate', (event) => { if (state) state.site.url = event.url; });

window.siteFloat.onInit((initial) => render(initial));
window.siteFloat.onState((next) => render(next));
