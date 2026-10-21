'use strict';

import { createAvatarRenderer } from './render.mjs';
import { createAvatarCapture } from './capture.mjs';

const elements = {
  camera: document.getElementById('camera'), refreshCameras: document.getElementById('refresh-cameras'),
  pickModel: document.getElementById('pick-model'), modelName: document.getElementById('model-name'),
  recentModels: document.getElementById('recent-models'),
  backgroundColor: document.getElementById('background-color'), alwaysOnTop: document.getElementById('always-on-top'),
  frameless: document.getElementById('frameless'), closeWindow: document.getElementById('close-window'),
  toggleSettings: document.getElementById('toggle-settings'),
  status: document.getElementById('status'),
  canvas: document.getElementById('avatar-canvas'), renderState: document.getElementById('render-state'),
  fps: document.getElementById('fps'),
};
let settings;
const rootStyle = [...document.styleSheets[0].cssRules].find((rule) => rule.selectorText === ':root').style;
const frameTimes = [];
const avatarRenderer = createAvatarRenderer({ canvas: elements.canvas });
let loadedModelPath = '';
let avatarCapture = null;
let unsubscribeCapture = null;
let libraryModels = [];
let selectingModel = false;
let modelLoadSequence = 0;

function renderLibrary() {
  const host = document.getElementById('model-library');
  host.replaceChildren();
  for (const model of libraryModels) {
    const selected = settings?.modelPath === model.path;
    const card = document.createElement('button');
    card.className = 'model-card';
    card.type = 'button';
    card.disabled = selectingModel;
    card.setAttribute('aria-pressed', String(selected));
    card.title = `${model.name} · ${model.author} · ${model.license}`;
    const image = document.createElement('img');
    image.src = new URL(`../../assets/avatar-model-thumbnails/${model.thumbnail}`, import.meta.url).href;
    image.alt = model.name;
    const title = document.createElement('strong'); title.textContent = model.name;
    const hint = document.createElement('small');
    hint.textContent = selected ? '使用中' : (model.ready ? '点击使用' : `下载使用 · ${Math.ceil(model.bytes / 1024 / 1024)} MB`);
    card.append(image, title, hint);
    card.addEventListener('click', async () => {
      if (selectingModel || selected) return;
      selectingModel = true;
      elements.pickModel.disabled = true;
      elements.recentModels.disabled = true;
      renderLibrary();
      setStatus(model.ready ? `正在切换到 ${model.name}…` : `正在下载 ${model.name}，请稍候…`);
      try {
        applySettings(await window.avatar.selectModel(model.id));
        model.ready = true;
        setStatus(`已选择 ${model.name}`);
      } catch (error) { setStatus(`切换失败：${error.message}`, true); }
      finally { selectingModel = false; elements.pickModel.disabled = false; elements.recentModels.disabled = false; renderLibrary(); }
    });
    host.append(card);
  }
}

function stopCapture() {
  unsubscribeCapture?.();
  avatarCapture?.stop();
  unsubscribeCapture = null;
  avatarCapture = null;
  frameTimes.length = 0;
  elements.fps.textContent = '0.0';
}

async function restartCapture() {
  stopCapture();
  const capture = createAvatarCapture({
    mediaStreamConstraints: {
      audio: false,
      video: settings.cameraId ? { deviceId: { exact: settings.cameraId } } : { facingMode: 'user' },
    },
  });
  avatarCapture = capture;
  unsubscribeCapture = capture.subscribe((frame) => {
    if (avatarCapture !== capture) return;
    avatarRenderer.renderFrame(frame);
    frameTimes.push(frame.timestampMs);
    const cutoff = frame.timestampMs - 1000;
    while (frameTimes[0] < cutoff) frameTimes.shift();
    if (frameTimes.length > 1) {
      elements.fps.textContent = ((frameTimes.length - 1) * 1000 / (frameTimes.at(-1) - frameTimes[0])).toFixed(1);
    }
    if (loadedModelPath) {
      elements.renderState.textContent = frame.detected
        ? 'VRM 已加载 · 摄像头驱动中'
        : 'VRM 已加载 · 等待面部追踪';
    }
  });
  await capture.start();
}

