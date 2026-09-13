from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QPoint, QPointF, QRectF, QSize, QTimer, Signal
from PySide6.QtGui import (
    QPainter, QPen, QPixmap, QColor, QMouseEvent, QPaintEvent, QPainterPath,
    QGuiApplication,
)
from PySide6.QtWidgets import QWidget

from .state import FloatState


SIZE = 120
ICON_SIZE = 68
SNAP_DIST = 30
POS_FILE = Path(__file__).resolve().parents[2] / "resources" / "floating_pos.json"
RESOURCE_DIR = Path(__file__).resolve().parents[2] / "resources"
ICON_FILES = (RESOURCE_DIR / "xiaozhi.png", RESOURCE_DIR / "icon.png", RESOURCE_DIR / "icon_tray.png")


class FloatingWindow(QWidget):
    left_clicked = Signal()
    right_clicked = Signal(QPoint)
    double_clicked = Signal()
    moved = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(
            parent,
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.NoDropShadowWindowHint,
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setFixedSize(SIZE, SIZE)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        self._state = FloatState.IDLE
        self._pixmap = QPixmap()
        for icon_file in ICON_FILES:
            if icon_file.exists():
                candidate = QPixmap(str(icon_file))
                if not candidate.isNull():
                    self._pixmap = candidate
                    break
        self._drag_offset: QPoint | None = None
        self._moved = False

        self._wave_phase = 0.0
        self._wave_timer = QTimer(self)
        self._wave_timer.setInterval(66)
        self._wave_timer.timeout.connect(self._advance_wave)

        self._restore_position()
        self._no_activate_applied = False

    def showEvent(self, event) -> None:
        super().showEvent(event)
        # WA_ShowWithoutActivating only covers *showing* the window; on Windows a
        # mouse click still activates it and steals focus from the target app,
        # so the pasted text would land nowhere. WS_EX_NOACTIVATE fixes that.
        if sys.platform == "win32" and not self._no_activate_applied:
            self._no_activate_applied = True
            import ctypes

            GWL_EXSTYLE = -20
            WS_EX_NOACTIVATE = 0x08000000
            user32 = ctypes.WinDLL("user32")
            hwnd = int(self.winId())
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE)

    def _advance_wave(self) -> None:
        self._wave_phase = (self._wave_phase + 0.06) % 1.0
        self.update()

    def set_state(self, state: FloatState) -> None:
        if state is self._state:
            return
        self._state = state
        self.setToolTip(state.label)
        if state is FloatState.LISTENING:
            if not self._wave_timer.isActive():
                self._wave_timer.start()
        else:
            self._wave_timer.stop()
            self._wave_phase = 0.0
        self.update()

    def state(self) -> FloatState:
        return self._state

    def paintEvent(self, event: QPaintEvent) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = QRectF(self.rect())
        center = rect.center()
        outer_r = rect.width() / 2
        icon_r = ICON_SIZE / 2
        halo_color = QColor(self._state.halo)

        if self._state is FloatState.LISTENING:
            travel = outer_r - icon_r - 2
            for i in range(3):
                p = (self._wave_phase + i / 3.0) % 1.0
                radius = icon_r + 2 + p * travel
                alpha = int(200 * (1.0 - p))
                pen_color = QColor(halo_color.red(), halo_color.green(), halo_color.blue(), alpha)
                painter.setPen(QPen(pen_color, 2))
                painter.setBrush(Qt.BrushStyle.NoBrush)
                painter.drawEllipse(QPointF(center), radius, radius)
        else:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(halo_color)
            painter.drawEllipse(QPointF(center), icon_r + 3, icon_r + 3)

        icon_rect = QRectF(
            center.x() - icon_r, center.y() - icon_r,
            icon_r * 2, icon_r * 2,
        )
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(255, 255, 255, 240))
        painter.drawEllipse(icon_rect)

        if not self._pixmap.isNull():
            path = QPainterPath()
            path.addEllipse(icon_rect)
            painter.setClipPath(path)
            scaled = self._pixmap.scaled(
                QSize(int(icon_rect.width()), int(icon_rect.height())),
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            target = QRectF(
                icon_rect.center().x() - scaled.width() / 2,
                icon_rect.center().y() - scaled.height() / 2,
                scaled.width(),
                scaled.height(),
            )
            painter.drawPixmap(target.topLeft(), scaled)
            painter.setClipping(False)
        else:
            painter.setBrush(QColor(220, 220, 220))
            painter.drawEllipse(icon_rect)

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            self._moved = False
            event.accept()
        elif event.button() == Qt.MouseButton.RightButton:
            self.right_clicked.emit(event.globalPosition().toPoint())
            event.accept()

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._drag_offset is None:
            return
        new_pos = event.globalPosition().toPoint() - self._drag_offset
        if not self._moved and (new_pos - self.pos()).manhattanLength() > 3:
            self._moved = True
        self.move(new_pos)
        self.moved.emit()
        event.accept()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton and self._drag_offset is not None:
            self._drag_offset = None
            if self._moved:
                self._snap_to_edge()
                self._save_position()
            else:
                self.left_clicked.emit()
            event.accept()

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.double_clicked.emit()
            event.accept()

    def _screen_geometry(self):
        screen = self.screen() or QGuiApplication.primaryScreen()
        return screen.availableGeometry()

    def _snap_to_edge(self) -> None:
        geo = self._screen_geometry()
        x, y = self.x(), self.y()
        x = max(geo.left(), min(x, geo.right() - self.width()))
        y = max(geo.top(), min(y, geo.bottom() - self.height()))
        dl = x - geo.left()
        dr = geo.right() - (x + self.width())
        if dl < SNAP_DIST and dl <= dr:
            x = geo.left()
        elif dr < SNAP_DIST:
            x = geo.right() - self.width()
        self.move(x, y)

    def _save_position(self) -> None:
        try:
            POS_FILE.parent.mkdir(parents=True, exist_ok=True)
            POS_FILE.write_text(json.dumps({"x": self.x(), "y": self.y()}))
        except OSError:
            pass

    def _restore_position(self) -> None:
        geo = self._screen_geometry()
        if POS_FILE.exists():
            try:
                data = json.loads(POS_FILE.read_text())
                x = int(data["x"])
                y = int(data["y"])
                x = max(geo.left(), min(x, geo.right() - self.width()))
                y = max(geo.top(), min(y, geo.bottom() - self.height()))
                self.move(x, y)
                return
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                pass
        self.move(geo.right() - self.width() - 40, geo.bottom() - self.height() - 80)
