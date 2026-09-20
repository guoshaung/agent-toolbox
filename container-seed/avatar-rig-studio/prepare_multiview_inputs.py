"""Validate and normalize three full-body references without warping aspect ratios."""
from pathlib import Path

from PIL import Image, ImageOps
import numpy as np
from scipy import ndimage

VIEWS = ('front', 'left', 'back')


def cutout(image):
    image = image.convert('RGBA')
    alpha = np.asarray(image.getchannel('A'))
    if alpha.max() == 0:
        raise ValueError('图片完全透明')
    if alpha.min() < 250:
        return image
    # Only accept plain white backgrounds here. A white shirt must not be
    # thresholded away: flood from the border, then fill enclosed foreground.
    rgb = np.asarray(image)[:, :, :3]
    white = rgb.min(axis=2) >= 245
    border = np.concatenate((white[0], white[-1], white[:, 0], white[:, -1]))
    if border.mean() < .95:
        raise ValueError('三视图请使用透明或纯白背景；有场景的图片请先去背景')
    seed = np.zeros_like(white)
    seed[0] = white[0]; seed[-1] = white[-1]
    seed[:, 0] = white[:, 0]; seed[:, -1] = white[:, -1]
    background = ndimage.binary_propagation(seed, mask=white)
    foreground = ndimage.binary_fill_holes(~background)
    labels, _ = ndimage.label(foreground)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= max(16, foreground.size * .00001)
    keep[0] = False
    image.putalpha(Image.fromarray((keep[labels] * 255).astype('uint8')))
    if image.getbbox() is None:
        raise ValueError('没有识别到人物，请检查背景和透明通道')
    return image


def prepare(job):
    for view in VIEWS + (('right',) if (job/'input-right.png').is_file() else ()):
        source = job / f'input-{view}.png'
        if not source.is_file():
            raise ValueError(f'缺少 {view} 图片')
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            if image.width * image.height > 32_000_000 or min(image.size) < 128:
                raise ValueError(f'{view} 图尺寸无效（短边至少128像素，总像素不超过3200万）')
            # A common square canvas preserves within-view proportions. Height
            # normalization matches the upstream MV image processor contract.
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            image = cutout(image)
            image = image.crop(image.getbbox())
            image.thumbnail((870, 870), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (1024, 1024), (255, 255, 255, 0))
            canvas.alpha_composite(image, ((1024-image.width)//2, (1024-image.height)//2))
            canvas.save(job / f'{view}.png')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', type=Path, required=True)
    prepare(parser.parse_args().job.resolve())
