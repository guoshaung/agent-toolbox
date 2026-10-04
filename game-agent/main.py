"""
main.py —— 主循环。只有装配和调度，没有算法。

闭环比什么都重要，所以这个文件从头到尾就干一件事：

    Screenshot -> Detect -> error -> Decision -> Send key -> Screenshot again

热键（全局，游戏在前台也有效）：
    F8   开始 / 暂停自动控制
    ESC  立即退出，并释放所有按键
    R    清空跟踪状态，下一帧重新全画面搜索
    预览窗里点一下 = 锁定点击处那个颜色（方案 A：点哪儿追哪儿）

安全兜底一共有四层，任何一层生效都不会让 A/D 卡在按下状态：
    1. controller.pulse() 用 try/finally 包住，异常也松键
    2. 主循环 try/finally 里 release_all()
    3. atexit + signal 处理器里再 release_all()（幂等）
    4. 进程启动时先 release_all() 一次，清掉上一次崩溃残留的按下状态

另外还有两道「别瞎按」的闸：
    * 焦点守卫 FocusGuard —— 前台窗口对不上就不发键
    * 冻结帧检测 —— 画面连续 N 帧一模一样（游戏暂停/被挡住/截图卡死）时收手

性能上做了三件事，都是先量后改的（详见 bench.py）：
    * 跟踪窗口截图：锁定后只截目标周围一块。1440p 全屏抓一次 28ms，
      截 920x518 只要 7ms —— 这是整个循环里最大的一笔。
    * 检测降采样：长边缩到 1280 再检测，检测链从 20ms 降到 4.3ms。
    * 标注帧异步落盘：1440p 一帧 PNG 编码 97ms，同步写会直接吃掉一整帧预算。
"""

from __future__ import annotations

import atexit
import ctypes
import json
import queue
import signal
import statistics
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

import cv2

from config import Config, HOTKEY_VK, from_args, resolve_path
from controller import (
    Action,
    FocusGuard,
    InputController,
    create_controller,
    decide,
    plan_action,
)
from screen_capture import (
    CaptureError,
    Frame,
    FrameClock,
    Rect,
    ScreenCapture,
)
from sim_game import SimulatedGame
from target_detector import Target, TargetDetector
from observation import observed_target, live_backend
from visualizer import Visualizer, VisualizerStats

EVENT_MARK = "@@FRAME@@"  # 给工具箱父进程认的行前缀


# ================================================================ 全局中止开关

class Abort:
    """一个能被子进程各处查询的中止信号，也用来打断分片 sleep。"""

    def __init__(self) -> None:
        self._event = threading.Event()

    def set(self) -> None:
        self._event.set()

    def is_set(self) -> bool:
        return self._event.is_set()

    def __bool__(self) -> bool:
        return self._event.is_set()

    def sleep(self, seconds: float, tick: float = 0.02) -> bool:
        """返回 True 表示睡满了，False 表示被打断。"""
        end = time.monotonic() + max(0.0, seconds)
        while True:
            if self.is_set():
                return False
            remaining = end - time.monotonic()
            if remaining <= 0:
                return True
            time.sleep(min(tick, remaining))


ABORT = Abort()


def watch_stdin() -> None:
    """父进程的「停止」哨兵。

    工具箱把本程序作为子进程拉起时会连着 stdin。约定：
      * 收到一行 stop / quit / exit  -> 立即中止（走完 release_all 的收尾）
      * stdin 被关闭（父进程退出/被杀）-> 同样立即中止

    第二条尤其重要：如果工具箱崩溃了，子进程不能变成一个没人管的
    「还在往游戏里敲 A/D」的孤儿。只在 stdin 是管道时启用，平时在终端里
    手动跑（stdin 是 tty）不受影响。
    """
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return
    except Exception:
        return

    def _reader() -> None:
        try:
            for raw in sys.stdin:
                token = (raw or "").strip().lower()
                if token in ("stop", "quit", "exit"):
                    ABORT.set()
                    return
        except Exception:
            pass
        finally:
            # 走到这里说明 EOF 或读出错：parent 大概率已经没了
            ABORT.set()

    threading.Thread(target=_reader, name="game-agent-stdin", daemon=True).start()


# ================================================================ 热键

class HotkeyWatcher:
    """全局热键。

    用 GetAsyncKeyState 而不是 cv2.waitKey：游戏全屏在前台时，OpenCV 窗口根本收不到键盘，
    那样「按 F8 停不下来」就成了真问题。这里只是读按键状态，不挂钩子、不拦截。
    """

    def __init__(self, toggle: str = "f8", quit_key: str = "esc", reset_key: str = "r") -> None:
        self.toggle_vk = HOTKEY_VK.get(toggle.lower())
        self.quit_vk = HOTKEY_VK.get(quit_key.lower())
        self.reset_vk = HOTKEY_VK.get(reset_key.lower())
        self._prev: dict[int, bool] = {}
        self.supported = sys.platform.startswith("win")
        self._user32 = ctypes.windll.user32 if self.supported else None

    def _down(self, vk: Optional[int]) -> bool:
        if vk is None or not self.supported:
            return False
        return bool(self._user32.GetAsyncKeyState(vk) & 0x8000)

    def _edge(self, vk: Optional[int], name: str) -> bool:
        """只在「刚按下」的这一帧返回 True，避免按住不放连触发。"""
        if vk is None:
            return False
        now = self._down(vk)
        was = self._prev.get(vk, False)
        self._prev[vk] = now
        return now and not was

    def poll(self) -> tuple[bool, bool, bool]:
        """返回 (toggle, quit, reset)。"""
        return (
            self._edge(self.toggle_vk, "toggle"),
            self._edge(self.quit_vk, "quit"),
            self._edge(self.reset_vk, "reset"),
        )

    def poll_cv_keys(self, keycode: int) -> tuple[bool, bool, bool]:
        """非 Windows 下的退路：OpenCV 窗口里的按键。"""
        if self.supported or keycode < 0:
            return False, False, False
        if keycode in (27,):  # ESC
            return False, True, False
        if keycode in (ord("f"), ord("F")):
            return True, False, False
        if keycode in (ord("r"), ord("R")):
            return False, False, True
        return False, False, False

    def describe(self) -> str:
        suffix = "global" if self.supported else "window-only"
        return f"F8=toggle R=reset ESC=quit({suffix})"


