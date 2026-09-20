# Side textures and opt-in finger rig

Local verification: 2026-09-20. This is a correction to the existing draft pipeline,
not a claim that the reconstructed character is now production quality.

## Changes

- Cover both X-facing sides with four texture projections. Missing right references
  use a mirrored left texture with explicit provenance; optional right references
  pass through input validation, preparation and Hunyuan conditioning.
- Support explicitly reviewed replacement-hand landmarks. Original fused hands
  are replaced by generic volumetric palms and five fingers. This is not learned
  anatomy reconstruction. The original intermediate mesh and prior job remain.
- Export 30 weighted finger bones and 10 tip helper joints in addition to the
  existing 21 bones. Tip helpers are excluded from VRM humanoid mappings.
- Add both side views, bone-based hand close-ups, individual finger curl and reset
  controls. Hand curl controls require VRM and repair metadata.

## Verified

- Seven Python tests: image background preservation, normalization, legacy export,
  four-direction material routing (including negative X), mirrored/supplied right
  textures, finger chains/weights, opt-in behavior and invalid landmarks.
- Seven targeted Node tests: optional fourth input validation and persistence,
  required inputs, job isolation/failures, setup and safe seed updates.
- Local `fubuki-side-hands-v3`: 137,647 vertices, 274,950 triangles, 61 joints,
  51 humanoid mappings and five material primitives, loaded with three-vrm.
- Khronos glTF validator: zero errors and warnings. VRMC_vrm is not validated by
  that validator; three-vrm separately loaded and recognized all finger mappings.
- Each finger bone influences 48–61 replacement vertices; no original-body
  primitive vertex has finger weights. Browser deformation tests at 30 degrees
  moved sampled distal vertices by 0.024–0.042 m on both hands, with zero movement
  in sampled unselected fingers. This checks isolation, not anatomical realism.

## Remaining limitations

The original Hunyuan body geometry is reused: fused hair/clothes and rough facial
features are not solved. Mirroring cannot recover asymmetric opposite-side details.
Hands are generic fitted pieces, not reference-faithful anatomy; wrist seams and
the heuristic body rig still require editing. No automatic landmark detection,
facial expressions or secondary motion is added. Do not reuse sample landmarks on
arbitrary characters. A cleaner character base mesh and dedicated topology/rigging
workflow should be evaluated before further detail work on this reconstruction.
