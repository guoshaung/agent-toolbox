"""Small real image/GLB regressions; no pretrained models required."""
import importlib.util
import json
import struct
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
            boxes = [i.getbbox() for i in images]
            self.assertEqual({i.size for i in images}, {(1024, 1024)})
            self.assertLess(max(b[3]-b[1] for b in boxes)-min(b[3]-b[1] for b in boxes), 3)
            self.assertLess(boxes[1][2]-boxes[1][0], boxes[0][2]-boxes[0][0])


class ExportTest(unittest.TestCase):
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
