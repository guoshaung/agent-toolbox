"""
test_target_window.py —— 一个真实的、独立的目标窗口，用来在没有游戏的情况下排练真机闭环。

它同时扮演两个角色：
  1. 「游戏」：黑底 + 一个会随机漂移的红色圆点。
  2. 「相机」：轮询 A/D 的按下状态，把视角左右转，所以红点在画面上的移动方向和真游戏一致
     （按 D 向右转 ⇒ 红点向左走 ⇒ 朝中心靠）。

于是 agent 走的是**完全真实的链路**：mss 真的在截屏、pyautogui 真的在敲键盘、
A/D 真的被别的进程读到。这是「上真机」之前最后一道彩排。

用它配合 agent：
    窗口 A: python test_target_window.py
    窗口 B: python main.py --source screen --window-title AgentToolboxTestTarget \
                          --focus-title AgentToolboxTestTarget --preset red

用 tkinter 而不是 cv2 开窗，是因为我们要一个能被正常聚焦、能精确控制位置和置顶的真窗口。
"""

from __future__ import annotations

import argparse
import ctypes
import random
import sys
import tkinter as tk
from dataclasses import dataclass
from typing import Optional

WINDOW_TITLE = "AgentToolboxTestTarget"  # 纯 ASCII：既好匹配窗口标题，也避免编码问题

VK_A = 0x41
VK_D = 0x44


@dataclass
class TestTargetState:
    """虚拟世界状态。红点在世界里漂，相机角度被 A/D 改。"""

    width: int = 960
    height: int = 540
    fov_deg: float = 90.0
    turn_speed_dps: float = 60.0
    drift_px_per_s: float = 220.0
    drift_change_s: float = 1.1
    radius: int = 14
    seed: int = 7
    start_offset_px: int = 260

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)
        self.yaw_deg = 0.0
        self.dot_world_deg = self.start_offset_px * self.fov_deg / self.width
        self._vel_deg = 0.0
        self._next_change = 0.0
        self.elapsed = 0.0

    @property
    def deg_per_px(self) -> float:
        return self.fov_deg / self.width

    @property
    def dot_x(self) -> float:
        return self.width / 2.0 + (self.dot_world_deg - self.yaw_deg) / self.deg_per_px

    def step(self, dt: float, a_down: bool, d_down: bool) -> None:
        if dt <= 0:
            return
        self.elapsed += dt

        if d_down and not a_down:
            self.yaw_deg += self.turn_speed_dps * dt
        elif a_down and not d_down:
            self.yaw_deg -= self.turn_speed_dps * dt

        if self.elapsed >= self._next_change:
            self._next_change = self.elapsed + self.drift_change_s
            speed = self.drift_px_per_s * self.deg_per_px
            self._vel_deg = self._rng.uniform(-speed, speed)
        self.dot_world_deg += self._vel_deg * dt
        # 随机游走不加约束迟早走到画面外（我第一次测试就栽在这），到边界就反弹
        limit = self.width * 0.45 * self.deg_per_px
        if abs(self.dot_world_deg) > limit:
            self.dot_world_deg = limit if self.dot_world_deg > 0 else -limit
            self._vel_deg *= -0.8


