import { createAvatarCapture } from './capture.mjs';

const SHAPES = ['jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'browInnerUp'];
const status = document.querySelector('#status');
const fps = document.querySelector('#fps');
const pitch = document.querySelector('#pitch');
const yaw = document.querySelector('#yaw');
const roll = document.querySelector('#roll');
const bars = new Map();
const frameTimes = [];

for (const name of SHAPES) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `<label>${name}</label><div class="track"><div class="fill"></div></div><output>0.000</output>`;
  document.querySelector('#blendshapes').append(row);
  bars.set(name, { fill: row.querySelector('.fill'), output: row.querySelector('output') });
}

function degrees(value) {
  return `${(value * 180 / Math.PI).toFixed(1)}°`;
}

const capture = createAvatarCapture({ smoothingFactor: 0.35 });
capture.subscribe((frame) => {
  const cutoff = frame.timestampMs - 1000;
  frameTimes.push(frame.timestampMs);
  while (frameTimes[0] < cutoff) frameTimes.shift();
  fps.textContent = frameTimes.length > 1
    ? ((frameTimes.length - 1) * 1000 / (frameTimes.at(-1) - frameTimes[0])).toFixed(1)
    : '0.0';

  status.dataset.detected = String(frame.detected);
  status.textContent = frame.detected ? '已检测到人脸' : '未检测到人脸';
  pitch.textContent = degrees(frame.headRotation.pitch);
  yaw.textContent = degrees(frame.headRotation.yaw);
  roll.textContent = degrees(frame.headRotation.roll);

  for (const [name, elements] of bars) {
    const value = frame.blendshapes[name] ?? 0;
    elements.fill.style.width = `${value * 100}%`;
    elements.output.value = value.toFixed(3);
  }
});

await capture.start();
window.addEventListener('pagehide', () => capture.stop(), { once: true });
