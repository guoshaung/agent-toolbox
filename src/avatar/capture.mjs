import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const DEFAULT_SMOOTHING_FACTOR = 0.35;
const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DEFAULT_WASM_PATH = new URL(
  '../../node_modules/@mediapipe/tasks-vision/wasm/',
  import.meta.url,
).href.replace(/\/$/, '');
const ZERO_ROTATION = Object.freeze({ pitch: 0, yaw: 0, roll: 0 });

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function smoothAngle(previous, current, factor) {
  return normalizeAngle(previous + normalizeAngle(current - previous) * factor);
}

/**
 * MediaPipe returns the transform in the same column-major convention used by
 * WebGL and Three.js. Normalizing its basis columns removes any fitted scale
 * before applying Three.js' YXZ Euler decomposition.
 *
 * @param {{ rows?: number, columns?: number, data?: number[] }} matrix
 * @returns {import('./avatar-frame.mjs').HeadRotation | null}
 */
export function headRotationFromMatrix(matrix) {
  const data = matrix?.data;
  if (matrix?.rows !== 4 || matrix?.columns !== 4 || data?.length < 16) return null;
  if (!data.every(Number.isFinite)) return null;

  const scaleX = Math.hypot(data[0], data[1], data[2]);
  const scaleY = Math.hypot(data[4], data[5], data[6]);
  const scaleZ = Math.hypot(data[8], data[9], data[10]);
  if (scaleX === 0 || scaleY === 0 || scaleZ === 0) return null;

  const m11 = data[0] / scaleX;
  const m13 = data[8] / scaleZ;
  const m21 = data[1] / scaleX;
  const m22 = data[5] / scaleY;
  const m23 = data[9] / scaleZ;
  const m31 = data[2] / scaleX;
  const m33 = data[10] / scaleZ;

  const pitch = Math.asin(-clamp(m23, -1, 1));
  let yaw;
  let roll;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m13, m33);
    roll = Math.atan2(m21, m22);
  } else {
    yaw = Math.atan2(-m31, m11);
    roll = 0;
  }

  if (![pitch, yaw, roll].every(Number.isFinite)) return null;
  return {
    pitch: clamp(pitch, -Math.PI / 2, Math.PI / 2),
    yaw: clamp(yaw, -Math.PI, Math.PI),
    roll: clamp(roll, -Math.PI, Math.PI),
  };
}

function blendshapesFromResult(result) {
  const blendshapes = {};
  for (const category of result.faceBlendshapes?.[0]?.categories ?? []) {
    if (typeof category.categoryName !== 'string' || !Number.isFinite(category.score)) continue;
    blendshapes[category.categoryName] = clamp(category.score, 0, 1);
  }
  return blendshapes;
}

function notDetectedFrame(timestampMs) {
  return { blendshapes: {}, headRotation: ZERO_ROTATION, detected: false, timestampMs };
}

/**
 * Browser-side capture boundary. It owns the camera and MediaPipe objects and
 * emits only values conforming to AvatarFrame.
 *
 * @callback AvatarFrameListener
 * @param {import('./avatar-frame.mjs').AvatarFrame} frame
 * @returns {void}
 *
 * @typedef {Object} AvatarCapture
 * @property {() => Promise<void>} start
 * @property {() => void} stop
 * @property {(listener: AvatarFrameListener) => () => void} subscribe
 *
 * @typedef {Object} AvatarCaptureOptions
 * @property {number} [smoothingFactor=0.35] Exponential smoothing coefficient in (0, 1].
 * @property {MediaStreamConstraints} [mediaStreamConstraints]
 * @property {string} [modelAssetPath]
 * @property {string} [wasmPath]
 */

/**
 * @param {AvatarCaptureOptions} [options]
 * @returns {AvatarCapture}
 */
