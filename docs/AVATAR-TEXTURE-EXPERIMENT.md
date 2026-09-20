# Local fidelity iteration after PR #11

Branch: `codex/avatar-texture-quality-local` (not pushed).

## Changes

- Extract the neural density at grid resolution 384 instead of 256.
- Remove degenerate faces, merge coincident vertices, correct inward winding before normal-based surface selection.
- Store perspective-projected UVs and embed the original prepared PNG in GLB/VRM. Front-facing triangles use reference texture; side/back retain inferred colors. This is reference projection, not new observed backside detail.
- Preserve native pixels. The actual reference is 519×791; preparation adds transparent/gray border to a 929×929 square. TripoSR still conditions on 512×512; there is no invented 2K/4K detail.
- Improve viewer antialiasing, texture anisotropy, shared-vertex statistics and add face close-up.

## Local result

Job `miku-texture-v3`: 90,838 unique vertices, 181,672 faces, 66,693 textured front faces, 21 bones. Surface is watertight with positive signed volume. GPU reconstruction took 20.7 seconds on RTX 4070 Laptop 8GB.

Khronos validator: 0 errors / 0 warnings, informational notice about a non-power-of-two texture and unsupported VRM-extension validation. three-vrm actually loads both skinned primitives. A 0.25-radian head rotation moves a sampled head vertex ~0.04381m in both primitives.

Same-camera close-ups show clearer eyes, mouth, headphones and clothing markings than the vertex-color baseline. Side/back remain coarse; projection seams, imperfect head silhouette, reference-pose rig and missing expressions/physics remain unresolved. This is a sharper editable draft, not a production-ready character.
