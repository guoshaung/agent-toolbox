import json
import tempfile
import unittest
from pathlib import Path
import cv2
import numpy as np
from config import DetectConfig
from feature_matcher import FeatureMatcher
from target_detector import Target, TargetDetector
from observation import observed_target, live_backend
from config import CaptureConfig
from screen_capture import ScreenCapture, CaptureError
from unittest.mock import patch
from config import Config
from main import GameAgent
from evaluate_replay import evaluate, iou


def textured():
    rng=np.random.default_rng(713)
    image=rng.integers(0,256,(240,280,3),dtype=np.uint8)
    image=cv2.GaussianBlur(image,(3,3),.5)
    cv2.putText(image,'TARGET 713',(30,125),cv2.FONT_HERSHEY_SIMPLEX,1,(255,255,255),3)
    return image


class EvidenceTests(unittest.TestCase):
    def test_startup_waits_for_focus_without_inventing_a_frame(self):
        config=Config();config.control.backend='null';config.output.show_window=False
        agent=GameAgent(config)
        with patch.object(agent.source,'grab',side_effect=CaptureError('target not foreground')),patch.object(agent.source,'has_base_region',return_value=False),patch('main.ABORT.sleep'):
            self.assertIsNone(agent._grab())
            self.assertEqual(agent.observed_frames,0)
            self.assertEqual(agent.skipped_frames,1)
        agent.source.close()

    def test_missing_window_never_reuses_old_desktop_region(self):
        capture=ScreenCapture(CaptureConfig(window_title='鸣潮'))
        capture._last_base=(0,0,1920,1080)
        with patch('screen_capture.find_window_rect',return_value=None):
            with self.assertRaises(CaptureError):capture.resolve_base_region()

    def test_feature_matches_selected_object_among_red_distractors(self):
        template=textured();image=np.zeros((700,1000,3),np.uint8)
        image[210:450,370:650]=template
        for x in [50,140,760,900]: cv2.circle(image,(x,180),35,(0,0,255),-1)
        result=FeatureMatcher(template).match(image)
        self.assertIsNotNone(result)
        self.assertGreater(iou(result[0],[370,210,280,240]),.95)

    def test_feature_handles_scale_change(self):
        template=textured();image=np.zeros((600,900,3),np.uint8)
        smaller=cv2.resize(template,None,fx=.8,fy=.8)
        image[150:342,300:524]=smaller
        result=FeatureMatcher(template).match(image)
        self.assertIsNotNone(result)
        self.assertGreater(iou(result[0],[300,150,224,192]),.9)

    def test_unrelated_scene_and_red_dot_do_not_match(self):
        matcher=FeatureMatcher(textured())
        for image in [np.random.default_rng(999).integers(0,256,(600,900,3),dtype=np.uint8),np.zeros((600,900,3),np.uint8)]:
            cv2.circle(image,(450,300),60,(0,0,255),-1)
            self.assertIsNone(matcher.match(image))

    def test_predicted_or_frozen_positions_are_not_observations(self):
        self.assertFalse(observed_target(Target(True,x=100,predicted=True)))
        self.assertFalse(observed_target(Target(True,x=100),frozen=True))
        self.assertTrue(observed_target(Target(True,x=100)))

    def test_unverified_game_is_always_read_only(self):
        self.assertEqual(live_backend('screen','sendinput','鸣潮','鸣潮','block'),'null')
        self.assertEqual(live_backend('screen','sendinput','AgentToolboxTestTarget','','off'),'null')
        self.assertEqual(live_backend('screen','sendinput','AgentToolboxTestTarget','AgentToolboxTestTarget','block'),'sendinput')

    def test_unicode_template_path_and_reject_flat_template(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'目标截图.png'
            cv2.imencode('.png',textured())[1].tofile(path)
            detector=TargetDetector(DetectConfig(mode='feature',template_path=str(path)))
            self.assertTrue(detector.detect(textured()).found)
            cv2.imencode('.png',np.zeros((80,80,3),np.uint8))[1].tofile(path)
            with self.assertRaises(ValueError):TargetDetector(DetectConfig(mode='template',template_path=str(path)))

    def test_empty_or_unlabelled_replay_cannot_pass(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'manifest.json'
            for data in [{'source':'wuthering_waves','annotations':'human','frames':[]},{'frames':[{'image':'x.png'}]}]:
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):evaluate(path)

    def test_synthetic_replay_never_becomes_real_game_acceptance(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);image=textured()
            cv2.imencode('.png',image)[1].tofile(root/'target.png')
            manifest={'source':'synthetic','annotations':'human','template':'target.png','frames':[{'image':'target.png','bbox':[0,0,280,240],'split':'test'}]}
            (root/'manifest.json').write_text(json.dumps(manifest))
            report=evaluate(root/'manifest.json')
            self.assertEqual(report['validation_status'],'insufficient_real_evidence')
            self.assertFalse(report['control_verified'])


if __name__=='__main__':unittest.main()
