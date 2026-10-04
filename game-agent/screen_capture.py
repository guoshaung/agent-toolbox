"""
screen_capture.py —— 把「屏幕」变成一帧一帧的 numpy 数组。

核心状态 Frame 定义在这里。

三条采集路径：
  * 指定窗口标题  → 只截那个窗口的客户区，窗口移动/缩放会自动跟随
  * 指定 region   → 截固定的一块屏幕
  * 都不指定      → 截整个显示器（monitor 编号，1 = 主屏）

三种「少干活」的手段，都是实测出来的收益：
  * roi 参数：只截画面里的一小块（跟踪窗口）。2560x1440 全屏抓一次要 28ms，
    截 920x518 只要 7ms —— 这是整个循环里最大的一笔开销。
  * 坐标换算是 Frame 自带的：ROI 裁过之后，下游拿到的坐标仍然是「逻辑画面」
    坐标系，所以上层逻辑一行都不用改。
  * 抓屏失败会重试并重建 mss 句柄。游戏切全屏、改分辨率、进过场动画时
    mss.grab 会抛异常，以前这一下就直接把整个程序带崩了。

用 mss 抓屏：比 PIL.ImageGrab 快一个量级。
"""

from __future__ import annotations

import ctypes
import os
import sys
import time
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

if sys.platform.startswith("win"):
    import ctypes.wintypes  # noqa: F401  RECT / POINT 依赖它被 import 过

try:  # cv2 只用来做 BGRA→BGR 的颜色转换，没有也能跑（会退回 numpy 切片）
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from config import CaptureConfig

Rect = Tuple[int, int, int, int]  # (left, top, width, height)


class CaptureError(RuntimeError):
    """抓屏失败。上层应当跳过这一帧，而不是让整个循环崩掉。"""


@dataclass
class Frame:
    """一帧截图。所有下游模块都只认这个结构。

    坐标系约定（很重要，改之前先读这段）：

        base_region  —— 「逻辑画面」的屏幕矩形。通常就是游戏窗口的客户区，
                        或者整个显示器。上层所有关于「中心」「左右」的判断都
                        以它为准。
        region       —— 这一帧 image 真正覆盖的屏幕矩形。没做 ROI 裁剪时
                        与 base_region 相同。

    image 里的像素坐标是「图像坐标」；目标检测报出来的坐标一律换算成
    「base 局部坐标」（0 .. base_width），这样上层不用关心底层截了多少。
    """

    image: np.ndarray  # BGR，形状 (h, w, 3)
    index: int  # 从 0 开始的帧序号
    timestamp: float  # time.monotonic()，用来算 FPS
    region: Rect  # 这一帧 image 对应的屏幕区域 (left, top, w, h)
    source: str = "screen"
    # 逻辑画面的屏幕矩形。None = 和 region 相同（没裁剪）
    base_region: Optional[Rect] = None

    # ---------------------------------------------------------- 基本尺寸

    @property
    def height(self) -> int:
        """image 的像素高度（裁剪/缩放之后）。"""
        return int(self.image.shape[0])

    @property
    def width(self) -> int:
        """image 的像素宽度（裁剪/缩放之后）。"""
        return int(self.image.shape[1])

    @property
    def _base(self) -> Rect:
        return self.base_region if self.base_region else self.region

    @property
    def base(self) -> Rect:
        """逻辑画面的屏幕矩形（公开版，别处要读坐标基准时用它）。"""
        return self._base

    @property
    def base_width(self) -> int:
        return int(self._base[2])

    @property
    def base_height(self) -> int:
        return int(self._base[3])

    @property
    def center_x(self) -> int:
        """逻辑画面的横向中心（base 局部坐标）。"""
        return self.base_width // 2

    @property
    def center_y(self) -> int:
        return self.base_height // 2

    @property
    def is_cropped(self) -> bool:
        """这一帧是不是只截了逻辑画面的一部分（用了跟踪窗口）。"""
        base = self._base
        reg = self.region
        return reg[0] != base[0] or reg[1] != base[1] or reg[2] != base[2] or reg[3] != base[3]

    # ---------------------------------------------------------- 坐标换算

    @property
    def scale_x(self) -> float:
        """image 一个像素代表多少屏幕像素。1.0 = 没缩放。"""
        return self.region[2] / max(1, self.width)

    @property
    def scale_y(self) -> float:
        return self.region[3] / max(1, self.height)

    def image_to_base(self, x: float, y: float) -> Tuple[float, float]:
        """图像坐标 → base 局部坐标。检测器用它把结果换算回逻辑画面。"""
        base = self._base
        sx = self.region[0] + x * self.scale_x
        sy = self.region[1] + y * self.scale_y
        return sx - base[0], sy - base[1]

    def base_to_image(self, x: float, y: float) -> Tuple[float, float]:
        """base 局部坐标 → 图像坐标。可视化用它把标注画到正确位置。"""
        base = self._base
        sx = x + base[0]
        sy = y + base[1]
        inv_x = self.scale_x or 1.0
        inv_y = self.scale_y or 1.0
        return (sx - self.region[0]) / inv_x, (sy - self.region[1]) / inv_y

    # ---------------------------------------------------------- 小工具

    def to_gray(self) -> np.ndarray:
        if cv2 is None:
            raise RuntimeError("没有 cv2，无法灰度化")
        return cv2.cvtColor(self.image, cv2.COLOR_BGR2GRAY)

    def signature(self, step: int = 16) -> bytes:
        """极廉价的一帧指纹，用来发现「画面卡住不动了」。

        抽稀采样之后取字节，2560x1440 上大约 14KB，比哈希整帧便宜得多。
        """
        return self.image[::step, ::step].tobytes()