export function createAvatarCapture(options = {}) {
  const smoothingFactor = options.smoothingFactor ?? DEFAULT_SMOOTHING_FACTOR;
  if (!Number.isFinite(smoothingFactor) || smoothingFactor <= 0 || smoothingFactor > 1) {
    throw new RangeError('smoothingFactor must be a finite number in (0, 1]');
  }

  const listeners = new Set();
  const mediaStreamConstraints = options.mediaStreamConstraints ?? {
    audio: false,
    video: { facingMode: 'user' },
  };
  let stream = null;
  let video = null;
  let landmarker = null;
  let frameRequest = null;
  let startPromise = null;
  let running = false;
  let generation = 0;
  let previousBlendshapes = null;
  let previousRotation = null;
  let lastVideoTime = -1;
  let lastMediaPipeTimestamp = -1;

  function emit(frame) {
    for (const listener of listeners) {
      try {
        listener(frame);
      } catch (error) {
        console.error('Avatar capture listener failed', error);
      }
    }
  }

  function emitNotDetected(timestampMs = monotonicNow()) {
    previousBlendshapes = null;
    previousRotation = null;
    emit(notDetectedFrame(timestampMs));
  }

  function cancelFrame() {
    if (frameRequest === null || !video) return;
    if (typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameRequest);
    } else {
      globalThis.cancelAnimationFrame(frameRequest);
    }
    frameRequest = null;
  }

  function releaseResources() {
    cancelFrame();
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    landmarker?.close?.();
    stream = null;
    video = null;
    landmarker = null;
    lastVideoTime = -1;
    lastMediaPipeTimestamp = -1;
  }

  function scheduleFrame(callback) {
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameRequest = video.requestVideoFrameCallback(callback);
    } else {
      frameRequest = globalThis.requestAnimationFrame(callback);
    }
  }

  function smoothFrame(blendshapes, rotation, timestampMs) {
    if (!previousBlendshapes || !previousRotation) {
      previousBlendshapes = blendshapes;
      previousRotation = rotation;
    } else {
      const smoothedBlendshapes = {};
      for (const [name, value] of Object.entries(blendshapes)) {
        const previous = previousBlendshapes[name] ?? 0;
        smoothedBlendshapes[name] = clamp(previous + (value - previous) * smoothingFactor, 0, 1);
      }
      previousBlendshapes = smoothedBlendshapes;
      previousRotation = {
        pitch: clamp(
          previousRotation.pitch + (rotation.pitch - previousRotation.pitch) * smoothingFactor,
          -Math.PI / 2,
          Math.PI / 2,
        ),
        yaw: clamp(smoothAngle(previousRotation.yaw, rotation.yaw, smoothingFactor), -Math.PI, Math.PI),
        roll: clamp(smoothAngle(previousRotation.roll, rotation.roll, smoothingFactor), -Math.PI, Math.PI),
      };
    }

    return {
      blendshapes: previousBlendshapes,
      headRotation: previousRotation,
      detected: true,
      timestampMs,
    };
  }

  function processFrame(_now, metadata) {
    frameRequest = null;
    if (!running || !video || !landmarker) return;

    const timestampMs = monotonicNow();
    const videoTime = metadata?.mediaTime ?? video.currentTime;
    if (video.readyState >= 2 && videoTime !== lastVideoTime) {
      lastVideoTime = videoTime;
      const mediaPipeTimestamp = Math.max(timestampMs, lastMediaPipeTimestamp + 0.001);
      lastMediaPipeTimestamp = mediaPipeTimestamp;
      try {
        const result = landmarker.detectForVideo(video, mediaPipeTimestamp);
        const rotation = headRotationFromMatrix(result.facialTransformationMatrixes?.[0]);
        const blendshapes = blendshapesFromResult(result);
        if (result.faceLandmarks?.length && rotation) {
          emit(smoothFrame(blendshapes, rotation, timestampMs));
        } else {
          emitNotDetected(timestampMs);
        }
      } catch (error) {
        console.error('Avatar face detection failed', error);
        emitNotDetected(timestampMs);
      }
    }
    if (running) scheduleFrame(processFrame);
  }

  async function initialize(expectedGeneration) {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture is unavailable');
      stream = await navigator.mediaDevices.getUserMedia(mediaStreamConstraints);
      if (!running || generation !== expectedGeneration) return;

      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (!running || generation !== expectedGeneration) return;

      const vision = await FilesetResolver.forVisionTasks(options.wasmPath ?? DEFAULT_WASM_PATH);
      if (!running || generation !== expectedGeneration) return;
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      if (!running || generation !== expectedGeneration) return;

      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!running) return;
          running = false;
          generation += 1;
          releaseResources();
          emitNotDetected();
        }, { once: true });
      }
      scheduleFrame(processFrame);
    } catch (error) {
      console.error('Avatar capture could not start', error);
      if (running && generation === expectedGeneration) {
        running = false;
        emitNotDetected();
      }
    } finally {
      if (!running || generation !== expectedGeneration || !landmarker) releaseResources();
    }
  }

  function start() {
    if (running) return startPromise ?? Promise.resolve();
    if (startPromise) return startPromise.then(start);

    running = true;
    const expectedGeneration = ++generation;
    startPromise = initialize(expectedGeneration).finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  return {
    start,

    stop() {
      if (!running && !startPromise) return;
      running = false;
      generation += 1;
      releaseResources();
      emitNotDetected();
    },

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
