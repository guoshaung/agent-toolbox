from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QObject, Signal
from PySide6.QtGui import QIcon, QAction
from PySide6.QtWidgets import QSystemTrayIcon, QMenu

from .state import FloatState


ICON_FILE = Path(__file__).resolve().parents[2] / "resources" / "icon_tray.png"


class FloatingTray(QObject):
    toggle_visible_requested = Signal()
    state_requested = Signal(FloatState)
    speak_test_requested = Signal()
    quit_requested = Signal()

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        icon = QIcon(str(ICON_FILE)) if ICON_FILE.exists() else QIcon()
        self._tray = QSystemTrayIcon(icon, self)
        self._tray.setToolTip("招财猫")

        menu = QMenu()
        self._toggle_action = QAction("显示 / 隐藏浮窗", menu)
        self._toggle_action.triggered.connect(self.toggle_visible_requested.emit)
        menu.addAction(self._toggle_action)

        debug_menu = menu.addMenu("调试：切状态")
        for state in FloatState:
            action = QAction(state.label, debug_menu)
            action.triggered.connect(lambda _=False, s=state: self.state_requested.emit(s))
            debug_menu.addAction(action)

        menu.addSeparator()
        speak_action = QAction("调试：测试 TTS（跳过麦克风）", menu)
        speak_action.triggered.connect(self.speak_test_requested.emit)
        menu.addAction(speak_action)

        menu.addSeparator()
        quit_action = QAction("退出", menu)
        quit_action.triggered.connect(self.quit_requested.emit)
        menu.addAction(quit_action)

        self._menu = menu
        self._tray.setContextMenu(menu)
        self._tray.activated.connect(self._on_activated)

    def _on_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.toggle_visible_requested.emit()

    def show(self) -> None:
        self._tray.show()

    def hide(self) -> None:
        self._tray.hide()
