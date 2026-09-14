/**
 * The capture and render modules share only this renderer-process data contract.
 * Raw camera frames and MediaPipe result objects must not cross this boundary.
 */

/**
 * Renderer-ready head rotation in radians, using Three.js' right-handed axes.
 * Pitch rotates around +X (positive looks up), yaw around +Y (positive looks
 * left), and roll around +Z (positive is counter-clockwise to the viewer).
 * Apply the rotations in YXZ order. Ranges follow Three.js Euler's YXZ
 * decomposition: pitch is in [-PI/2, PI/2], yaw and roll are in [-PI, PI].
 * Producers must clamp finite out-of-range values to the nearest bound before
 * emitting a frame, not pass them through. NaN and infinities must not be
 * emitted. Renderers may rely on these finite, inclusive bounds.
 *
 * @typedef {Readonly<{
 *   pitch: number,
 *   yaw: number,
 *   roll: number,
 * }>} HeadRotation
 */

/**
 * One face-tracking sample passed from capture to render.
 *
 * Blendshape keys are MediaPipe category names and values are normalized to
 * [0, 1]. `timestampMs` is the capture time on a monotonic millisecond clock.
 * `detected` indicates whether a face is present. When false, blendshapes must
 * be empty and all head rotation components must be zero.
 *
 * `confidence`, when supplied, is a finite number in [0, 1]; producers must
 * clamp finite out-of-range values before emission and omit non-finite ones.
 * Absence means confidence is unavailable, not zero or no face detected.
 * The first capture implementation may omit it.
 * These are producer obligations; this type declaration does not transform
 * or validate values at runtime.
 *
 * @typedef {Readonly<{
 *   blendshapes: Readonly<Record<string, number>>,
 *   headRotation: HeadRotation,
 *   detected: boolean,
 *   confidence?: number,
 *   timestampMs: number,
 * }>} AvatarFrame
 */