# ================================================================ 逐阶段计时


class Timings:
    """逐阶段耗时的滚动统计。

    存在的意义：帧率掉了的时候，你得能一眼看出是抓屏慢了、检测慢了，
    还是写盘把循环堵住了。没有这个就只能靠猜。

    注意这是**滚动窗口**（最近 window 帧），不是全程累计 —— 我们要看的是
    「现在这一秒慢不慢」，而不是「十分钟前那次卡顿」。之所以给 max 和 p99，
    是因为尖峰问题最容易被 p50/p95 掩盖：脉冲帧只占 5% 时，p95 会正好落在
    脉冲帧和普通帧的边界上，稍微变一下脉冲次数，p95 就会在两个桶之间跳。
    判断「有没有尖峰」要看 max。
    """

    KEYS = ("grab", "detect", "decide", "key", "draw", "dump", "loop")
    WINDOW = 600  # 60fps 下约 10 秒

    def __init__(self, window: int = WINDOW) -> None:
        self._samples: dict[str, deque] = {k: deque(maxlen=window) for k in self.KEYS}
        self._last: dict[str, float] = {k: 0.0 for k in self.KEYS}

    def add(self, key: str, ms: float) -> None:
        if key in self._samples:
            self._samples[key].append(float(ms))
            self._last[key] = float(ms)

    def reset(self) -> None:
        """清空滚动窗口。

        首帧会带上一次性的预热开销（mss 初始化会顺带把进程切成 DPI 感知，
        ctypes 的 windll 绑定是惰性的，OpenCV/numpy 也有一堆惰性初始化）。
        实测首帧整帧要 ~200ms，而稳态只要 ~17ms —— 把两者混在一个窗口里，
        max 就永远是个噪声，看不出真正的尖峰。所以首帧单独记账，然后清空。
        """
        for d in self._samples.values():
            d.clear()

    def last(self, key: str) -> float:
        return self._last.get(key, 0.0)

    def stats(self) -> dict:
        out: dict[str, float] = {}
        for key, samples in self._samples.items():
            if not samples:
                continue
            arr = sorted(samples)
            n = len(arr)
            out[f"{key}_p50_ms"] = round(arr[n // 2], 2)
            out[f"{key}_p95_ms"] = round(arr[min(n - 1, int(n * 0.95))], 2)
            out[f"{key}_p99_ms"] = round(arr[min(n - 1, int(n * 0.99))], 2)
            out[f"{key}_max_ms"] = round(arr[-1], 2)
            out[f"{key}_mean_ms"] = round(statistics.fmean(arr), 2)
        return out

    def hud_lines(self) -> list[str]:
        def pair(key: str) -> str:
            s = self._samples.get(key)
            if not s:
                return "--"
            arr = sorted(s)
            return f"{arr[len(arr) // 2]:.1f}"

        return [
            f"t(ms) p50 grab {pair('grab')}  detect {pair('detect')}  loop {pair('loop')}",
        ]


# ================================================================ 异步落盘


class FrameDumper:
    """标注帧的后台落盘。

    为什么必须异步：1440p 一帧 PNG 编码实测 97ms、JPEG 21ms。同步写的话，
    每 dump_every 帧就有一次几十毫秒的卡顿 —— 正好落在控制回路里，直接掉帧。

    队列满了丢最旧的：宁可少存几张图，也不能让写盘拖慢控制。
    """

    def __init__(self, directory: Path, fmt: str = "jpg", queue_size: int = 8,
                 quality: int = 85) -> None:
        self.directory = directory
        self.fmt = "png" if str(fmt).lower() == "png" else "jpg"
        self.quality = int(quality)
        self.written = 0
        self.errors = 0
        self.dropped = 0
        self._queue: "queue.Queue[Optional[tuple]]" = queue.Queue(maxsize=max(1, queue_size))
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._worker, name="game-agent-dump", daemon=True)
        directory.mkdir(parents=True, exist_ok=True)
        self._thread.start()

    def submit(self, image, path: Path) -> None:
        item = (image, path)
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            # 丢掉最旧的一张，把位置让给最新的
            try:
                self._queue.get_nowait()
                self.dropped += 1
            except queue.Empty:
                pass
            try:
                self._queue.put_nowait(item)
            except queue.Full:
                self.dropped += 1

    def _worker(self) -> None:
        ext = "." + self.fmt
        while True:
            item = self._queue.get()
            if item is None:
                self._queue.task_done()
                return
            image, path = item
            try:
                target = Path(path)
                target.parent.mkdir(parents=True, exist_ok=True)
                # cv2.imwrite 遇到非 ASCII 路径会静默失败，走 imencode 绕开
                suffix = target.suffix or ext
                if suffix.lower() in (".jpg", ".jpeg"):
                    params = [int(cv2.IMWRITE_JPEG_QUALITY), self.quality]
                else:
                    params = []
                ok, buf = cv2.imencode(suffix, image, params)
                if ok:
                    target.write_bytes(buf.tobytes())
                    self.written += 1
                else:
                    self.errors += 1
            except Exception:
                self.errors += 1
            finally:
                self._queue.task_done()

    def flush(self, timeout: float = 2.0) -> None:
        """等队列排空。收尾时调用，保证最后几张真的落盘了。"""
        deadline = time.monotonic() + max(0.0, timeout)
        while not self._queue.empty() and time.monotonic() < deadline:
            time.sleep(0.01)

    def close(self) -> None:
        self._stop.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(None)
            except Exception:
                pass
        if self._thread.is_alive():
            self._thread.join(timeout=2.0)


# ================================================================ 日志


@dataclass
class FrameRecord:
    """一帧的完整快照。日志和 JSON 事件都由它生成。"""

    index: int
    wall: float
    target_x: Optional[int]
    center_x: int
    error: Optional[int]
    decision: str
    action_key: Optional[str]
    duration_ms: int
    sent: bool
    skipped: str
    fps: float
    true_x: Optional[float] = None  # 仅有仿真时存在，用来核对检测是否准
    auto: bool = False
    # ---- 新增诊断字段（不参与控制）----
    predicted: bool = False  # 这个位置是「丢帧保持」补出来的
    raw_x: Optional[float] = None  # 平滑之前的检测位置
    candidates: int = 0  # 这一帧有几个候选团块
    windowed: bool = False  # 只在跟踪窗口里找的
    frozen: bool = False  # 画面卡住
    observed: bool = False
    confidence: float = 0.0
    method: str = ""


class Logger:
    """两种格式：人看的（多行块）和机器看的（单行 JSON）。"""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.verbose = config.output.verbose_log
        self.json_events = config.output.events == "json"
        self._file = None
        if config.output.log_file:
            path = resolve_path(config.output.log_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            self._file = path.open("w", encoding="utf-8")
        self._lock = threading.Lock()

    # ----- 输出目标 -----

    def _emit(self, text: str, human: bool = True) -> None:
        with self._lock:
            if self._file is not None:
                self._file.write(text + "\n")
                self._file.flush()
            if self.json_events:
                # JSON 模式下 stdout 专门留给机器，人看的信息走 stderr
                stream = sys.stderr if human else sys.stdout
            else:
                stream = sys.stdout
            stream.write(text + "\n")
            stream.flush()

    # ----- 人看的 -----

    @staticmethod
    def _clock(wall: float) -> str:
        return time.strftime("[%H:%M:%S", time.localtime(wall)) + f".{int((wall % 1) * 1000):03d}]"

    def block(self, r: FrameRecord) -> str:
        lines = [self._clock(r.wall)]
        lines.append(f"target_x={r.target_x if r.target_x is not None else 'none'}")
        lines.append(f"center_x={r.center_x}")
        lines.append(f"error={r.error if r.error is not None else 'none'}")
        lines.append(f"decision={r.decision}")
        if r.action_key:
            lines.append(f"action={r.action_key.upper()}")
            lines.append(f"duration={r.duration_ms / 1000.0:.3f}")
            if not r.sent:
                lines.append(f"skipped={r.skipped or 'yes'}")
        return "\n".join(lines)

    def line(self, r: FrameRecord) -> str:
        parts = [
            self._clock(r.wall),
            f"#{r.index:<4d}",
            f"target_x={'--' if r.target_x is None else r.target_x:<5}",
            f"center_x={r.center_x:<5}",
            f"error={'--' if r.error is None else format(r.error, '+d'):<6}",
            f"decision={r.decision:<8}",
            f"action={(r.action_key.upper() + ' ' + str(r.duration_ms) + 'ms') if r.action_key else '--':<10}",
            f"fps={r.fps:4.1f}",
        ]
        if r.windowed:
            parts.append("win")
        if r.candidates > 1:
            parts.append(f"cand={r.candidates}")
        if r.predicted:
            parts.append("HELD")
        if r.frozen:
            parts.append("FROZEN")
        if r.true_x is not None:
            parts.append(f"true_x={r.true_x:7.1f}")
            if r.raw_x is not None:
                parts.append(f"raw_err={r.raw_x - r.true_x:+6.1f}")
        return " ".join(parts)

    def frame(self, r: FrameRecord) -> None:
        if self.json_events:
            payload = {
                "type": "frame",
                "index": r.index,
                "wall": r.wall,
                "target_x": r.target_x,
                "center_x": r.center_x,
                "error": r.error,
                "decision": r.decision,
                "action": r.action_key,
                "duration_ms": r.duration_ms,
                "sent": r.sent,
                "skipped": r.skipped,
                "fps": round(r.fps, 2),
                "auto": r.auto,
                "true_x": r.true_x,
                "predicted": r.predicted,
                "raw_x": r.raw_x,
                "candidates": r.candidates,
                "windowed": r.windowed,
                "frozen": r.frozen,
                "observed": r.observed,
                "confidence": r.confidence,
                "method": r.method,
            }
            self._emit(EVENT_MARK + json.dumps(payload, ensure_ascii=False), human=False)
            # 同时留一份人看的日志在 stderr，便于直接跑的时候也能看
            self._emit(self.line(r), human=True)
            return
        self._emit(self.block(r) if self.verbose else self.line(r))
        if self.verbose:
            self._emit("", human=False if self.json_events else True)

    # ----- 事件 -----

    def event(self, message: str, level: str = "info") -> None:
        if self.json_events:
            self._emit(EVENT_MARK + json.dumps(
                {"type": "event", "level": level, "message": message}, ensure_ascii=False
            ), human=False)
            self._emit(f"[agent] {message}", human=True)
            return
        prefix = {"info": "·", "warn": "!", "error": "x", "good": "+"}.get(level, "·")
        self._emit(f"{prefix} {message}")

    def summary(self, data: dict, text: str) -> None:
        if self.json_events:
            self._emit(EVENT_MARK + json.dumps({"type": "summary", **data}, ensure_ascii=False),
                       human=False)
            self._emit(text, human=True)
            return
        self._emit(text)

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None


# ================================================================ 采集源


class CaptureSource:
    """把 ScreenCapture 和 SimulatedGame 抹平成同一个接口。"""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.is_sim = config.capture.source == "sim"
        self._truth_x: Optional[float] = None
        if self.is_sim:
            self.sim = SimulatedGame(
                sim=config.sim,
                control=config.control,
                frame_interval=config.frame_interval(),
            )
            self.screen = None
        else:
            self.sim = None
            self.screen = ScreenCapture(config.capture)

    def open(self) -> None:
        if self.screen is not None:
            self.screen.open()

    def grab(self, roi: Optional[Rect] = None) -> Frame:
        if self.sim is not None:
            frame = self.sim.grab()
            # 关键：真值必须在「这一帧被渲染出来的那一刻」取。
            # 放到按键之后取的话，你比对的就是两个不同时刻的画面，会误判成检测不准。
            self._truth_x = self.sim.screen_x_true
            return frame
        return self.screen.grab(roi)  # type: ignore[union-attr]

    def advance(self, seconds: float) -> None:
        """仿真里用来补上「松键后等待」的那段时间。"""
        if self.sim is not None:
            self.sim.advance(seconds)

    def truth_x(self) -> Optional[float]:
        return self._truth_x

    def virtual_time(self) -> Optional[float]:
        return None if self.sim is None else self.sim.t

    def clock(self) -> float:
        """当前逻辑时钟：真机用墙钟，仿真用虚拟时钟。

        冷却期必须跟着这个走 —— 仿真里虚拟时钟只在 grab/advance 时前进，
        如果拿墙钟去算冷却，仿真的冷却会瞬间过期，测出来的行为跟真机不一致。
        """
        if self.sim is not None:
            return self.sim.t
        return time.monotonic()

    def has_base_region(self) -> bool:
        """有没有成功解析过截图区域。没有 = 窗口压根没找到，属于致命错误。"""
        if self.screen is None:
            return True
        return self.screen._last_base is not None  # noqa: SLF001

    def describe(self) -> str:
        if self.sim is not None:
            return self.sim.describe()
        return self.screen.describe() if self.screen is not None else "screen"

    def close(self) -> None:
        if self.screen is not None:
            self.screen.close()
        if self.sim is not None:
            self.sim.close()


# ================================================================ 主流程


class GameAgent:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.log = Logger(config)
        self.source = CaptureSource(config)
        self.detector = TargetDetector(config.detect)
        self.guard = FocusGuard(config.capture.focus_title, config.capture.focus_mode)
        self.hotkeys = HotkeyWatcher(config.hotkey_toggle, config.hotkey_quit)
        self.stats = VisualizerStats()
        self.observed_frames = 0
        self.clock = FrameClock(config.capture.target_fps)
        self.timings = Timings()

        # 仿真模式下如果没显式指定，就用 null 后端把脉冲喂给虚拟游戏
        backend = live_backend(config.capture.source, config.control.backend, config.capture.window_title, config.capture.focus_title, config.capture.focus_mode)
        if self.source.is_sim and backend == "pyautogui":
            backend = "null"
        self.backend_name = backend
        kwargs = (
            {"on_pulse": self.source.sim.apply_pulse}
            if backend == "null" and self.source.is_sim
            else {}
        )
        self.controller: InputController = create_controller(backend, **kwargs)

        self.visualizer = Visualizer(
            config, detector_desc=self.detector.describe(), backend_name=self.backend_name
        )
        self.visualizer.set_click_handler(self._on_preview_click)

        self.auto = bool(config.control.auto_start)
        self.frame_index = 0
        self.dump_dir = resolve_path(config.output.dump_dir) if config.output.dump_dir else None
        self.dumper: Optional[FrameDumper] = config_dumper(config, self.dump_dir)
        self._first_dump: Optional[Path] = None
        self._last_dump: Optional[Path] = None
        self._loop_start = time.monotonic()
        self._fps = 0.0
        self.first_frame_ms: Optional[float] = None
        self._frames_since_mark = 0
        self._last_rate_mark = time.monotonic()
        self._summary_written = False

        # ---- 保护机制的状态 ----
        self._last_base_size: Optional[tuple[int, int]] = None
        self._last_signature: Optional[bytes] = None
        self._frozen_run = 0
        self._frozen_announced = False
        self.freeze_events = 0
        self.capture_errors = 0
        self.skipped_frames = 0
        self._pending_click: Optional[tuple[int, int]] = None
        self._last_frame: Optional[Frame] = None

        # 发键之后到「允许再发下一次」之间的冷却期，用逻辑时钟表示。
        # 注意它是**非阻塞**的：冷却期间主循环照常抓屏+检测，只是不再发键。
        self._cooldown_until = 0.0
        self.cooldown_frames = 0

    # ------------------------------------------------------------ 启动自检

    def preflight(self) -> None:
        self.controller.release_all()  # 清掉上一次崩溃可能残留的按下状态
        self.log.event(f"输入后端 = {getattr(self.controller, 'name', self.backend_name)}")
        self.log.event(f"采集来源 = {self.source.describe()}")
        self.log.event(f"目标检测 = {self.detector.describe()}")
        self.log.event(
            f"阈值 = +/-{self.config.control.threshold_px}px  "
            f"脉冲 = {self.config.control.pulse_mode} "
            f"[{self.config.control.min_pulse_ms},{self.config.control.max_pulse_ms}]ms"
        )
        self.log.event(f"热键 = {self.hotkeys.describe()}")
        if self.config.capture.capture_roi:
            self.log.event(
                "跟踪窗口截图 = 开（锁定后只截目标周围一块，抓屏开销可降到 1/4）",
            )
        if self.config.capture.freeze_frames:
            self.log.event(
                f"冻结帧保护 = 画面连续 {self.config.capture.freeze_frames} 帧不动就"
                f"{'暂停自动控制' if self.config.capture.freeze_action == 'pause' else '报警'}",
                "warn" if self.config.capture.freeze_action == "pause" else "info",
            )
        if self.guard.active:
            self.log.event(
                f"焦点守卫 = {self.guard.mode}，只在前台窗口标题含 {self.guard.title!r} 时发键",
                "warn" if self.guard.mode == "block" else "info",
            )
        if self.config.capture.source != "sim" and not self.config.capture.window_title \
                and not self.config.capture.region and not self.guard.active:
            self.log.event(
                "没设 --window-title / --focus-title，A/D 会发给当前前台窗口。"
                "建议先加 --focus-title 限定游戏窗口。",
                "warn",
            )

    # ------------------------------------------------------------ 截图

    def _capture_hint(self) -> Optional[Rect]:
        """这一帧建议截哪里。None = 整个逻辑画面。

        只在开了 capture_roi、真实截图、而且已经锁定目标时才收窄。
        窗口尺寸用上一帧的 —— 第一帧必然是全画面，这样才能「找到」目标。
        """
        if not self.config.capture.capture_roi or self.source.is_sim or self.config.detect.mode == "feature":
            return None
        if self._last_base_size is None:
            return None
        base_w, base_h = self._last_base_size
        return self.detector.search_roi(base_w, base_h)

    def _grab(self) -> Optional[Frame]:
        hint = self._capture_hint()
        started = time.monotonic()
        try:
            frame = self.source.grab(hint)
        except CaptureError as exc:
            self.timings.add("grab", (time.monotonic() - started) * 1000.0)
            if not self.source.has_base_region():
                if time.monotonic() - self._loop_start < self.config.capture.startup_wait_seconds:
                    self.capture_errors += 1
                    self.skipped_frames += 1
                    if self.capture_errors == 1:
                        self.log.event(f"等待目标窗口进入前台；不截取旧位置：{exc}", "warn")
                    ABORT.sleep(min(.25, max(.02, 1.0 / max(1.0, self.config.capture.target_fps))))
                    return None
                raise
            self.capture_errors += 1
            self.skipped_frames += 1
            self.log.event(f"截图失败，跳过这一帧（第 {self.capture_errors} 次）：{exc}", "warn")
            if self.capture_errors >= 15:
                raise CaptureError(
                    f"连续 {self.capture_errors} 帧截图失败，不再重试"
                ) from exc
            ABORT.sleep(max(0.0, self.clock.remaining(started)))
            return None
        self.timings.add("grab", (time.monotonic() - started) * 1000.0)
        self.capture_errors = 0
        self._last_base_size = (frame.base_width, frame.base_height)
        return frame

    def _check_freeze(self, frame: Frame) -> bool:
        """画面是不是卡住了。

        连续 N 帧像素完全一致，说明游戏暂停了、被别的窗口挡住了，或者截图
        卡死了。这时候继续按 A/D 就是在瞎按。
        """
        limit = int(self.config.capture.freeze_frames)
        if limit <= 0:
            return False
        sig = frame.signature()
        if self._last_signature is not None and sig == self._last_signature:
            self._frozen_run += 1
        else:
            self._frozen_run = 0
            if self._frozen_announced:
                self.log.event("画面恢复变化，冻结保护解除", "good")
            self._frozen_announced = False
        self._last_signature = sig

        if self._frozen_run < limit:
            return False
        if not self._frozen_announced:
            self._frozen_announced = True
            self.freeze_events += 1
            self.log.event(
                f"画面已经连续 {self._frozen_run} 帧完全没变化（游戏暂停？被挡住了？"
                f"截图卡死？）—— 暂停自动控制，避免盲按",
                "warn",
            )
        return True

    # ------------------------------------------------------------ 一帧

    def run_frame(self) -> FrameRecord:
        loop_started = time.monotonic()

        # 1. 截图
        frame = self._grab()
        if frame is None:
            self.frame_index += 1
            self.timings.add("loop", (time.monotonic() - loop_started) * 1000.0)
            return FrameRecord(
                index=self.frame_index - 1, wall=time.time(), target_x=None,
                center_x=0, error=None, decision="LOST", action_key=None,
                duration_ms=0, sent=False, skipped="截图失败", fps=self._fps, auto=self.auto,
            )

        self._last_frame = frame

        # 处理预览窗里点选的目标（方案 A：点哪儿追哪儿）
        self._apply_pending_click(frame)

        # 2. 冻结帧检查（在检测之前：画面都不动了，检测也没意义）
        frozen = self._check_freeze(frame)

        # 3. 检测
        started = time.monotonic()
        target: Target = self.detector.detect_frame(frame)
        self.timings.add("detect", (time.monotonic() - started) * 1000.0)

        # 4. 判断
        started = time.monotonic()
        center_x = frame.center_x + int(self.config.control.center_offset)
        decision = decide(
            target.x if observed_target(target, frozen) else None,
            center_x,
            self.config.control.threshold_px,
            self.config.control.invert_axis,
        )
        action: Action = plan_action(decision, self.config.control, self.config.control.invert_axis)
        self.timings.add("decide", (time.monotonic() - started) * 1000.0)

        # 5. 发键
        started = time.monotonic()
        cooling = self._dispatch_action(action, frozen)
        if cooling:
            self.cooldown_frames += 1
        self.timings.add("key", (time.monotonic() - started) * 1000.0)

        # 6. 统计 + 可视化
        detect_x = target.raw_x if target.raw_x is not None else (target.x if target.found else None)
        fresh = observed_target(target, frozen)
        self.observed_frames += int(fresh)
        self.stats.push(decision.error if fresh else None, fresh and decision.is_centered, fresh)
        self.visualizer.update_history(decision.error if target.found else None)

        self._tick_fps()
        record = FrameRecord(
            index=self.frame_index,
            wall=time.time(),
            target_x=target.x if fresh else None,
            center_x=center_x,
            error=decision.error if fresh else None,
            decision=decision.direction,
            action_key=action.key if action.sent else None,
            duration_ms=action.duration_ms if action.sent else 0,
            sent=action.sent,
            skipped=action.skipped_reason,
            fps=self._fps,
            true_x=self.source.truth_x(),
            auto=self.auto,
            predicted=target.predicted,
            raw_x=detect_x,
            candidates=target.candidates,
            windowed=target.windowed,
            frozen=frozen,
            observed=fresh,
            confidence=target.confidence if fresh else 0.0,
            method=target.method,
        )
        self.log.frame(record)

        # 6b. 只在「真的要给人看」的时候才画 HUD。
        #
        # 原来这里无条件 render()，然后 --no-window 模式下把画好的图直接丢掉 ——
        # 白烧约 7ms/帧（实测），而且这 7ms 是在 8~30 FPS 的预算里扣的。
        # 落盘的时候还是要画：标注帧的价值就在于上面有 HUD。
        need_image = self.config.output.show_window or self._dump_due()
        image: Optional[np.ndarray] = None
        started = time.monotonic()
        if need_image:
            image = self.visualizer.render(
                frame, target, decision, action, self._fps, self.auto,
                extra_lines=self._hud_extra(target),
            )
        self.timings.add("draw", (time.monotonic() - started) * 1000.0)

        started = time.monotonic()
        if image is not None:
            self._maybe_dump(image)
        self.timings.add("dump", (time.monotonic() - started) * 1000.0)

        if self.config.output.show_window:
            self.visualizer.open()
            self.visualizer.show_raw(frame)
            self._handle_cv_key(self.visualizer.poll_key())
            cv2.imshow(Visualizer.WINDOW_MAIN, image)
        else:
            self.visualizer.poll_key()

        self.frame_index += 1

        # 7. 节流到目标 FPS（仿真用虚拟时钟，不 sleep）
        #
        # 注意这里**没有** settle 的阻塞 sleep。发键后的等待已经变成 _cooldown_until，
        # 由上面的冷却门在后续帧里体现 —— 冷却期间我们照常抓屏和检测，
        # 所以追踪器不会断流，主循环也不会出现 100ms 级别的尖峰。
        if not self.source.is_sim:
            remaining = self.clock.remaining(loop_started)
            if remaining > 0:
                ABORT.sleep(remaining)

        loop_ms = (time.monotonic() - loop_started) * 1000.0
        if self.first_frame_ms is None:
            # 首帧：记到单独的账上，然后把滚动窗口清空，这一帧的 loop 也不进统计 ——
            # 否则清完又加回去，max 依然是那个 200ms。
            # （注意别用 frame_index 判断，它在上面已经自增过了。）
            # 首帧贵是一次性的：mss 初始化会顺带把进程切成 DPI 感知，
            # ctypes 的 windll 绑定是惰性的，OpenCV/numpy 也有一堆惰性初始化。
            self.first_frame_ms = round(loop_ms, 2)
            self.timings.reset()
        else:
            self.timings.add("loop", loop_ms)

        # 尖峰单独打一条：混在几百行逐帧日志里的 200ms 帧是找不到的，
        # 而「为什么突然卡一下」恰恰只能靠这一帧的现场来回答。
        #
        # 注意「发键」这一项和后面括号里的「脉冲」是两个数：发键 = 整个
        # _dispatch_action 的耗时，脉冲 = 计划要按住多久。正常情况下两者
        # 几乎相等；如果发键 >> 脉冲，说明有东西叠在按键后面（历史上就是
        # settle 的阻塞 sleep），这一条日志就是为此设计的。
        # 首帧不算尖峰（它是一次性预热，已经有单独的一行说明）。
        budget = 1000.0 / self.config.capture.target_fps if self.config.capture.target_fps else 0.0
        if self.timings.last("loop") == loop_ms and budget and loop_ms >= max(3 * budget, 60.0):
            self.log.event(
                f"#{record.index} 整帧 {loop_ms:.0f}ms（帧预算 {budget:.1f}ms）"
                f"｜抓屏 {self.timings.last('grab'):.0f} 检测 {self.timings.last('detect'):.0f}"
                f" 发键 {self.timings.last('key'):.0f}(脉冲 {record.duration_ms})"
                f" 绘制 {self.timings.last('draw'):.0f}"
                f" 落盘 {self.timings.last('dump'):.0f}ms",
                "warn",
            )
        return record

    # ------------------------------------------------------------ 发键

    def _dispatch_action(self, action: Action, frozen: bool) -> bool:
        """唯一一处真正按键的地方。所有「该不该按」的判断都集中在这里。

        返回 True 表示这一帧处于冷却期（已经按过键，正在等游戏响应）。
        冷却期是非阻塞的 —— 调用方照常抓屏、检测、画图，只是不发新的键。
        这样做的好处是追踪器在冷却期间继续跟着目标走，不会因为等待而丢锁。
        """
        if not action.key:
            return False
        if frozen:
            action.sent = False
            action.skipped_reason = "画面卡住"
            return False
        if not self.auto:
            action.sent = False
            action.skipped_reason = "已暂停"
            return False

        # 冷却门：上一次按键之后要让游戏有一段时间去响应，这期间不再按键。
        if self.source.clock() < self._cooldown_until:
            action.sent = False
            action.skipped_reason = "冷却中"
            return True

        allowed, current_title = self.guard.check()
        if not allowed:
            action.sent = False
            action.skipped_reason = f"前台是 {current_title[:24]!r}"
            return False

        action.started_at = time.monotonic()
        action.sent = True
        self.stats.pulses += 1
        self.controller.pulse(action.key, action.duration_ms, abort=lambda: ABORT.is_set())

        settle = max(0, int(self.config.control.settle_ms))
        if settle > 0:
            if self.config.control.debug_blocking_settle:
                # 负对照：复现旧实现（阻塞 sleep），用来证明 test_real_screen.py
                # 的尖峰检查不是个永远通过的假测试。日常使用不要打开。
                ABORT.sleep(settle / 1000.0)
                self._cooldown_until = 0.0
            else:
                # pulse() 返回时键已经松开了，冷却从这一刻开始算
                self._cooldown_until = self.source.clock() + settle / 1000.0
        return False

    # ------------------------------------------------------------ 交互

    def _on_preview_click(self, x: int, y: int) -> None:
        """预览窗里的鼠标点击。只记下来，真正的处理放到主循环里做。"""
        self._pending_click = (int(x), int(y))

    def _apply_pending_click(self, frame: Frame) -> None:
        if self._pending_click is None:
            return
        x, y = self._pending_click
        self._pending_click = None
        h, w = frame.image.shape[:2]
        if not (0 <= x < w and 0 <= y < h):
            self.log.event("点击位置在画面之外，忽略", "warn")
            return
        message = self.detector.lock_color(frame.image, x, y)
        bx, by = frame.image_to_base(x, y)
        self.detector.seed_lock(bx, by)
        self.log.event(f"点击锁色 @ 画面({x},{y}) → {message}", "good")
        self.visualizer.set_detector_desc(self.detector.describe())

    def _handle_cv_key(self, keycode: int) -> None:
        """非 Windows 时用窗口按键兜底。Windows 上热键是全局的。"""
        toggle, quit_, reset = self.hotkeys.poll_cv_keys(keycode)
        if quit_:
            self.log.event("ESC：退出并释放按键", "warn")
            ABORT.set()
        elif toggle:
            self.toggle_auto()
        elif reset:
            self.reset_tracking()

    def toggle_auto(self) -> None:
        self.auto = not self.auto
        if not self.auto:
            self.controller.release_all()  # 暂停的那一刻就把键松开
            self.log.event("已暂停自动控制（按键已释放）", "warn")
        else:
            self.log.event("开始自动控制", "good")

    def reset_tracking(self) -> None:
        self.detector.reset_tracking()
        self.log.event("跟踪状态已清空，下一帧回到全画面搜索")

    # ------------------------------------------------------------ 杂项

    def _hud_extra(self, target: Target) -> list[str]:
        bits = [f"backend: {self.backend_name}", f"source: {self.config.capture.source}"]
        if self.config.output.show_timings:
            bits.extend(self.timings.hud_lines())
        if self.guard.active:
            allowed, _ = self.guard.check()
            bits.append("focus: ok" if allowed else "focus: BLOCKED")
        if self.config.capture.capture_roi and self.source.screen is not None:
            bits.append("capture: tracking-window" if target.windowed else "capture: full")
        if self.config.capture.freeze_frames and self._frozen_run > 0:
            bits.append(f"frame: static x{self._frozen_run}")
        left = self._cooldown_until - self.source.clock()
        if left > 0:
            bits.append(f"cooldown: {left * 1000:.0f}ms")
        if target.windowed:
            bits.append(f"search: window  cands {target.candidates}")
        if self.source.is_sim and self.source.sim is not None:
            bits.append(f"yaw: {self.source.sim.yaw_deg:+.1f}deg")
        return bits

    def _tick_fps(self) -> None:
        self._frames_since_mark += 1
        now = time.monotonic()

        # 仿真跑的是虚拟时钟，墙上时间没有意义（会显示 3000fps）。
        # 这里改成「虚拟时间下的逻辑帧率」，才和真机的口径可比。
        virtual = self.source.virtual_time()
        if virtual is not None:
            self._fps = self.frame_index / virtual if virtual > 0 else 0.0
            return

        span = now - self._last_rate_mark
        if span >= 0.5:
            self._fps = self._frames_since_mark / span
            self._frames_since_mark = 0
            self._last_rate_mark = now

    def _dump_due(self) -> bool:
        """这一帧要不要落盘。用来决定「值不值得画 HUD」。

        必须和 _maybe_dump 用同一个 frame_index（这里读的是递增之前的值），
        否则会出现「判定该画、实际没落盘」的错位。
        """
        if self.dump_dir is None or self.dumper is None:
            return False
        every = max(1, int(self.config.output.dump_every))
        if self.frame_index == 0 or self.frame_index % every == 0:
            return True
        max_frames = self.config.output.max_frames
        return bool(max_frames) and self.frame_index >= max_frames - 1

    def _maybe_dump(self, image) -> None:
        if self.dump_dir is None or self.dumper is None:
            return
        every = max(1, int(self.config.output.dump_every))
        is_first = self.frame_index == 0
        is_scheduled = self.frame_index % every == 0
        is_last = bool(self.config.output.max_frames) and \
            self.frame_index >= self.config.output.max_frames - 1
        if not (is_first or is_scheduled or is_last):
            return
        ext = ".png" if self.dumper.fmt == "png" else ".jpg"
        path = self.dump_dir / f"frame-{self.frame_index:05d}{ext}"
        # 交给后台线程：主循环绝不因为写盘掉帧
        self.dumper.submit(image, path)
        if self._first_dump is None:
            self._first_dump = path
        self._last_dump = path

    # ------------------------------------------------------------ 汇总

    def summary_text(self) -> tuple[dict, str]:
        s = self.stats.summary(self.config.control.threshold_px)
        elapsed = time.monotonic() - self._loop_start
        timing = self.timings.stats()
        detector_stats = {
            "windowed_frames": self.detector.windowed_frames,
            "hold_frames": self.detector.hold_frames,
            "multi_candidate_frames": self.detector.multi_candidate_frames,
            "capture_failures": self.capture_errors,
            "skipped_frames": self.skipped_frames,
            "freeze_events": self.freeze_events,
            "cooldown_frames": self.cooldown_frames,
            "first_frame_ms": self.first_frame_ms,
            "frames": self.frame_index,
        }
        if self.source.screen is not None:
            detector_stats["capture_reopens"] = self.source.screen.reopen_count
        data = {
            **s,
            **timing,
            **detector_stats,
            "elapsed_s": round(elapsed, 3),
            "effective_fps": round(self.frame_index / elapsed, 2) if elapsed > 0 else 0.0,
            "source": self.config.capture.source,
            "validation_status": "simulation_only" if self.source.is_sim else "unverified_real_game",
            "observed_frames": self.observed_frames,
            "semantic_target_verified": False,
            "motion_model_verified": False,
            "backend": self.backend_name,
            "detector": self.detector.describe(),
            "invert_axis": self.config.control.invert_axis,
            "capture_roi": self.config.capture.capture_roi,
            "dumps_written": self.dumper.written if self.dumper else 0,
            "dumps_dropped": self.dumper.dropped if self.dumper else 0,
        }

        lines = [
            "",
            "=" * 62,
            "  闭环结果",
            "=" * 62,
            f"  帧数              {s['frames']}",
            f"  目标检出率        {s['detect_rate'] * 100:.1f}%",
            f"  判定居中比例      {s['centered_rate'] * 100:.1f}%",
            f"  发出脉冲次数      {s['pulses']}",
            f"  |error| 全程均值  {s['abs_error_mean_all']:.1f}px",
            f"  |error| 稳定后均值{s['abs_error_mean_tail']:.1f}px   <- 收敛看这个",
            f"  |error| 最大      {s['abs_error_max']:.1f}px",
            f"  稳定后落在阈值内  {s['within_threshold_tail'] * 100:.1f}%",
            f"  阈值              +/-{s['threshold']}px",
            "-" * 62,
            f"  耗时              {elapsed:.2f}s",
            f"  实际帧率          {data['effective_fps']:.1f} fps",
        ]
        if self.source.is_sim:
            lines[-1] += "（仿真不 sleep，不代表真机速度）"
        if timing:
            lines += [
                "-" * 62,
                "  逐阶段耗时 p50 / p95 / max (ms)",
                f"    抓屏           {timing.get('grab_p50_ms', 0):7.2f} /{timing.get('grab_p95_ms', 0):7.2f} /{timing.get('grab_max_ms', 0):7.2f}",
                f"    目标检测       {timing.get('detect_p50_ms', 0):7.2f} /{timing.get('detect_p95_ms', 0):7.2f} /{timing.get('detect_max_ms', 0):7.2f}",
                f"    判断+规划      {timing.get('decide_p50_ms', 0):7.2f} /{timing.get('decide_p95_ms', 0):7.2f} /{timing.get('decide_max_ms', 0):7.2f}",
                f"    按键等待       {timing.get('key_p50_ms', 0):7.2f} /{timing.get('key_p95_ms', 0):7.2f} /{timing.get('key_max_ms', 0):7.2f}",
                f"    可视化绘制     {timing.get('draw_p50_ms', 0):7.2f} /{timing.get('draw_p95_ms', 0):7.2f} /{timing.get('draw_max_ms', 0):7.2f}",
                f"    落盘提交       {timing.get('dump_p50_ms', 0):7.2f} /{timing.get('dump_p95_ms', 0):7.2f} /{timing.get('dump_max_ms', 0):7.2f}",
                f"    整帧           {timing.get('loop_p50_ms', 0):7.2f} /{timing.get('loop_p95_ms', 0):7.2f} /{timing.get('loop_max_ms', 0):7.2f}",
                f"    （滚动窗口 {Timings.WINDOW} 帧；帧率看 max 而不是 p50）",
            ]
            if self.first_frame_ms is not None:
                lines.append(
                    f"    首帧 {self.first_frame_ms:.1f}ms（一次性预热：mss 初始化切 DPI 感知、"
                    f"ctypes/OpenCV 惰性绑定；已从上面的统计中剔除）"
                )
        lines += [
            "-" * 62,
            "  检测细节",
            f"    走跟踪窗口的帧  {detector_stats['windowed_frames']}",
            f"    丢帧保持补的帧  {detector_stats['hold_frames']}",
            f"    多候选的帧      {detector_stats['multi_candidate_frames']}",
            f"    冷却期帧数      {detector_stats['cooldown_frames']}",
            f"    截图失败跳过    {detector_stats['skipped_frames']}",
            f"    冻结报警次数    {detector_stats['freeze_events']}",
        ]
        if self.dumper is not None:
            lines.append(
                f"    标注帧落盘      {self.dumper.written} 张"
                f"（丢弃 {self.dumper.dropped}，失败 {self.dumper.errors}）"
            )
        lines += ["=" * 62, ""]
        return data, "\n".join(lines)

    def write_summary(self) -> None:
        if self._summary_written:
            return
        self._summary_written = True
        data, text = self.summary_text()
        self.log.summary(data, text)
        if self.dump_dir is not None:
            try:
                self.dump_dir.mkdir(parents=True, exist_ok=True)
                (self.dump_dir / "summary.json").write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
            except Exception:
                pass

    def close(self) -> None:
        try:
            self.controller.release_all()
        except Exception:
            pass
        try:
            self.source.close()
        except Exception:
            pass
        if self.dumper is not None:
            self.dumper.flush()
            self.dumper.close()
        self.visualizer.close()
        self.log.close()

    # ------------------------------------------------------------ 主循环

    def run(self) -> int:
        cfg = self.config
        try:
            self.preflight()
        except (CaptureError, RuntimeError) as exc:
            # 启动阶段就失败：直接说清楚原因，别让它变成一个看不懂的 traceback
            print(f"[error] 启动失败：{exc}", file=sys.stderr)
            self.close()
            return 3

        atexit.register(self.close)
        for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
            if sig is None:
                continue
            try:
                signal.signal(sig, lambda *_a: ABORT.set())
            except Exception:
                pass

        self.log.event(
            "按 F8 开始自动控制" if not self.auto else "已自动开始；按 F8 可暂停",
            "good",
        )
        if self.config.output.show_window and self.config.output.dump_dir:
            self.log.event("预览窗里点一下目标 = 锁定那个颜色（方案 A）", "good")

        exit_code = 0
        try:
            while not ABORT.is_set():
                self.run_frame()

                toggle, quit_, reset = self.hotkeys.poll()
                if quit_:
                    self.log.event("ESC：退出并释放按键", "warn")
                    break
                if toggle:
                    self.toggle_auto()
                elif reset:
                    self.reset_tracking()

                if not self.auto and self._should_idle_exit():
                    break

                if cfg.output.max_frames and self.frame_index >= cfg.output.max_frames:
                    self.log.event(f"达到 --max-frames {cfg.output.max_frames}，自动停止")
                    break
                if cfg.output.max_seconds and (time.monotonic() - self._loop_start) >= cfg.output.max_seconds:
                    self.log.event(f"达到 --max-seconds {cfg.output.max_seconds}，自动停止")
                    break
        except KeyboardInterrupt:
            self.log.event("收到 Ctrl+C", "warn")
        except CaptureError as exc:
            self.log.event(f"截图不可用，退出：{exc}", "error")
            exit_code = 3
        except Exception as exc:  # noqa: BLE001  最后一层兜底：先松键，再把错误抛给用户看
            self.log.event(f"运行出错：{type(exc).__name__}: {exc}", "error")
            import traceback

            traceback.print_exc(file=sys.stderr)
            exit_code = 2
        finally:
            self.close()
            self.write_summary()

        return exit_code

    def _should_idle_exit(self) -> bool:
        """headless 模式下没人会按 F8，所以限制一下空转。"""
        if self.config.control.auto_start:
            return False
        limit = self.config.output.idle_frames
        if limit <= 0:
            return False
        return self.frame_index >= limit


def config_dumper(config: Config, dump_dir: Optional[Path]) -> Optional[FrameDumper]:
    if dump_dir is None:
        return None
    return FrameDumper(
        dump_dir,
        fmt=config.output.dump_format,
        queue_size=config.output.dump_queue,
    )


# ================================================================ 入口


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    # 一次性小工具：把当前可见窗口列成 JSON，给界面上的「选择游戏窗口」下拉用。
    # 必须在 watch_stdin() 之前返回 —— 这个模式只是回答一个问题，不进入主循环。
    if "--list-windows" in argv:
        from screen_capture import list_visible_windows

        print(json.dumps({"windows": list_visible_windows()}, ensure_ascii=False))
        return 0

    watch_stdin()
    config = from_args(argv)

    # auto_start 的默认值按来源决定：仿真自己就是裁判，直接开跑；
    # 真机则必须你亲手按 F8 —— 绝不默认往你的游戏里敲键。
    if config.control.auto_start is None:
        config.control.auto_start = config.capture.source == "sim"

    agent = GameAgent(config)
    return agent.run()


if __name__ == "__main__":
    sys.exit(main())
