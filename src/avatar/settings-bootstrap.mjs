// Keep a readable failure state even if a renderer dependency cannot be imported.
document.getElementById('close-window').addEventListener('click', () => window.avatar?.close());
import('./settings-panel.js').catch((error) => {
  console.error('Avatar output initialization failed', error);
  const status = document.getElementById('status');
  status.textContent = `虚拟形象初始化失败：${error.message}。请重新打开；仍失败时请更新工具箱。`;
  status.classList.add('error');
  const state = document.getElementById('render-state');
  state.textContent = '虚拟形象组件加载失败';
  state.dataset.error = 'true';
  const camera = document.getElementById('camera');
  camera.replaceChildren(new Option('初始化失败', ''));
});
