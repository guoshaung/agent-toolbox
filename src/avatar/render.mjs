/**
 * Browser-side Three.js/VRM rendering boundary. It consumes AvatarFrame and
 * has no access to camera or MediaPipe objects.
 *
 * @typedef {Object} AvatarRenderer
 * @property {(frame: import('./avatar-frame.mjs').AvatarFrame) => void} renderFrame
 * @property {() => void} dispose
 */

/**
 * @returns {AvatarRenderer}
 */
export function createAvatarRenderer() {
  throw new Error('Avatar rendering is not implemented');
}

