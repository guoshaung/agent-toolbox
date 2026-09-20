"""Split a reviewed three-view sheet at explicit gutters; never guess layout."""
import json
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

p=argparse.ArgumentParser();p.add_argument('--job',type=Path,required=True)
p.add_argument('--first-cut',type=int,required=True);p.add_argument('--second-cut',type=int,required=True)
args=p.parse_args()
root=args.job.resolve()
sheet=Image.open(root/'doubao-three-views.png').convert('RGB')
views={}
if not 0 < args.first_cut < args.second_cut < sheet.width:raise ValueError('裁切线必须按顺序位于图片内部')
for name,x0,x1 in [('front',0,args.first_cut),('left',args.first_cut,args.second_cut),('back',args.second_cut,sheet.width)]:
    crop=sheet.crop((x0,0,x1,sheet.height))
    rgb=np.asarray(crop)
    ink=rgb.min(2)<245
    ink=ndimage.binary_closing(ink,iterations=2)
    labels,n=ndimage.label(ink)
    sizes=np.bincount(labels.ravel());sizes[0]=0
    main=labels==sizes.argmax()
    mask=ndimage.binary_fill_holes(main)
    rgba=crop.convert('RGBA');rgba.putalpha(Image.fromarray((mask*255).astype('uint8')))
    box=rgba.getbbox()
    if box is None:raise ValueError(name+' has no foreground')
    views[name]=(rgba,box)
report={'provider':'Doubao web image generation','sheetSize':list(sheet.size),'views':{},'normalization':'shared scale and vertical origin; no per-view stretching'}
for name,(rgba,box) in views.items():
    canvas=Image.new('RGBA',(sheet.height,sheet.height),(255,255,255,0))
    center=(box[0]+box[2])/2
    canvas.alpha_composite(rgba,(round(sheet.height/2-center),0))
    canvas=canvas.resize((1024,1024),Image.Resampling.LANCZOS)
    canvas.save(root/(name+'.png'))
    report['views'][name]={'bboxBeforeNormalization':list(box),'file':name+'.png','size':[1024,1024]}
(root/'views.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report),flush=True)
