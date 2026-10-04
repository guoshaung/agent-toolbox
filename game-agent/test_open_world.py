"""
test_open_world.py —— 开放世界场景的压力测试。

真实游戏画面里同色物到处都是（血条、UI、环境光）。这个测试在合成画面里
同时放一个「真目标」和一堆「干扰物」，逐帧跑检测器，验证三件事：

  1. 锁定之后不跳：干扰物再大再近，也不该把锁定目标拐跑
  2. 短暂遮挡不丢：目标被挡一两帧，靠丢帧保持撑过去
  3. 干扰物消失/出现不影响：多候选时的选择是稳定的

这是纯合成测试，不需要窗口、不需要截屏，可以直接跑：
    uv run python test_open_world.py
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass, field

import cv2
import numpy as np

from config import DetectConfig
from target_detector import TargetDetector

W, H = 2560, 1440
DOT_R = 22


@dataclass
class Decoy:
    x: int
    y: int
    r: int
    alive: bool = True
    wobble: float = field(default=0.0)


class Scene:
    """合成一个「像游戏」的画面：噪声背景 + 真目标 + 干扰物。"""

    def __init__(self, seed: int = 11, decoys: int = 8) -> None:
        self.rng = random.Random(seed)
        self.target_x = W // 2 + 400
        self.target_y = H // 2
        self.vx = 0.0
        self.frame_no = 0
        self.occlude_until = -1
        self.decoys = [
            Decoy(
                x=self.rng.randrange(60, W - 60),
                y=self.rng.randrange(60, H - 60),
                r=self.rng.randrange(14, 60),
            )
            for _ in range(decoys)
        ]
        # 预生成一张噪声背景（模拟游戏画面的杂乱色彩）
        base = np.random.default_rng(seed).integers(0, 70, (H, W, 3), dtype=np.uint8)
        # 加一些大块的暖色区域，模拟环境光
        overlay = base.copy()
        cv2.circle(overlay, (int(W * 0.2), int(H * 0.3)), 400, (30, 40, 90), -1)
        cv2.circle(overlay, (int(W * 0.8), int(H * 0.7)), 500, (10, 30, 70), -1)
        self.background = cv2.addWeighted(base, 0.7, overlay, 0.3, 0)

    def step(self) -> None:
        """目标缓慢移动；干扰物偶尔闪烁、偶尔变大。"""
        self.frame_no += 1
        # 目标每帧走 -6 ~ +6 px（开放世界里 marker 相对画面的移动速度）
        self.vx = 0.9 * self.vx + self.rng.uniform(-2.5, 2.5)
        self.target_x = int(np.clip(self.target_x + self.vx, 40, W - 40))

        for d in self.decoys:
            d.wobble += 0.1
            if self.rng.random() < 0.01:
                d.alive = not d.alive
            if self.rng.random() < 0.02:  # 偶尔挪一下
                d.x = int(np.clip(d.x + self.rng.uniform(-40, 40), 30, W - 30))
                d.y = int(np.clip(d.y + self.rng.uniform(-40, 40), 30, H - 30))
        # 每 60 帧把目标挡住 3 帧（模拟 marker 被树/建筑挡住）
        if self.frame_no % 60 == 0:
            self.occlude_until = self.frame_no + 3

    def render(self) -> np.ndarray:
        img = self.background.copy()
        for d in self.decoys:
            if not d.alive:
                continue
            r = int(d.r * (1.0 + 0.15 * np.sin(d.wobble)))
            # 暗红/亮红随机，都落在红色的 HSV 区间里
            color = (0, 0, 200 + self.rng.randrange(0, 55))
            cv2.circle(img, (d.x, d.y), max(4, r), color, -1)
        if self.frame_no > self.occlude_until:
            cv2.circle(img, (self.target_x, self.target_y), DOT_R, (0, 0, 255), -1)
            cv2.circle(img, (self.target_x, self.target_y), DOT_R + 4, (40, 40, 200), 2)
        return img


def run(label: str, detect_cfg: DetectConfig, frames: int = 240) -> dict:
    scene = Scene(seed=11, decoys=8)
    detector = TargetDetector(detect_cfg)
    detector.seed_lock(scene.target_x, scene.target_y)

    errors: list[float] = []
    jumped = 0
    lost = 0
    held = 0

    for _ in range(frames):
        scene.step()
        img = scene.render()
        frame = _Plain(img)
        t = detector.detect_frame(frame)
        if not t.found:
            lost += 1
            continue
        if t.predicted:
            held += 1
            # 保持期间真目标确实被挡住，误差不算它
            continue
        err = t.x - scene.target_x
        errors.append(abs(err))
        if abs(err) > 60:
            jumped += 1

    stats = {
        "label": label,
        "frames": frames,
        "detect_rate": (frames - lost) / frames,
        "held": held,
        "mean_err": statistics.fmean(errors) if errors else -1.0,
        "p95_err": sorted(errors)[int(len(errors) * 0.95)] if errors else -1.0,
        "max_err": max(errors) if errors else -1.0,
        "jumped": jumped,
    }
    print(f"  {label}")
    print(f"    检出率 {stats['detect_rate']*100:5.1f}%   丢帧保持 {held} 帧   "
          f"|err| 均值 {stats['mean_err']:6.2f}px   p95 {stats['p95_err']:6.2f}px   "
          f"最大 {stats['max_err']:6.2f}px   跳变(>60px) {jumped} 次")
    return stats


class _Plain:
    """测试用的 Frame 壳：整幅就是逻辑画面。"""

    def __init__(self, image: np.ndarray) -> None:
        self.image = image
        self.region = (0, 0, int(image.shape[1]), int(image.shape[0]))
        self.base_region = None
        self._base = self.region
        self.base_width = int(image.shape[1])
        self.base_height = int(image.shape[0])
        self.width = int(image.shape[1])
        self.height = int(image.shape[0])

    def image_to_base(self, x: float, y: float) -> tuple[float, float]:
        return x, y

    def base_to_image(self, x: float, y: float) -> tuple[float, float]:
        return x, y


def main() -> int:
    print("=" * 74)
    print(f"  开放世界压力测试 · {W}x{H}，8 个同色干扰物 + 目标每 60 帧被遮挡 3 帧")
    print("=" * 74)

    base = dict(preset="red", min_area=40)

    run("① 不跟踪（旧行为，每帧独立全画面找）",
        DetectConfig(track_enabled=False, detect_max_side=0, **base))

    run("② 跟踪 + 降采样（新默认）",
        DetectConfig(track_enabled=True, detect_max_side=1280, **base))

    run("③ 再加形状过滤 + 跳变保护",
        DetectConfig(track_enabled=True, detect_max_side=1280, aspect_max=3.0,
                     fill_min=0.45, max_jump_px=300, **base))

    run("④ --fast 完整形态（降采样 960 + 搜索窗截图）",
        DetectConfig(track_enabled=True, detect_max_side=960, aspect_max=3.0,
                     fill_min=0.45, max_jump_px=300, **base))

    print()
    print("  判定标准：跳变应为 0，|err| 均值应 < 3px，遮挡帧由丢帧保持兜住")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
