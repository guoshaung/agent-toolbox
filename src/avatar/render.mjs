import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { collapseArkitBlendshapes } from './vrm-expression-map.mjs';

const IDLE_FRAME = Object.freeze({
  blendshapes: Object.freeze({}),
  headRotation: Object.freeze({ pitch: 0, yaw: 0, roll: 0 }),
  detected: false,
  timestampMs: 0,
});

function disposeScene(scene) {
  if (!scene) return;
  scene.removeFromParent();
  VRMUtils.deepDispose(scene);
}

function frameUpperBody(camera, vrm, aspect) {
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  if (bounds.isEmpty()) return;

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const hipsY = hips?.getWorldPosition(new THREE.Vector3()).y;
  const bottom = Number.isFinite(hipsY) ? hipsY : bounds.min.y + size.y * 0.45;
  const upperHeight = Math.max(bounds.max.y - bottom, size.y * 0.4, 0.1);
  const upperWidth = Math.max(size.x, 0.1);
  const verticalDistance = upperHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  const horizontalDistance = upperWidth / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(verticalDistance, horizontalDistance) * 1.18;
  const target = new THREE.Vector3(center.x, bottom + upperHeight * 0.5, center.z);

  camera.position.set(target.x, target.y, bounds.max.z + distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = Math.max(distance * 10, 100);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function applyExpressionWeights(manager, weights) {
  if (!manager) return;
  manager.resetValues();

  const has = (name) => manager.getExpression(name) !== null;
  if (has('blinkLeft') && has('blinkRight')) {
    manager.setValue('blinkLeft', weights.blinkLeft ?? 0);
    manager.setValue('blinkRight', weights.blinkRight ?? 0);
  } else if (has('blink')) {
    manager.setValue('blink', Math.max(weights.blinkLeft ?? 0, weights.blinkRight ?? 0));
  }

  for (const [name, weight] of Object.entries(weights)) {
    if (name !== 'blinkLeft' && name !== 'blinkRight' && has(name)) {
      manager.setValue(name, weight);
    }
  }
}

/**
 * Browser-side Three.js/VRM rendering boundary. It consumes AvatarFrame and
 * has no access to camera or MediaPipe objects.
 *
 * @typedef {Object} AvatarFrameSource
 * @property {(listener: (frame: import('./avatar-frame.mjs').AvatarFrame) => void) => () => void} subscribe
 *
 * @typedef {Object} AvatarRendererOptions
 * @property {HTMLCanvasElement} canvas
 * @property {string} [modelUrl]
 * @property {AvatarFrameSource} [frameSource]
 * @property {number} [maxPixelRatio=2]
 *
 * @typedef {Object} AvatarRenderer
 * @property {Promise<void>} ready
 * @property {(modelUrl: string) => Promise<void>} loadModel
 * @property {(frame: import('./avatar-frame.mjs').AvatarFrame) => void} renderFrame
 * @property {() => void} dispose
 */

/**
 * @param {AvatarRendererOptions} options
 * @returns {AvatarRenderer}
 */
export function createAvatarRenderer(options) {
  if (!(options?.canvas instanceof HTMLCanvasElement)) {
    throw new TypeError('options.canvas must be an HTMLCanvasElement');
  }
  if (options.frameSource && typeof options.frameSource.subscribe !== 'function') {
    throw new TypeError('options.frameSource must provide subscribe(listener)');
  }

  const canvas = options.canvas;
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  if (!Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0) {
    throw new RangeError('maxPixelRatio must be a positive finite number');
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x283044, 1.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(1.5, 2.5, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x9bbcff, 1.1);
  fillLight.position.set(-2, 1.2, 1);
  scene.add(fillLight);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const clock = new THREE.Clock();
  const frameEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const frameQuaternion = new THREE.Quaternion();
  let vrm = null;
  let head = null;
  let restHeadQuaternion = null;
  let latestFrame = IDLE_FRAME;
  let animationFrame = null;
  let disposed = false;
  let loadGeneration = 0;

  function resize() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, maxPixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (vrm) frameUpperBody(camera, vrm, camera.aspect);
  }

  function applyFrame(frame) {
    if (!vrm) return;
    if (!frame.detected) {
      vrm.expressionManager?.resetValues();
      if (head && restHeadQuaternion) head.quaternion.copy(restHeadQuaternion);
      return;
    }

    applyExpressionWeights(vrm.expressionManager, collapseArkitBlendshapes(frame.blendshapes));
    if (head && restHeadQuaternion) {
      frameEuler.set(
        frame.headRotation.pitch,
        frame.headRotation.yaw,
        frame.headRotation.roll,
        'YXZ',
      );
      frameQuaternion.setFromEuler(frameEuler);
      head.quaternion.copy(restHeadQuaternion).multiply(frameQuaternion);
    }
  }

  function renderFrame(frame) {
    latestFrame = frame;
    applyFrame(frame);
  }

  function animate() {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    vrm?.update(delta);
    renderer.render(scene, camera);
  }

  async function loadModel(modelUrl) {
    if (typeof modelUrl !== 'string' || modelUrl.trim() === '') {
      throw new TypeError('modelUrl must be a non-empty string');
    }
    const generation = ++loadGeneration;
    const gltf = await loader.loadAsync(modelUrl);
    const loadedVrm = gltf.userData.vrm;
    if (!loadedVrm) {
      disposeScene(gltf.scene);
      throw new Error(`The loaded file is not a VRM model: ${modelUrl}`);
    }
    if (disposed || generation !== loadGeneration) {
      disposeScene(loadedVrm.scene);
      return;
    }

    VRMUtils.rotateVRM0(loadedVrm);
    disposeScene(vrm?.scene);
    vrm = loadedVrm;
    scene.add(vrm.scene);
    head = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
    restHeadQuaternion = head?.quaternion.clone() ?? null;

    const presets = vrm.expressionManager?.presetExpressionMap ?? {};
    if (Object.keys(presets).length === 0) {
      console.warn(
        `[avatar] VRM model has no expression presets; facial animation is unavailable: ${modelUrl}`,
      );
    }
    if (!head) console.warn(`[avatar] VRM model has no normalized head bone: ${modelUrl}`);

    resize();
    applyFrame(latestFrame);
  }

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resize)
    : null;
  resizeObserver?.observe(canvas);
  globalThis.addEventListener?.('resize', resize);
  const unsubscribe = options.frameSource?.subscribe(renderFrame) ?? null;
  resize();
  animate();

  const ready = options.modelUrl ? loadModel(options.modelUrl) : Promise.resolve();
  return {
    ready,
    loadModel,
    renderFrame,
    dispose() {
      if (disposed) return;
      disposed = true;
      loadGeneration += 1;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      unsubscribe?.();
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.('resize', resize);
      disposeScene(vrm?.scene);
      vrm = null;
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
