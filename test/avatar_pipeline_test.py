"""Small real image/GLB regressions; no pretrained models required."""
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
import trimesh

STUDIO = Path(__file__).resolve().parents[1] / 'container-seed/avatar-rig-studio'
sys.path.insert(0, str(STUDIO))
from prepare_multiview_inputs import cutout, prepare
from export_vrm import export


class ImagePreparationTest(unittest.TestCase):
    def test_white_clothing_is_not_removed_with_background(self):
        image = Image.new('RGB', (200, 300), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((65, 20, 135, 280), fill='white', outline='black', width=3)
        result = cutout(image)
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((100, 150))[3], 255)

    def test_invalid_background_or_empty_image_fails(self):
        for image in [Image.new('RGBA', (200, 300), (0, 0, 0, 0)),
                      Image.new('RGB', (200, 300), 'blue'), Image.new('RGB', (200, 300), 'white')]:
            with self.assertRaises(ValueError): cutout(image)

    def test_different_aspect_views_keep_their_aspect_and_align_height(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            for view, width in [('front', 150), ('left', 70), ('back', 150)]:
                image = Image.new('RGBA', (250, 400))
                ImageDraw.Draw(image).rectangle((10, 20, 10+width, 370), fill='red')
                image.save(job / f'input-{view}.png')
            prepare(job)
            images = [Image.open(job/f'{v}.png') for v in ['front','left','back']]
            self.assertTrue(all((job/f'texture-source-{v}.png').is_file() for v in ['front','left','back']))
            boxes = [i.getbbox() for i in images]
            self.assertEqual({i.size for i in images}, {(1024, 1024)})
            self.assertLess(max(b[3]-b[1] for b in boxes)-min(b[3]-b[1] for b in boxes), 3)
            self.assertLess(boxes[1][2]-boxes[1][0], boxes[0][2]-boxes[0][0])


class ExportTest(unittest.TestCase):
    def test_reviewed_face_regions_export_vrm_expression_morphs(self):
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
            mesh=trimesh.creation.icosphere(subdivisions=2)
            mesh.vertices[:,1]+=1.35
            np.savez(job/'mesh.npz',vertices=mesh.vertices,faces=mesh.faces,
                     colors=np.tile([240,220,210,255],(len(mesh.vertices),1)))
            (job/'face-expressions.json').write_text(json.dumps({'regions':{
                'leftEye':{'center':[.08,1.45,.1],'radius':[.12,.12,.12]},
                'rightEye':{'center':[-.08,1.45,.1],'radius':[.12,.12,.12]},
                'mouth':{'center':[0,1.35,.1],'radius':[.12,.12,.12]}}}))
            result=export(job)
            self.assertEqual(result['expressions'],['blinkLeft','blinkRight','happy','aa'])
            self.assertGreater(result['expressionFeatureVertices'],0)
            raw=(job/'avatar.vrm').read_bytes();size=struct.unpack_from('<I',raw,12)[0]
            doc=json.loads(raw[20:20+size]);mesh_doc=doc['meshes'][0]
            self.assertEqual(len(mesh_doc['primitives'][0]['targets']),4)
            self.assertIn('Expression eyelids and mouth',[m['name'] for m in doc['materials']])
            self.assertEqual(set(doc['extensions']['VRMC_vrm']['expressions']['preset']),
                             {'blinkLeft','blinkRight','happy','aa'})

    def test_reviewed_nose_limit_reduces_only_front_spike(self):
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
            vertices=np.array([[0,1.40,.22],[.16,1.40,.22],[0,1.1,.22]],dtype=float)
            np.savez(job/'mesh.npz',vertices=vertices,faces=np.array([[0,1,2]]),
                     colors=np.tile([240,220,210,255],(3,1)))
            (job/'face-shape.json').write_text(json.dumps({'nose':{
                'center':[0,1.40,.13],'radius':[.08,.08,.15],'maxZ':.135}}))
            result=export(job)
            self.assertEqual(result['noseShapeVerticesAdjusted'],1)

    def test_separated_torso_cloth_exports_custom_bounce_morph(self):
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
            mesh=trimesh.creation.icosphere(subdivisions=2)
            mesh.apply_scale([.20,.25,.20])
            mesh.vertices[:,1]+=1.1
            np.savez(job/'mesh.npz',vertices=mesh.vertices,faces=mesh.faces,
                     colors=np.tile([230,220,210,255],(len(mesh.vertices),1)))
            (job/'torso-cloth.json').write_text(json.dumps({'outer':{
                'center':[0,1.1,0],'radius':[.35,.35,.35]},'bounce':{
                'center':[0,1.15,.1],'radius':[.25,.25,.25],'amplitude':.01},'restOffset':.0025}))
            result=export(job)
            self.assertGreater(result['clothPhysics']['copiedFrontFaces'],12)
            raw=(job/'avatar.vrm').read_bytes();size=struct.unpack_from('<I',raw,12)[0]
            doc=json.loads(raw[20:20+size])
            self.assertIn('chestBounce',doc['extensions']['VRMC_vrm']['expressions']['custom'])
            self.assertEqual(len(doc['meshes'][0]['primitives'][0]['targets']),1)

    def test_missing_side_is_mirrored_and_negative_x_faces_use_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            mesh = trimesh.creation.icosphere(subdivisions=1)
            np.savez(job/'hunyuan-raw.npz', vertices=mesh.vertices, faces=mesh.faces)
            for view in ['front','left','back']:
                image = Image.new('RGBA', (32,32), 'red')
                ImageDraw.Draw(image).rectangle((16,0,31,31), fill='blue')
                image.save(job/(view+'.png'))
            def prepare_mesh():
                subprocess.run([sys.executable,str(STUDIO/'prepare_multiview_mesh.py'),
                                '--job',str(job)],check=True,capture_output=True)
            prepare_mesh()
            right = np.asarray(Image.open(job/'right-texture.png'))
            left = np.asarray(Image.open(job/'left-texture.png'))
            np.testing.assert_array_equal(right,left[:,::-1])
            report=export(job)
            self.assertIn('mirrored',report['textureProvenance']['right'])
            raw=(job/'avatar.vrm').read_bytes();size=struct.unpack_from('<I',raw,12)[0]
            doc=json.loads(raw[20:20+size]);buffer=raw[28+size:]
            def read(accessor,dtype,width):
                a=doc['accessors'][accessor];v=doc['bufferViews'][a['bufferView']]
                return np.frombuffer(buffer,dtype=dtype,count=a['count']*width,
                                     offset=v.get('byteOffset',0)).reshape(-1,width)
            primitives=doc['meshes'][0]['primitives']
            self.assertEqual(len(primitives),4)
            normals=read(primitives[0]['attributes']['NORMAL'],'<f4',3)
            negative_x_count=0
            for primitive in primitives:
                faces=read(primitive['indices'],'<u4',1).reshape(-1,3)
                n=normals[faces].mean(1)
                negative=(n[:,0]<0)&(-n[:,0]>np.abs(n[:,2]))&(normals[faces][:,:,1].mean(1)<.25)
                if negative.any():
                    negative_x_count+=int(negative.sum())
                    self.assertIn('right-texture.png',doc['materials'][primitive['material']]['name'])
            self.assertGreater(negative_x_count,0)
            Image.new('RGBA',(32,32),'green').save(job/'right.png')
            prepare_mesh()
            self.assertEqual(json.loads((job/'texture-provenance.json').read_text())['right'],'supplied reference')
            self.assertEqual(Image.open(job/'right-texture.png').getpixel((0,0)),(0,128,0))

    def test_multiview_vrm_keeps_views_materials_and_character_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            mesh = trimesh.creation.icosphere(subdivisions=2)
            mesh.vertices[:, 1] += 1
            uv = np.full((3, len(mesh.vertices), 2), .5, dtype=np.float32)
            for view, color in [('front', 'red'), ('left', 'green'), ('back', 'blue')]:
                Image.new('RGB', (16, 16), color).save(job/(view+'.png'))
            np.savez(job/'mesh.npz', vertices=mesh.vertices, faces=mesh.faces,
                     colors=np.tile([255,255,255,255], (len(mesh.vertices),1)),
                     multiview_uv=uv, texture_files=np.array(['front.png','left.png','back.png']))
            (job/'multiview-reconstruction.json').write_text('{}')
            (job/'reference.json').write_text(json.dumps({'name':'Test character','copyright':'Owner'}))
            result = export(job)
            data = (job/'avatar.vrm').read_bytes()
            self.assertEqual(data[:4], b'glTF')
            self.assertEqual(struct.unpack_from('<I', data, 8)[0], len(data))
            length = struct.unpack_from('<I', data, 12)[0]
            doc = json.loads(data[20:20+length])
            self.assertEqual(len(doc['images']), 3)
            self.assertEqual(len(doc['meshes'][0]['primitives']), 3)
            self.assertEqual(doc['extensions']['VRMC_vrm']['meta']['name'], 'Test character')
            self.assertEqual(result['source'], 'Hunyuan3D-2mv')
            self.assertEqual(result['triangles'], len(mesh.faces))
            self.assertEqual(result['texturedTriangles'], len(mesh.faces))
            self.assertEqual(len(doc['skins'][0]['joints']), 21)
            for primitive in doc['meshes'][0]['primitives']:
                self.assertIn('TEXCOORD_0', primitive['attributes'])
                self.assertIn('WEIGHTS_0', primitive['attributes'])


if __name__ == '__main__': unittest.main()
