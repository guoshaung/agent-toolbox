"""Semantic regressions for opt-in replacement hand anatomy and skin isolation."""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'container-seed/avatar-rig-studio'))
from export_vrm import export
from hand_rig import replace_hands


def fixture(job):
    body=trimesh.creation.icosphere(subdivisions=4)
    body.apply_scale([.15,.6,.12]);body.apply_translation([0,.8,0])
    hands={}
    meshes=[body]
    for side,sign in [('left',1),('right',-1)]:
        wrist=[sign*.36,.91,.03];direction=np.array([sign*.68,-.733,0]);direction/=np.linalg.norm(direction)
        old=trimesh.creation.icosphere(subdivisions=2,radius=.03)
        old.apply_translation(np.array(wrist)+direction*.06);meshes.append(old)
        hands[side]={'wrist':wrist,'direction':direction.tolist()}
    mesh=trimesh.util.concatenate(meshes)
    np.savez(job/'mesh.npz',vertices=mesh.vertices,faces=mesh.faces,colors=np.tile([240,220,210,255],(len(mesh.vertices),1)))
    (job/'hand-repair.json').write_text(json.dumps({'hands':hands}))
    return mesh


class HandTest(unittest.TestCase):
    def test_replacement_is_opt_in_and_has_all_humanoid_fingers(self):
        with tempfile.TemporaryDirectory() as temp:
            job=Path(temp);fixture(job)
            report=export(job)
            self.assertEqual(report['fingerBones'],30)
            self.assertEqual(report['bones'],61)
            raw=(job/'avatar.vrm').read_bytes();size=struct.unpack_from('<I',raw,12)[0]
            doc=json.loads(raw[20:20+size]);buffer=raw[28+size:]
            human=doc['extensions']['VRMC_vrm']['humanoid']['humanBones']
            self.assertEqual(len(human),51)
            coverage=json.loads((job/'hand-rig.json').read_text())['weightedVertices']
            self.assertEqual(len(coverage),30)
            self.assertTrue(all(n>=12 for n in coverage.values()))
            for side in ['left','right']:
                for finger in ['Thumb','Index','Middle','Ring','Little']:
                    parts=['Metacarpal','Proximal','Distal'] if finger=='Thumb' else ['Proximal','Intermediate','Distal']
                    parent=human[side+'Hand']['node']
                    for part in parts:
                        child=human[side+finger+part]['node']
                        self.assertIn(child,doc['nodes'][parent]['children']);parent=child
            self.assertFalse(any(n.endswith('Tip') for n in human))
            def read(accessor,dtype,width):
                a=doc['accessors'][accessor];view=doc['bufferViews'][a['bufferView']]
                return np.frombuffer(buffer,dtype=dtype,count=a['count']*width,offset=view.get('byteOffset',0)).reshape(-1,width)
            p=doc['meshes'][0]['primitives'][0]['attributes']
            pos=read(p['POSITION'],'<f4',3);idx=read(p['JOINTS_0'],'<u2',4);weights=read(p['WEIGHTS_0'],'<f4',4)
            self.assertLess(np.abs(weights.sum(1)-1).max(),1e-6)
            torso=np.abs(pos[:,0])<.2
            self.assertFalse(np.any((idx[torso]>=21)&(weights[torso]>1e-6)))
            (job/'hand-repair.json').unlink()
            report=export(job)
            self.assertEqual(report['bones'],21)
            self.assertFalse((job/'hand-rig.json').exists())

    def test_invalid_landmarks_fail_before_export(self):
        with tempfile.TemporaryDirectory() as temp:
            job=Path(temp);fixture(job)
            config=json.loads((job/'hand-repair.json').read_text())
            for field,value in [('direction',[0,0,0]),('direction',[1,0]),
                                ('wrist',[float('nan'),0,0]),('wrist',None)]:
                with self.subTest(field=field,value=value):
                    modified=json.loads(json.dumps(config))
                    modified['hands']['left'][field]=value
                    (job/'hand-repair.json').write_text(json.dumps(modified))
                    with self.assertRaisesRegex(ValueError,'finite XYZ'):
                        export(job)


if __name__=='__main__':unittest.main()
