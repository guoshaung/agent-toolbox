"""
config.py —— 所有可调参数的唯一来源。

设计原则：
  1. 默认值必须能直接跑起来（零配置 = 跑通无头闭环仿真）。
  2. 命令行只做「覆盖」，不做「替代」；每个字段都能用 --<组>-<字段> 命中。
  3. 可以整体落盘成 JSON，方便从工具箱界面读写。

不要在这里读写任何硬件，也不要 import cv2 —— 这里只描述「想要什么」。
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field, asdict, fields
from pathlib import Path
from typing import Any, Optional, Tuple

PROJECT_DIR = Path(__file__).resolve().parent

# 颜色方案的 HSV 预设。红色在 OpenCV 的 H 轴上跨界（0 和 180 附近），
# 所以要拆成两段，取并集才稳定。
COLOR_PRESETS: dict[str, list[tuple[int, int, int, int, int, int]]] = {
    # (h_lo, s_lo, v_lo, h_hi, s_hi, v_hi)
    "red": [(0, 110, 90, 10, 255, 255), (168, 110, 90, 180, 255, 255)],
    "yellow": [(20, 100, 120, 35, 255, 255)],
    "green": [(45, 80, 70, 85, 255, 255)],
    "blue": [(95, 120, 70, 130, 255, 255)],
    "magenta": [(140, 90, 90, 168, 255, 255)],
    "white": [(0, 0, 200, 180, 40, 255)],
}

HOTKEY_VK = {
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
    "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
    "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
    "esc": 0x1B, "escape": 0x1B,
    "space": 0x20, "home": 0x24, "end": 0x23,
}


@dataclass
class CaptureConfig:
    """怎么拿到画面。"""

    # screen = 真实屏幕（mss 截图）；sim = 内置无头仿真（不需要显卡窗口，闭环可验证）
    source: str = "screen"
    # mss 的显示器编号，1 = 主屏
    monitor: int = 1
    # 显式指定截图区域 (left, top, width, height)。None = 整个显示器
    region: Optional[Tuple[int, int, int, int]] = None
    # 只截标题包含这个字符串的窗口（空 = 按 region / monitor 截）。窗口移动、缩放会自动跟随
    window_title: str = ""
    # 目标频率。5~10 足够，太高只会让 CPU 白转
    target_fps: float = 8.0
    # 焦点守卫：只有前台窗口标题包含这个字符串时才发按键（空 = 不检查）
    focus_title: str = ""
    # block = 不匹配就不发键；warn = 只打印警告仍然发；off = 完全不管
    focus_mode: str = "block"
    # 抓屏失败重试次数。游戏切全屏/改分辨率时 mss 会短暂抛异常，
    # 重试一次通常就好了；以前不重试，这一下直接把整个程序带崩。
    grab_retries: int = 3
    # 「跟踪窗口」截图：锁定目标后只截它周围一小块。
    # 实测 2560x1440 全屏抓一次 28ms，920x518 只要 7ms —— 最大的一笔开销。
    # 默认关（开着会让预览窗只显示一小块，调试时不直观），
    # 想要高帧率就打开，或者用 --fast。
    capture_roi: bool = False
    # 冻结帧检测：画面连续这么多帧完全一样，说明游戏暂停了、被别的窗口挡住了、
    # 或者截图卡住了。这时候画面分析毫无意义，继续发键就是在瞎按。
    # 45 帧 @8fps ≈ 5.6 秒。0 = 关闭。
    freeze_frames: int = 45
    # warn = 只在日志里提醒，照常发键；pause = 直接暂停自动控制（安全默认）
    freeze_action: str = "pause"
    # Allow the user to switch from the toolbox to the target before the first frame.
    startup_wait_seconds: float = 15.0


@dataclass
class DetectConfig:
    """怎么在画面里找到目标。"""

    # color = 颜色团块（方案 A 点击锁色 / 方案 B 固定颜色）；template = 模板匹配（方案 C）
    mode: str = "color"
    # 颜色预设名，见 COLOR_PRESETS。为空则用下面的 hsv_lower / hsv_upper
    preset: str = "red"
    hsv_lower: Tuple[int, int, int] = (0, 110, 90)
    hsv_upper: Tuple[int, int, int] = (10, 255, 255)
    # 面积过滤，滤掉噪点和小碎片
    min_area: int = 40
    max_area: int = 0  # 0 = 不限
    # 形态学核大小，3 比较稳；画面噪点大可以调到 5
    morph_kernel: int = 3
    # 只在画面这块区域里找目标 (x, y, w, h)，可显著提速并排除 HUD 干扰
    roi: Optional[Tuple[int, int, int, int]] = None
    # 模板匹配用
    template_path: str = ""
    match_threshold: float = 0.72

    # ---------------- 性能 ----------------

    # 检测前把画面长边缩到这个值以内。2560x1440 → 1280x720 后，
    # 整条检测链从 20ms 降到 4.3ms（实测 4.7 倍），坐标会映射回原尺寸。
    # 1280 及以下的画面不受影响，所以仿真和测试窗口的行为完全不变。
    detect_max_side: int = 1280
    # 模板匹配单独设一个更小的上限：全屏 60x60 模板匹配实测要 96ms，
    # 直接吃光一整帧的预算。缩到 960 后大约 5ms。
    template_max_side: int = 960

    # ---------------- 开放世界时序跟踪 ----------------

    # 锁定后只在上一帧位置附近找。开放世界里同色物太多（血条、UI、环境光），
    # 没有「上一帧在哪」这个先验，选出来的团块会一帧一个样。
    track_enabled: bool = True
    # 搜索窗的固定半宽/半高下限（像素）
    track_pad_px: int = 200
    # 搜索窗相对画面尺寸的比例下限。目标一次脉冲最多移动
    # 转向速度 x 最长脉冲 ≈ 9 度，1440p 下约 250px，留 0.18 的余量够用
    track_pad_ratio: float = 0.18
    # 连续丢这么多帧之内，沿用上一帧的位置（标记为 predicted），
    # 超过才判定为丢失。开放世界里 marker 被树挡一两帧很常见，
    # 一丢就停手会让控制变得一顿一顿的。5 帧 @8fps ≈ 0.6 秒。
    lost_hold_frames: int = 5
    # 位置平滑系数：0 = 完全不动，1 = 完全用新值。0.55 能明显压住抖动，
    # 又不会引入可感知的延迟
    smooth_alpha: float = 0.55
    # 单帧允许的最大跳变（像素）。0 = 不限。
    # 这是开放世界防「锁定被抢」的最后闸门：按默认转向 60°/s、最长脉冲 150ms、
    # 90° 视场折算，1440p 下一帧目标最多移动 ~300px，给 400 的余量。
    # 设了它，画面另一头突然出现一个更大的同色物也抢不走锁定。
    max_jump_px: int = 400
    # 候选团块长宽比上限（长边/短边）。0 = 不限。滤掉细长条状的
    # 环境元素（栏杆、光线、UI 横线）
    aspect_max: float = 4.0
    # 候选轮廓的最小填充率（面积 / 外接矩形面积）。0 = 不限。
    # 0.35 能滤掉大部分空心的圈和零散碎片，实心的 marker / 圆点不受影响
    fill_min: float = 0.35
    # 多候选打分权重：面积 vs 离上一帧位置的距离。两者相加为 1。
    # 距离权重高 = 更信任「它不会瞬移」这个先验
    score_area_weight: float = 0.45
    score_dist_weight: float = 0.55
    # 相邻候选框合并的 IoU 阈值（同一目标被切碎成几块时合并）
    nms_iou: float = 0.35


@dataclass
class ControlConfig:
    """怎么把误差变成按键。"""

    # 误差阈值（像素）。|error| <= threshold 就判定 CENTERED，松开所有键
    threshold_px: int = 50
    # fixed = 每次按固定 pulse_ms；proportional = 误差越大按越久（clamp 在 min/max 之间）
    pulse_mode: str = "proportional"
    pulse_ms: int = 100
    min_pulse_ms: int = 50
    max_pulse_ms: int = 150
    # proportional 模式的增益：duration = |error| * gain，再 clamp
    gain_ms_per_px: float = 0.25
    # 松键之后到「允许再发一次键」之间的冷却期。
    # 关键：它是**非阻塞**的 —— 冷却期间主循环照常抓屏、检测、画图，
    # 只是不再按键。早期实现是直接 sleep(settle_ms)，叠在脉冲之后会把脉冲帧
    # 拖到 ~130ms（帧预算只有 16.7ms 时等于掉 7 帧），而且追踪器会断流。
    settle_ms: int = 60
    # 负对照开关：把 settle 退回旧的阻塞 sleep，只给测试用来验证尖峰检查有牙
    debug_blocking_settle: bool = False
    # 有些游戏里 A/D 方向是反的
    invert_axis: bool = False
    # 认为的「屏幕中心」相对画面几何中心的横向偏移（正数 = 往右挪）
    center_offset: int = 0
    # 启动后是否立刻自动开始。None = 按来源自动决定（仿真默认开，真机默认要按 F8）
    auto_start: Optional[bool] = None
    # 输入后端：pyautogui（默认）/ sendinput（Windows 扫描码，对 DirectInput 游戏兼容更好）/ null（只记录不发键）
    backend: str = "pyautogui"


@dataclass
class OutputConfig:
    """日志和可视化。"""

    log_file: str = ""
    # 每帧日志用多行块还是单行。多行块好读，单行适合长时间盯屏
    verbose_log: bool = True
    # text = 纯文本日志；json = 每帧一行 JSON（带 @@FRAME@@ 前缀），给工具箱父进程解析
    events: str = "text"
    # 存标注帧的目录，用来事后复盘 / 出证据
    dump_dir: str = ""
    dump_every: int = 10
    # jpg / png。1440p 一帧 PNG 编码实测 97ms —— 直接吃掉一整帧预算，
    # 所以默认走 jpg（21ms），而且落盘是后台线程，不阻塞主循环。
    dump_format: str = "jpg"
    # 后台落盘队列深度。满了就丢最旧的，绝不因为写盘拖慢控制。
    dump_queue: int = 8
    show_window: bool = True
    # 额外开一个窗口显示「原始截图」（不加任何标注）
    show_game_window: bool = False
    # HUD 上显示逐阶段耗时（抓屏/检测/绘制）
    show_timings: bool = True
    # 自动停止条件，方便脚本化验证。0 = 不限
    max_seconds: float = 0.0
    max_frames: int = 0
    # 没开自动控制时空转多少帧就退出（0 = 一直等）。避免 headless 跑挂了没人知道
    idle_frames: int = 0


@dataclass
class SimConfig:
    """无头仿真的「虚拟游戏」参数。"""

    width: int = 1280
    height: int = 720
    # 视场角：屏幕横向一共覆盖多少度
    fov_deg: float = 90.0
    # 按住 A/D 每秒转多少度。
    # 这个值决定「一次最小脉冲能移动多少像素」：turn_speed * min_pulse_ms / 1000 度，
    # 换算成像素必须小于 threshold_px，否则控制回路会一直在阈值带两侧来回跳，
    # 永远停不下来。默认 60deg/s × 50ms = 3deg ≈ 42px < 50px，刚好收得住。
    turn_speed_dps: float = 60.0
    dot_radius: int = 16
    # 红点在世界坐标里随机漂移的速度（像素/秒，按屏幕尺度折算）
    drift_px_per_s: float = 240.0
    # 每隔多久换一次漂移方向
    drift_change_s: float = 1.1
    # 开局红点偏右多少像素，制造一个明确的初始误差
    start_offset_px: int = 420
    noise: bool = False
    seed: int = 7
    background_bgr: Tuple[int, int, int] = (10, 10, 12)
    dot_color_bgr: Tuple[int, int, int] = (0, 0, 255)


@dataclass
class Config:
    capture: CaptureConfig = field(default_factory=CaptureConfig)
    detect: DetectConfig = field(default_factory=DetectConfig)
    control: ControlConfig = field(default_factory=ControlConfig)
    output: OutputConfig = field(default_factory=OutputConfig)
    sim: SimConfig = field(default_factory=SimConfig)

    hotkey_toggle: str = "f8"
    hotkey_quit: str = "esc"

    # ---------- 派生量 ----------

    def hsv_ranges(self) -> list[tuple[Tuple[int, int, int], Tuple[int, int, int]]]:
        """把 preset / 手填值统一成「若干段 HSV 区间」。"""
        if self.detect.preset:
            key = self.detect.preset.strip().lower()
            if key not in COLOR_PRESETS:
                raise ValueError(
                    f"未知颜色预设 {self.detect.preset!r}，可选：{', '.join(COLOR_PRESETS)}"
                )
            return [
                ((h_lo, s_lo, v_lo), (h_hi, s_hi, v_hi))
                for h_lo, s_lo, v_lo, h_hi, s_hi, v_hi in COLOR_PRESETS[key]
            ]
        return [(tuple(self.detect.hsv_lower), tuple(self.detect.hsv_upper))]

    def center_x(self, frame_width: int) -> int:
        return frame_width // 2 + self.control.center_offset

    def frame_interval(self) -> float:
        return 1.0 / max(1.0, float(self.capture.target_fps))

    # ---------- 序列化 ----------

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        if not target.is_absolute():
            target = PROJECT_DIR / target
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return target

    @classmethod
    def load(cls, path: str | Path) -> "Config":
        source = Path(path)
        if not source.is_absolute():
            source = PROJECT_DIR / source
        raw = json.loads(source.read_text(encoding="utf-8"))
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Config":
        cfg = cls()
        for group_name, group_obj in (
            ("capture", cfg.capture),
            ("detect", cfg.detect),
            ("control", cfg.control),
            ("output", cfg.output),
            ("sim", cfg.sim),
        ):
            for key, value in (raw.get(group_name) or {}).items():
                if not hasattr(group_obj, key):
                    continue
                if isinstance(value, list) and isinstance(getattr(group_obj, key), tuple):
                    value = tuple(value)
                setattr(group_obj, key, value)
        for key in ("hotkey_toggle", "hotkey_quit"):
            if raw.get(key):
                setattr(cfg, key, raw[key])
        return cfg


# ---------------------------------------------------------------- 命令行


def _apply(group_obj: Any, prefix: str, args: argparse.Namespace) -> None:
    for f in fields(group_obj):
        attr = f"{prefix}_{f.name}"
        if not hasattr(args, attr):
            continue
        value = getattr(args, attr)
        if value is None:
            continue
        setattr(group_obj, f.name, value)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="game-agent",
        description="视觉闭环控制 PoC：截图 → 找目标 → 判左右 → 敲 A/D → 再截图",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--config", help="从 JSON 读取配置，命令行参数优先级更高")
    parser.add_argument("--fast", action="store_true",
                        help="性能预设：跟踪窗口截图 + 检测缩到 960 + jpg 落盘")

    g = parser.add_argument_group("采集／Capture")
    g.add_argument("--capture-source", "--source", dest="capture_source",
                   choices=["screen", "sim"], help="画面来源")
    g.add_argument("--monitor", type=int, help="显示器编号，1 = 主屏")
    g.add_argument("--region", help="截图区域 left,top,width,height")
    g.add_argument("--window-title", dest="capture_window_title", help="只截标题含此串的窗口")
    g.add_argument("--fps", type=float, dest="capture_target_fps", help="目标帧率")
    g.add_argument("--focus-title", help="只有前台窗口标题含此串时才发按键")
    g.add_argument("--focus-mode", choices=["block", "warn", "off"], help="焦点守卫模式")
    g.add_argument("--grab-retries", type=int, dest="capture_grab_retries", help="抓屏失败重试次数")
    g.add_argument("--capture-roi", action="store_true", dest="capture_capture_roi", default=None,
                   help="锁定后只截目标周围一小块，大幅提速（预览窗会变成局部视图）")
    g.add_argument("--freeze-frames", type=int, dest="capture_freeze_frames",
                   help="画面连续 N 帧完全一样就认为卡住，0 = 关闭")
    g.add_argument("--freeze-action", choices=["pause", "warn"], dest="capture_freeze_action",
                   help="卡住时的动作：pause 暂停发键 / warn 只提醒")

    g = parser.add_argument_group("检测／Detect")
    g.add_argument("--mode", dest="detect_mode", choices=["color", "template", "feature"], help="检测方式")
    g.add_argument("--preset", dest="detect_preset", help="颜色预设：red/yellow/green/blue/magenta/white")
    g.add_argument("--hsv-lower", help="HSV 下界 h,s,v")
    g.add_argument("--hsv-upper", help="HSV 上界 h,s,v")
    g.add_argument("--min-area", type=int, dest="detect_min_area", help="最小面积")
    g.add_argument("--max-area", type=int, dest="detect_max_area", help="最大面积，0 = 不限")
    g.add_argument("--morph-kernel", type=int, dest="detect_morph_kernel", help="形态学核大小")
    g.add_argument("--roi", dest="detect_roi", help="只在这块区域找目标 x,y,w,h")
    g.add_argument("--template", dest="detect_template_path", help="模板图片路径")
    g.add_argument("--match-threshold", type=float, dest="detect_match_threshold", help="模板匹配阈值")
    g.add_argument("--detect-max-side", type=int, dest="detect_detect_max_side",
                   help="检测前把画面长边缩到此值以内，0 = 不缩")
    g.add_argument("--template-max-side", type=int, dest="detect_template_max_side",
                   help="模板匹配时画面长边上限")
    g.add_argument("--track", dest="detect_track_enabled", action="store_true", default=None,
                   help="开启时序跟踪（默认开）")
    g.add_argument("--no-track", dest="detect_track_enabled", action="store_false", default=None,
                   help="关闭时序跟踪，每帧独立在全画面里找")
    g.add_argument("--track-pad-px", type=int, dest="detect_track_pad_px", help="搜索窗半宽下限")
    g.add_argument("--track-pad-ratio", type=float, dest="detect_track_pad_ratio", help="搜索窗相对画面比例")
    g.add_argument("--lost-hold", type=int, dest="detect_lost_hold_frames",
                   help="连续丢 N 帧内沿用上一位置，0 = 一丢就报 LOST")
    g.add_argument("--smooth", type=float, dest="detect_smooth_alpha",
                   help="位置平滑系数 0~1，1 = 不平滑")
    g.add_argument("--max-jump", type=int, dest="detect_max_jump_px",
                   help="单帧最大跳变像素，0 = 不限")
    g.add_argument("--aspect-max", type=float, dest="detect_aspect_max",
                   help="候选长宽比上限，0 = 不限")
    g.add_argument("--fill-min", type=float, dest="detect_fill_min",
                   help="候选最小填充率 0~1，0 = 不限")
    g.add_argument("--nms-iou", type=float, dest="detect_nms_iou", help="相邻候选合并的 IoU 阈值")

    g = parser.add_argument_group("控制／Control")
    g.add_argument("--threshold", type=int, dest="control_threshold_px", help="中心判定阈值 px")
    g.add_argument("--pulse-mode", choices=["fixed", "proportional"], help="脉冲时长策略")
    g.add_argument("--pulse-ms", type=int, dest="control_pulse_ms", help="固定脉冲时长 ms")
    g.add_argument("--min-pulse-ms", type=int, dest="control_min_pulse_ms")
    g.add_argument("--max-pulse-ms", type=int, dest="control_max_pulse_ms")
    g.add_argument("--gain", type=float, dest="control_gain_ms_per_px")
    g.add_argument("--settle-ms", type=int, dest="control_settle_ms", help="松键后等待 ms")
    g.add_argument("--debug-blocking-settle", action="store_true",
                   dest="control_debug_blocking_settle", default=None,
                   help="【负对照，别在日常使用】把 settle 退回旧的阻塞 sleep 实现，"
                        "用来验证 test_real_screen.py 的尖峰检查真的能抓到问题")
    g.add_argument("--invert-axis", action="store_true", dest="control_invert_axis", default=None)
    g.add_argument("--center-offset", type=int, dest="control_center_offset")
    g.add_argument("--auto-start", action="store_true", dest="control_auto_start", default=None)
    g.add_argument("--backend", choices=["pyautogui", "sendinput", "null"], dest="control_backend",
                   help="输入后端：pyautogui / sendinput / null(只记录不发键)")

    g = parser.add_argument_group("输出／Output")
    g.add_argument("--log-file", dest="output_log_file", help="日志文件路径")
    g.add_argument("--log-format", choices=["block", "line"], dest="output_log_format",
                   help="block = 每帧多行块（项目需求里的格式）；line = 每帧一行")
    g.add_argument("--events", choices=["text", "json"],
                   dest="output_events", help="json = 每帧输出一行 JSON 给父进程")
    g.add_argument("--dump-dir", dest="output_dump_dir", help="标注帧输出目录")
    g.add_argument("--dump-every", type=int, dest="output_dump_every", help="每 N 帧存一张")
    g.add_argument("--dump-format", choices=["jpg", "png"], dest="output_dump_format",
                   help="标注帧格式，jpg 快很多")
    g.add_argument("--dump-queue", type=int, dest="output_dump_queue", help="后台落盘队列深度")
    g.add_argument("--no-window", action="store_false", dest="output_show_window", default=None,
                   help="不显示预览窗口")
    g.add_argument("--show-game-window", action="store_true", dest="output_show_game_window", default=None)
    g.add_argument("--no-timings", action="store_false", dest="output_show_timings", default=None,
                   help="HUD 上不显示逐阶段耗时")
    g.add_argument("--max-seconds", type=float, dest="output_max_seconds", help="跑多久自动停，0 = 不限")
    g.add_argument("--max-frames", type=int, dest="output_max_frames", help="跑多少帧自动停，0 = 不限")
    g.add_argument("--idle-frames", type=int, dest="output_idle_frames", help="没开始控制时空转多少帧退出，0 = 一直等")

    g = parser.add_argument_group("仿真／Sim")
    g.add_argument("--sim-width", type=int, dest="sim_width")
    g.add_argument("--sim-height", type=int, dest="sim_height")
    g.add_argument("--sim-fov", type=float, dest="sim_fov_deg")
    g.add_argument("--sim-turn-speed", type=float, dest="sim_turn_speed_dps", help="按住键每秒转多少度")
    g.add_argument("--sim-drift", type=float, dest="sim_drift_px_per_s", help="红点漂移速度，0 = 静止")
    g.add_argument("--sim-start-offset", type=int, dest="sim_start_offset_px", help="开局偏离中心多少像素")
    g.add_argument("--sim-noise", action="store_true", dest="sim_noise", default=None)
    g.add_argument("--sim-seed", type=int, dest="sim_seed")

    g = parser.add_argument_group("热键／Hotkey")
    g.add_argument("--hotkey-toggle", help="开始/暂停自动控制的热键")
    g.add_argument("--hotkey-quit", help="退出并释放按键的热键")

    return parser


def parse_vector(text: str, size: int, cast=int) -> tuple:
    parts = [p for p in str(text).replace("，", ",").split(",") if p.strip() != ""]
    if len(parts) != size:
        raise argparse.ArgumentTypeError(f"需要 {size} 个数字，收到 {len(parts)} 个：{text!r}")
    return tuple(cast(p.strip()) for p in parts)


def from_args(argv: Optional[list[str]] = None) -> Config:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    cfg = Config.load(args.config) if args.config else Config()

    # --fast：一键把「省时间」的几个开关都打开。
    # 实测 2560x1440 上从 ~52ms/帧 降到 ~15ms/帧，同一台机器能跑到 20+ FPS。
    if getattr(args, "fast", False):
        if args.capture_capture_roi is None:
            args.capture_capture_roi = True
        if args.detect_detect_max_side is None:
            args.detect_detect_max_side = 960
        if args.output_dump_format is None:
            args.output_dump_format = "jpg"

    # 先处理需要解析的向量／枚举，再统一灌进去
    if args.region:
        cfg.capture.region = parse_vector(args.region, 4)
    if args.detect_roi:
        cfg.detect.roi = parse_vector(args.detect_roi, 4)
    if args.hsv_lower:
        cfg.detect.hsv_lower = parse_vector(args.hsv_lower, 3)
        cfg.detect.preset = ""  # 手填值优先于预设，否则会被预设覆盖
    if args.hsv_upper:
        cfg.detect.hsv_upper = parse_vector(args.hsv_upper, 3)
        cfg.detect.preset = ""

    for prefix, group_obj in (
        ("capture", cfg.capture),
        ("detect", cfg.detect),
        ("control", cfg.control),
        ("output", cfg.output),
        ("sim", cfg.sim),
    ):
        _apply(group_obj, prefix, args)

    if args.hotkey_toggle:
        cfg.hotkey_toggle = args.hotkey_toggle
    if args.hotkey_quit:
        cfg.hotkey_quit = args.hotkey_quit
    if args.output_log_format:
        cfg.output.verbose_log = args.output_log_format == "block"

    return cfg


def resolve_path(path: str) -> Path:
    """相对路径一律相对项目目录，避免受 cwd 影响。"""
    p = Path(path)
    return p if p.is_absolute() else (PROJECT_DIR / p)


if __name__ == "__main__":
    # 小工具：打印当前默认配置，方便对照
    print(json.dumps(Config().to_dict(), ensure_ascii=False, indent=2))
