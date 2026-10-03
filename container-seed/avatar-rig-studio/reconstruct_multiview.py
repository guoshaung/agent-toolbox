"""Hunyuan3D-2mv: joint conditioning on front/left/back, not image batching."""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'vendor/Hunyuan3D-2'))

def main():
    p=argparse.ArgumentParser();p.add_argument('--job',type=Path,required=True);p.add_argument('--steps',type=int,default=40)
    args=p.parse_args();job=args.job.resolve()
    import torch
    import numpy as np
    from PIL import Image
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    if not torch.cuda.is_available():
        raise RuntimeError('多视图模式需要 NVIDIA CUDA 显卡，请检查驱动和 .venv-mv 安装。')
    torch.set_num_threads(8)
    images={key:Image.open(job/(key+'.png')).convert('RGBA') for key in ['front','left','back']}
    if (job/'right.png').is_file():images['right']=Image.open(job/'right.png').convert('RGBA')
    images['front'].save(job/'source.png')
    started=time.monotonic()
    print('Loading Hunyuan3D-2mv (fp16, CPU offload)',flush=True)
    pipeline=Hunyuan3DDiTFlowMatchingPipeline.from_single_file(
        str(ROOT/'models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv/model.fp16.safetensors'),
        str(ROOT/'models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv/config.yaml'),
        device='cpu',dtype=torch.float16,use_safetensors=True)
    # Upstream standalone pipeline does not define DiffusionPipeline.components,
    # but its offload method expects it. Supply the actual existing modules.
    pipeline.components={k:getattr(pipeline,k) for k in ['conditioner','model','vae']}
    pipeline.enable_model_cpu_offload()
    pipeline.device=torch.device('cuda:0')
    print('Joint multi-view shape inference',flush=True)
    with torch.inference_mode():
        mesh=pipeline(image=images,num_inference_steps=args.steps,octree_resolution=320,num_chunks=8000,
                      generator=torch.Generator(device='cpu').manual_seed(12345),output_type='trimesh')[0]
    if mesh is None:raise RuntimeError('Empty reconstructed surface')
    mesh.export(job/'hunyuan-raw.glb')
    mesh.export(job/'hunyuan-raw.ply')
    np.savez_compressed(job/'hunyuan-raw.npz',vertices=mesh.vertices,faces=mesh.faces)
    report={'engine':'Hunyuan3D-2mv','views':list(images),'steps':args.steps,'seconds':round(time.monotonic()-started,2),
            'vertices':len(mesh.vertices),'triangles':len(mesh.faces),'bounds':mesh.bounds.tolist()}
    (job/'multiview-reconstruction.json').write_text(json.dumps(report,indent=2),'utf8')
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
