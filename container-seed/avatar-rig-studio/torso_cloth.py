"""Opt-in separated front torso cloth with a conservative VRM morph target."""
import numpy as np


def add_torso_cloth(vertices, faces, colors, source_indices, config):
    vertices=np.asarray(vertices,dtype=np.float32)
    faces=np.asarray(faces,dtype=np.uint32)
    colors=np.asarray(colors,dtype=np.uint8)
    sources=np.asarray(source_indices,dtype=int)
    outer=config.get('outer',{}) if isinstance(config,dict) else {}
    bounce=config.get('bounce',{}) if isinstance(config,dict) else {}
    center=np.asarray(outer.get('center'),dtype=float)
    radius=np.asarray(outer.get('radius'),dtype=float)
    bounce_center=np.asarray(bounce.get('center'),dtype=float)
    bounce_radius=np.asarray(bounce.get('radius'),dtype=float)
    amplitude=float(bounce.get('amplitude',.012))
    rest_offset=float(config.get('restOffset',.0025))
    if any(v.shape!=(3,) or not np.isfinite(v).all() for v in (center,radius,bounce_center,bounce_radius)) or np.any(radius<=0) or np.any(bounce_radius<=0) or not .002 <= amplitude <= .03 or not 0 < rest_offset <= .01:
        raise ValueError('torso-cloth.json needs finite XYZ regions and conservative offsets')
    face_centers=vertices[faces].mean(axis=1)
    normalized=(face_centers-center)/radius
    selected=((normalized*normalized).sum(axis=1)<1) & (face_centers[:,2]>center[2]-radius[2]*.35)
    if selected.sum()<12:
        raise ValueError('torso cloth region selected too little visible front geometry')
    source_faces=faces[selected]
    used=np.unique(source_faces)
    mapping=np.full(len(vertices),-1,dtype=int)
    start=len(vertices);mapping[used]=np.arange(start,start+len(used))
    cloned=vertices[used].copy();cloned[:,2]+=rest_offset
    cloned_faces=mapping[source_faces]
    d=(vertices[used]-bounce_center)/bounce_radius
    softness=np.clip(1-(d*d).sum(axis=1),0,1).astype(np.float32)
    return {
        'vertices':np.vstack([vertices,cloned]),
        'faces':np.vstack([faces,cloned_faces]),
        'colors':np.vstack([colors,colors[used]]),
        'source_indices':np.r_[sources,sources[used]],
        'bindings':{int(index):{'chest':1} for index in mapping[used]},
        'cloth_vertices':mapping[used],
        'softness':softness,
        'amplitude':amplitude,
        'cloth_faces':np.r_[np.zeros(len(faces),dtype=bool),np.ones(len(cloned_faces),dtype=bool)],
        'copiedFaces':int(len(cloned_faces)),
    }
