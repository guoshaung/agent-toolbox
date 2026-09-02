const divider = document.getElementById('divider');
let lastMoveAt = 0;

divider.addEventListener('pointerdown', (event) => {
  divider.setPointerCapture(event.pointerId);
  divider.classList.add('is-dragging');
});

divider.addEventListener('pointermove', (event) => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const now = performance.now();
  if (now - lastMoveAt < 24) return;
  lastMoveAt = now;
  window.dockDivider.move(event.screenX);
});

function finish(event) {
  if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  divider.classList.remove('is-dragging');
  window.dockDivider.end();
}

divider.addEventListener('pointerup', finish);
divider.addEventListener('pointercancel', finish);
divider.addEventListener('dblclick', () => window.dockDivider.detach());
