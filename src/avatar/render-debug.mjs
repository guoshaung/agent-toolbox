import { createAvatarRenderer } from './render.mjs';
import { generateMockAvatarFrame } from './mock-avatar-frame.mjs';

const canvas = document.querySelector('#avatar');
const state = document.querySelector('#state');
const fps = document.querySelector('#fps');
const modelUrl = new URLSearchParams(location.search).get('model');
const frameTimes = [];

const mockFrameSource = {
  subscribe(listener) {
    let request = null;
    const tick = (timestampMs) => {
      listener(generateMockAvatarFrame(timestampMs));
      frameTimes.push(timestampMs);
      const cutoff = timestampMs - 1000;
      while (frameTimes[0] < cutoff) frameTimes.shift();
      if (frameTimes.length > 1) {
        fps.textContent = ((frameTimes.length - 1) * 1000 / (frameTimes.at(-1) - frameTimes[0])).toFixed(1);
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  },
};

if (!modelUrl) {
  state.dataset.error = 'true';
  state.textContent = 'Missing ?model=<VRM URL>';
  throw new Error('A VRM model URL is required');
}

const avatarRenderer = createAvatarRenderer({ canvas, modelUrl, frameSource: mockFrameSource });
window.renderDebugReady = avatarRenderer.ready.then(() => {
  state.dataset.ready = 'true';
  state.textContent = 'VRM ready';
}).catch((error) => {
  state.dataset.error = 'true';
  state.textContent = `Load failed: ${error.message}`;
  throw error;
});

window.recordMockDemo = async (durationMs = 5000) => {
  await window.renderDebugReady;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
  recorder.start(250);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: recorder.mimeType });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
};

window.addEventListener('pagehide', () => avatarRenderer.dispose(), { once: true });
