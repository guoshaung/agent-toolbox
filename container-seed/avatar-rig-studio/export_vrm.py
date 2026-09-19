"""Export a reconstructed, vertex-colored surface as skinned glTF and VRM 1.0.

The anatomical rig is a starting estimate. Optional landmarks.json replaces the
joint coordinates for nonstandard poses; this is not a learned auto-rigger.
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np

PARENTS = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
POSITIONS = {'hips': [0, .81, 0], 'spine': [0, .97, 0], 'chest': [0, 1.15, 0],
             'neck': [0, 1.33, 0], 'head': [0, 1.43, 0]}
for side, sign in [('left', 1), ('right', -1)]:
    for bone, parent, point in [
        ('Shoulder', 'chest', [.075, 1.27, 0]), ('UpperArm', side+'Shoulder', [.16, 1.25, 0]),
        ('LowerArm', side+'UpperArm', [.22, 1.04, .015]), ('Hand', side+'LowerArm', [.27, .86, .03]),
        ('UpperLeg', 'hips', [.095, .79, 0]), ('LowerLeg', side+'UpperLeg', [.12, .43, 0]),
        ('Foot', side+'LowerLeg', [.14, .07, .015]), ('Toes', side+'Foot', [.14, .035, .11]),
    ]:
        PARENTS[side+bone] = parent
        POSITIONS[side+bone] = [point[0]*sign, *point[1:]]

def glb(document, blob):
    encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    blob += b'\0' * (-len(blob) % 4)
    return (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(blob))
            + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
            + struct.pack('<II', len(blob), 0x004e4942) + blob)

def export(job, name='Image reconstructed avatar', t_pose=False, use_texture=True):
    reference = json.loads((job/'reference.json').read_text('utf-8')) if (job/'reference.json').is_file() else {}
    engine = 'Hunyuan3D-2mv' if (job/'multiview-reconstruction.json').is_file() else 'TripoSR'
    name = reference.get('name', name)
    data = np.load(job / 'mesh.npz')
    vertices = data['vertices'].astype(np.float32)
    colors = data['colors'][:, :3].astype(np.float32) / 255
    # Vertex colors in glTF are linear, whereas TripoSR predicts display RGB.
    colors = np.where(colors <= .04045, colors / 12.92, ((colors+.055)/1.055)**2.4)
    faces = data['faces'].astype(np.uint32)
    positions = dict(POSITIONS)
    if (job/'landmarks.json').exists():
        positions.update(json.loads((job/'landmarks.json').read_text('utf-8')))
    names = list(PARENTS)
    joints = np.array([positions[n] for n in names], dtype=np.float32)
    # Distance to each bone segment, with four normalized influences per vertex.
    distances = []
    for i, bone in enumerate(names):
        children = [n for n in names if PARENTS[n] == bone]
        tail = joints[names.index(children[0])] if children else joints[i] + [0, .045, 0]
        direction = tail-joints[i]
        t = np.clip((vertices-joints[i]) @ direction / max(direction@direction, 1e-8), 0, 1)
        distances.append(np.linalg.norm(vertices-joints[i]-t[:, None]*direction, axis=1))
    distances = np.stack(distances, axis=1)
    # Optional job-specific hint; do not mistake arbitrary turquoise clothing
    # for hair in every character.
    raw = data['colors'][:, :3].astype(np.float32)/255
    hair = reference.get('turquoiseHair', False) & (raw[:, 1] > raw[:, 0]*1.3) & (raw[:, 2] > raw[:, 0]*1.2) & (np.abs(vertices[:, 0])>.23)
    distances[hair] = 10
    distances[hair, names.index('head')] = 0
    indices = np.argsort(distances, axis=1)[:, :4].astype(np.uint16)
    selected = np.take_along_axis(distances, indices, axis=1)
    weights = np.exp(-(selected-selected[:, :1]) / .025)
    weights[weights < 1e-6] = 0
    weights /= weights.sum(axis=1, keepdims=True)
    indices[weights == 0] = 0
    # Bake arms into an approximate T pose; recompute rest skeleton and normals.
    transforms = np.repeat(np.eye(4)[None], len(names), axis=0)
    for side, sign in ([('left', 1), ('right', -1)] if t_pose else []):
        a = names.index(side+'UpperArm')
        b = names.index(side+'LowerArm')
        delta = joints[b]-joints[a]
        angle = (0 if sign == 1 else np.pi) - np.arctan2(delta[1], delta[0])
        co, si = np.cos(angle), np.sin(angle)
        rotation = np.array([[co,-si,0],[si,co,0],[0,0,1]])
        translation = joints[a] - rotation@joints[a]
        for bone in ['UpperArm','LowerArm','Hand']:
            j = names.index(side+bone)
            transforms[j, :3, :3] = rotation
            transforms[j, :3, 3] = translation
    homogeneous = np.c_[vertices, np.ones(len(vertices))]
    vertices = sum(weights[:, k, None] * np.einsum('nij,nj->ni', transforms[indices[:, k]], homogeneous)[:, :3] for k in range(4)).astype(np.float32)
    joints = np.einsum('nij,nj->ni', transforms, np.c_[joints,np.ones(len(joints))])[:, :3]
    import trimesh
    normals = trimesh.Trimesh(vertices=vertices, faces=faces, process=False).vertex_normals.astype(np.float32)
    document = {'asset': {'version': '2.0', 'generator': 'Avatar Rig Studio / '+engine},
                'scene': 0, 'scenes': [{'nodes': [0, len(names)+1]}], 'nodes': [], 'meshes': [],
                'bufferViews': [], 'accessors': [], 'buffers': [], 'skins': [],
                'materials': [{'name': 'Reconstructed colors', 'doubleSided': True,
                              'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': .85},
                              'extensions': {'KHR_materials_unlit': {}}}],
                'extensionsUsed': ['KHR_materials_unlit']}
    blob = bytearray()
    def accessor(array, component_type, kind, target=None, bounds=False):
        array = np.ascontiguousarray(array)
        blob.extend(b'\0'*(-len(blob)%4))
        view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': array.nbytes}
        if target: view['target'] = target
        document['bufferViews'].append(view)
        blob.extend(array.tobytes())
        result = {'bufferView': len(document['bufferViews'])-1, 'componentType': component_type,
                  'count': len(array), 'type': kind}
        if bounds:
            result.update(min=array.min(axis=0).reshape(-1).tolist(), max=array.max(axis=0).reshape(-1).tolist())
        document['accessors'].append(result)
        return len(document['accessors'])-1
    node_indices = {n: i+1 for i,n in enumerate(names)}
    document['nodes'].append({'name': 'Avatar', 'children': [1]})
    for i, bone in enumerate(names):
        parent = PARENTS[bone]
        local = joints[i] - joints[names.index(parent)] if parent else joints[i]
        node = {'name': bone, 'translation': local.tolist()}
        children = [node_indices[n] for n in names if PARENTS[n] == bone]
        if children: node['children'] = children
        document['nodes'].append(node)
    document['nodes'].append({'name': 'Character surface', 'mesh': 0, 'skin': 0})
    inverse = np.repeat(np.eye(4, dtype=np.float32)[None], len(names), axis=0)
    inverse[:, :3, 3] = -joints
    document['skins'].append({'name': 'Humanoid skin', 'joints': list(node_indices.values()), 'skeleton': 1,
                             'inverseBindMatrices': accessor(inverse.transpose(0,2,1),5126,'MAT4')})
    attributes = {'POSITION': accessor(vertices,5126,'VEC3',34962,True),
                  'NORMAL': accessor(normals,5126,'VEC3',34962),
                  'COLOR_0': accessor(colors.astype(np.float32),5126,'VEC3',34962),
                  'JOINTS_0': accessor(indices,5123,'VEC4',34962),
                  'WEIGHTS_0': accessor(weights.astype(np.float32),5126,'VEC4',34962)}
    textured = use_texture and 'projection_uv' in data and (job/'input-prepared.png').is_file()
    multiview = use_texture and 'multiview_uv' in data
    primitives = []
    texture_faces = np.zeros(len(faces), dtype=bool)
    if textured:
        uv = data['projection_uv'].astype(np.float32)
        # Restrict the reference projection to front-facing triangles inside the
        # image. Occluded side/back surfaces retain the learned appearance.
        facing = normals[faces].mean(axis=1)[:,2]
        uv_valid = ((uv >= 0) & (uv <= 1)).all(axis=1)
        texture_faces = (facing > .35) & uv_valid[faces].all(axis=1)
        texture = (job/'input-prepared.png').read_bytes()
        blob.extend(b'\0'*(-len(blob)%4))
        image_view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer':0, 'byteOffset':len(blob), 'byteLength':len(texture)})
        blob.extend(texture)
        document['images']=[{'bufferView':image_view,'mimeType':'image/png','name':'Original reference (native pixels)'}]
        document['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}]
        document['textures']=[{'source':0,'sampler':0}]
        document['materials'].append({'name':'Reference detail projection','doubleSided':True,
          'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':.85},
          'extensions':{'KHR_materials_unlit':{}}})
        attrs = {k:v for k,v in attributes.items() if k!='COLOR_0'}
        attrs['TEXCOORD_0'] = accessor(uv,5126,'VEC2',34962)
        if texture_faces.any():
            primitives.append({'attributes':attrs,'indices':accessor(faces[texture_faces].reshape(-1),5125,'SCALAR',34963),'material':1})
    if multiview:
        face_normals=normals[faces].mean(axis=1)
        scores=np.stack((face_normals[:,2],face_normals[:,0],-face_normals[:,2]),axis=1)
        groups=scores.argmax(axis=1)
        document['images']=[];document['textures']=[]
        document['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}]
        for j,filename in enumerate(data['texture_files']):
            image_path=(job/str(filename)).resolve()
            if image_path.parent != job.resolve():raise ValueError('Texture outside job')
            texture=image_path.read_bytes()
            blob.extend(b'\0'*(-len(blob)%4))
            document['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(texture)})
            blob.extend(texture)
            document['images'].append({'bufferView':len(document['bufferViews'])-1,'mimeType':'image/png','name':str(filename)})
            document['textures'].append({'source':j,'sampler':0})
            document['materials'].append({'name':f'Multiview reference {filename}','doubleSided':True,
                'pbrMetallicRoughness':{'baseColorTexture':{'index':j},'metallicFactor':0,'roughnessFactor':.85},
                'extensions':{'KHR_materials_unlit':{}}})
            attrs={k:v for k,v in attributes.items() if k!='COLOR_0'}
            attrs['TEXCOORD_0']=accessor(data['multiview_uv'][j].astype(np.float32),5126,'VEC2',34962)
            chosen=groups==j
            if chosen.any():
                primitives.append({'attributes':attrs,'indices':accessor(faces[chosen].reshape(-1),5125,'SCALAR',34963),'material':len(document['materials'])-1})
        texture_faces[:]=True
    if (~texture_faces).any():
        primitives.append({'attributes':attributes,'indices':accessor(faces[~texture_faces].reshape(-1),5125,'SCALAR',34963),'material':0})
    document['meshes'].append({'primitives':primitives})
    times = np.array([0,.5,1,1.5,2],dtype=np.float32)
    angles = np.array([0,.35,0,-.35,0])/2
    rotations = np.stack([np.zeros(5),np.sin(angles),np.zeros(5),np.cos(angles)],axis=1).astype(np.float32)
    document['animations'] = [{'name': 'Head turn (skin test)',
        'samplers': [{'input': accessor(times,5126,'SCALAR',bounds=True), 'output':accessor(rotations,5126,'VEC4'), 'interpolation':'LINEAR'}],
        'channels': [{'sampler':0,'target':{'node':node_indices['head'],'path':'rotation'}}]}]
    document['buffers'] = [{'byteLength': len(blob)}]
    (job/'avatar.glb').write_bytes(glb(document,bytes(blob)))
    document['extensionsUsed'].append('VRMC_vrm')
    document['extensions'] = {'VRMC_vrm': {'specVersion':'1.0',
        'meta': {'name':name, 'version':'0.3.0', 'authors':['Avatar Rig Studio - automatic reconstruction'],
                 'copyrightInformation': reference.get('copyright', 'Auto-reconstructed derivative draft; reference rights remain with the original rights holders.'),
                 'licenseUrl':'https://vrm.dev/licenses/1.0/',
                 **({'otherLicenseUrl':reference['licenseUrl']} if reference.get('licenseUrl') else {}),
                 **({'references':[reference['sourceUrl']]} if reference.get('sourceUrl') else {}),
                 'allowRedistribution':False, 'commercialUsage':'personalNonProfit'},
        'humanoid': {'humanBones': {n:{'node':i} for n,i in node_indices.items()}}}}
    (job/'avatar.vrm').write_bytes(glb(document,bytes(blob)))
    report = {'format':'VRM 1.0', 'model':'avatar.vrm', 'glb':'avatar.glb',
              'name': name,
              'vertices':len(vertices), 'triangles':len(faces), 'bones':len(names),
              'skin':'4 normalized weights per vertex', 'rigQuality':'estimated draft; manual correction required',
              'restPose':'approximate T pose' if t_pose else 'reference pose (T-pose correction required for retargeting)',
              'source':engine,
              'appearance':'three-view reference projection (not diffusion texture)' if multiview else ('native-resolution reference projection + inferred side/back colors' if textured else 'vertex colors'),
              'texturedTriangles': int(texture_faces.sum()),
              'limitations':(['AI-generated view inconsistencies and texture seams','Unobserved right-side texture approximated'] if multiview else ['Back surface inferred from one image'])+['No facial blendshapes','Hair and clothing have no physics'],
              'weightSumError':float(abs(weights.sum(1)-1).max())}
    (job/'project.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(report),flush=True)
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', type=Path, required=True)
    parser.add_argument('--name', default='Image reconstructed avatar')
    parser.add_argument('--t-pose', action='store_true', help='Experimental: may deform joined hair/clothing')
    parser.add_argument('--vertex-colors', action='store_true', help='Disable reference texture for A/B comparison')
    args = parser.parse_args()
    export(args.job, args.name, args.t_pose, not args.vertex_colors)
