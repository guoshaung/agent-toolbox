# Local experiment: Doubao turnaround → Hunyuan3D-2mv

This documents the initial local experiment after baseline PR #11. It has now been integrated as a separate selectable mode; see [AVATAR-MULTIVIEW.md](AVATAR-MULTIVIEW.md). The normal single-image mode still uses TripoSR.

## Actual run

1. Uploaded the official Fubuki full-body reference to the user's logged-in Doubao web image generator and requested one aligned front/left/back A-pose turnaround sheet.
2. Saved the generated 2496×1664 original, then cropped the reviewed empty gutters (x=1000 and x=1500), segmented the white background, and placed each view on a shared-scale 1024×1024 RGBA canvas. The original generated sheet and prompt remain in the local job.
3. Used the actual Hunyuan3D-2mv dictionary input (`front`, `left`, `back`) with the fp16 checkpoint, 40 steps, octree resolution 320, chunk size 8000 and seed 12345.
4. Patched only the runner's offload integration: the upstream standalone pipeline lacked `components`, although its offload method requires it. Supplied its existing conditioner/model/VAE modules and set the execution device to CUDA after enabling offload. Network weights unchanged.
5. Exported geometry, then used three-view orthographic reference projection (NOT Hunyuan's diffusion texture model), padded texture boundaries and the existing provisional VRM rig. Reviewed clay geometry and textured front, side and back.

GPU: RTX 4070 Laptop 8GB. Inference with loading took 160.2 seconds after dependencies/checkpoint were installed. Output: 140,058 vertices / 280,172 triangles; watertight surface with 2 connected components; VRM has 21 bones and 3 skinned material primitives. Khronos glTF validation: 0 errors / 0 warnings; three-vrm loaded the VRM extension; head rotation deformed all three primitives consistently.

The side head/body shape is visibly more coherent than the previous TripoSR output. This is not a controlled model-only benchmark: the input changed from a crossed-leg pose to a neutral generated turnaround as well. Remaining issues include view inconsistency, texture seams, missing opposite-side reference, guessed skin weights, no facial blendshapes/physics, and imperfect small anatomy/clothing geometry.

## Reproduce locally

Keep Hunyuan source and weights outside Git in the container project:

```powershell
git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git vendor/Hunyuan3D-2
uv venv --python 3.12 .venv-mv
uv pip install --python .venv-mv/Scripts/python.exe torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv-mv/Scripts/python.exe 'numpy<2' diffusers==0.33.1 transformers==4.46.3 accelerate==1.1.1 einops omegaconf trimesh pymeshlab scikit-image Pillow rembg onnxruntime opencv-python-headless safetensors huggingface-hub==0.28.1
```

Download `config.yaml` and `model.fp16.safetensors` from `tencent/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv` into `models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv/`. Hunyuan has its own license; not MIT. This local personal experiment does not imply distribution/commercial rights.

After placing the reviewed sheet at `jobs/<job>/doubao-three-views.png`:

```powershell
.venv/Scripts/python.exe prepare_three_views.py --job jobs/<job> --first-cut 1000 --second-cut 1500
.venv-mv/Scripts/python.exe reconstruct_multiview.py --job jobs/<job>
.venv-mv/Scripts/python.exe prepare_multiview_mesh.py --job jobs/<job>
.venv/Scripts/python.exe export_vrm.py --job jobs/<job>
```

The example gutter positions are Fubuki-sheet-specific and must be adjusted after visual inspection for a different sheet. Do not blindly split arbitrary sheets into equal thirds. Ref metadata and optional `landmarks.json` are job-local. No generated images, weights or personal account state are included in this source change.
