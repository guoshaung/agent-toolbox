# Avatar Rig / controls validation

This PR snapshots the current local feature, including previous Windows quick-control fixes and UI changes. It does not claim production-quality character reconstruction.

## Evidence

- Windows 11 / RTX 4070 Laptop (8GB), Python 3.12, PyTorch 2.6 + CUDA 12.4.
- Installed Toolbox UI: More → 图片建模 → official full-body Miku sample → export.
- TripoSR generated 39,825 vertices and 79,646 faces. Exported GLB and VRM contain 21 bones, inverse bind matrices and normalized skin weights.
- Khronos glTF validator: 0 errors / 0 warnings. VRMC_vrm extension additionally loaded using @pixiv/three-vrm 3.5.5 (not covered by glTF validator).
- Front / side / back inspected. Rotating the normalized head bone 0.3 radians moved a sampled head vertex ~0.05226m, confirming skinning is active.
- Known limitations: blurred facial/finger details, inferred backside artifacts, reference-pose rig needing T-pose/weight correction, no facial blendshapes or hair/cloth physics. Higher-quality textures/reconstruction are the next local iteration, not part of this snapshot.
- Windows read-only probe regression executes two concurrent actual PowerShell window enumerations. Global shortcut tests cover safe-process exclusion, untitled app windows and asynchronous error feedback. Destructive process termination is mocked in automated tests.

## Reproduction

1. `npm ci`, `npm run avatar:prepare`, `npm test`.
2. Launch Toolbox; container seed copies `avatar-rig-studio` on first run.
3. Run `setup.ps1` in the container project; select your own image (optional sample instructions in its README).
4. Generate, open the local viewer, rotate and test head motion.

Weights, local config/secrets, generated artifacts, and reference artwork are excluded from Git. TripoSR source is MIT-licensed with its license retained.
