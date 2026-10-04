"""
controller.py —— 把「左右判断」变成真实的键盘输入。

核心状态 Decision 和 Action 定义在这里。

分层：
    decide()          纯函数：error + threshold → Decision。没有任何副作用，好测。
    plan_action()     纯函数：Decision → Action（key + 时长）。脉冲时长策略在这里。
    InputController   抽象基类：press / release / release_all。
       ├── NullController        只记录不发键，用来 dry-run 和仿真
       ├── PyAutoGUIController   默认实现，跨平台，够简单
       └── SendInputController   Windows SendInput，走扫描码，对 DirectInput 游戏兼容更好

安全设计（这一版最要紧的部分）：
    * 每个 controller 自己记着「当前按下的键」，release_all() 是幂等的。
    * pulse() 用 try/finally 包住，哪怕中途抛异常也一定松键。
    * 启动时先 release_all() 一次，清掉上一次崩溃可能残留的按下状态。
    * FocusGuard：前台窗口标题对不上时默认不发键，避免把 A/D 打进浏览器/聊天框。
"""

from __future__ import annotations

import ctypes
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, Optional

from config import ControlConfig
from screen_capture import foreground_window_title

LEFT = "LEFT"
RIGHT = "RIGHT"
CENTERED = "CENTERED"
LOST = "LOST"  # 这一帧没找到目标：不按键，但也不算「已经居中」

A_KEY = "a"
D_KEY = "d"


# ---------------------------------------------------------------- 核心状态


@dataclass
class Decision:
    """这一帧的判断结果。"""

    direction: str
    error: int  # target_x - center_x，正数 = 目标偏右
    threshold: int
    target_x: Optional[int] = None
    center_x: Optional[int] = None
    reason: str = ""

    @property
    def is_centered(self) -> bool:
        return self.direction == CENTERED

    def __str__(self) -> str:
        return f"{self.direction}(error={self.error:+d})"


@dataclass
class Action:
    """这一帧真正做了什么。"""

    key: Optional[str] = None
    duration_ms: int = 0
    sent: bool = False
    skipped_reason: str = ""
    started_at: float = 0.0

    @property
    def label(self) -> str:
        """给屏幕左上角那几行用，例如 'D 100ms' / '— 松开 A/D'。

        注意保持 ASCII：不同版本的 OpenCV 对 cv2.putText 的中文支持不一致，
        HUD 上出现问号比出现乱码更让人放心这是一套可控的链路。
        """
        if not self.key:
            return "- released"
        if not self.sent:
            return f"{self.key.upper()} (blocked)"
        return f"{self.key.upper()} {self.duration_ms}ms"


# ---------------------------------------------------------------- 纯逻辑


def decide(
    target_x: Optional[int],
    center_x: int,
    threshold: int,
    invert_axis: bool = False,
) -> Decision:
    """error = target_x - screen_center_x，然后三段式判断。

    invert_axis 只影响按键映射（见 select_key），不影响这里报告的 error —— 
    这样屏幕上显示的方向永远是「目标在左边还是右边」，跟人的直觉一致。
    """
    if target_x is None:
        return Decision(direction=LOST, error=0, threshold=threshold, center_x=center_x,
                        reason="本帧未检测到目标")

    error = int(target_x) - int(center_x)
    if error < -threshold:
        direction = LEFT
    elif error > threshold:
        direction = RIGHT
    else:
        direction = CENTERED

    return Decision(
        direction=direction,
        error=error,
        threshold=int(threshold),
        target_x=int(target_x),
        center_x=int(center_x),
    )


def select_key(direction: str, invert_axis: bool = False) -> Optional[str]:
    """方向 → 键位。"""
    if direction == LEFT:
        return D_KEY if invert_axis else A_KEY
    if direction == RIGHT:
        return A_KEY if invert_axis else D_KEY
    return None


