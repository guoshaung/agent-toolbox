"""
sim_game.py —— 无头「虚拟游戏」，用来在没有任何外部窗口的情况下验证闭环。

为什么需要它：
  真机调试时你分不清「检测错了」还是「控制错了」。这里把两个变量钉死：
    * 画面的 ground truth 由我们自己算，所以可以拿 detected_x 和 true_x 逐帧对比，
      检测环节正确与否一目了然。
    * 相机偏航角由 agent 发出的按键脉冲驱动，方向语义和真实游戏一致
      （向右转 → 世界里的固定目标在画面上向左移动），所以控制回路是真闭环。

时间用的是虚拟时钟：不 sleep，跑 1000 帧只要几百毫秒，而且完全可复现（seed 固定）。
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from config import ControlConfig, SimConfig
from screen_capture import Frame

A_KEY = "a"
D_KEY = "d"


@dataclass
class SimTruth:
    """这一帧的 ground truth，用来验证检测器。"""

    true_offset_px: float  # 目标真实偏离中心多少像素
    yaw_deg: float
    dot_world_deg: float


@dataclass
class SimulatedGame:
    """一个只会「转身」和「目标自己乱走」的假游戏。"""

    sim: SimConfig = field(default_factory=SimConfig)
    control: ControlConfig = field(default_factory=ControlConfig)
    # 每帧推进多少虚拟时间。由 main 按 --fps 传进来，好让仿真和真机的时间尺度一致
    frame_interval: float = 0.125

    def __post_init__(self) -> None:
        self._rng = random.Random(self.sim.seed)
        self.t = 0.0  # 虚拟时钟（秒）
        self.yaw_deg = 0.0
        self._dot_vel_deg = 0.0
        self._next_vel_change = 0.0
        # 开局把目标放在世界坐标的右边，制造一个明确的初始误差
        self.dot_world_deg = self._px_to_deg(self.sim.start_offset_px)
        self.frames = 0
        self._grabbed = 0

    # ---------------------------------------------------------- 换算

    @property
    def deg_per_px(self) -> float:
        return self.sim.fov_deg / max(1, self.sim.width)

    def _px_to_deg(self, px: float) -> float:
        return px * self.deg_per_px

    def _deg_to_px(self, deg: float) -> float:
        return deg / self.deg_per_px

    # ---------------------------------------------------------- 外部驱动

    def apply_pulse(self, key: str, duration_ms: int) -> None:
        """agent 按了一次键。虚拟世界按真实时间语义推进。"""
        seconds = max(0.0, duration_ms / 1000.0)
        self.t += seconds
        delta = self.sim.turn_speed_dps * seconds
        if key == D_KEY:
            # 向右转：世界方位不变，但相机朝向 +yaw ⇒ 目标在画面上往左走
            self.yaw_deg += delta
        elif key == A_KEY:
            self.yaw_deg -= delta
        self._advance_drift(seconds)

    def advance(self, seconds: float) -> None:
        """没有按键时，只是时间流逝（目标自己在动）。"""
        self.t += max(0.0, seconds)
        self._advance_drift(max(0.0, seconds))

    def _advance_drift(self, seconds: float) -> None:
        if seconds <= 0:
            return
        if self.t >= self._next_vel_change:
            self._next_vel_change = self.t + self.sim.drift_change_s
            speed = self._px_to_deg(self.sim.drift_px_per_s)
            self._dot_vel_deg = self._rng.uniform(-speed, speed)
        self.dot_world_deg += self._dot_vel_deg * seconds
        # 随机游走不加约束迟早走到画面外，测试就失去意义了 —— 到边界就反弹
        limit = self._px_to_deg(self.sim.width * 0.45)
        if abs(self.dot_world_deg) > limit:
            self.dot_world_deg = limit if self.dot_world_deg > 0 else -limit
            self._dot_vel_deg *= -0.8

    # ---------------------------------------------------------- 真值

    @property
    def screen_x_true(self) -> float:
        """当前这一帧目标应该出现在哪个像素上。"""
        relative = self.dot_world_deg - self.yaw_deg
        # 超出视场角就是跑到画面外了 —— 画外和「检测丢了」是两回事，这里如实返回
        return self.sim.width / 2.0 + self._deg_to_px(relative)

    @property
    def in_view(self) -> bool:
        x = self.screen_x_true
        return 0 <= x < self.sim.width

    def truth(self) -> SimTruth:
        return SimTruth(
            true_offset_px=self.screen_x_true - self.sim.width / 2.0,
            yaw_deg=self.yaw_deg,
            dot_world_deg=self.dot_world_deg,
        )

    # ---------------------------------------------------------- 渲染

    def render(self) -> np.ndarray:
        w, h = self.sim.width, self.sim.height
        img = np.zeros((h, w, 3), dtype=np.uint8)
        img[:] = self.sim.background_bgr

        # 一点淡淡的网格，看起来像个游戏而不是纯黑框
        grid_color = tuple(int(c + 16) for c in self.sim.background_bgr)
        for x in range(0, w, 80):
            cv2.line(img, (x, 0), (x, h), grid_color, 1)
        for y in range(0, h, 80):
            cv2.line(img, (0, y), (w, y), grid_color, 1)

        # 中心准星（白色，不会命中红色检测）
        cx, cy = w // 2, h // 2
        cv2.line(img, (cx - 14, cy), (cx + 14, cy), (90, 90, 95), 1, cv2.LINE_AA)
        cv2.line(img, (cx, cy - 14), (cx, cy + 14), (90, 90, 95), 1, cv2.LINE_AA)

        # 目标：实心红点
        tx = int(round(self.screen_x_true))
        if -self.sim.dot_radius <= tx <= w + self.sim.dot_radius:
            cv2.circle(img, (tx, cy), self.sim.dot_radius, self.sim.dot_color_bgr, -1, cv2.LINE_AA)
            # 外圈让它更像游戏里的 marker，同时不影响 HSV 红色判定
            cv2.circle(img, (tx, cy), self.sim.dot_radius + 3, (40, 40, 200), 1, cv2.LINE_AA)

        if self.sim.noise:
            noise = self._rng_state_noise(img.shape)
            img = cv2.addWeighted(img, 1.0, noise, 0.06, 0)

        cv2.putText(img, "SIMULATED GAME", (16, h - 18), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, (120, 120, 130), 1, cv2.LINE_AA)
        return img

    def _rng_state_noise(self, shape) -> np.ndarray:
        return np.random.default_rng(self._grabbed).integers(0, 255, shape, dtype=np.uint8)

    def grab(self) -> Frame:
        """和 ScreenCapture.grab() 同签名，main 里可以无差别调用。"""
        self.advance(self.frame_interval)
        image = self.render()
        self._grabbed += 1
        frame = Frame(
            image=image,
            index=self.frames,
            timestamp=self.t,
            region=(0, 0, self.sim.width, self.sim.height),
            source="sim",
        )
        self.frames += 1
        return frame

    # ---------------------------------------------------------- 收尾

    def close(self) -> None:
        pass

    def describe(self) -> str:
        return (
            f"sim {self.sim.width}x{self.sim.height} fov={self.sim.fov_deg:.0f}deg "
            f"turn={self.sim.turn_speed_dps:.0f}deg/s drift={self.sim.drift_px_per_s:.0f}px/s"
        )
