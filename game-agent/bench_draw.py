"""
bench_draw.py —— 把可视化绘制拆开计时，找出 draw 阶段到底花在哪。

起因：真机 A/B 里 draw p50 一会儿 1.9ms 一会儿 7.3ms，差了近 4 倍。
查下来发现**大半是测量本身的问题**：这台机器的 CPU 在持续负载约 2.5 秒后
会从 boost 降到基频（同样的 memcpy 从 0.047ms 掉到 0.080ms，1.7x）。
所以任何「短跑一次就下结论」的基准都不可信。

这个脚本因此做两件事：
  1. 测量前先烧 CPU 越过 boost 窗口；
  2. 每个场景前后各测一次固定参考负载，用它的漂移做归一化 ——
     报告里同时给「原始 ms」和「归一化 ms」，后者才可跨场景比较。

用法：
    python bench_draw.py                # 全场景
    python bench_draw.py --no-warmup    # 看 boost 窗口内的数字（对比用）
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cv2  # noqa: E402

from config import Config  # noqa: E402
from controller import Action, Decision, decide, plan_action  # noqa: E402
from screen_capture import Frame  # noqa: E402
from target_detector import Target  # noqa: E402
from visualizer import (  # noqa: E402
    CYAN,
    DIM,
    FONT,
    GREEN,
    ORANGE,
    WHITE,
    Visualizer,
    _panel,
    _text,
)

STEPS = ("_draw_threshold_band", "_draw_target", "_draw_hud",
         "_draw_sparkline", "_draw_status_bar", "_draw_capture_note")
ACC: dict[str, list[float]] = defaultdict(list)

# 参考负载：一块固定大小的 memcpy，用来感知机器当前的算力水位
_REF_SRC = np.random.default_rng(0).integers(0, 255, (518, 920, 3), dtype=np.uint8)
_REF_DST = np.empty_like(_REF_SRC)


def reference_ms(iters: int = 120) -> float:
    """测一次固定负载耗时。用于归一化，本身不代表被测代码的开销。"""
    best = float("inf")
    for _ in range(3):  # 取最好的一次，减少被调度打断的影响
        t0 = time.perf_counter()
        for _ in range(iters):
            np.copyto(_REF_DST, _REF_SRC)
        best = min(best, (time.perf_counter() - t0) / iters * 1000.0)
    return best


def warmup(seconds: float) -> None:
    """把 CPU 烧过 boost 窗口，否则测的是加速态，跨场景不可比。"""
    if seconds <= 0:
        return
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        for _ in range(50):
            np.copyto(_REF_DST, _REF_SRC)


def instrument(viz: Visualizer) -> None:
    for name in STEPS:
        original = getattr(viz, name)

        def wrapper(*args, _orig=original, _name=name, **kwargs):
            t = time.perf_counter()
            try:
                return _orig(*args, **kwargs)
            finally:
                ACC[_name].append((time.perf_counter() - t) * 1000.0)

        setattr(viz, name, wrapper)


# ------------------------------------------------------------------ 旧实现
#
# 把优化前的三个函数原样搬进来，用于同进程 A/B。
# 为什么不在两个进程里各跑一次？因为这台机器会降频，两个进程的算力水位不同，
# 比出来的差值里混着降频量。同进程内交替测量才是干净的对照。

def legacy_dashed_vline(img, x, color, dash=8, gap=6):
    h = img.shape[0]
    y = 0
    while y < h:
        cv2.line(img, (x, y), (x, min(h, y + dash)), color, 1, cv2.LINE_AA)
        y += dash + gap


def legacy_threshold_band(self, img, center_x, threshold, h):
    w = img.shape[1]
    if threshold > 0:
        x0 = max(0, center_x - threshold)
        x1 = min(w, center_x + threshold)
        if x1 > x0:
            band = img[:, x0:x1].copy()
            band[:] = (40, 55, 40)
            cv2.addWeighted(band, 0.22, img[:, x0:x1], 0.78, 0, img[:, x0:x1])
        for x in (center_x - threshold, center_x + threshold):
            if 0 <= x < w:
                legacy_dashed_vline(img, x, (70, 200, 70), 6, 6)
    if 0 <= center_x < w:
        cv2.line(img, (center_x, 0), (center_x, h), CYAN, 2, cv2.LINE_AA)
    else:
        edge_x = 8 if center_x < 0 else w - 8
        cv2.putText(img, "CENTER >>" if center_x >= w else "<< CENTER",
                    (edge_x if center_x < 0 else edge_x - 90, h // 2), FONT, 0.5, CYAN, 1, cv2.LINE_AA)


def legacy_sparkline(self, img, threshold, h):
    if self.spark is None:
        return
    box_w, box_h = 300, 96
    x0 = 10
    y0 = h - box_h - 10
    if y0 < 0:
        return
    _panel(img, x0, y0, box_w, box_h, alpha=0.55)
    mid_y = y0 + box_h // 2
    inner_w = box_w - 20
    inner_h = box_h - 26
    cv2.line(img, (x0 + 10, mid_y), (x0 + 10 + inner_w, mid_y), (110, 115, 130), 1, cv2.LINE_AA)
    span = max(threshold * 3, max((abs(v) for v in self.spark), default=threshold) or threshold)
    for sign in (-1, 1):
        yy = int(mid_y - sign * (threshold / span) * (inner_h / 2))
        cv2.line(img, (x0 + 10, yy), (x0 + 10 + inner_w, yy), (70, 160, 70), 1, cv2.LINE_AA)
    _text(img, "error history", (x0 + 12, y0 + 16), DIM, 0.44)
    if len(self.spark) < 2:
        return
    pts = []
    for i, value in enumerate(self.spark):
        px = x0 + 10 + int(i / max(1, self.spark.maxlen - 1) * inner_w)
        py = int(mid_y - np.clip(value / span, -1.0, 1.0) * (inner_h / 2))
        pts.append((px, py))
    for i in range(1, len(pts)):
        cur_v = self.spark[i]
        color = GREEN if abs(cur_v) <= threshold else ORANGE
        cv2.line(img, pts[i - 1], pts[i], color, 2, cv2.LINE_AA)
    cv2.circle(img, pts[-1], 3, WHITE, -1, cv2.LINE_AA)


def install_legacy(viz: Visualizer) -> None:
    """把优化的三个函数换回旧实现，同时保留计时包装。"""
    viz._draw_threshold_band = lambda img, cx, th, h: legacy_threshold_band(viz, img, cx, th, h)
    viz._draw_sparkline = lambda img, th, h: legacy_sparkline(viz, img, th, h)
    instrument(viz)


def make_frame(w: int, h: int, region=None) -> Frame:
    img = np.full((h, w, 3), 30, dtype=np.uint8)
    img[::4, :] = 45
    img[:, ::4] = 40
    return Frame(image=img, index=0, timestamp=0.0,
                 region=region or (0, 0, w, h), source="screen")


EXTRA = ["backend: null", "source: screen"]


def report(title: str, frame: Frame, target: Target, decision: Decision,
           action: Action, viz: Visualizer, n: int) -> dict:
    def once() -> float:
        viz.update_history(decision.error if target.found else None)
        t = time.perf_counter()
        viz.render(frame, target, decision, action, 60.0, True, EXTRA)
        return (time.perf_counter() - t) * 1000.0

    for _ in range(30):  # 预热：让 cv2 的惰性初始化 / 缓存都就位
        once()

    ref_before = reference_ms()
    ACC.clear()
    total = 0.0
    for _ in range(n):
        total += once()
    ref_after = reference_ms()
    ref = 0.5 * (ref_before + ref_after)
    overall = total / n
    k = ref / 0.047  # 0.047ms = 本机在 boost 频率下的参考值，作为基准水位

    print(f"\n{title}   （{frame.image.shape[1]}x{frame.image.shape[0]}，{n} 帧）")
    print(f"  参考负载 {ref:.3f} ms（基准 0.047 → 算力水位 x{k:.2f}）")
    print(f"  render 合计        {overall:7.3f} ms   归一化 {overall / k:7.3f} ms")
    subs = 0.0
    for name in STEPS:
        v = ACC.get(name) or [0.0]
        p50 = sorted(v)[len(v) // 2]
        subs += p50
        print(f"    {name:<22} {p50:7.3f} ms   归一化 {p50 / k:7.3f} ms")
    rest = overall - subs
    print(f"    {'其它（copy/换算/…）':<20} {rest:7.3f} ms   归一化 {rest / k:7.3f} ms")
    return {"title": title, "overall": overall / k, "subs": {s: 0.0 for s in STEPS}}


def build_scenarios(cfg: Config) -> list[tuple]:
    f = make_frame(920, 518)

    dec_far = decide(840, 720, 50, False)
    act_far = plan_action(dec_far, cfg.control, False)
    act_far.sent = False

    dec_cen = decide(690, 720, 50, False)
    act_cen = plan_action(dec_cen, cfg.control, False)
    act_cen.sent = True
    act_cen.key = "d"
    act_cen.duration_ms = 48

    dec_off = decide(120, 90, 50, False)
    act_off = plan_action(dec_off, cfg.control, False)
    act_off.sent = False

    return [
        ("① 目标偏右 error=+120", f,
         Target(found=True, x=840, y=259, bbox=(832, 251, 16, 16),
                raw_x=840.0, candidates=1, elapsed_ms=1.2), dec_far, act_far),
        ("② 目标居中 error=-30 已发键", f,
         Target(found=True, x=690, y=259, bbox=(682, 251, 16, 16),
                raw_x=690.0, candidates=1, elapsed_ms=1.2), dec_cen, act_cen),
        ("③ 多候选 candidates=3", f,
         Target(found=True, x=120, y=259, bbox=(112, 251, 16, 16),
                raw_x=120.0, candidates=3, elapsed_ms=0.8), dec_off, act_off),
        ("④ 丢帧保持 HELD", f,
         Target(found=True, x=690, y=259, bbox=(682, 251, 16, 16),
                raw_x=690.0, candidates=1, elapsed_ms=0.0, predicted=True), dec_cen, act_cen),
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--warmup", type=float, default=6.0, help="测量前烧多少秒 CPU")
    ap.add_argument("--no-warmup", action="store_true")
    ap.add_argument("--only", choices=["new", "legacy"], help="只跑一侧")
    args = ap.parse_args()

    cfg = Config()

    if not args.no_warmup:
        print(f"先烧 {args.warmup:.0f}s CPU 越过降频窗口，再做交替 A/B…")
        warmup(args.warmup)

    scenarios = build_scenarios(cfg)
    sides = ["legacy", "new"] if not args.only else [args.only]
    out: dict[str, dict[str, float]] = {s: {} for s in sides}

    # 交替跑两轮，每轮内部也交错顺序，尽量把缓慢漂移平摊到两侧
    for rnd in range(2):
        order = sides if rnd == 0 else list(reversed(sides))
        for side in order:
            viz = Visualizer(cfg, detector_desc="color preset=red", backend_name="null")
            if side == "legacy":
                install_legacy(viz)
            else:
                instrument(viz)
            print(f"\n{'=' * 66}\n[{side.upper()}] 第 {rnd + 1} 轮\n{'=' * 66}")
            for title, frame, target, dec, act in scenarios:
                r = report(title, frame, target, dec, act, viz, args.frames)
                key = title
                prev = out[side].get(key)
                out[side][key] = r["overall"] if prev is None else min(prev, r["overall"])

    if len(sides) == 2:
        print("\n" + "=" * 66)
        print("同进程交替 A/B（归一化 render 合计，取两轮最好值）")
        print("=" * 66)
        print(f"  {'场景':<30}{'旧':>9}{'新':>9}{'提速':>9}")
        tot_old = tot_new = 0.0
        for title, *_ in scenarios:
            o = out["legacy"][title]
            n = out["new"][title]
            tot_old += o
            tot_new += n
            gain = f"{o / n:.2f}x" if n > 0 else "-"
            print(f"  {title:<28}{o:8.3f} {n:8.3f} {gain:>9}")
        print("-" * 66)
        print(f"  {'合计':<28}{tot_old:8.3f} {tot_new:8.3f} "
              f"{tot_old / tot_new:8.2f}x")
        print("\n  注：这些数字是在当前算力水位下归一化过的，可直接横向比较。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
