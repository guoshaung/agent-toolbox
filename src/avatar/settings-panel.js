'use strict';

const elements = {
  camera: document.getElementById('camera'), refreshCameras: document.getElementById('refresh-cameras'),
  pickModel: document.getElementById('pick-model'), modelName: document.getElementById('model-name'),
  backgroundColor: document.getElementById('background-color'), alwaysOnTop: document.getElementById('always-on-top'),
  frameless: document.getElementById('frameless'), closeWindow: document.getElementById('close-window'),
  toggleSettings: document.getElementById('toggle-settings'),
  status: document.getElementById('status'),
};
let settings;
const rootStyle = [...document.styleSheets[0].cssRules].find((rule) => rule.selectorText === ':root').style;

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}
function modelName(filePath) { return filePath ? filePath.split(/[\\/]/).pop() : '尚未选择'; }
function applySettings(next) {
  settings = next;
  elements.modelName.textContent = modelName(next.modelPath);
  elements.modelName.title = next.modelPath || '';
  elements.backgroundColor.value = next.backgroundColor;
  elements.backgroundColor.disabled = next.backgroundMode !== 'solid';
  elements.alwaysOnTop.checked = next.alwaysOnTop;
  elements.frameless.checked = next.frameless;
  document.querySelector(`input[name="background"][value="${next.backgroundMode}"]`).checked = true;
  rootStyle.setProperty('--stage-background', next.backgroundMode === 'solid' ? next.backgroundColor : 'transparent');
}
async function save(patch, message = '设置已保存') {
  try {
    applySettings(await window.avatar.updateSettings(patch));
    setStatus(message);
  } catch (error) { setStatus(`保存失败：${error.message}`, true); }
}
async function refreshCameras(requestPermission = false) {
  let stream;
  try {
    if (requestPermission) stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    elements.camera.replaceChildren();
    if (!devices.length) {
      elements.camera.add(new Option('未找到摄像头', ''));
      return;
    }
    devices.forEach((device, index) => elements.camera.add(new Option(device.label || `摄像头 ${index + 1}`, device.deviceId)));
    if (settings.cameraId && devices.some((device) => device.deviceId === settings.cameraId)) elements.camera.value = settings.cameraId;
    else if (settings.cameraId) elements.camera.add(new Option('已保存的设备当前不可用', settings.cameraId, true, true));
    setStatus(requestPermission ? '摄像头列表已刷新' : '设置会自动保存');
  } catch (error) { setStatus(`无法读取摄像头：${error.message}`, true); }
  finally { stream?.getTracks().forEach((track) => track.stop()); }
}

elements.camera.addEventListener('change', () => save({ cameraId: elements.camera.value }, '摄像头已保存'));
elements.refreshCameras.addEventListener('click', () => refreshCameras(true));
elements.pickModel.addEventListener('click', async () => {
  const file = await window.avatar.pickModel();
  if (file) save({ modelPath: file.path }, `已选择 ${file.name}`);
});
document.querySelectorAll('input[name="background"]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) save({ backgroundMode: input.value });
}));
elements.backgroundColor.addEventListener('input', () => rootStyle.setProperty('--stage-background', elements.backgroundColor.value));
elements.backgroundColor.addEventListener('change', () => save({ backgroundColor: elements.backgroundColor.value }));
elements.alwaysOnTop.addEventListener('change', () => save({ alwaysOnTop: elements.alwaysOnTop.checked }));
elements.frameless.addEventListener('change', () => save({ frameless: elements.frameless.checked }, '窗口样式已保存'));
elements.closeWindow.addEventListener('click', () => window.avatar.close());
elements.toggleSettings.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('settings-hidden');
  elements.toggleSettings.setAttribute('aria-label', hidden ? '显示设置' : '隐藏设置');
});
window.avatar.onSettingsChanged(applySettings);
window.avatar.getSettings()
  .then((initialSettings) => { applySettings(initialSettings); return refreshCameras(false); })
  .catch((error) => setStatus(`初始化失败：${error.message}`, true));
