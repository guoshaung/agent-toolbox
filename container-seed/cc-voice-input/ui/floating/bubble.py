from __future__ import annotations

from PySide6.QtCore import (
    QEasingCurve,
    QPoint,
    QPropertyAnimation,
    QTimer,
    Qt,
)
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QApplication, QLabel, QVBoxLayout, QWidget


BUBBLE_STYLES = {
    "listening": {"bg": "rgba(38, 132, 255, 235)", "fg": "#ffffff"},
    "final":     {"bg": "rgba(30, 30, 30, 230)", "fg": "#ffffff"},
    "speaking":  {"bg": "rgba(46, 174, 106, 235)", "fg": "#ffffff"},
    "error":     {"bg": "rgba(215, 71, 71, 235)", "fg": "#ffffff"},
}

MAX_WIDTH = 320
GAP = 12


class BubbleWindow(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(
            parent,
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.WindowDoesNotAcceptFocus,
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)

        self.label = QLabel(self)
        self.label.setWordWrap(True)
        self.label.setMaximumWidth(MAX_WIDTH)
        self.label.setContentsMargins(14, 10, 14, 10)
        self.label.setTextInteractionFlags(Qt.NoTextInteraction)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.label)

        self._anchor: QWidget | None = None
        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self._start_fade)

        self._fade = QPropertyAnimation(self, b"windowOpacity", self)
        self._fade.setDuration(250)
        self._fade.setEasingCurve(QEasingCurve.OutCubic)
        self._fade.finished.connect(self._on_fade_finished)

        self._apply_style("final")
        self.hide()

    def attach_to(self, anchor: QWidget) -> None:
        self._anchor = anchor

    def show_text(
        self,
        text: str,
        kind: str = "final",
        auto_hide_ms: int | None = 3500,
    ) -> None:
        if not text:
            return
        self._fade.stop()
        self._hide_timer.stop()
        self._apply_style(kind)
        self.label.setText(text)
        self.label.adjustSize()
        self.adjustSize()
        self._reposition()
        self.setWindowOpacity(1.0)
        self.show()
        self.raise_()
        if auto_hide_ms and auto_hide_ms > 0:
            self._hide_timer.start(auto_hide_ms)

    def dismiss(self) -> None:
        self._hide_timer.stop()
        self._start_fade()

    def cancel_auto_hide(self) -> None:
        self._hide_timer.stop()

    def _apply_style(self, kind: str) -> None:
        style = BUBBLE_STYLES.get(kind, BUBBLE_STYLES["final"])
        self.label.setStyleSheet(
            f"background-color: {style['bg']};"
            f"color: {style['fg']};"
            "border-radius: 14px;"
            "font-size: 14px;"
            "font-weight: 500;"
        )

    def _reposition(self) -> None:
        if self._anchor is None:
            return
        anchor_geo = self._anchor.frameGeometry()
        screen = QGuiApplication.screenAt(anchor_geo.center()) or QApplication.primaryScreen()
        screen_geo = screen.availableGeometry()
        size = self.size()

        x = anchor_geo.center().x() - size.width() // 2
        y = anchor_geo.top() - size.height() - GAP
        if y < screen_geo.top() + 4:
            y = anchor_geo.bottom() + GAP
        x = max(screen_geo.left() + 4, min(x, screen_geo.right() - size.width() - 4))
        self.move(QPoint(x, y))

    def _start_fade(self) -> None:
        if not self.isVisible():
            return
        self._fade.stop()
        self._fade.setStartValue(self.windowOpacity())
        self._fade.setEndValue(0.0)
        self._fade.start()

    def _on_fade_finished(self) -> None:
        if self.windowOpacity() <= 0.01:
            self.hide()
            self.setWindowOpacity(1.0)
