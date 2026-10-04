"""Offline acceptance against human labels, never the detector's own predictions.

Manifest: {source:"wuthering_waves",annotations:"human",template:"target.png",
 frames:[{image:"frame.png",bbox:[x,y,w,h] or null,split:"test"}, ...]}
Coordinates use the full original image. Empty/mixed/unlabelled inputs cannot pass.
"""
import argparse
import json
import time
import hashlib
from pathlib import Path
import cv2
import numpy as np
from config import DetectConfig
from target_detector import TargetDetector


def iou(a, b):
    x,y=max(a[0],b[0]),max(a[1],b[1])
    right,bottom=min(a[0]+a[2],b[0]+b[2]),min(a[1]+a[3],b[1]+b[3])
    intersection=max(0,right-x)*max(0,bottom-y)
    union=a[2]*a[3]+b[2]*b[3]-intersection
    return intersection/union if union else 0


def evaluate(manifest, mode='feature'):
    root=Path(manifest).resolve().parent
    data=json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
    frames=data.get('frames',[])
    if not frames or data.get('annotations')!='human':
        raise ValueError('需要非空人工标注集；检测器预测不能充当真值。')
    if any('bbox' not in f or f.get('split')!='test' for f in frames):
        raise ValueError('每帧必须明确 bbox 或 null，且属于未参与模板选取的 test 集。')
    template=str(root/data['template']) if mode!='color' else ''
    detector=TargetDetector(DetectConfig(mode=mode,template_path=template,lost_hold_frames=0,smooth_alpha=1.0))
    tp=fp=fn=tn=0
    errors=[]; latency=[]; overlaps=[]; details=[]; hashes=set(); cases=set()
    for frame in frames:
        image=cv2.imdecode(np.fromfile(root/frame['image'],dtype=np.uint8),cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError('读不到截图：'+frame['image'])
        hashes.add(hashlib.sha256(image.tobytes()).hexdigest())
        cases.add(frame.get('case','unspecified'))
        box=frame['bbox']
        if box is not None and (not isinstance(box,list) or len(box)!=4 or not all(isinstance(v,(int,float)) and np.isfinite(v) for v in box) or box[2]<=0 or box[3]<=0):
            raise ValueError('标注框无效：'+frame['image'])
        before=time.perf_counter();target=detector.detect(image);latency.append((time.perf_counter()-before)*1000)
        found=bool(target.found and not target.predicted and target.bbox)
        overlap=iou(target.bbox,box) if found and box is not None else 0
        correct=found and box is not None and overlap>=.5
        if correct:
            tp+=1;overlaps.append(overlap)
            errors.append(float(np.hypot(target.x-(box[0]+box[2]/2),target.y-(box[1]+box[3]/2))))
        else:
            if found: fp+=1
            if box is not None: fn+=1
            elif not found: tn+=1
        details.append({'image':frame['image'],'found':found,'iou':round(overlap,4),'predicted':target.predicted})
    positive=sum(f['bbox'] is not None for f in frames);negative=len(frames)-positive
    precision=tp/(tp+fp) if tp+fp else 0
    recall=tp/(tp+fn) if tp+fn else 0
    required_cases={'hud_distractor','target_absent','occluded','scale_change','motion'}
    sufficient=(data.get('source')=='wuthering_waves' and len(frames)>=30 and positive>=20 and negative>=10
                and len(hashes)==len(frames) and required_cases.issubset(cases))
    latency_p95=float(np.percentile(latency,95))
    passed=sufficient and precision>=.95 and recall>=.90 and (fp/negative if negative else 1)<=.05 and latency_p95<=100
    return {'validation_status':'passed_real_replay' if passed else 'failed_real_replay' if sufficient else 'insufficient_real_evidence',
            'source':data.get('source'),'mode':mode,'frames':len(frames),'positive_frames':positive,'negative_frames':negative,
            'tp':tp,'fp':fp,'fn':fn,'tn':tn,'precision':precision,'recall':recall,'iou_mean':float(np.mean(overlaps)) if overlaps else None,
            'center_error_p95_px':float(np.percentile(errors,95)) if errors else None,'latency_p95_ms':latency_p95,
            'unique_images':len(hashes),'covered_cases':sorted(cases),'required_cases':sorted(required_cases),
            'control_verified':False,'details':details}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('manifest');parser.add_argument('--mode',choices=['feature','template','color'],default='feature');parser.add_argument('--output',required=True)
    args=parser.parse_args();report=evaluate(args.manifest,args.mode);Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(report['validation_status']);raise SystemExit(0 if report['validation_status']=='passed_real_replay' else 2)
