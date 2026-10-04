"""
visualizer.py —— 把每一帧的「它看到了什么 / 它决定了什么」画出来。

这是整个 PoC 的眼睛。没有这个窗口，你没法判断到底是检测错了还是控制错了。

注意一个硬约束：cv2.putText 画不了中文（会变成一串问号），
所以屏幕上所有文字都用英文，中文只出现在日志和 README 里。

画的东西：
  * 屏幕中心竖线 + 阈值带（|error| 落在这条带子里就算 CENTERED）
  * 目标的外接框、中心点、十字准星
  * 从中心指向目标的箭头
  * 左上角 HUD：FPS / Target X / Center X / Error / Decision / Action
  * 左下角误差历史曲线（一眼看出有没有在收敛）
  * 顶部状态条：AUTO-RUNNING / PAUSED / TARGET LOST
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Sequence

import cv2
import numpy as np

from config import Config
from controller import CENTERED, LEFT, LOST, RIGHT, Action, Decision
from screen_capture import Frame
from target_detector import Target

# ---- 配色（BGR！不是 RGB）----
WHITE = (255, 255, 255)
DIM = (150, 155, 168)
CYAN = (255, 255, 0)
YELLOW = (0, 235, 255)
ORANGE = (0, 165, 255)
GREEN = (80, 235, 80)
RED = (70, 70, 255)
PANEL_BG = (22, 22, 28)
PANEL_EDGE = (95, 99, 115)

FONT = cv2.FONT_HERSHEY_SIMPLEX

DIRECTION_COLOR = {
    LEFT: YELLOW,
    RIGHT: YELLOW,
    CENTERED: GREEN,
    LOST: RED,
}


def _panel(img: np.ndarray, x: int, y: int, w: int, h: int,
           alpha: float = 0.62, bg=PANEL_BG, edge=PANEL_EDGE) -> None:
    """半透明底板。比纯色块好看，而且不会把画面完全盖住。"""
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(img.shape[1], x + w), min(img.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    overlay = img[y0:y1, x0:x1].copy()
    overlay[:] = bg
    cv2.addWeighted(overlay, alpha, img[y0:y1, x0:x1], 1 - alpha, 0, img[y0:y1, x0:x1])
    cv2.rectangle(img, (x0, y0), (x1 - 1, y1 - 1), edge, 1)


def _text(img: np.ndarray, s: str, org: tuple[int, int], color=WHITE,
          scale: float = 0.52, thickness: int = 1, shadow: bool = True) -> None:
    """带一圈黑色描边的文字。游戏画面五颜六色，没描边经常看不清。

    注意：描边必须和正文用**同一个 thickness**。OpenCV 的 Hershey 字体在
    LINE_AA 下，thickness=3 画出来的字符串比 thickness=1 宽 8%（14 个字符
    累计漂移 8px），用 thickness+2 做描边会让黑影和正文越来越错开，
    看起来像重影 —— 这是实测出来的，别改回去。
    """
    if shadow:
        cv2.putText(img, s, (org[0] + 1, org[1] + 1), FONT, scale, (0, 0, 0), thickness, cv2.LINE_AA)
        cv2.putText(img, s, (org[0] - 1, org[1] + 1), FONT, scale, (0, 0, 0), thickness, cv2.LINE_AA)
    cv2.putText(img, s, org, FONT, scale, color, thickness, cv2.LINE_AA)


@dataclass
class VisualizerStats:
    """一段时间内的表现，跑完/summary 的时候要用。"""

    history: deque = field(default_factory=lambda: deque(maxlen=240))
    frames: int = 0
    detected: int = 0
    pulses: int = 0
    centered_frames: int = 0
    lost_run: int = 0

    def push(self, error: Optional[int], centered: bool, found: bool) -> None:
        self.frames += 1
        if found:
            self.detected += 1
            self.lost_run = 0
            if error is not None:
                self.history.append(int(error))
        else:
            self.lost_run += 1
        if centered:
            self.centered_frames += 1

    def summary(self, threshold: int, settled_after: int = 8) -> dict:
        arr = np.array(self.history, dtype=np.float32) if self.history else np.zeros(1, np.float32)
        # 前几帧必然有误差（开局就是偏的），单独看「稳定之后」的段更能说明问题
        tail = arr[settled_after:] if len(arr) > settled_after else arr
        return {
            "frames": self.frames,
            "detect_rate": (self.detected / self.frames) if self.frames else 0.0,
            "centered_rate": (self.centered_frames / self.frames) if self.frames else 0.0,
            "abs_error_mean_all": float(np.abs(arr).mean()),
            "abs_error_mean_tail": float(np.abs(tail).mean()),
            "abs_error_max": float(np.abs(arr).max()),
            "within_threshold_tail": float((np.abs(tail) <= threshold).mean()),
            "pulses": self.pulses,
            "threshold": threshold,
        }


class Visualizer:
    """负责画、负责开窗、负责收键。不修改任何控制状态。"""

    WINDOW_MAIN = "Agent Toolbox - Vision Control PoC"
    WINDOW_RAW = "Agent Toolbox - Raw Capture"

    def __init__(self, config: Config, detector_desc: str = "", backend_name: str = "") -> None:
        self.config = config
        self.detector_desc = detector_desc
        self.backend_name = backend_name
        self._open = False
        self.spark = deque(maxlen=180)
        self._click_handler = None

    # ------------------------------------------------------------ 窗口

    def set_click_handler(self, handler) -> None:
        """预览窗里点一下的回调，参数是图像坐标 (x, y)。"""
        self._click_handler = handler
        if self._open:
            self._bind_mouse()

    def set_detector_desc(self, desc: str) -> None:
        self.detector_desc = desc

    def _bind_mouse(self) -> None:
        if self._click_handler is None:
            return
        try:
            cv2.setMouseCallback(self.WINDOW_MAIN, self._on_mouse)
        except Exception:
            pass

    def _on_mouse(self, event, x, y, _flags, _param) -> None:
        if event != cv2.EVENT_LBUTTONDOWN or self._click_handler is None:
            return
        try:
            self._click_handler(int(x), int(y))
        except Exception:
            pass

    def open(self) -> None:
        if self._open or not self.config.output.show_window:
            return
        cv2.namedWindow(self.WINDOW_MAIN, cv2.WINDOW_AUTOSIZE)
        self._open = True
        self._bind_mouse()
        if self.config.output.show_game_window:
            cv2.namedWindow(self.WINDOW_RAW, cv2.WINDOW_AUTOSIZE)

    def close(self) -> None:
        if self._open:
            try:
                cv2.destroyAllWindows()
            except Exception:
                pass
            self._open = False

    def show_raw(self, frame: Frame) -> None:
        if self.config.output.show_window and self.config.output.show_game_window:
            cv2.imshow(self.WINDOW_RAW, frame.image)

    def poll_key(self) -> int:
        """返回 OpenCV 窗口里的按键。-1 表示没有。"""
        if not self._open:
            return -1
        try:
            return cv2.waitKey(1) & 0xFF
        except Exception:
            return -1

    # ------------------------------------------------------------ 绘制

    def render(
        self,
        frame: Frame,
        target: Target,
        decision: Decision,
        action: Action,
        fps: float,
        auto: bool,
        extra_lines: Sequence[str] = (),
    ) -> np.ndarray:
        img = frame.image.copy()
        h, w = img.shape[:2]

        # 上层逻辑全部用「base 局部坐标」（逻辑画面自己的坐标系）。
        # 这里统一换算成图像坐标再画 —— 用了跟踪窗口截图时两者并不重合。
        base_center = decision.center_x if decision.center_x is not None else frame.center_x
        center_x, _ = frame.base_to_image(base_center, 0)
        center_x = int(round(center_x))
        # 阈值是 base 单位下的像素长度，画到图上要按缩放比折一下
        sx = frame.scale_x or 1.0
        threshold = int(round(max(0, int(decision.threshold)) / sx))

        self._draw_threshold_band(img, center_x, threshold, h)
        self._draw_target(img, frame, target, decision, center_x)
        self._draw_hud(img, frame, target, decision, action, fps, auto, extra_lines, base_center)
        self._draw_sparkline(img, decision.threshold, h)
        self._draw_status_bar(img, target, decision, auto, w)
        self._draw_capture_note(img, frame, target)
        return img

    def _draw_capture_note(self, img: np.ndarray, frame: Frame, target: Target) -> None:
        """用了跟踪窗口截图时，明确标出来 —— 否则你会以为画面变窄了。"""
        if not frame.is_cropped:
            return
        h, w = img.shape[:2]
        cv2.rectangle(img, (0, 0), (w - 1, h - 1), (60, 130, 200), 2)
        label = f"CAPTURE ROI {w}x{h}  (offset {frame.region[0] - frame.base[0]},{frame.region[1] - frame.base[1]})"
        _text(img, label, (10, h - 10), (60, 170, 230), 0.5)

    # ----- 阈值带和中心线 -----

    def _draw_threshold_band(self, img, center_x: int, threshold: int, h: int) -> None:
        w = img.shape[1]
        if threshold > 0:
            x0 = max(0, center_x - threshold)
            x1 = min(w, center_x + threshold)
            if x1 > x0:
                # 原来先 .copy() 出一块 band 再 addWeighted（多一次分配 + 一次全填充）。
                # cv2.multiply / cv2.add 都能原地写回切片，省掉那块中间图。
                roi = img[:, x0:x1]
                cv2.multiply(roi, 0.78, roi)
                cv2.add(roi, (9, 12, 9), roi)  # ≈ (40,55,40) * 0.22，取整避免隐式转换
            for x in (center_x - threshold, center_x + threshold):
                if 0 <= x < w:
                    self._dashed_vline(img, x, (70, 200, 70), 6, 6)

        if 0 <= center_x < w:
            cv2.line(img, (center_x, 0), (center_x, h), CYAN, 2, cv2.LINE_AA)
            cv2.putText(img, "CENTER", (center_x + 6, h - 12), FONT, 0.42, CYAN, 1, cv2.LINE_AA)
        else:
            # 中心跑出画面了（截的是跟踪窗口，目标偏在一侧）。在边缘指个方向，
            # 不然你只看到一条斜的箭头，不知道相对中心到底差多少。
            edge_x = 8 if center_x < 0 else w - 8
            pts = [(edge_x, h // 2 - 14), (edge_x, h // 2 + 14)]
            cv2.arrowedLine(img, pts[1], pts[0], CYAN, 3, cv2.LINE_AA, tipLength=0.4)
            _text(img, f"CENTER {center_x}", (edge_x + 10 if center_x < 0 else edge_x - 120, h // 2),
                  CYAN, 0.5)

    @staticmethod
    def _dashed_vline(img, x: int, color, dash: int = 8, gap: int = 6) -> None:
        """竖直虚线。整条线用**一次** cv2.polylines 画完。

        原来是一段一个 cv2.line，518px 高要发 43 次调用；阈值带两侧就是 86 次，
        而每次 LINE_AA 的 cv2.line 有几微秒的固定开销 —— 实测这是阈值带里
        最大的一笔。cv2.polylines 接受「多条独立折线」的数组，所以可以把
        所有小段一次性塞进去，dash 之间不会被连起来（每段只有两个点）。
        """
        h = img.shape[0]
        y = 0
        segs = []
        while y < h:
            y2 = min(h, y + dash)
            if y2 > y:
                segs.append(((x, y), (x, y2)))
            y += dash + gap
        if not segs:
            return
        cv2.polylines(img, np.asarray(segs, dtype=np.int32), False, color, 1, cv2.LINE_AA)

    # ----- 目标 -----

    def _draw_target(self, img, frame: Frame, target: Target, decision: Decision,
                     center_x: int) -> None:
        img_h, img_w = img.shape[:2]
        if not target.found:
            return

        color = DIRECTION_COLOR.get(decision.direction, ORANGE)
        # target 的坐标是 base 局部坐标，换算成图像坐标才画得对
        tx_f, ty_f = frame.base_to_image(target.x, target.y)
        tx, ty = int(round(tx_f)), int(round(ty_f))

        if target.bbox:
            bx, by, bw, bh = (int(v) for v in target.bbox)
            x0, y0 = frame.base_to_image(bx, by)
            x1, y1 = frame.base_to_image(bx + bw, by + bh)
            rect = (int(round(x0)) - 2, int(round(y0)) - 2,
                    int(round(x1)) + 2, int(round(y1)) + 2)
            cv2.rectangle(img, rect[:2], rect[2:], color, 1, cv2.LINE_AA)

        # 「丢帧保持」补出来的位置，画成虚线感的空心准星 —— 提醒你这不是真看到的
        if target.predicted:
            cv2.circle(img, (tx, ty), 18, color, 1, cv2.LINE_AA)
            _text(img, "HELD (not seen this frame)", (tx - 90, ty + 34), color, 0.46)
            color = DIM

        # 十字准星 + 中心点
        cv2.circle(img, (tx, ty), 4, color, -1, cv2.LINE_AA)
        cv2.line(img, (tx - 12, ty), (tx + 12, ty), color, 1, cv2.LINE_AA)
        cv2.line(img, (tx, ty - 12), (tx, ty + 12), color, 1, cv2.LINE_AA)

        # 中心 → 目标 的箭头，一眼看出差多少、往哪边
        if abs(tx - center_x) > 2:
            cv2.arrowedLine(img, (center_x, ty), (tx, ty), color, 2, cv2.LINE_AA, tipLength=0.12)
            label = f"{target.x - (decision.center_x or 0):+d}px"
            mid = (center_x + tx) // 2
            _text(img, label, (mid - 24, ty - 12), color, 0.46)
        else:
            cv2.circle(img, (center_x, ty), 10, GREEN, 2, cv2.LINE_AA)

        # 目标坐标贴在准星旁边（报的是 base 坐标，跟 HUD 对得上）
        _text(img, f"target ({target.x}, {target.y})", (tx + 14, ty - 14), color, 0.44)

    # ----- HUD -----

    def _draw_hud(self, img, frame: Frame, target: Target, decision: Decision,
                  action: Action, fps: float, auto: bool, extra_lines, center_x: int) -> None:
        lines: list[tuple[str, tuple[int, int, int]]] = []
        lines.append((f"FPS: {fps:5.1f}", WHITE))
        lines.append(("", WHITE))
        if target.found:
            tag = "  HELD" if target.predicted else ""
            lines.append((f"Target X: {target.x}{tag}", ORANGE if not target.predicted else DIM))
        else:
            lines.append(("Target X: --", RED))
        # center_x 传进来的是 base 局部坐标 —— 和 target 同一个坐标系，可以直接减
        lines.append((f"Center X: {center_x}", CYAN))
        if decision.direction == LOST:
            lines.append(("Error:    --", RED))
        else:
            lines.append((f"Error:    {decision.error:+d}", DIRECTION_COLOR.get(decision.direction, WHITE)))
        lines.append((f"Threshold:{threshold_label(decision.threshold)}", DIM))
        lines.append((f"Decision: {decision.direction}", DIRECTION_COLOR.get(decision.direction, WHITE)))
        lines.append((f"Action:   {action.label}", GREEN if action.sent else DIM))
        if target.found and target.candidates > 1:
            lines.append((f"Candidates: {target.candidates} (picked best)", ORANGE))
        if target.raw_x is not None and abs(target.raw_x - target.x) >= 1.0:
            lines.append((f"raw X:    {target.raw_x:.1f}", DIM))
        if target.elapsed_ms:
            lines.append((f"Detect:   {target.elapsed_ms:.1f}ms", DIM))

        for extra in extra_lines or ():
            lines.append((extra, DIM))

        scale = 0.56
        line_h = 22
        pad = 12
        width = max(
            (cv2.getTextSize(t, FONT, scale, 1)[0][0] for t, _ in lines if t),
            default=200,
        ) + pad * 2
        height = line_h * len(lines) + pad * 2

        _panel(img, 10, 10, width, height)

        y = 10 + pad + 14
        for text, color in lines:
            if text:
                _text(img, text, (10 + pad, y), color, scale)
            y += line_h

        # 右上角：当前的目标检测方式，方便确认「我锁的是不是对的颜色」
        if self.detector_desc:
            desc = self.detector_desc[:52]
            tw = cv2.getTextSize(desc, FONT, 0.44, 1)[0][0]
            _text(img, desc, (img.shape[1] - tw - 16, 26), DIM, 0.44)

    # ----- 误差曲线 -----

    def _draw_sparkline(self, img, threshold: int, h: int) -> None:
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

        # 一次转成 numpy 数组。原来在循环里写 self.spark[i]，而 spark 是 deque，
        # 按下标取值是 O(n)，180 个点就是 O(n²) —— 纯属白给的。
        vals = np.asarray(list(self.spark), dtype=np.float64)
        span = max(threshold * 3,
                   float(np.abs(vals).max()) if vals.size else float(threshold),
                   float(threshold))

        # 零轴和阈值线
        cv2.line(img, (x0 + 10, mid_y), (x0 + 10 + inner_w, mid_y), (110, 115, 130), 1, cv2.LINE_AA)
        for sign in (-1, 1):
            yy = int(mid_y - sign * (threshold / span) * (inner_h / 2))
            cv2.line(img, (x0 + 10, yy), (x0 + 10 + inner_w, yy), (70, 160, 70), 1, cv2.LINE_AA)
        _text(img, "error history", (x0 + 12, y0 + 16), DIM, 0.44)

        if vals.size < 2:
            return

        n = vals.size
        step = inner_w / max(1, (self.spark.maxlen or n) - 1)
        xs = (x0 + 10 + np.arange(n) * step).astype(np.int32)
        clipped = np.clip(vals / span, -1.0, 1.0)
        ys = (mid_y - clipped * (inner_h / 2)).astype(np.int32)
        pts = np.stack([xs, ys], axis=1)

        # 把「连续同色」的段合并成一条折线。原来逐段 cv2.line，180 段 ≈ 1.5ms；
        # 误差曲线同一侧往往连着几十帧，合并之后通常只剩个位数次调用。
        # 相邻段共享端点（切片到 i+1），所以折线之间不会断开。
        inside = np.abs(vals) <= threshold
        runs: list[tuple[int, int]] = []
        start = 0
        for i in range(1, n):
            if inside[i] != inside[start]:
                runs.append((start, i + 1))
                start = i
        runs.append((start, n))

        for a, b in runs:
            if b - a < 2:
                continue
            color = GREEN if inside[a] else ORANGE
            cv2.polylines(img, [pts[a:b]], False, color, 2, cv2.LINE_AA)
        cv2.circle(img, (int(pts[-1][0]), int(pts[-1][1])), 3, WHITE, -1, cv2.LINE_AA)

    # ----- 顶部状态 -----

    def _draw_status_bar(self, img, target: Target, decision: Decision, auto: bool, w: int) -> None:
        if not target.found:
            text, color = "TARGET LOST - no key sent", RED
        elif target.predicted:
            text, color = "HOLDING last position - target not seen this frame", ORANGE
        elif auto:
            text, color = f"AUTO RUNNING - {decision.direction}", DIRECTION_COLOR.get(decision.direction, GREEN)
        else:
            text, color = "PAUSED - press F8 to start", YELLOW

        tw = cv2.getTextSize(text, FONT, 0.6, 2)[0][0]
        x = max(10, (w - tw) // 2)
        _panel(img, x - 14, 10, tw + 28, 34, alpha=0.6)
        _text(img, text, (x, 34), color, 0.6, 2)

    # ------------------------------------------------------------ 落盘

    @staticmethod
    def save(image: np.ndarray, path) -> None:
        from pathlib import Path

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        # cv2.imwrite 遇到非 ASCII 路径会静默失败，用 imencode 绕过去
        ok, buf = cv2.imencode(p.suffix or ".png", image)
        if ok:
            p.write_bytes(buf.tobytes())

    def update_history(self, error: Optional[int]) -> None:
        if error is not None:
            self.spark.append(int(error))


def threshold_label(threshold: int) -> str:
    return f" +/-{threshold}px"
