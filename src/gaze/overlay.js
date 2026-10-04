'use strict';
/** 视线光圈：主进程算好坐标推过来，这里只负责画。整层鼠标穿透。 */
const halo = document.getElementById('halo');
window.toolbox.gaze.onPoint(({ x, y, state, visible }) => {
  if (!visible) { halo.hidden = true; return; }
  halo.hidden = false;
  halo.className = `halo is-${state || 'looking'}`;
  halo.style.transform = `translate(${x}px, ${y}px)`;
});
