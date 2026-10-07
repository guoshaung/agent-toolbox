"""Optional expression geometry for automatic meshes without usable face topology.

The configured eyelids and mouth are separate, skinned surfaces. Their rest pose
stays behind the reconstructed face; VRM morphs bring them forward. This keeps
blink and mouth-open visible even when the source eye texture is painted on a
single coarse facial surface.
"""
import numpy as np


def add_expression_features(vertices, faces, colors, config, source_indices=None):
    vertices=np.asarray(vertices,dtype=np.float32)
    faces=np.asarray(faces,dtype=np.uint32)
    colors=np.asarray(colors,dtype=np.uint8)
    regions=config.get('regions',{}) if isinstance(config,dict) else {}
    if any(name not in regions for name in ('leftEye','rightEye','mouth')):
        raise ValueError('face-expressions.json requires leftEye, rightEye and mouth regions')
    appended=[];added_faces=[];bindings={};feature_vertices={}
    skin=np.array(config.get('skinColor',[248,218,206,255]),dtype=np.uint8)
    ink=np.array(config.get('inkColor',[38,46,56,255]),dtype=np.uint8)

    def region(name):
        data=regions[name];center=np.asarray(data.get('center'),dtype=float);radius=np.asarray(data.get('radius'),dtype=float)
        if center.shape!=(3,) or radius.shape!=(3,) or not np.isfinite(center).all() or not np.isfinite(radius).all() or np.any(radius<=0):
            raise ValueError('face expression regions require finite XYZ center/radius')
        return center,radius

    def ellipse(name, center, rx, ry, color, behind=.08, segments=16):
        start=len(vertices)+len(appended)
        base=center.copy();base[2]-=behind
        appended.append(base);bindings[start]={'head':1}
        for i in range(segments):
            angle=2*np.pi*i/segments
            point=base+np.array([rx*np.cos(angle),ry*np.sin(angle),0])
            appended.append(point);bindings[start+i+1]={'head':1}
        for i in range(segments):
            added_faces.append([start,start+i+1,start+(i+1)%segments+1])
        feature_vertices[name]=np.arange(start,start+segments+1,dtype=int)
        return np.tile(color,(segments+1,1))

    appended_colors=[]
    for side,name in [('left','leftEye'),('right','rightEye')]:
        center,radius=region(name)
        appended_colors.append(ellipse('blink'+side.title(),center,radius[0]*.92,radius[1]*.92,skin))
        # A slim lash line is moved with the skin-colored eyelid disk.
        line_center=center.copy();line_center[1]-=radius[1]*.04
        appended_colors.append(ellipse('blink'+side.title()+'Line',line_center,radius[0]*.62,max(radius[1]*.12,.004),ink,segments=12))
        feature_vertices['blink'+side.title()]=np.r_[feature_vertices['blink'+side.title()],feature_vertices.pop('blink'+side.title()+'Line')]
    mouth,radius=region('mouth')
    appended_colors.append(ellipse('aa',mouth,radius[0]*.58,radius[1]*1.12,ink))
    smile_center=mouth.copy();smile_center[1]+=radius[1]*.22
    appended_colors.append(ellipse('happy',smile_center,radius[0]*.72,max(radius[1]*.12,.003),ink,segments=14))
    expanded=np.vstack([vertices,np.asarray(appended,dtype=np.float32)])
    expanded_colors=np.vstack([colors,np.vstack(appended_colors)])
    expanded_faces=np.vstack([faces,np.asarray(added_faces,dtype=np.uint32)])
    old_sources=np.arange(len(vertices),dtype=int) if source_indices is None else np.asarray(source_indices,dtype=int)
    sources=np.r_[old_sources,np.full(len(appended),-1,dtype=int)]
    feature_face_mask=np.r_[np.zeros(len(faces),dtype=bool),np.ones(len(added_faces),dtype=bool)]
    return {'vertices':expanded,'faces':expanded_faces,'colors':expanded_colors,
            'source_indices':sources,'bindings':bindings,'feature_vertices':feature_vertices,
            'feature_faces':feature_face_mask}
