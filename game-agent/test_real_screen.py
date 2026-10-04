"""
test_real_screen.py —— 真机链路端到端回归（测试窗口 + mss 实拍 + 跟踪窗口截图）。

为什么需要它：
    手工「开一个终端跑 test_target_window.py，再开另一个终端跑 main.py」在自动化环境里
    是不可靠的 —— 两条命令之间测试窗口可能被回收或最小化，agent 就报「找不到窗口」退出。
    这个脚本把「起窗口 → 等就绪 → 跑 agent → 收尾」放进**同一个进程**，
    并且全程盯着窗口矩形，一旦发现窗口被最小化（坐标 -32000）立刻报出来。

它测的是真链路：
    - mss 真的在抓屏（不是合成帧）
    - --window-title 走的是 EnumWindows + GetClientRect 真实窗口定位
    - 跟踪窗口截图（capture_roi）真的在裁剪，坐标映射真的对得上
    - 按键走的是 null 后端（不会真的污染其它程序），但控制逻辑全部真实执行

用法：
    python test_real_screen.py                      # 默认 --fast，跑 90 帧
    python test_real_screen.py --frames 240 --fps 60
    python test_real_screen.py --no-fast            # 关掉 --fast，跑全屏基准
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

HERE = Path(__file__).resolve().parent
PY = sys.executable
WINDOW_TITLE = "AgentToolboxTestTarget"
MINIMIZED_X = -32000  # Windows 把最小化窗口丢到这个坐标


def _import_local():
    """把 game-agent 目录塞进 sys.path，好复用 screen_capture 里的窗口工具。"""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import screen_capture  # noqa: E402

    return screen_capture


def watch_window(stop: threading.Event, samples: list, period: float = 0.5) -> None:
    """后台盯着测试窗口的矩形，记录它活着的每一刻。"""
    sc = _import_local()
    while not stop.is_set():
        rect = sc.find_window_rect(WINDOW_TITLE)
        samples.append((round(time.monotonic(), 2), rect))
        stop.wait(period)


def wait_for_window(timeout: float = 20.0) -> tuple[bool, str]:
    """等测试窗口出现并且不是最小化状态。"""
    sc = _import_local()
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        rect = sc.find_window_rect(WINDOW_TITLE)
        if rect is not None:
            last = rect
            return True, f"窗口就绪 rect={rect}"
        # 单独看一眼「可见窗口」列表，好区分「没开」和「开了但被最小化」
        for hwnd, title, r in sc.visible_windows():
            if WINDOW_TITLE in title:
                last = r
                if r[0] <= MINIMIZED_X:
                    return False, f"窗口被最小化 rect={r}"
        time.sleep(0.25)
    return False, f"等了 {timeout:.0f}s 没等到窗口（最后一次看到 rect={last}）"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="真机链路端到端回归")
    ap.add_argument("--frames", type=int, default=90, help="agent 跑多少帧")
    ap.add_argument("--fps", type=float, default=60.0)
    ap.add_argument("--fast", dest="fast", action="store_true", default=True,
                    help="给 agent 加 --fast（默认开）")
    ap.add_argument("--no-fast", dest="fast", action="store_false")
    ap.add_argument("--no-track", action="store_true", help="关掉跟踪，用于 A/B")
    ap.add_argument("--live", action="store_true",
                    help="真实发键闭环：backend=sendinput + auto-start + 焦点保险丝，"
                         "验证 error 真的能收敛（测试窗口会真的读到 A/D 转视角）")
    ap.add_argument("--backend", default=None,
                    choices=["pyautogui", "sendinput", "null"], help="覆盖按键后端")
    ap.add_argument("--drift", type=float, default=200.0, help="红点漂移速度 px/s")
    ap.add_argument("--dump-every", type=int, default=15)
    ap.add_argument("--dump-dir", "--dumps", dest="dump_dir", default="work/real-check")
    ap.add_argument("--keep-window", action="store_true", help="跑完不关测试窗口")
    ap.add_argument("--extra", nargs=argparse.REMAINDER, help="透传给 main.py 的额外参数")
    args = ap.parse_args(argv)

    dump_dir = HERE / args.dump_dir
    dump_dir.mkdir(parents=True, exist_ok=True)
    for old in dump_dir.glob("frame-*.jpg"):
        old.unlink()
    for old in dump_dir.glob("frame-*.png"):
        old.unlink()
    (dump_dir / "summary.json").unlink(missing_ok=True)

    print("=" * 74)
    print("真机链路端到端回归")
    print("=" * 74)

    # ---------- 1. 起测试窗口 ----------
    tk_cmd = [PY, "-u", str(HERE / "test_target_window.py"), "--drift", str(args.drift)]
    print(f"[1/4] 启动测试窗口：{' '.join(str(c) for c in tk_cmd[1:])}")
    tk_env = dict(os.environ)
    tk_env["PYTHONUNBUFFERED"] = "1"
    tk_proc = subprocess.Popen(
        tk_cmd, cwd=str(HERE), env=tk_env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    tk_lines: list[str] = []

    def pump_tk():
        assert tk_proc.stdout is not None
        for line in tk_proc.stdout:
            tk_lines.append(line.rstrip())

    threading.Thread(target=pump_tk, daemon=True).start()

    try:
        ok, msg = wait_for_window(timeout=20.0)
        print(f"      {msg}")
        if not ok:
            print("\n[!] 测试窗口没能就绪，打印它的输出：")
            for ln in tk_lines[-20:]:
                print("     ", ln)
            return 1

        # 窗口活着的时候后台采样矩形，跑完能看到它有没有中途被最小化
        stop = threading.Event()
        samples: list = []
        watcher = threading.Thread(target=watch_window, args=(stop, samples), daemon=True)
        watcher.start()

        # ---------- 2. 跑 agent ----------
        backend = args.backend or ("sendinput" if args.live else "null")
        agent_cmd = [
            PY, "-u", str(HERE / "main.py"),
            "--source", "screen",
            "--window-title", WINDOW_TITLE,
            "--backend", backend,
            "--no-window",
            "--preset", "red",
            "--fps", str(args.fps),
            "--max-frames", str(args.frames),
            "--dump-dir", str(dump_dir.relative_to(HERE).as_posix()),
            "--dump-every", str(args.dump_every),
            "--log-format", "line",
        ]
        if args.live:
            # 闭环模式：真的按 A/D，真的让测试窗口转视角。
            # --focus-title + block 是保险丝 —— 只有前台是测试窗口时才发键，
            # 万一焦点被别的程序抢走，按键会被守门拦掉而不是打到别人窗口里。
            agent_cmd += ["--auto-start", "--focus-title", WINDOW_TITLE, "--focus-mode", "block"]
        else:
            agent_cmd += ["--focus-mode", "off"]
        if args.fast:
            agent_cmd.append("--fast")
        if args.no_track:
            agent_cmd.append("--no-track")
        if args.extra:
            agent_cmd.extend(args.extra)

        print(f"[2/4] 启动 agent：{' '.join(str(c) for c in agent_cmd[1:])}")
        t0 = time.monotonic()
        agent_env = dict(os.environ)
        agent_env["PYTHONUNBUFFERED"] = "1"
        res = subprocess.run(
            agent_cmd, cwd=str(HERE), env=agent_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            timeout=max(60.0, args.frames / max(1.0, args.fps) * 12),
        )
        elapsed = time.monotonic() - t0

        stop.set()
        time.sleep(0.1)

        lines = [ln for ln in res.stdout.splitlines()]
        # 完整输出落盘。只打印尾部 40 行的话，中间的告警（比如整帧尖峰、
        # 焦点被挡、画面冻结）全都看不到 —— 而这些恰恰是排查时最需要的。
        agent_log = dump_dir / "agent.log"
        agent_log.write_text(res.stdout, encoding="utf-8")
        print(f"[3/4] agent 输出（尾 40 行，完整输出见 {agent_log.as_posix()}）：")
        for ln in lines[-40:]:
            print("     ", ln)
        warns = [ln for ln in lines if ln.startswith(("!", "x"))]
        if warns:
            print(f"      其中告警/错误 {len(warns)} 条：")
            for ln in warns[:8]:
                print("        ", ln)
            if len(warns) > 8:
                print(f"         …还有 {len(warns) - 8} 条，见 {agent_log.name}")
        print(f"      退出码 {res.returncode}，墙钟 {elapsed:.1f}s")

        # ---------- 3. 校验 ----------
        print("[4/4] 校验：")
        alive = [s for s in samples if s[1] is not None]
        minimized = [s for s in samples if s[1] is not None and s[1][0] <= MINIMIZED_X]
        print(f"      窗口采样 {len(samples)} 次，其中有矩形的 {len(alive)} 次，"
              f"最小化 {len(minimized)} 次")

        summary_path = dump_dir / "summary.json"
        rc = 0
        if not summary_path.exists():
            print("      [x] 没生成 summary.json —— agent 大概没跑起来")
            return 2
        s = json.loads(summary_path.read_text(encoding="utf-8"))
        dumps = sorted(dump_dir.glob("frame-*.*"))

        def check(name: str, cond: bool, detail: str) -> None:
            nonlocal rc
            print(f"      {'[√]' if cond else '[x]'} {name}：{detail}")
            if not cond:
                rc = 1

        check("跑满帧数", s["frames"] == args.frames,
              f"frames={s['frames']} 期望 {args.frames}")
        check("抓屏没失败", s["capture_failures"] == 0,
              f"capture_failures={s['capture_failures']}, reopens={s['capture_reopens']}")
        check("检测命中率", s["detect_rate"] >= 0.95,
              f"detect_rate={s['detect_rate']:.1%}")
        check("实际帧率", s["effective_fps"] >= 8.0,
              f"{s['effective_fps']:.1f} fps（抓屏 p50 {s['grab_p50_ms']:.1f}ms）")
        check("跟踪窗在生效" if (args.fast and not args.no_track) else "全屏模式",
              (s["windowed_frames"] > 0) if (args.fast and not args.no_track) else True,
              f"windowed_frames={s['windowed_frames']}/{s['frames']}")
        check("没触发冻结帧", s["freeze_events"] == 0,
              f"freeze_events={s['freeze_events']}")
        check("标注帧落盘", len(dumps) > 0, f"{len(dumps)} 张 → {dump_dir.as_posix()}")
        check("窗口全程未被最小化", len(minimized) == 0,
              f"最小化采样 {len(minimized)} 次")

        # 尖峰检查：确认没有东西「叠」在脉冲后面。
        #
        # 为什么不能只看整帧 max：脉冲帧本来就是慢的（要真的按住键），
        # 而按住多久取决于当时的误差，误差大脉冲就长 —— 拿 max 跟一个含
        # 脉冲的阈值比，判据会自指。实测就是这么翻车的：负对照（旧的阻塞
        # settle）反而通过了，因为阻塞让控制变慢 ⇒ 误差变大 ⇒ 脉冲变长 ⇒
        # 阈值跟着一起涨。
        #
        # 正确判据是逐帧看分解：发键耗时应该 ≈ 计划脉冲时长。两者差得远，
        # 说明有别的等待混在了按键后面 —— 历史上就是 settle 的阻塞 sleep。
        import re  # noqa: PLC0415

        warn_lines = [
            ln for ln in lines
            if ln.startswith("!") and "整帧" in ln and "脉冲" in ln
        ]
        worst_gap = 0.0
        worst_line = ""
        for ln in warn_lines:
            m = re.search(r"发键 (\d+)\(脉冲 (\d+)\)", ln)
            if not m:
                continue
            gap = float(m.group(1)) - float(m.group(2))
            if gap > worst_gap:
                worst_gap, worst_line = gap, ln

        print(f"      尖峰帧 {len(warn_lines)} 条；"
              f"「发键 - 脉冲」最大偏差 {worst_gap:.0f}ms")
        if worst_line:
            print(f"        最差一条：{worst_line}")
        check("没有等待叠在脉冲后面", worst_gap <= 15.0,
              f"最大偏差 {worst_gap:.0f}ms ≤ 15ms"
              f"（发键 ≈ 脉冲；若接近 settle 说明又变回阻塞 sleep）")

        if args.live:
            # 闭环模式的硬指标：真的发出脉冲 + error 真的收敛
            check("真的发出了脉冲", s["pulses"] > 0, f"pulses={s['pulses']}")
            check("闭环收敛（稳定后 |err|）", s["abs_error_mean_tail"] <= 60.0,
                  f"|err| tail={s['abs_error_mean_tail']:.1f}px（阈值 ±{s['threshold']}px）")
            check("稳定后多数帧在阈值内", s["within_threshold_tail"] >= 0.5,
                  f"{s['within_threshold_tail']:.1%}")

        print(f"\n      关键指标：detect {s['detect_rate']:.1%}  |  "
              f"|err| tail {s['abs_error_mean_tail']:.1f}px  |  "
              f"pulses {s['pulses']}  |  {s['effective_fps']:.1f} fps")
        print(f"      grab p50 {s['grab_p50_ms']:.1f}ms / p95 {s['grab_p95_ms']:.1f}ms  |  "
              f"循环 p50 {s.get('loop_p50_ms', 0):.1f} / p95 {s.get('loop_p95_ms', 0):.1f} "
              f"/ max {s.get('loop_max_ms', 0):.1f} ms")
        print(f"      冷却 {s.get('cooldown_frames', 0)} 帧  |  "
              f"丢帧保持 {s.get('hold_frames', 0)} 帧  |  "
              f"跟踪窗 {s['windowed_frames']}/{s['frames']}")
        ff = s.get("first_frame_ms")
        print(f"      首帧 {ff:.1f}ms（一次性预热，已从统计中剔除）" if ff
              else "      首帧 --")
        print(f"      检测器：{s['detector']}")

        if rc == 0:
            print("\n" + "=" * 74)
            print("真机链路全绿")
            print("=" * 74)
        return rc

    finally:
        if not args.keep_window:
            tk_proc.terminate()
            try:
                tk_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tk_proc.kill()


if __name__ == "__main__":
    sys.exit(main())
