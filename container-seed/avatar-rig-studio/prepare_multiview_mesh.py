"""Normalize Hunyuan geometry and attach orthographic three-view projections."""
import json
import argparse
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image, ImageOps
from scipy.ndimage import map_coordinates, distance_transform_edt

p=argparse.ArgumentParser();p.add_argument('--job',type=Path,required=True);args=p.parse_args()
root=args.job.resolve()
raw=np.load(root/'hunyuan-raw.npz')
mesh=trimesh.Trimesh(raw['vertices'],raw['faces'],process=True)
mesh.update_faces(mesh.nondegenerate_faces())
mesh.remove_unreferenced_vertices()
mesh.fix_normals(multibody=True)
if mesh.volume<0:mesh.invert()
v=np.asarray(mesh.vertices).copy()
print('Raw bounds:',mesh.bounds.tolist(),flush=True)
# Hunyuan shape output is Y-up, front +Z. Keep raw mesh for orientation QA.
v[:,1]-=v[:,1].min();v*=1.6/v[:,1].max()
v[:,0]-=(v[:,0].min()+v[:,0].max())/2
mesh.vertices=v
mesh.visual.vertex_colors=np.tile([190,196,205,255],(len(v),1))
mesh.export(root/'reconstructed.glb')
mesh.export(root/'reconstructed.ply')
uvs=[];sampled=[];provenance={}
for name,horizontal in [('front',v[:,0]),('left',-v[:,2]),('back',-v[:,0]),('right',v[:,2])]:
    if name == 'right' and not (root/'right.png').is_file():
        image=ImageOps.mirror(Image.open(root/'left.png').convert('RGBA'))
        provenance[name]='mirrored left reference; not observed right-side detail'
    else:
        image=Image.open(root/(name+'.png')).convert('RGBA')
        provenance[name]='supplied reference'
    bbox=image.getbbox()
    if bbox is None:raise ValueError(f'{name} image is empty')
    scale=(bbox[3]-bbox[1])/1.6
    u=(horizontal-(horizontal.min()+horizontal.max())/2)*scale+(bbox[0]+bbox[2])/2
    y=bbox[3]-v[:,1]*scale
    uv=np.stack((u/image.width,y/image.height),axis=1).astype(np.float32)
    uvs.append(uv)
    rgba=np.asarray(image)
    foreground=rgba[:,:,3]>128
    nearest=distance_transform_edt(~foreground,return_distances=False,return_indices=True)
    rgb=rgba[:,:,:3].copy()
    rgb[~foreground]=rgb[nearest[0][~foreground],nearest[1][~foreground]]
    Image.fromarray(rgb).save(root/(name+'-texture.png'))
    color=np.stack([map_coordinates(rgb[:,:,c].astype(float),[y,u],order=1,mode='nearest') for c in range(3)],axis=1)
    sampled.append(color)
normals=mesh.vertex_normals
scores=np.stack((normals[:,2],normals[:,0],-normals[:,2],-normals[:,0]),axis=1)
which=scores.argmax(1)
colors=np.stack(sampled,axis=1)[np.arange(len(v)),which]
colors=np.c_[colors,np.full(len(v),255)].astype('uint8')
np.savez_compressed(root/'mesh.npz',vertices=v,faces=mesh.faces,normals=normals,colors=colors,
                    multiview_uv=np.stack(uvs),texture_files=np.array(['front-texture.png','left-texture.png','back-texture.png','right-texture.png']))
(root/'texture-provenance.json').write_text(json.dumps(provenance,indent=2),'utf8')
(root/'project.json').write_text(json.dumps({'engine':'Hunyuan3D-2mv','stage':'geometry preview'}),encoding='utf8')
print({'vertices':len(v),'triangles':len(mesh.faces),'bounds':mesh.bounds.tolist()},flush=True)