def plan_action(
    decision: Decision,
    config: ControlConfig,
    invert_axis: bool = False,
) -> Action:
    """决定这一帧按不按、按多久。不做任何实际输入。"""
    key = select_key(decision.direction, invert_axis)
    if key is None:
        return Action(key=None, duration_ms=0, sent=False)

    if config.pulse_mode == "proportional":
        duration = abs(decision.error) * float(config.gain_ms_per_px)
        duration = max(float(config.min_pulse_ms), min(float(config.max_pulse_ms), duration))
    else:
        duration = float(config.pulse_ms)

    return Action(key=key, duration_ms=int(round(duration)), sent=False)


# ---------------------------------------------------------------- 焦点守卫


@dataclass
class FocusGuard:
    """确认前台窗口是不是我们想控制的那一个。

    mode='off'   不检查
    mode='warn'  不匹配也照发，只打印
    mode='block' 不匹配就不发（默认）—— 宁可不动，也不要往别的窗口里乱敲
    """

    title: str = ""
    mode: str = "block"

    @property
    def active(self) -> bool:
        return bool(self.title) and self.mode != "off"

    def check(self) -> tuple[bool, str]:
        if not self.active:
            return True, ""
        current = foreground_window_title()
        if not current:
            return (self.mode != "block"), ""  # 拿不到标题时按模式决定放不放行
        ok = self.title.strip().lower() in current.lower()
        return (ok or self.mode != "block"), current


# ---------------------------------------------------------------- 输入后端


class InputController(ABC):
    """所有输入后端的统一接口。换后端只改这个类，主循环一行都不用动。"""

    name = "abstract"

    def __init__(self) -> None:
        self._down: set[str] = set()

    # ----- 子类要实现的两件事 -----

    @abstractmethod
    def _send_down(self, key: str) -> None: ...

    @abstractmethod
    def _send_up(self, key: str) -> None: ...

    # ----- 公共逻辑：记账，避免重复按下、保证能松开 -----

    def press(self, key: str) -> None:
        if key in self._down:
            return
        try:
            self._send_down(key)
        finally:
            self._down.add(key)

    def release(self, key: str) -> None:
        if key not in self._down:
            return
        try:
            self._send_up(key)
        finally:
            self._down.discard(key)

    def release_all(self) -> None:
        """幂等。异常退出的所有路径都要走到这里。"""
        for key in sorted(self._down, key=lambda k: (k != A_KEY, k != D_KEY, k)):
            try:
                self._send_up(key)
            except Exception:
                pass
            finally:
                self._down.discard(key)

    # ----- 脉冲 -----

    def pulse(
        self,
        key: str,
        duration_ms: int,
        abort: Optional[Callable[[], bool]] = None,
        tick_ms: int = 10,
    ) -> bool:
        """按下 → 等 duration_ms → 松开。

        分片 sleep 而不是一次 time.sleep(duration)：这样 ESC 能立刻打断，
        而不用等这 150ms 走完。整个循环用 try/finally 包住，任何异常都松键。
        """
        self.press(key)
        try:
            remaining = max(0.0, duration_ms / 1000.0)
            while remaining > 0:
                if abort is not None and abort():
                    return False
                chunk = min(remaining, tick_ms / 1000.0)
                time.sleep(chunk)
                remaining -= chunk
            return True
        finally:
            self.release(key)

    @property
    def pressed(self) -> tuple[str, ...]:
        return tuple(sorted(self._down))

    def close(self) -> None:
        self.release_all()


class NullController(InputController):
    """不发任何真实按键，只记录。用于 --no-window / 仿真 / CI 验证。"""

    name = "null(dry-run)"

    def __init__(self, on_pulse: Optional[Callable[[str, int], None]] = None) -> None:
        super().__init__()
        self.on_pulse = on_pulse
        self.log: list[tuple[str, int]] = []

    def _send_down(self, key: str) -> None:
        self.log.append((key, -1))

    def _send_up(self, key: str) -> None:
        pass

    def pulse(self, key, duration_ms, abort=None, tick_ms=10) -> bool:  # type: ignore[override]
        """仿真里不能真的 sleep，那就只把「按了多久」告诉虚拟游戏，让它自己推演。"""
        self.press(key)
        self.log.append((key, int(duration_ms)))
        if self.on_pulse is not None:
            self.on_pulse(key, int(duration_ms))
        self.release(key)
        if abort is not None and abort():
            return False
        return True


