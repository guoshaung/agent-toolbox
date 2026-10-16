"""Opt-in fitted generic hands for a reconstruction with fused fingers.

Requires explicitly reviewed hand-repair.json wrist/direction landmarks.
This does NOT claim to recover the reference character's original hand anatomy.
"""
import numpy as np


def replace_hands(vertices, faces, colors, parents, positions, config):
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces)
    originals = len(vertices)
    remove = np.zeros(len(vertices), dtype=bool)
    new_vertices, new_faces, bindings = [], [], []
    reports, axes = {}, {}
    color = np.array(config.get('skinColor', [247, 217, 203, 255]), dtype=np.uint8)
    if not isinstance(config.get('hands'), dict) or set(config['hands']) != {'left', 'right'}:
        raise ValueError('Provide reviewed left and right hand landmarks')

    for side, spec in config['hands'].items():
        wrist = np.array(spec.get('wrist'), dtype=float)
        direction = np.array(spec.get('direction'), dtype=float)
        if (wrist.shape != (3,) or direction.shape != (3,) or
                not np.isfinite(wrist).all() or not np.isfinite(direction).all() or
                np.linalg.norm(direction) < 1e-8):
            raise ValueError(f'{side} requires finite XYZ wrist and nonzero XYZ direction')
        direction /= np.linalg.norm(direction)
        # Planar A-pose hands; palm front faces +Z. This configuration is
        # intentionally explicit instead of pretending arbitrary pose detection.
        if abs(direction[2]) > .1:
            raise ValueError('Hand replacement currently requires nearly frontal palms')
        sign = 1 if side == 'left' else -1
        across = np.cross([0, 0, 1], direction)
        across *= sign
        across /= np.linalg.norm(across)
        depth = np.cross(direction, across)
        depth /= np.linalg.norm(depth)
        width = float(spec.get('width', .038))
        length = float(spec.get('palmLength', .039))
        if not .02 <= width <= .07 or not .02 <= length <= .07:
            raise ValueError('Hand dimensions outside supported meter range')
        delta = vertices-wrist
        longitudinal = delta@direction
        lateral = delta@across
        region = ((longitudinal > 0) & (longitudinal < .18)
                  & (np.abs(lateral) < width*1.65) & (np.abs(delta@depth) < .065))
        if not 20 <= region.sum() <= originals*.12:
            raise ValueError(f'{side} wrist/cut region must be checked against the model')
        remove |= region
        positions[side+'Hand'] = wrist.tolist()
        reports[side] = {'replacedVertices': int(region.sum()), 'wrist': wrist.tolist(),
                         'origin': 'fitted generic geometry, not image-recovered fingers'}

        def surface(centers, widths, depths, ring_bindings):
            offset = originals+len(new_vertices)
            segments = 12
            for center, rx, rz, binding in zip(centers, widths, depths, ring_bindings):
                for theta in np.linspace(0, 2*np.pi, segments, endpoint=False):
                    new_vertices.append(center + across*rx*np.cos(theta) + depth*rz*np.sin(theta))
                    bindings.append(binding)
            for ring in range(len(centers)-1):
                for j in range(segments):
                    a=offset+ring*segments+j;b=offset+ring*segments+(j+1)%segments
                    c=a+segments;d=b+segments
                    new_faces.extend([[a,c,b],[b,c,d]])
            for end, ring in [(0,0),(-1,len(centers)-1)]:
                center_index=originals+len(new_vertices)
                new_vertices.append(centers[end]);bindings.append(ring_bindings[end])
                for j in range(segments):
                    new_faces.append([center_index,offset+ring*segments+j,offset+ring*segments+(j+1)%segments])

        surface([wrist+direction*length*t for t in [0,.2,.65,1]],
                np.array([.65,.9,1, .92])*width/2,
                [width*.21,width*.23,width*.22,width*.17],
                [{side+'Hand':1}]*4)
        fingers = [('Index',-.27,.053),('Middle',-.03,.059),('Ring',.21,.054),('Little',.43,.044)]
        finger_radius=float(spec.get('fingerRadius',.16))
        if not .10 <= finger_radius <= .26:
            raise ValueError('fingerRadius must be 0.10–0.26 times hand width')
        for finger, spread, finger_length in fingers+[('Thumb',-.66,.041)]:
            thumb = finger == 'Thumb'
            base = wrist+direction*length*(.38 if thumb else .92)+across*width*spread
            finger_direction = direction+across*(-.65 if thumb else spread*.26)
            finger_direction /= np.linalg.norm(finger_direction)
            joint_names = [side+finger+x for x in (['Metacarpal','Proximal','Distal'] if thumb else ['Proximal','Intermediate','Distal'])]
            points = [base+finger_direction*finger_length*t for t in [0,.42,.73,1]]
            parent = side+'Hand'
            for name, point in zip(joint_names, points):
                parents[name]=parent;positions[name]=point.tolist();parent=name
                axes[name]=(across*sign).tolist()
            tip = side+finger+'Tip'
            parents[tip]=joint_names[-1];positions[tip]=points[-1].tolist()
            centers=[];radii=[];ring_bindings=[]
            for t in [0,.08,.23,.4,.43,.57,.71,.74,.87,.97,1]:
                centers.append(base+finger_direction*finger_length*t)
                radius=width*(finger_radius*1.08 if thumb else finger_radius)*(1-.30*t)
                if t>.96:radius*=.55
                radii.append(radius)
                if t<.12:binding={side+'Hand':1-t/.12,joint_names[0]:t/.12}
                elif t<.36:binding={joint_names[0]:1}
                elif t<.48:
                    w=(t-.36)/.12;binding={joint_names[0]:1-w,joint_names[1]:w}
                elif t<.67:binding={joint_names[1]:1}
                elif t<.79:
                    w=(t-.67)/.12;binding={joint_names[1]:1-w,joint_names[2]:w}
                else:binding={joint_names[2]:1}
                ring_bindings.append(binding)
            surface(centers,radii,np.array(radii)*.82,ring_bindings)
    remaining = faces[~remove[faces].any(axis=1)]
    expanded = np.vstack([vertices,np.asarray(new_vertices)])
    rgba = np.vstack([colors,np.tile(color,(len(new_vertices),1))])
    faces = np.vstack([remaining,np.asarray(new_faces,dtype=np.uint32)])
    # Remove old fused-hand orphan vertices while preserving per-vertex source
    # IDs for UVs and new explicit weights.
    used=np.unique(faces);mapping=np.full(len(expanded),-1,dtype=int);mapping[used]=np.arange(len(used))
    mapped_bindings={int(mapping[originals+i]):b for i,b in enumerate(bindings)}
    return dict(vertices=expanded[used],faces=mapping[faces],colors=rgba[used],source_indices=used,
                bindings=mapped_bindings,hand_faces=np.r_[np.zeros(len(remaining),bool),np.ones(len(new_faces),bool)],
                report=reports,axes=axes)