async function loadConfiguredModel() {
  const sequence = ++modelLoadSequence;
  const modelPath = settings.modelPath;
  if (!settings.modelPath) {
    loadedModelPath = '';
    elements.renderState.textContent = '等待选择 VRM 模型';
    return;
  }
  if (settings.modelPath === loadedModelPath) return;
  elements.renderState.dataset.error = 'false';
  elements.renderState.textContent = '正在加载 VRM…';
  try {
    const modelUrl = await window.avatar.getModelUrl();
    if (!modelUrl) throw new Error('配置的模型不是 .vrm 文件');
    await avatarRenderer.loadModel(modelUrl, { relaxedArms: libraryModels.some((model) => model.path === modelPath) });
    if (sequence !== modelLoadSequence) return;
    loadedModelPath = modelPath;
    elements.renderState.textContent = 'VRM 已加载 · 等待面部追踪';
  } catch (error) {
    if (sequence !== modelLoadSequence) return;
    elements.renderState.dataset.error = 'true';
    elements.renderState.textContent = `加载失败：${error.message}`;
    throw error;
  }
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}
function modelName(filePath) { return filePath ? filePath.split(/[\\/]/).pop() : '尚未选择'; }
function applySettings(next) {
  const cameraChanged = !settings || settings.cameraId !== next.cameraId;
  const modelChanged = !settings || settings.modelPath !== next.modelPath;
  settings = next;
  elements.modelName.textContent = libraryModels.find((model) => model.path === next.modelPath)?.name || modelName(next.modelPath);
  elements.modelName.title = next.modelPath || '';
  elements.recentModels.replaceChildren(new Option('最近用过的皮套…', ''));
  for (const filePath of next.recentModelPaths || []) {
    const name = libraryModels.find((model) => model.path === filePath)?.name || `${modelName(filePath)} · ${filePath.split(/[\\/]/).at(-2) || ''}`;
    elements.recentModels.add(new Option(name, filePath));
  }
  elements.recentModels.value = next.modelPath;
  elements.backgroundColor.value = next.backgroundColor;
  elements.backgroundColor.disabled = next.backgroundMode !== 'solid';
  elements.alwaysOnTop.checked = next.alwaysOnTop;
  elements.frameless.checked = next.frameless;
  document.querySelector(`input[name="background"][value="${next.backgroundMode}"]`).checked = true;
  rootStyle.setProperty('--stage-background', next.backgroundMode === 'solid' ? next.backgroundColor : 'transparent');
  if (modelChanged) loadConfiguredModel().catch((error) => setStatus(`模型加载失败：${error.message}`, true));
  renderLibrary();
  if (cameraChanged) restartCapture().catch((error) => setStatus(`摄像头启动失败：${error.message}`, true));
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
elements.recentModels.addEventListener('change', () => {
  if (elements.recentModels.value) save({ modelPath: elements.recentModels.value }, '已切换皮套');
});
document.querySelectorAll('input[name="background"]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) save({ backgroundMode: input.value });
}));
elements.backgroundColor.addEventListener('input', () => rootStyle.setProperty('--stage-background', elements.backgroundColor.value));
elements.backgroundColor.addEventListener('change', () => save({ backgroundColor: elements.backgroundColor.value }));
elements.alwaysOnTop.addEventListener('change', () => save({ alwaysOnTop: elements.alwaysOnTop.checked }));
elements.frameless.addEventListener('change', () => save({ frameless: elements.frameless.checked }, '窗口样式已保存'));
elements.toggleSettings.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('settings-hidden');
  elements.toggleSettings.setAttribute('aria-label', hidden ? '显示设置' : '隐藏设置');
});
window.avatar.onSettingsChanged(applySettings);
window.avatar.getSettings()
  .then(async (initialSettings) => {
    try { libraryModels = await window.avatar.listModels(); }
    catch (error) { document.getElementById('model-library').textContent = `皮套库读取失败：${error.message}`; }
    applySettings(initialSettings);
    return refreshCameras(false);
  })
  .catch((error) => setStatus(`初始化失败：${error.message}`, true));
window.addEventListener('pagehide', () => {
  stopCapture();
  avatarRenderer.dispose();
}, { once: true });