class PyAutoGUIController(InputController):
    """默认实现。cross-platform，代码最短。"""

    name = "pyautogui"

    def __init__(self) -> None:
        super().__init__()
        try:
            import pyautogui  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "缺少 pyautogui。装一下：\n  uv pip install pyautogui\n或者：\n  pip install pyautogui"
            ) from exc
        import pyautogui as _pag

        self._pag = _pag
        # 这是整个脚本里最危险的一行如果不管它：pyautogui 的默认故障保护是
        # 「鼠标甩到屏幕角落就抛异常」，我们只发键盘，留着它没坏处，所以不动。
        self._pag.FAILSAFE = True

    def _send_down(self, key: str) -> None:
        self._pag.keyDown(key)

    def _send_up(self, key: str) -> None:
        self._pag.keyUp(key)


class SendInputController(InputController):  # pragma: no cover - 依赖 Windows
    """Windows SendInput，按扫描码发键。

    什么时候需要它：部分游戏走 DirectInput / Raw Input，只认扫描码不认 VK，
    pyautogui 发过去的键它们收不到。这不是驱动级注入，也不是反作弊绕过，
    就是 Windows 自带的标准输入 API —— 和输入法、宏键盘用的是同一个入口。
    """

    name = "win-sendinput"

    KEYEVENTF_SCANCODE = 0x0008
    KEYEVENTF_KEYUP = 0x0002
    INPUT_KEYBOARD = 1
    MAPVK_VK_TO_VSC = 0

    VK = {A_KEY: 0x41, D_KEY: 0x44}

    def __init__(self) -> None:
        super().__init__()
        if not sys.platform.startswith("win"):
            raise RuntimeError("SendInputController 只能在 Windows 上用")

        ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", ctypes.c_ushort),
                ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong),
                ("dwExtraInfo", ULONG_PTR),
            ]

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [
                ("dx", ctypes.c_long), ("dy", ctypes.c_long),
                ("mouseData", ctypes.c_ulong), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ULONG_PTR),
            ]

        class HARDWAREINPUT(ctypes.Structure):
            _fields_ = [
                ("uMsg", ctypes.c_ulong), ("wParamL", ctypes.c_ushort),
                ("wParamH", ctypes.c_ushort),
            ]

        class _UNION(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", ctypes.c_ulong), ("union", _UNION)]

        self._KEYBDINPUT = KEYBDINPUT
        self._UNION = _UNION
        self._INPUT = INPUT
        self._user32 = ctypes.windll.user32

    def _scan(self, key: str) -> int:
        vk = self.VK[key]
        return int(self._user32.MapVirtualKeyW(vk, self.MAPVK_VK_TO_VSC))

    def _emit(self, key: str, keyup: bool) -> None:
        scan = self._scan(key)
        flags = self.KEYEVENTF_SCANCODE | (self.KEYEVENTF_KEYUP if keyup else 0)
        inp = self._INPUT(
            type=self.INPUT_KEYBOARD,
            union=self._UNION(
                ki=self._KEYBDINPUT(wVk=0, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)
            ),
        )
        if ctypes.sizeof(inp) not in (40, 28):  # 64 位是 40，32 位是 28
            raise RuntimeError(f"INPUT 结构大小异常({ctypes.sizeof(inp)})，SendInput 不可靠，请改用 pyautogui")
        self._user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

    def _send_down(self, key: str) -> None:
        self._emit(key, keyup=False)

    def _send_up(self, key: str) -> None:
        self._emit(key, keyup=True)


BACKENDS: dict[str, type[InputController]] = {
    "pyautogui": PyAutoGUIController,
    "sendinput": SendInputController,
    "null": NullController,
}


def create_controller(backend: str, **kwargs) -> InputController:
    """按名字造一个后端。造不出来时退回 null 并给出原因，而不是直接崩。"""
    name = (backend or "pyautogui").strip().lower()
    if name == "auto":
        name = "sendinput" if sys.platform.startswith("win") else "pyautogui"
    if name not in BACKENDS:
        raise ValueError(f"未知输入后端 {backend!r}，可选：{', '.join(BACKENDS)}")
    if name == "null":
        return NullController(**kwargs)
    return BACKENDS[name]()
