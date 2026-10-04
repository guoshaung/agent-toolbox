"""
bench_ab.py —— 逐项累积的性能 A/B：每一档只比上一档多开一个开关，看它各自值多少。

为什么需要这个脚本（而不是随手敲几条命令）：
  这台机器的 CPU 在持续负载约 2.5 秒后会降频（实测同一段 memcpy 从 0.047ms
  涨到 0.080ms）。early 的「12.9 fps → 52.9 fps」那张表就是短跑量出来的，
  每个档位各自跑在 boost 窗口里，结论不可信。所以这里：

  * 每个档位前先烧 CPU，越过降频窗口；
  * 每个档位前后各测一次固定参考负载，用它的漂移做归一化；
  * 两轮、每轮顺序轮换，取「归一化后最好」的值。

跑的是真实 mss 链路（配一个黑底红点测试窗口），所以抓屏开销是真的。

用法：
    python bench_ab.py                    # 全部 5 档，2 轮
    python bench_ab.py --frames 300 --rounds 2
    python bench_ab.py --only 5           # 只跑第 5 档
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_real_screen import PY, WINDOW_TITLE, watch_window, wait_for_window  # noqa: E402

# 参考负载：固定大小的 memcpy，用来感知当前算力水位
_REF_SRC = np.random.default_rng(0).integers(0, 255, (518, 920, 3), dtype=np.uint8)
_REF_DST = np.empty_like(_REF_SRC)
REF_AT_BOOST = 0.047  # 本机在 boost 频率下测得的值，作为水位 1.00 的基准


def reference_ms(iters: int = 60) -> float:
    best = float("inf")
    for _ in range(3):
        t0 = time.perf_counter()
        for _ in range(iters):
            np.copyto(_REF_DST, _REF_SRC)
        best = min(best, (time.perf_counter() - t0) / iters * 1000.0)
    return best


def warmup(seconds: float) -> None:
    if seconds <= 0:
        return
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        for _ in range(50):
            np.copyto(_REF_DST, _REF_SRC)


# 每一档 = 在上一档基础上多开一个开关。顺序有意义，别随便调。
CONFIGS: list[tuple[str, str, list[str]]] = [
    ("① 全旧行为", "全分辨率检测 + 不做跟踪 + PNG 落盘",
     ["--no-track", "--detect-max-side", "0", "--dump-format", "png"]),
    ("② +检测降采样 1280", "一帧的检测链缩到 1280 最长边",
     ["--no-track", "--detect-max-side", "1280", "--dump-format", "png"]),
    ("③ +检测侧跟踪窗", "锁定后只在目标周围搜（仍全屏截图）",
     ["--track", "--detect-max-side", "1280", "--dump-format", "png"]),
    ("④ +JPG 落盘", "PNG 编码 97ms → JPEG 21ms，且本来就异步",
     ["--track", "--detect-max-side", "1280", "--dump-format", "jpg"]),
    ("⑤ +截图 ROI (= --fast)", "锁定后连截图也只截目标周围一块",
     ["--fast"]),
]


def run_config(label: str, extra: list[str], frames: int, fps: float,
               dump_dir: Path, fullscreen: bool = True) -> dict | None:
    for old in dump_dir.glob("frame-*.*"):
        old.unlink()
    dump_dir.mkdir(parents=True, exist_ok=True)
    (dump_dir / "summary.json").unlink(missing_ok=True)

    cmd = [
        PY, "-u", str(HERE / "main.py"),
        "--source", "screen",
        "--focus-mode", "off",
        "--backend", "null",
        "--no-window",
        "--preset", "red",
        "--auto-start",
        "--fps", str(fps),
        "--max-frames", str(frames),
        "--dump-dir", dump_dir.relative_to(HERE).as_posix(),
        "--dump-every", "20",
        "--log-format", "line",
        "--no-timings",
    ]
    if fullscreen:
        # 全屏截图才是真实游戏的条件（游戏窗口就是整块 2560x1440）。
        # 截测试窗口的话基准只有 920x518，会把「截图 ROI」这一档的收益
        # 严重低估 —— 而那一档恰恰是收益最大的一档。
        cmd += ["--monitor", "1"]
    else:
        cmd += ["--window-title", WINDOW_TITLE]
    cmd += extra
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    try:
        res = subprocess.run(cmd, cwd=str(HERE), env=env, capture_output=True,
                             text=True, encoding="utf-8", errors="replace",
                             timeout=max(90.0, frames / 10.0 * 6))
    except subprocess.TimeoutExpired:
        print(f"      [x] {label} 超时（{max(90.0, frames / 10.0 * 6):.0f}s）")
        return None

    path = dump_dir / "summary.json"
    if not path.exists() or res.returncode != 0:
        # 失败的时候要说清楚：是找不到窗口、还是崩了、还是没写汇总
        tail = "\n".join(res.stdout.splitlines()[-6:])
        print(f"      [x] {label} 退出码 {res.returncode}，没有 summary.json")
        if tail:
            for ln in tail.splitlines():
                print(f"          {ln}")
        err = "\n".join(res.stderr.splitlines()[-4:])
        if err:
            for ln in err.splitlines():
                print(f"          [stderr] {ln}")
        return None
    s = json.loads(path.read_text(encoding="utf-8"))
    if not s.get("frames"):
        print(f"      [x] {label} 跑了 0 帧")
        return None
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=400, help="每档跑多少帧")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--warmup", type=float, default=6.0)
    ap.add_argument("--only", type=int, help="只跑第 N 档（1 起）")
    ap.add_argument("--window", action="store_true",
                    help="截测试窗口而不是全屏（默认全屏，更贴近真实游戏）")
    args = ap.parse_args()

    configs = CONFIGS
    if args.only:
        configs = [CONFIGS[args.only - 1]]

    print("=" * 78)
    print("逐项累积的性能 A/B（真实 mss 链路 · 每档只比上一档多开一个开关）")
    print("=" * 78)

    tk_proc = subprocess.Popen(
        [PY, "-u", str(HERE / "test_target_window.py"), "--drift", "120"],
        cwd=str(HERE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        ok, msg = wait_for_window(timeout=20.0)
        print(f"[前置] {msg}")
        if not ok:
            return 1

        stop = threading.Event()
        results: dict[str, list[float]] = {label: [] for label, _, _ in configs}
        raws: dict[str, list[float]] = {label: [] for label, _, _ in configs}
        levels: dict[str, list[float]] = {label: [] for label, _, _ in configs}

        for rnd in range(args.rounds):
            order = configs if rnd % 2 == 0 else list(reversed(configs))
            for label, desc, extra in order:
                print(f"\n[{label}] {desc}")
                warmup(args.warmup)
                ref_before = reference_ms()
                dump_dir = HERE / "work" / "bench-ab" / label.split()[0]
                s = run_config(label, extra, args.frames, 240.0, dump_dir,
                               fullscreen=not args.window)
                ref_after = reference_ms()
                ref = 0.5 * (ref_before + ref_after)
                level = ref / REF_AT_BOOST
                if s is None:
                    print(f"      第 {rnd + 1} 轮：没拿到结果，跳过")
                    continue
                loop_p50 = float(s.get("loop_p50_ms", 0.0))
                norm = loop_p50 / level
                raws[label].append(loop_p50)
                levels[label].append(level)
                results[label].append(norm)
                print(f"      第 {rnd + 1} 轮：{s['effective_fps']:5.1f} fps  "
                      f"抓屏 {s['grab_p50_ms']:5.2f}ms  检测 {s['detect_p50_ms']:5.2f}ms  "
                      f"整帧 {loop_p50:5.2f}ms  → 归一化 {norm:5.2f}ms（水位 x{level:.2f}）")

        print("\n" + "=" * 78)
        print(f"汇总（归一化整帧 p50，取 {args.rounds} 轮最好值；越小越好）")
        print("=" * 78)
        print(f"  {'档位':<26}{'整帧(原始)':>12}{'整帧(归一化)':>14}{'相对①':>10}")
        base = None
        for label, desc, _ in configs:
            if not results[label]:
                print(f"  {label:<26}{'--':>12}{'--':>14}{'--':>10}")
                continue
            raw = min(raws[label])
            norm = min(results[label])
            if base is None:
                base = norm
            gain = f"{base / norm:.2f}x" if norm > 0 else "--"
            print(f"  {label:<26}{raw:11.2f}ms{norm:13.2f}ms{gain:>10}")
        print("\n  归一化 = 原始 p50 / 算力水位。水位由固定 memcpy 参考负载测得，")
        print("  基准 1.00 = 本机 boost 频率（" f"{REF_AT_BOOST:.3f}ms" "）。")
        print("  每档开跑前都烧过 CPU，所以各档之间的差值是可比的。")
        return 0
    finally:
        tk_proc.terminate()
        try:
            tk_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tk_proc.kill()
        if stop is not None:
            stop.set()


if __name__ == "__main__":
    sys.exit(main())
