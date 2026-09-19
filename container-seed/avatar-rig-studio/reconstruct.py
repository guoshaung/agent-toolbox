"""Real single-image reconstruction using the upstream TripoSR pretrained model."""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'vendor' / 'TripoSR'))

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--resolution', type=int, default=384)
    args = p.parse_args()
    import numpy as np
    import torch
    from PIL import Image
    from tsr.system import TSR
    from tsr.utils import resize_foreground

    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    image = Image.open(args.input).convert('RGBA')
    if image.getchannel('A').getextrema()[0] == 255:
        import rembg
        image = rembg.remove(image)
    image.save(output / 'source.png')
    image = resize_foreground(image, 0.85)
    rgba = np.asarray(image).astype(np.float32) / 255
    rgb = rgba[..., :3] * rgba[..., 3:4] + (1 - rgba[..., 3:4]) * 0.5
    image = Image.fromarray((rgb * 255).astype(np.uint8))
    image.save(output / 'input-prepared.png')
    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    print(f'Loading TripoSR on {device}', flush=True)
    started = time.monotonic()
    torch.set_num_threads(8)
    model = TSR.from_pretrained(str(ROOT / 'models' / 'TripoSR'), 'config.yaml', 'model.ckpt')
    model.eval().to(device)
    model.renderer.set_chunk_size(4096)
    print('Reconstructing 3D density and appearance', flush=True)
    with torch.inference_mode():
        scene = model([image], device=device)
        print('Extracting colored surface', flush=True)
        mesh = model.extract_mesh(scene, True, resolution=args.resolution)[0]
    # Marching cubes can produce inward winding near degenerate cells. Fix this
    # before normal-based texture selection (unlit vertex colors had hidden it).
    mesh.merge_vertices(digits_vertex=6)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals(multibody=True)
    if mesh.volume < 0:
        mesh.invert()
    # TripoSR uses Z-up; glTF and VRM use Y-up. Positive X is the front camera.
    vertices = np.asarray(mesh.vertices)
    # Preserve visible illustration detail on the front surface. Side/back colors
    # remain the model prediction; this cannot invent unseen detail.
    mesh.fix_normals()
    normals = np.asarray(mesh.vertex_normals)
    distance = 1.9 - vertices[:, 0]
    scale = 2 * np.tan(np.deg2rad(20)) * distance
    uv = np.stack((.5 + vertices[:, 1]/scale, .5 - vertices[:, 2]/scale), axis=1)
    pixels = np.asarray(image).astype(np.float32)
    coords = uv * (np.array(image.size)-1)
    from scipy.ndimage import map_coordinates
    sampled = np.stack([map_coordinates(pixels[..., c], [coords[:, 1], coords[:, 0]], order=1, mode='nearest') for c in range(3)], axis=1)
    blend = np.clip((normals[:, 0]-.15)/.55, 0, 1)[:, None] * .85
    valid = ((uv >= 0) & (uv <= 1)).all(axis=1)
    blend[~valid] = 0
    model_colors = np.asarray(mesh.visual.vertex_colors).copy()
    model_colors[:, :3] = np.clip(sampled*blend + model_colors[:, :3]*(1-blend), 0, 255).astype(np.uint8)
    mesh.visual.vertex_colors = model_colors
    vertices = np.stack((vertices[:, 1], vertices[:, 2], vertices[:, 0]), axis=1)
    vertices[:, 1] -= vertices[:, 1].min()
    vertices *= 1.6 / vertices[:, 1].max()
    mesh.vertices = vertices
    mesh.fix_normals()
    mesh.export(output / 'reconstructed.glb')
    mesh.export(output / 'reconstructed.ply')
    np.savez_compressed(output / 'mesh.npz', vertices=mesh.vertices, faces=mesh.faces,
                        normals=mesh.vertex_normals, colors=mesh.visual.vertex_colors,
                        projection_uv=uv.astype(np.float32))
    report = {'engine': 'TripoSR', 'source': str(Path(args.input).resolve()),
              'vertices': len(mesh.vertices), 'triangles': len(mesh.faces),
              'bounds': mesh.bounds.tolist(), 'watertight': bool(mesh.is_watertight),
              'seconds': round(time.monotonic() - started, 2), 'device': device,
              'surfaceResolution': args.resolution, 'sourcePixels': list(Image.open(args.input).size),
              'texturePixels': list(image.size), 'networkInputPixels': [512,512]}
    (output / 'reconstruction.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)

if __name__ == '__main__':
    main()