class TestTargetWindow:
    def __init__(self, state: TestTargetState, topmost: bool, no_keys: bool,
                 foreground: bool = True) -> None:
        self.state = state
        self.no_keys = no_keys
        self.want_foreground = foreground
        self.root = tk.Tk()
        self.root.title(WINDOW_TITLE)
        self.root.geometry(f"{state.width}x{state.height}+80+80")
        self.root.configure(bg="black")
        self.root.resizable(False, False)
        if topmost:
            self.root.attributes("-topmost", True)

        self.canvas = tk.Canvas(
            self.root, width=state.width, height=state.height,
            bg="black", highlightthickness=0,
        )
        self.canvas.pack()

        cx, cy = state.width // 2, state.height // 2
        self.canvas.create_line(cx - 14, cy, cx + 14, cy, fill="#3a3a3a")
        self.canvas.create_line(cx, cy - 14, cx, cy + 14, fill="#3a3a3a")
        self.canvas.create_text(
            12, state.height - 14, anchor="w", fill="#555555",
            font=("Consolas", 9),
            text=f"{WINDOW_TITLE}  |  A/D turns the view  |  dot drifts randomly",
        )

        # 外圈 + 实心红点。外圈颜色偏暗红，不会干扰 HSV 红色检测
        self.ring = self.canvas.create_oval(0, 0, 0, 0, outline="#8a1a1a", width=2)
        self.dot = self.canvas.create_oval(0, 0, 0, 0, fill="#ff0000", outline="")
        # 先画一次再进主循环，别让窗口开出来之后有一瞬间什么都看不到
        self._redraw()

        self.user32 = ctypes.windll.user32 if sys.platform.startswith("win") else None
        self._pressed: set[int] = set()
        self._last_tick = self._now()
        self._last_print = 0.0

    # ---------------- 键盘 ----------------

    def _now(self) -> float:
        import time

        return time.monotonic()

    def _key_down(self, vk: int) -> bool:
        if self.no_keys or self.user32 is None:
            return False
        return bool(self.user32.GetAsyncKeyState(vk) & 0x8000)

    # ---------------- 主循环 ----------------

    def tick(self) -> None:
        now = self._now()
        dt = min(0.25, now - self._last_tick)  # 卡顿时别让世界瞬移
        self._last_tick = now

        a_down = self._key_down(VK_A)
        d_down = self._key_down(VK_D)
        for vk, pressed in ((VK_A, a_down), (VK_D, d_down)):
            if pressed and vk not in self._pressed:
                self._pressed.add(vk)
                print(f"[target] {'A' if vk == VK_A else 'D'} down")
            elif not pressed and vk in self._pressed:
                self._pressed.discard(vk)
                print(f"[target] {'A' if vk == VK_A else 'D'} up")

        self.state.step(dt, a_down, d_down)
        self._redraw()

        if now - self._last_print > 2.0:
            self._last_print = now
            x = self.state.dot_x
            print(f"[target] dot_x={x:7.1f} offset={x - self.state.width / 2:+7.1f} "
                  f"yaw={self.state.yaw_deg:+6.1f}")

        self.root.after(16, self.tick)

    def _redraw(self) -> None:
        x = self.state.dot_x
        y = self.state.height / 2
        r = self.state.radius
        self.canvas.coords(self.dot, x - r, y - r, x + r, y + r)
        self.canvas.coords(self.ring, x - r - 3, y - r - 3, x + r + 3, y + r + 3)

    # ---------------- 焦点 ----------------

    def _grab_foreground(self) -> None:
        """把自己弄到前台。

        为什么需要：agent 用 --focus-mode block + --focus-title 做保险丝，只有前台窗口
        标题匹配才发按键。如果测试窗口不是前台，按键就全被守门拦掉，闭环看起来像「不工作」。
        自动化环境里窗口刚开出来时焦点往往还在启动它的那个终端上，所以要主动抢一次。

        SetForegroundWindow 有前台锁定规则，直接调用经常被系统拒绝，所以老办法是
        AttachThreadInput 到当前前台线程再抢 —— 这里照做。
        """
        if self.user32 is None or not self.want_foreground:
            return
        try:
            hwnd = self.root.winfo_id()
            self.user32.ShowWindow(hwnd, 9)          # SW_RESTORE
            self.user32.BringWindowToTop(hwnd)
            kernel32 = ctypes.windll.kernel32
            fg = self.user32.GetForegroundWindow()
            if fg != hwnd:
                tid_self = kernel32.GetCurrentThreadId()
                tid_fg = self.user32.GetWindowThreadProcessId(fg, None)
                if tid_fg and tid_fg != tid_self:
                    self.user32.AttachThreadInput(tid_fg, tid_self, True)
                    self.user32.SetForegroundWindow(hwnd)
                    self.user32.AttachThreadInput(tid_fg, tid_self, False)
                else:
                    self.user32.SetForegroundWindow(hwnd)
            print(f"[target] 前台窗口 = {_foreground_title_inline()}")
        except Exception as exc:  # 抢不到焦点不该让窗口起不来
            print(f"[target] 抢焦点失败（不影响红点漂移）：{exc}")

    def run(self) -> None:
        self.root.bind("<Escape>", lambda _e: self.root.destroy())
        self._last_tick = self._now()
        print(f"[target] 窗口已打开：{WINDOW_TITLE}  {self.state.width}x{self.state.height}")
        print("[target] 现在可以跑 agent：")
        print(f"[target]   python main.py --source screen --window-title {WINDOW_TITLE} "
              f"--focus-title {WINDOW_TITLE} --preset red")
        # 让窗口先真正映射到屏幕上，再抢焦点（太早抢会被系统忽略）
        self.root.update_idletasks()
        self.root.after(120, self._grab_foreground)
        self.root.after(600, self._grab_foreground)  # 再补一次，防第一次被拒
        self.root.after(16, self.tick)
        self.root.mainloop()


def _foreground_title_inline() -> str:
    """不 import screen_capture（避免耦合），就地拿一次前台窗口标题。"""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value or "(无标题)"
    except Exception:
        return "(未知)"


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="生成一个黑底 + 随机移动红点的测试窗口")
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--drift", type=float, default=220.0, help="红点漂移速度 px/s，0 = 静止")
    parser.add_argument("--turn-speed", type=float, default=60.0, help="按住 A/D 每秒转多少度")
    parser.add_argument("--start-offset", type=int, default=260, help="开局偏离中心多少像素")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--no-topmost", action="store_true", help="不置顶")
    parser.add_argument("--no-keys", action="store_true", help="不响应 A/D（只让红点自己漂）")
    parser.add_argument("--no-foreground", action="store_true", help="不主动抢前台焦点")
    args = parser.parse_args(argv)

    state = TestTargetState(
        width=args.width,
        height=args.height,
        drift_px_per_s=args.drift,
        turn_speed_dps=args.turn_speed,
        start_offset_px=args.start_offset,
        seed=args.seed,
    )
    TestTargetWindow(
        state,
        topmost=not args.no_topmost,
        no_keys=args.no_keys,
        foreground=not args.no_foreground,
    ).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
