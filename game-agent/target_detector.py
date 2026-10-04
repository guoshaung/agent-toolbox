"""
target_detector.py —— 在画面里找到「目标点」，给出它的中心位置。

核心状态 Target 定义在这里。

三种方案，按稳定性从高到低排：
  * 方案 B（默认，最稳）：固定颜色的团块检测。黑底红点，零配置直接可跑。
  * 方案 A：鼠标点一下目标，程序记住那块的颜色，之后按这个颜色追。
            颜色会随光照漂移，但比模板匹配省事，而且不需要预先准备素材。
  * 方案 C：模板匹配。你给一张目标图标截图，全画面找最像的位置。
            图标有缩放/旋转时会失效，所以放在最后。

共同点：都不需要模型、不需要联网、不需要 OCR。

── 开放世界为什么要「时序跟踪」 ──────────────────────────────────────

在黑底红点的测试窗口里，画面里只有一个红色团块，「取最大的那个」永远是对的。
开放世界里完全不是这样：血条、技能图标、环境光、红色的花、水面反光……同一时刻
可能有几十个色团同时命中 HSV 区间。每帧独立地「取最大」，结果是锁定目标一帧一个样。

所以这里引入了「上一帧在哪」这个先验：

  1. 搜索窗   锁定之后，只在上一帧位置附近的小窗里找。
              既省时间（整条检测链快 18 倍），也从根子上排除了画面别处的同色干扰。
  2. 多候选打分  面积 + 离上一帧位置的距离，按权重综合，而不是单纯比大小。
  3. 丢帧保持  marker 被树挡一两帧很常见，一丢就停手会让控制一顿一顿的。
              连续丢 N 帧之内沿用上一帧位置（标记为 predicted），超过才算真丢失。
  4. 形态过滤  长宽比、填充率，滤掉细长条（栏杆/光线/UI 横线）和空心圈。
  5. NMS      同一个目标被切碎成几块时合并。

注意：跟踪只在「已经锁定」之后生效。第一帧仍然全画面找，所以要保证
开局时画面里只有一个符合颜色的候选 —— 或者用 --left-click-lock 手动点一下。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Optional, Tuple

import cv2
import numpy as np

from config import DetectConfig

Rect = Tuple[int, int, int, int]


@dataclass
class Target:
    """一帧里的目标检测结果。

    found=False 时其它字段无意义。
    坐标一律是「base 局部坐标」—— 也就是逻辑画面（游戏窗口）自己的坐标系，
    不是底层截图的实际像素坐标。ROI 裁剪和降采样都在 detector 内部消化掉了。
    """

    found: bool
    x: int = -1
    y: int = -1
    bbox: Optional[Rect] = None  # (x, y, w, h)，base 坐标
    area: float = 0.0
    confidence: float = 0.0
    method: str = ""

    # ---- 诊断用（不影响控制逻辑）----
    # 由「丢帧保持」补出来的，不是这一帧真检测到的
    predicted: bool = False
    # 这一帧过筛之后的候选团块数量。>1 说明画面里有多个同色物，正在做选择
    candidates: int = 0
    # 综合得分（候选打分用）
    score: float = 0.0
    # 平滑之前的位置。控制用 x，对账检测精度用 raw_x
    raw_x: Optional[float] = None
    raw_y: Optional[float] = None
    # 这一帧是不是只在跟踪窗口里找的
    windowed: bool = False
    # 单帧耗时（毫秒）
    elapsed_ms: float = 0.0

    @property
    def is_valid(self) -> bool:
        return self.found and self.x >= 0

    @property
    def degraded(self) -> bool:
        """这一帧的结果可信度打折（预测出来的）。"""
        return self.predicted

    def __str__(self) -> str:
        if not self.found:
            return "Target(none)"
        tag = "~held" if self.predicted else ""
        return f"Target(x={self.x}, y={self.y}, area={self.area:.0f}, conf={self.confidence:.2f}{tag})"

    @staticmethod
    def missing(method: str = "") -> "Target":
        return Target(found=False, method=method)


MISSING = Target(found=False)


# ---------------------------------------------------------------- 候选团块


@dataclass
class Candidate:
    """一个过筛之后的候选团块。坐标已经是 base 局部坐标。"""

    cx: float
    cy: float
    bbox: Rect
    area: float
    fill: float  # 面积 / 外接矩形面积
    score: float = 0.0

    @property
    def aspect(self) -> float:
        w = max(1, self.bbox[2])
        h = max(1, self.bbox[3])
        return max(w, h) / min(w, h)


def _iou(a: Rect, b: Rect) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x0, y0 = max(ax, bx), max(ay, by)
    x1, y1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = x1 - x0, y1 - y0
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def suppress(cands: list[Candidate], iou_threshold: float) -> list[Candidate]:
    """非极大值抑制：把重叠的同色碎片合并掉，别让一个目标报出三个框。

    输入按 score 降序，输出保证不再有两两 IoU 超过阈值的框。
    """
    if iou_threshold <= 0 or len(cands) <= 1:
        return cands
    kept: list[Candidate] = []
    for cand in sorted(cands, key=lambda c: c.score, reverse=True):
        if all(_iou(cand.bbox, k.bbox) <= iou_threshold for k in kept):
            kept.append(cand)
    return kept


# ---------------------------------------------------------------- 检测器


class TargetDetector:
    """无状态入、有状态出的检测器。

    有状态的部分是「跟踪器」：它记着上一帧目标在哪，用来收窄下一帧的搜索范围。
    颜色区间也可能被「点击锁色」改写，所以这部分状态也在这里。
    """

    def __init__(self, config: DetectConfig) -> None:
        self.config = config
        self._ranges = self._resolve_ranges()
        self._template: Optional[np.ndarray] = None
        self._template_gray: Optional[np.ndarray] = None
        self._locked_note = ""
        self._kernel: Optional[np.ndarray] = None

        # ---- 跟踪状态 ----
        self._lock: Optional[Tuple[float, float]] = None  # 平滑后的位置（base 坐标）
        self._lock_area: float = 0.0  # 上一次的面积，用来给打分定参考尺度
        self._lost: int = 0  # 连续丢了多少帧
        self._hits: int = 0  # 累计命中多少帧
        self._last_base: Optional[Tuple[int, int]] = None  # 上一帧的逻辑画面尺寸

        # ---- 统计（给 summary 用）----
        self.windowed_frames = 0
        self.hold_frames = 0
        self.multi_candidate_frames = 0

        if config.mode == "template":
            self._load_template()

    # ------------------------------------------------------------ 颜色区间

    def _resolve_ranges(self) -> list[Tuple[Tuple[int, int, int], Tuple[int, int, int]]]:
        cfg = self.config
        if cfg.preset:
            from config import COLOR_PRESETS

            key = cfg.preset.strip().lower()
            if key not in COLOR_PRESETS:
                raise ValueError(
                    f"未知颜色预设 {cfg.preset!r}，可选：{', '.join(COLOR_PRESETS)}"
                )
            return [
                ((h_lo, s_lo, v_lo), (h_hi, s_hi, v_hi))
                for h_lo, s_lo, v_lo, h_hi, s_hi, v_hi in COLOR_PRESETS[key]
            ]
        return [(tuple(cfg.hsv_lower), tuple(cfg.hsv_upper))]

    @property
    def kernel(self) -> np.ndarray:
        if self._kernel is None:
            k = max(1, int(self.config.morph_kernel) | 1)  # 强制奇数
            self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        return self._kernel

    def describe(self) -> str:
        """给 HUD 用的一行说明。"""
        if self.config.mode == "template":
            base = f"template {self._template_name()}"
        elif self._locked_note:
            base = f"color {self._locked_note}"
        elif self.config.preset:
            base = f"color preset={self.config.preset}"
        else:
            parts = [f"H{lo[0]}-{hi[0]} S{lo[1]}-{hi[1]} V{lo[2]}-{hi[2]}" for lo, hi in self._ranges]
            base = "color " + " | ".join(parts)

        bits = []
        if self.config.detect_max_side:
            bits.append(f"<= {self.config.detect_max_side}px")
        if self.config.track_enabled:
            bits.append(f"track +/-{self.config.track_pad_px}px")
        if self.config.lost_hold_frames:
            bits.append(f"hold {self.config.lost_hold_frames}f")
        return base + ("  [" + " ".join(bits) + "]" if bits else "")

    def _template_name(self) -> str:
        import os

        return os.path.basename(self.config.template_path) or "(未设置)"

    # ------------------------------------------------------------ 方案 A：点击锁色

    def lock_color(self, image: np.ndarray, x: int, y: int, patch: int = 5,
                   tol_h: int = 12, tol_s: int = 70, tol_v: int = 70) -> str:
        """采样 (x, y) 附近一小块的颜色，把 HSV 区间收缩到它附近。

        这是方案 A 的实现：不用准备素材，点哪儿追哪儿。
        """
        h, w = image.shape[:2]
        if h == 0 or w == 0:
            return "画面是空的，锁色失败"
        px, py = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
        x0, x1 = max(0, px - patch), min(w, px + patch + 1)
        y0, y1 = max(0, py - patch), min(h, py + patch + 1)
        # 注意：这里必须 copy —— 否则拿到的是原图的视图，后面 cvtColor 时会读到
        # 主循环已经改过的数据
        crop = image[y0:y1, x0:x1].copy()
        if crop.size == 0:
            return "取样区域为空，锁色失败"

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        # 用中位数而不是均值：采样框里混进一两个异色像素不会把结果带跑
        hh = float(np.median(hsv[:, :, 0]))
        ss = float(np.median(hsv[:, :, 1]))
        vv = float(np.median(hsv[:, :, 2]))

        if ss < 40:
            self._locked_note = "灰度色目标，建议改用模板匹配"
            return "这个位置几乎是灰的（饱和度太低），颜色追踪会很不稳"

        h_lo, h_hi = hh - tol_h, hh + tol_h
        s_lo, s_hi = max(0, ss - tol_s), min(255, ss + tol_s)
        v_lo, v_hi = max(0, vv - tol_v), min(255, vv + tol_v)

        ranges: list[Tuple[Tuple[int, int, int], Tuple[int, int, int]]] = []
        if h_lo < 0:  # 红色跨 H 轴零点，拆两段
            ranges.append(((0, int(s_lo), int(v_lo)), (int(min(180, h_hi)), int(s_hi), int(v_hi))))
            ranges.append(((int(180 + h_lo), int(s_lo), int(v_lo)), (180, int(s_hi), int(v_hi))))
        elif h_hi > 180:
            ranges.append(((0, int(s_lo), int(v_lo)), (int(h_hi - 180), int(s_hi), int(v_hi))))
            ranges.append(((int(h_lo), int(s_lo), int(v_lo)), (180, int(s_hi), int(v_hi))))
        else:
            ranges.append(((int(h_lo), int(s_lo), int(v_lo)), (int(h_hi), int(s_hi), int(v_hi))))

        self._ranges = ranges
        self.config.mode = "color"
        self.config.preset = ""  # 锁色之后不再走预设
        self.reset_tracking()  # 换了目标，之前的跟踪位置作废
        # 记下 BGR 色值，HUD 上能直接看出锁定的是什么颜色
        b, g, r = (int(crop[:, :, i].mean()) for i in range(3))
        self._locked_note = f"locked #{r:02X}{g:02X}{b:02X} H{int(hh)}"
        return f"已锁定颜色 rgb({r},{g},{b})，H={int(hh)} S={int(ss)} V={int(vv)}"

    def reset(self) -> None:
        self._ranges = self._resolve_ranges()
        self._locked_note = ""
        self.reset_tracking()

    def reset_tracking(self) -> None:
        """把跟踪状态清空，下一帧回到全画面搜索。"""
        self._lock = None
        self._lock_area = 0.0
        self._lost = 0
        self._hits = 0

    def seed_lock(self, x: float, y: float) -> None:
        """手动指定一个初始位置。

        用户点了「目标在这儿」之后调用：搜索窗立刻收到那一小块上，
        既省时间，也避免第一帧就在全画面里挑错团块。
        """
        self._lock = (float(x), float(y))
        self._lock_area = 0.0
        self._lost = 0

    # ------------------------------------------------------------ 方案 C：模板

    def _load_template(self) -> None:
        path = self.config.template_path
        if not path:
            raise ValueError("mode=template 但没有给 template_path")
        from config import resolve_path

        img = cv2.imread(str(resolve_path(path)), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"模板图读不出来：{path}")
        self._template = img
        self._template_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    def lock_template(self, image: np.ndarray, rect: Rect) -> str:
        """从当前帧里抠一块当模板（等价于方案 C，只是素材是现场截的）。"""
        x, y, w, h = (int(v) for v in rect)
        h_img, w_img = image.shape[:2]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w_img, x + w), min(h_img, y + h)
        if x1 - x0 < 4 or y1 - y0 < 4:
            return "选区太小或越界，抠不出模板"
        crop = image[y0:y1, x0:x1].copy()
        self._template = crop
        self._template_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        self.config.mode = "template"
        self.reset_tracking()
        self._locked_note = f"template {x1 - x0}x{y1 - y0}"
        return f"已从画面抠出 {x1 - x0}x{y1 - y0} 的模板"

    # ------------------------------------------------------------ 跟踪窗口

    def _search_half(self, base_w: int, base_h: int) -> Tuple[int, int]:
        """算出搜索窗的半宽/半高。

        横向给多一点：一次脉冲最多转 9 度，1440p 上约 250px，而纵向上目标
        基本不动（转身改变的是横向位置）。
        """
        cfg = self.config
        pad = max(32, int(cfg.track_pad_px))
        ratio = max(0.0, float(cfg.track_pad_ratio))
        half_w = max(pad, int(base_w * ratio))
        half_h = max(pad // 2, int(base_h * ratio))
        # 别让窗口超过画面本身，不然 clamp 之后反而变复杂
        half_w = min(half_w, base_w // 2)
        half_h = min(half_h, base_h // 2)
        return max(16, half_w), max(16, half_h)

    def search_roi(self, base_w: int, base_h: int) -> Optional[Rect]:
        """下一帧建议截哪里（base 局部坐标）。None = 全画面。

        主循环在抓屏之前调它，这样连「抓多少像素」都能省下来。

        丢帧保持期间**必须继续用窗口**：一回到全画面，画面里几十个同色物
        就会在没有「离上一帧多远」这个先验的情况下乱选一个，保持就白做了。
        只有保持期也过了（目标真没了），才退回全画面重新找。
        """
        if not self.config.track_enabled or self._lock is None:
            return None
        hold = max(0, int(self.config.lost_hold_frames))
        if self._lost > hold:
            return None  # 保持期过了：承认丢了，全画面重新找
        lx, ly = self._lock
        half_w, half_h = self._search_half(base_w, base_h)
        x0 = int(round(lx)) - half_w
        y0 = int(round(ly)) - half_h
        w = half_w * 2
        h = half_h * 2
        # 贴边时平移而不是裁小，保证窗口尺寸恒定（尺寸恒定才好做性能预期）
        x0 = max(0, min(x0, max(0, base_w - w)))
        y0 = max(0, min(y0, max(0, base_h - h)))
        w = min(w, base_w)
        h = min(h, base_h)
        return (x0, y0, w, h)

    # ------------------------------------------------------------ 主入口

    def detect_frame(self, frame) -> Target:
        """在 frame 里找目标。坐标以 base 局部坐标返回。

        frame 需要提供：image / base_width / base_height / image_to_base()。
        （screen_capture.Frame 和 sim_game 造的 Frame 都满足）
        """
        import time

        t0 = time.perf_counter()
        image = getattr(frame, "image", None)
        if image is None or image.size == 0:
            return Target.missing(self.config.mode)

        base_w = int(getattr(frame, "base_width", image.shape[1]))
        base_h = int(getattr(frame, "base_height", image.shape[0]))
        self._last_base = (base_w, base_h)

        if self.config.mode == "template":
            target = self._detect_template(frame)
        else:
            target = self._detect_color(frame)

        target.elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return target

    def detect(self, image: np.ndarray) -> Target:
        """老签名，只给「手上只有一张图」的场合用（等价于整帧都是逻辑画面）。"""
        return self._detect_color(_PlainFrame(image))

    # ------------------------------------------------------------ 窗口解析

    def _resolve_window(self, frame, base_w: int, base_h: int) -> Optional[Rect]:
        """这一帧要在 base 画面的哪一块里找。None = 整幅。

        三个来源取交集：固定的 detect.roi、跟踪搜索窗、以及这一帧实际截到的范围。
        """
        win: Optional[Rect] = (0, 0, base_w, base_h)

        if self.config.roi:
            rx, ry, rw, rh = (int(v) for v in self.config.roi)
            win = _rect_intersect(win, (max(0, rx), max(0, ry), max(1, rw), max(1, rh)))

        track = self.search_roi(base_w, base_h)
        if track is not None:
            win = _rect_intersect(win, track) if win else track

        # 这一帧实际覆盖的 base 范围（用了跟踪窗口截屏时会小于整个 base）
        region = getattr(frame, "region", None)
        base_region = getattr(frame, "_base", None)
        if region is not None and base_region is not None:
            actual = (region[0] - base_region[0], region[1] - base_region[1], region[2], region[3])
            win = _rect_intersect(win, actual) if win else actual

        return win

    def _crop_and_scale(self, frame, win: Optional[Rect]):
        """把要处理的那块抠出来并降采样。

        返回 (crop, scale, 映射函数)。映射函数把 crop 里降采样后的像素坐标
        换算回 base 局部坐标。scale 是 crop → 降采样图的缩放比。
        """
        image = frame.image
        h_img, w_img = image.shape[:2]

        if win is None:
            ix0, iy0, ix1, iy1 = 0, 0, w_img, h_img
        else:
            to_img = frame.base_to_image
            x0f, y0f = to_img(win[0], win[1])
            x1f, y1f = to_img(win[0] + win[2], win[1] + win[3])
            ix0 = max(0, int(math.floor(x0f)))
            iy0 = max(0, int(math.floor(y0f)))
            ix1 = min(w_img, int(math.ceil(x1f)))
            iy1 = min(h_img, int(math.ceil(y1f)))
            if ix1 - ix0 < 8 or iy1 - iy0 < 8:  # 窗口太离谱，退回整幅
                ix0, iy0, ix1, iy1 = 0, 0, w_img, h_img

        crop = image[iy0:iy1, ix0:ix1]

        max_side = int(self.config.detect_max_side)
        ch, cw = crop.shape[:2]
        scale = 1.0
        if max_side > 0 and max(ch, cw) > max_side:
            scale = max_side / float(max(ch, cw))
            crop = cv2.resize(
                crop,
                (max(8, int(round(cw * scale))), max(8, int(round(ch * scale)))),
                interpolation=cv2.INTER_AREA,
            )

        inv = 1.0 / scale if scale > 0 else 1.0
        to_base = frame.image_to_base

        def mapper(sx: float, sy: float) -> Tuple[float, float]:
            return to_base(ix0 + sx * inv, iy0 + sy * inv)

        return crop, scale, mapper

    # ------------------------------------------------------------ 颜色团块

    def _detect_color(self, frame) -> Target:
        cfg = self.config
        base_w = int(getattr(frame, "base_width", frame.image.shape[1]))
        base_h = int(getattr(frame, "base_height", frame.image.shape[0]))

        win = self._resolve_window(frame, base_w, base_h)
        if win is None or win[2] < 8 or win[3] < 8:
            return self._miss("color", windowed=False)

        crop, scale, mapper = self._crop_and_scale(frame, win)
        ch, cw = crop.shape[:2]
        if ch < 4 or cw < 4:
            return self._miss("color", windowed=False)

        px_per_base = scale
        region = getattr(frame, "region", None)
        img_w = getattr(frame, "width", 0) or 1
        if region is not None and img_w:
            px_per_base = scale * (region[2] / float(img_w))
        area_scale = max(1e-6, px_per_base * px_per_base)

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
        for lo, hi in self._ranges:
            mask |= cv2.inRange(
                hsv, np.array(lo, dtype=np.uint8), np.array(hi, dtype=np.uint8)
            )

        # 开运算去毛刺、闭运算补空洞。核的大小按降采样比例缩过 ——
        # 不然画面缩小之后同一个核相对就更「凶」，小目标会被直接抹掉。
        k = max(1, int(round(max(1, int(cfg.morph_kernel)) * scale)) | 1)
        if k >= 3:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        min_area = max(1.0, float(cfg.min_area) * area_scale)
        max_area = float(cfg.max_area) * area_scale if cfg.max_area else 0.0

        cands: list[Candidate] = []
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < min_area:
                continue
            if max_area and area > max_area:
                continue
            bx, by, bw, bh = cv2.boundingRect(contour)
            box_area = float(max(1, bw * bh))
            fill = area / box_area
            if cfg.fill_min > 0 and fill < cfg.fill_min:
                continue
            aspect = max(bw, bh) / float(max(1, min(bw, bh)))
            if cfg.aspect_max > 0 and aspect > cfg.aspect_max:
                continue

            moments = cv2.moments(contour)
            if moments["m00"] > 0:
                mx = moments["m10"] / moments["m00"]
                my = moments["m01"] / moments["m00"]
            else:  # 退化成一像素宽时矩会失败，退回外接矩形中心
                mx, my = bx + bw / 2.0, by + bh / 2.0

            # 面积换算回 base 单位，这样 min_area 的语义跟缩不缩放无关
            base_x, base_y = mapper(mx, my)
            tl = mapper(bx, by)
            br = mapper(bx + bw, by + bh)
            cands.append(Candidate(
                cx=base_x,
                cy=base_y,
                bbox=(int(round(tl[0])), int(round(tl[1])),
                      max(1, int(round(br[0] - tl[0]))), max(1, int(round(br[1] - tl[1])))),
                area=area / area_scale,
                fill=fill,
            ))

        if not cands:
            return self._miss("color", windowed=win is not None and _is_smaller(win, base_w, base_h))

        cands = self._score(cands, base_w, base_h)
        iou = float(cfg.nms_iou)
        if iou > 0:
            cands = suppress(cands, iou)

        # 「重现门」：丢帧保持期间，我们相信目标还在原位置附近，几帧后就会
        # 在那里重现。这时窗口里冒出来的别的色块，多半是路过的干扰物 ——
        # 离保持位置太远的一律不认，宁可继续保持。不然 marker 被挡几帧，
        # 锁定就被窗口里随便哪个同色物拐跑了。
        hold = max(0, int(cfg.lost_hold_frames))
        best: Optional[Candidate]
        if self._lock is not None and 0 < self._lost <= hold:
            half_w, half_h = self._search_half(base_w, base_h)
            gate = max(48.0, 0.4 * math.hypot(half_w, half_h))
            lx, ly = self._lock
            best = None
            for cand in sorted(cands, key=lambda c: c.score, reverse=True):
                if math.hypot(cand.cx - lx, cand.cy - ly) <= gate:
                    best = cand
                    break
            if best is None:
                return self._miss("color", windowed=_is_smaller(win, base_w, base_h))
        else:
            best = max(cands, key=lambda c: c.score)

        return self._accept(best, len(cands), windowed=_is_smaller(win, base_w, base_h))

    def _score(self, cands: list[Candidate], base_w: int, base_h: int) -> list[Candidate]:
        """给候选打分。两条先验：够大、离上一帧的位置够近。

        面积分是自归一化的（除以本帧最大的候选），不是拿一个固定参考面积去除。
        踩过的坑：原先用 min_area*8 当参考，开放世界里随便一个色块都超过它，
        于是所有候选面积分全是 1.0 —— 等于没有面积分，选谁全看轮廓顺序。
        """
        cfg = self.config
        lock = self._lock
        hold = max(0, int(cfg.lost_hold_frames))
        lost = self._lost

        w_area = max(0.0, float(cfg.score_area_weight))
        w_dist = max(0.0, float(cfg.score_dist_weight))
        total = w_area + w_dist
        if total <= 0:
            w_area, w_dist = 1.0, 0.0
        else:
            w_area, w_dist = w_area / total, w_dist / total

        if lock is None:
            # 从来没锁定过（开局第一帧）：只能靠面积，谁大押谁
            w_area, w_dist = 1.0, 0.0
            radius = 1.0
        elif lost > hold:
            # 保持期过了才承认丢：全画面重新抓，半径放大到半个屏幕对角线量级，
            # 让「离刚才那个位置近」仍然压得住「更大但更远」的干扰物
            radius = max(24.0, math.hypot(base_w, base_h) * 0.4)
        else:
            half_w, half_h = self._search_half(base_w, base_h)
            radius = max(24.0, math.hypot(half_w, half_h))

        max_area = max((c.area for c in cands), default=1.0)
        max_area = max(1.0, max_area)

        for cand in cands:
            # 开方压缩：2 倍大和 10 倍大不该是 5 倍的差距
            area_score = math.sqrt(_clamp01(cand.area / max_area))

            if lock is None:
                dist_score = 0.0
            else:
                d = math.hypot(cand.cx - lock[0], cand.cy - lock[1])
                dist_score = _clamp01(1.0 - d / radius)

            cand.score = w_area * area_score + w_dist * dist_score
        return cands

    # ------------------------------------------------------------ 结果收口

    def _accept(self, best: Candidate, n_candidates: int, windowed: bool) -> Target:
        """候选 → Target：平滑、更新跟踪状态、处理跳变。"""
        cfg = self.config
        raw_x, raw_y = best.cx, best.cy

        # 跳变保护：锁了 A 处的目标，突然在画面另一头找到一个更大的色块，
        # 那不是同一个东西。
        if (cfg.max_jump_px > 0 and self._lock is not None and self._lost <= 0):
            d = math.hypot(raw_x - self._lock[0], raw_y - self._lock[1])
            if d > cfg.max_jump_px:
                return self._miss("color", windowed=windowed)

        alpha = _clamp01(float(cfg.smooth_alpha))
        if self._lock is None or self._lost > 0 or alpha >= 1.0:
            sx, sy = raw_x, raw_y
        else:
            sx = alpha * raw_x + (1 - alpha) * self._lock[0]
            sy = alpha * raw_y + (1 - alpha) * self._lock[1]

        self._lock = (sx, sy)
        self._lock_area = best.area
        self._lost = 0
        self._hits += 1
        if windowed:
            self.windowed_frames += 1
        if n_candidates > 1:
            self.multi_candidate_frames += 1

        return Target(
            found=True,
            x=int(round(sx)),
            y=int(round(sy)),
            bbox=best.bbox,
            area=best.area,
            confidence=_clamp01(best.score),
            method="color",
            candidates=n_candidates,
            score=best.score,
            raw_x=raw_x,
            raw_y=raw_y,
            windowed=windowed,
        )

    def _miss(self, method: str, windowed: bool) -> Target:
        """这一帧没找到。可能的处理：沿用上一帧位置（丢帧保持）。"""
        self._lost += 1
        hold = max(0, int(self.config.lost_hold_frames))
        if self._lock is not None and hold and self._lost <= hold:
            self.hold_frames += 1
            x, y = self._lock
            return Target(
                found=True,
                x=int(round(x)),
                y=int(round(y)),
                area=self._lock_area,
                confidence=0.0,
                method=method,
                predicted=True,
                windowed=windowed,
            )
        return Target.missing(method)

    # ------------------------------------------------------------ 模板匹配

    def _detect_template(self, frame) -> Target:
        if self._template_gray is None:
            return Target.missing("template")

        base_w = int(getattr(frame, "base_width", frame.image.shape[1]))
        base_h = int(getattr(frame, "base_height", frame.image.shape[0]))
        win = self._resolve_window(frame, base_w, base_h)

        crop, scale, mapper = self._crop_and_scale(frame, win)

        # 模板匹配是 O(画面面积 x 模板面积)，全屏跑一次实测 96ms —— 直接吃光
        # 一整帧的预算。这里再压一道，模板和画面同时缩，匹配结果等价。
        max_side = int(self.config.template_max_side)
        ch, cw = crop.shape[:2]
        t_scale = 1.0
        if max_side > 0 and max(ch, cw) > max_side:
            t_scale = max_side / float(max(ch, cw))
            crop = cv2.resize(
                crop,
                (max(16, int(round(cw * t_scale))), max(16, int(round(ch * t_scale)))),
                interpolation=cv2.INTER_AREA,
            )

        th, tw = self._template_gray.shape[:2]
        if t_scale < 1.0:
            tw_s = max(4, int(round(tw * t_scale)))
            th_s = max(4, int(round(th * t_scale)))
            template = cv2.resize(self._template_gray, (tw_s, th_s), interpolation=cv2.INTER_AREA)
        else:
            template = self._template_gray
            tw_s, th_s = tw, th

        h, w = crop.shape[:2]
        if th_s > h or tw_s > w:
            return self._miss("template", windowed=_is_smaller(win, base_w, base_h))

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val < self.config.match_threshold:
            return self._miss("template", windowed=_is_smaller(win, base_w, base_h))

        # 降采样图坐标 → 统一的 mapper 输入坐标
        u = (max_loc[0] + tw_s / 2.0) / t_scale
        v = (max_loc[1] + th_s / 2.0) / t_scale
        cx, cy = mapper(u, v)

        tl = mapper(max_loc[0] / t_scale, max_loc[1] / t_scale)
        br = mapper((max_loc[0] + tw_s) / t_scale, (max_loc[1] + th_s) / t_scale)
        cand = Candidate(
            cx=cx, cy=cy,
            bbox=(int(round(tl[0])), int(round(tl[1])),
                  max(1, int(round(br[0] - tl[0]))), max(1, int(round(br[1] - tl[1])))),
            area=float((br[0] - tl[0]) * (br[1] - tl[1])),
            fill=1.0,
            score=float(max_val),
        )
        target = self._accept(cand, 1, windowed=_is_smaller(win, base_w, base_h))
        target.method = "template"
        target.confidence = float(max_val)
        return target


# ---------------------------------------------------------------- 辅助


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _rect_intersect(a: Optional[Rect], b: Optional[Rect]) -> Optional[Rect]:
    if a is None or b is None:
        return None
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[0] + a[2], b[0] + b[2])
    y1 = min(a[1] + a[3], b[1] + b[3])
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return None
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def _is_smaller(win: Optional[Rect], base_w: int, base_h: int) -> bool:
    if win is None:
        return False
    return win[2] < base_w or win[3] < base_h


class _PlainFrame:
    """给「只有一张图」的旧调用方式用的壳，等价于整幅都是逻辑画面。"""

    def __init__(self, image: np.ndarray) -> None:
        self.image = image
        self.region = (0, 0, int(image.shape[1]), int(image.shape[0]))
        self.base_region = None
        self._base = self.region
        self.base_width = int(image.shape[1])
        self.base_height = int(image.shape[0])
        self.width = int(image.shape[1])
        self.height = int(image.shape[0])

    def image_to_base(self, x: float, y: float) -> Tuple[float, float]:
        return x, y

    def base_to_image(self, x: float, y: float) -> Tuple[float, float]:
        return x, y


def detect_from_frame(detector: TargetDetector, frame) -> Target:
    """方便调用的小包装。"""
    return detector.detect_frame(frame)