# ------------------------------------------------------------------ 窗口定位


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def _enumerate_windows(handler) -> None:
    """枚举顶层窗口，逐个交给 handler(hwnd, user32)。异常一律吞掉。

    handler 返回 False 表示不用再看后续窗口了。
    """
    user32 = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(
        ctypes.c_bool, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)
    )

    def _callback(hwnd, _lparam):
        try:
            return bool(handler(hwnd, user32))
        except Exception:
            return True  # 单个窗口出问题不该中断整轮枚举

    try:
        user32.EnumWindows(WNDENUMPROC(_callback), None)
    except Exception:
        pass


def window_rect(hwnd, user32, client_only: bool = True) -> Optional[Rect]:
    """读一个窗口的矩形。client_only=True 取客户区（不含标题栏边框）。"""
    if client_only:
        rect = ctypes.wintypes.RECT()
        if not user32.GetClientRect(hwnd, ctypes.byref(rect)):
            return None
        point = ctypes.wintypes.POINT(0, 0)
        if not user32.ClientToScreen(hwnd, ctypes.byref(point)):
            return None
        left, top = int(point.x), int(point.y)
    else:
        rect = ctypes.wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        left, top = int(rect.left), int(rect.top)

    width = int(rect.right - rect.left)
    height = int(rect.bottom - rect.top)
    if width <= 0 or height <= 0:
        return None
    return left, top, width, height


def window_title(hwnd, user32) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value or ""


def find_window_rect(title_substring: str) -> Optional[Rect]:
    """按标题子串找可见窗口的客户区矩形。找不到返回 None。

    只做「找窗口 + 读它的矩形」，不注入、不挂钩、不读窗口内容。
    """
    if not _is_windows() or not title_substring:
        return None

    needle = title_substring.lower()
    found: list[Rect] = []
    visible = ctypes.windll.user32

    def handler(hwnd, user32):
        if not user32.IsWindowVisible(hwnd):
            return True
        title = window_title(hwnd, user32)
        if not title or needle not in title.lower():
            return True
        if user32.IsIconic(hwnd):  # 最小化了，截出来是空的
            return True
        rect = window_rect(hwnd, user32)
        if rect is not None and rect[2] > 16 and rect[3] > 16:
            found.append(rect)
        return True

    _enumerate_windows(handler)
    if not found:
        return None
    # 多个同标题窗口时取面积最大的那个
    return max(found, key=lambda r: r[2] * r[3])


