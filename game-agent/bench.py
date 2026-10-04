"""
bench.py —— 逐阶段耗时测量。先量，再改。

为什么需要它：2560x1440 这么一块画面，全分辨率走完「抓屏 → 转色 → HSV →
形态学 → 找轮廓」到底哪一步贵，靠猜是不准的。这个脚本把每一步单独计时，
跑完直接告诉你瓶颈在哪、以及下采样能省多少。

用法：
    uv run python bench.py                # 默认测主屏
    uv run python bench.py --repeat 60    # 每步重复 60 次取统计
"""

from __future__ import annotations

import argparse
import statistics
import time
from typing import Callable, Optional

import cv2
import numpy as np


def timeit(fn: Callable[[], object], repeat: int) -> dict:
    """跑 repeat 次，丢掉前两次预热，返回耗时统计（毫秒）。"""
    samples: list[float] = []
    for i in range(repeat):
        t0 = time.perf_counter()
        fn()
        dt = (time.perf_counter() - t0) * 1000.0
        if i >= 2:  # 前两次是预热
            samples.append(dt)
    if not samples:
        samples = [0.0]
    samples.sort()
    return {
        "mean": statistics.fmean(samples),
        "p50": samples[len(samples) // 2],
        "p95": samples[min(len(samples) - 1, int(len(samples) * 0.95))],
    }


def fmt(name: str, s: dict) -> str:
    return f"  {name:<26} mean={s['mean']:7.2f}ms  p50={s['p50']:7.2f}  p95={s['p95']:7.2f}"


def main() -> int:
    parser = argparse.ArgumentParser(description="game-agent 逐阶段性能测量")
    parser.add_argument("--repeat", type=int, default=40, help="每步重复次数")
    parser.add_argument("--width", type=int, default=0, help="不截屏，用合成图（指定宽度）")
    parser.add_argument("--height", type=int, default=0, help="不截屏，用合成图（指定高度）")
    args = parser.parse_args()

    repeat = max(4, args.repeat)

    # ---------------------------------------------------------- 准备画面
    if args.width and args.height:
        base = np.zeros((args.height, args.width, 4), dtype=np.uint8)
        base[:, :, 2] = 30
        source_note = f"合成图 {args.width}x{args.height}"
    else:
        import mss

        with mss.mss() as sct:
            mon = sct.monitors[1]
            t0 = time.perf_counter()
            shot = sct.grab(mon)
            first = (time.perf_counter() - t0) * 1000
            base = np.asarray(shot, dtype=np.uint8)
            source_note = f"真实主屏 {mon['width']}x{mon['height']}（首次抓屏 {first:.0f}ms）"

    h, w = base.shape[:2]
    print("=" * 72)
    print(f"  性能基线 · {source_note}")
    print("=" * 72)

    bgra = base  # mss 原生就是 BGRA
    bgr = cv2.cvtColor(bgra, cv2.COLOR_BGRA2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array((0, 110, 90), np.uint8), np.array((10, 255, 255), np.uint8))
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    rows: list[str] = []

    # ---------------------------------------------------------- 抓屏
    if not (args.width and args.height):
        import mss

        sct = mss.mss()
        mon = sct.monitors[1]

        def _grab():
            sct.grab(mon)

        rows.append(fmt("mss.grab (全屏)", timeit(_grab, repeat)))
        sct.close()

    # ---------------------------------------------------------- 转换
    rows.append(fmt("BGRA2BGR (全屏)", timeit(lambda: cv2.cvtColor(bgra, cv2.COLOR_BGRA2BGR), repeat)))
    rows.append(fmt("np 切片取前3通道", timeit(lambda: np.ascontiguousarray(bgra[:, :, :3]), repeat)))
    rows.append(fmt("BGR2HSV (全屏)", timeit(lambda: cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV), repeat)))
    rows.append(fmt("BGR2GRAY (全屏)", timeit(lambda: cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), repeat)))

    # ---------------------------------------------------------- 掩码
    rows.append(fmt("inRange (全屏HSV)", timeit(
        lambda: cv2.inRange(hsv, np.array((0, 110, 90), np.uint8), np.array((10, 255, 255), np.uint8)),
        repeat)))
    rows.append(fmt("morph open k3", timeit(lambda: cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3), repeat)))
    rows.append(fmt("morph close k5", timeit(lambda: cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k5), repeat)))

    def _contours():
        cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    rows.append(fmt("findContours", timeit(_contours, repeat)))

    # ---------------------------------------------------------- 模板匹配
    tpl = cv2.cvtColor(bgr[100:160, 100:160], cv2.COLOR_BGR2GRAY)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    def _match():
        cv2.matchTemplate(gray, tpl, cv2.TM_CCOEFF_NORMED)

    rows.append(fmt("matchTemplate 60x60", timeit(_match, repeat)))

    # ---------------------------------------------------------- 画
    canvas_src = bgr.copy()

    def _draw():
        img = canvas_src.copy()
        cv2.line(img, (w // 2, 0), (w // 2, h), (255, 255, 0), 2)
        cv2.circle(img, (w // 3, h // 2), 8, (0, 0, 255), -1)
        cv2.putText(img, "FPS 8.0", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

    rows.append(fmt("可视化绘制 (含整帧copy)", timeit(_draw, repeat)))

    # ---------------------------------------------------------- PNG 落盘
    png_buf = bgr.copy()

    def _png():
        cv2.imencode(".png", png_buf)

    rows.append(fmt("imencode PNG (整帧)", timeit(_png, repeat)))

    def _jpg():
        cv2.imencode(".jpg", png_buf, [int(cv2.IMWRITE_JPEG_QUALITY), 80])

    rows.append(fmt("imencode JPEG q80", timeit(_jpg, repeat)))

    for r in rows:
        print(r)

    # ---------------------------------------------------------- 下采样收益
    print("-" * 72)
    print("  下采样收益（检测链 = BGRA2BGR + BGR2HSV + inRange + morph×2 + contours）")

    def chain(img_bgr: np.ndarray) -> None:
        small_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        m = cv2.inRange(small_hsv, np.array((0, 110, 90), np.uint8), np.array((10, 255, 255), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k3)
        cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    base_stat = timeit(lambda: chain(bgr), repeat)
    print(fmt("scale=1.00 (全分辨率)", base_stat))

    for scale in (0.75, 0.5, 0.35, 0.25):
        nw, nh = int(w * scale), int(h * scale)
        small = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA)

        def _chained(s=small):
            chain(s)

        st = timeit(_chained, repeat)
        speedup = base_stat["mean"] / max(1e-6, st["mean"])
        print(fmt(f"scale={scale:.2f} ({nw}x{nh})", st) + f"   x{speedup:.1f} 提速")

    # ---------------------------------------------------------- ROI 收益
    print("-" * 72)
    print("  跟踪搜索窗收益（以上一帧位置为中心的固定大小窗口）")
    for frac in (1.0, 0.5, 0.25, 0.125):
        nw, nh = max(64, int(w * frac)), max(64, int(h * frac))
        x0, y0 = (w - nw) // 2, (h - nh) // 2
        patch = bgr[y0:y0 + nh, x0:x0 + nw]

        def _chained2(p=patch):
            chain(p)

        st = timeit(_chained2, repeat)
        speedup = base_stat["mean"] / max(1e-6, st["mean"])
        print(fmt(f"窗口 {frac*100:.0f}% ({nw}x{nh})", st) + f"   x{speedup:.1f} 提速")

    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