def visible_windows() -> list[tuple[object, str, Rect]]:
    """枚举「可见 + 有标题」的顶层窗口，返回 (hwnd, title, rect)。"""
    out: list[tuple[object, str, Rect]] = []

    def handler(hwnd, user32):
        if not user32.IsWindowVisible(hwnd):
            return True
        title = window_title(hwnd, user32).strip()
        if not title:
            return True
        rect = window_rect(hwnd, user32, client_only=False)
        if rect is not None:
            out.append((hwnd, title, rect))
        return True

    _enumerate_windows(handler)
    return out


def _window_process_name(user32, hwnd) -> str:
    """窗口属于哪个进程（只要文件名，例如 'Client-Win64-Shipping.exe'）。

    纯读信息：OpenProcess 用的是 PROCESS_QUERY_LIMITED_INFORMATION，只问"这是谁"，
    不读它的内存、不注入。拿不到就返回空串，不影响主流程。
    """
    try:
        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return ""
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid.value)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return ""
        try:
            size = ctypes.wintypes.DWORD(1024)
            buffer = ctypes.create_unicode_buffer(size.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                return os.path.basename(buffer.value or "")
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return ""


def list_visible_windows(limit: int = 80) -> list[dict]:
    """列出当前「可见 + 有标题 + 没最小化」的顶层窗口。

    存在的意义只有一个：让界面上的「选择游戏窗口」能下拉选，而不是让你手敲标题。
    读的东西仅限于窗口标题、窗口矩形、所属进程名 —— 不读窗口内容、不碰游戏内存。
    """
    if not _is_windows():
        return []

    found: list[dict] = []
    user32 = ctypes.windll.user32

    def handler(hwnd, _user32):
        if not user32.IsWindowVisible(hwnd):
            return True
        title = window_title(hwnd, user32).strip()
        if not title:
            return True
        rect = window_rect(hwnd, user32, client_only=False)
        if rect is None or rect[2] < 64 or rect[3] < 64:
            return True
        found.append({
            "title": title,
            "x": int(rect[0]),
            "y": int(rect[1]),
            "width": int(rect[2]),
            "height": int(rect[3]),
            "minimized": bool(user32.IsIconic(hwnd)),
            "process": _window_process_name(user32, hwnd),
        })
        return True

    _enumerate_windows(handler)
    # 面积大的排前面：游戏窗口通常又大又显眼，一眼就能找到
    found.sort(key=lambda w: w["width"] * w["height"], reverse=True)
    return found[:limit]


def foreground_window_title() -> str:
    """当前前台窗口标题。焦点守卫用。"""
    if not _is_windows():
        return ""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""
        return window_title(hwnd, user32)
    except Exception:
        return ""


def virtual_screen_rect() -> Optional[Rect]:
    """所有显示器拼起来的总区域。用来把截图区域夹回屏幕内。"""
    if not _is_windows():
        return None
    try:
        user32 = ctypes.windll.user32
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79
        left = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
        top = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
        width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
        height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
        if width <= 0 or height <= 0:
            return None
        return (int(left), int(top), int(width), int(height))
    except Exception:
        return None


def intersect_rect(inner: Rect, outer: Rect) -> Optional[Rect]:
    """求交集。完全不相交返回 None。"""
    left = max(inner[0], outer[0])
    top = max(inner[1], outer[1])
    right = min(inner[0] + inner[2], outer[0] + outer[2])
    bottom = min(inner[1] + inner[3], outer[1] + outer[3])
    if right - left <= 0 or bottom - top <= 0:
        return None
    return (int(left), int(top), int(right - left), int(bottom - top))


# ------------------------------------------------------------------ 采集器


class ScreenCapture:
    """实时截图。当作上下文管理器用，保证 mss 句柄被释放。"""

    def __init__(self, config: CaptureConfig) -> None:
        self.config = config
        self._sct = None
        self._index = 0
        self._last_region: Optional[Rect] = None
        self._last_base: Optional[Rect] = None
        self.window_miss_count = 0
        self.capture_failures = 0
        self.reopen_count = 0

    # ----- 生命周期 -----

    def open(self) -> "ScreenCapture":
        if self._sct is not None:
            return self
        try:
            import mss
        except ImportError as exc:  # 给出能照做的指令，而不是一句 ModuleNotFoundError
            raise RuntimeError(
                "缺少 mss。装一下：\n  uv pip install mss\n或者：\n  pip install mss"
            ) from exc
        # mss.mss 在新版本里被废弃了，优先用 MSS
        factory = getattr(mss, "MSS", None) or getattr(mss, "mss")
        self._sct = factory()
        return self

    def _reopen(self) -> None:
        """把 mss 句柄丢掉重建。分辨率变化 / 切换全屏之后句柄会失效。"""
        self.close()
        self.open()
        self.reopen_count += 1

    def close(self) -> None:
        if self._sct is not None:
            try:
                self._sct.close()
            except Exception:
                pass
            self._sct = None

    def __enter__(self) -> "ScreenCapture":
        return self.open()

    def __exit__(self, *_exc) -> None:
        self.close()

    # ----- 区域解析 -----

    def resolve_base_region(self) -> Rect:
        """决定「逻辑画面」是哪一块。优先级：窗口 > 显式 region > 整屏。

        窗口找不到时沿用上一帧的位置（窗口切后台会枚举不到），实在没有才报错。
        """
        cfg = self.config

        if cfg.window_title:
            rect = find_window_rect(cfg.window_title)
            if rect is not None:
                self.window_miss_count = 0
                self._last_base = rect
                return rect
            self.window_miss_count += 1
            if self._last_base is not None:
                return self._last_base
            raise CaptureError(
                f"找不到标题包含 {cfg.window_title!r} 的可见窗口。"
                "确认窗口没被最小化，标题拼写是否正确。"
            )

        if cfg.region:
            return tuple(int(v) for v in cfg.region)  # type: ignore[return-value]

        if self._sct is None:
            self.open()
        monitors = self._sct.monitors  # type: ignore[union-attr]
        index = int(cfg.monitor)
        if index < 0 or index >= len(monitors):
            index = 1 if len(monitors) > 1 else 0
        m = monitors[index]
        return (int(m["left"]), int(m["top"]), int(m["width"]), int(m["height"]))

    def _clamp(self, rect: Rect) -> Rect:
        """把区域夹回真实屏幕范围内，并保证至少 16x16。

        窗口拖到屏幕边缘外时，mss 会返回一块比要求小的乃至全黑的图，
        与其拿到垃圾数据，不如老老实实夹一下。
        """
        limit = virtual_screen_rect()
        if limit is not None:
            clipped = intersect_rect(rect, limit)
            if clipped is not None:
                rect = clipped
        left, top, width, height = rect
        return (int(left), int(top), max(16, int(width)), max(16, int(height)))

    # ----- 抓取 -----

    def _grab_raw(self, region: Rect) -> np.ndarray:
        """抓一块区域的原始 BGRA 像素。失败会重试，再失败抛 CaptureError。"""
        if self._sct is None:
            self.open()
        request = {
            "left": int(region[0]),
            "top": int(region[1]),
            "width": int(region[2]),
            "height": int(region[3]),
        }
        attempts = max(1, int(self.config.grab_retries))
        last_exc: Optional[BaseException] = None

        for attempt in range(attempts):
            try:
                shot = self._sct.grab(request)  # type: ignore[union-attr]
                raw = np.asarray(shot, dtype=np.uint8)
                if raw.ndim == 3 and raw.size:
                    return raw
                last_exc = CaptureError("mss 返回了空画面")
            except Exception as exc:  # mss 的异常类型各版本不一致，全接住
                last_exc = exc
                # 大概率是句柄失效（切全屏/改分辨率），重建一次再试
                try:
                    self._reopen()
                except Exception:
                    pass
            if attempt + 1 < attempts:
                time.sleep(0.012 * (attempt + 1))

        self.capture_failures += 1
        raise CaptureError(f"截图失败（已重试 {attempts} 次）：{last_exc}")

    def grab(self, roi: Optional[Rect] = None) -> Frame:
        """截一帧。

        roi 是「base 局部坐标」下的子区域。给了就只截这一小块（跟踪窗口），
        但返回的 Frame 仍然记着完整的 base_region，所以下游坐标不受影响。
        """
        if self._sct is None:
            self.open()  # resolve_base_region 要用到 monitors，必须先起来
        base = self._clamp(self.resolve_base_region())

        region = base
        if roi is not None:
            rx, ry, rw, rh = (int(v) for v in roi)
            if rw >= 16 and rh >= 16:
                region = self._clamp((base[0] + rx, base[1] + ry, rw, rh))

        raw = self._grab_raw(region)

        # mss 返回 BGRA，去掉 alpha 就是 BGR。
        # cv2 的转换比 numpy 切片快一个数量级（实测 1.3ms vs 12ms @1440p）
        if cv2 is not None and raw.shape[2] == 4:
            image = cv2.cvtColor(raw, cv2.COLOR_BGRA2BGR)
        elif raw.shape[2] == 4:
            image = np.ascontiguousarray(raw[:, :, :3])
        else:
            image = raw
        image = np.ascontiguousarray(image)

        self._last_region = region
        frame = Frame(
            image=image,
            index=self._index,
            timestamp=time.monotonic(),
            region=region,
            source="screen",
            base_region=base,
        )
        self._index += 1
        return frame

    def describe(self) -> str:
        cfg = self.config
        bits = [f"monitor={cfg.monitor}"]
        if cfg.window_title:
            bits.insert(0, f"window={cfg.window_title!r}")
        if cfg.region:
            bits.insert(0, f"region={cfg.region}")
        if self._last_base:
            bits.append(f"base={self._last_base[2]}x{self._last_base[3]}")
        if self.window_miss_count:
            bits.append(f"miss={self.window_miss_count}")
        if self.capture_failures:
            bits.append(f"failed={self.capture_failures}")
        return "screen " + " ".join(bits)


@dataclass
class FrameClock:
    """节流器：让整个循环（截图 + 判断 + 按键 + 等待）不超过目标周期。

    注意是在循环末尾「补差」而不是每步各睡一次 —— 否则按键的 100ms 和截图的
    125ms 会叠加，实际帧率直接掉一半。
    """

    target_fps: float = 8.0

    def remaining(self, loop_started: float) -> float:
        interval = 1.0 / max(1.0, float(self.target_fps))
        return interval - (time.monotonic() - loop_started)


if __name__ == "__main__":
    # 自检：截一帧存下来，确认 mss 和区域解析都正常
    cfg = CaptureConfig()
    t0 = time.monotonic()
    with ScreenCapture(cfg) as cap:
        frame = cap.grab()
        base = cap.resolve_base_region()
    dt = time.monotonic() - t0
    print(f"base={base} image={frame.width}x{frame.height} 首次耗时={dt * 1000:.0f}ms")

    if frame.width:
        # 再来几次，看看稳定后的抓屏耗时
        times = []
        with ScreenCapture(cfg) as cap:
            for _ in range(8):
                t = time.monotonic()
                cap.grab()
                times.append((time.monotonic() - t) * 1000)
        print(f"稳定后抓屏：{min(times):.1f}~{max(times):.1f}ms")
