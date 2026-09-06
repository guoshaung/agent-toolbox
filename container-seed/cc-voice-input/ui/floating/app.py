from __future__ import annotations

import sys

from PySide6.QtCore import QObject, QPoint
from PySide6.QtWidgets import QApplication

from .bubble import BubbleWindow
from .floating_window import FloatingWindow
from .state import FloatState
from .tray import FloatingTray
from .voice_pipeline import VoicePipeline


class FloatingApp(QObject):
    def __init__(self) -> None:
        super().__init__()
        self.window = FloatingWindow()
        self.tray = FloatingTray()
        self.bubble = BubbleWindow()
        self.bubble.attach_to(self.window)
        self.pipeline = VoicePipeline(self)

        self.window.right_clicked.connect(self._show_menu_at)
        self.window.left_clicked.connect(self.pipeline.toggle_listening)
        self.window.moved.connect(self._on_window_moved)

        self.tray.toggle_visible_requested.connect(self._toggle_visible)
        self.tray.state_requested.connect(self.window.set_state)
        self.tray.speak_test_requested.connect(self._on_speak_test)
        self.tray.quit_requested.connect(QApplication.instance().quit)

        self.pipeline.listening_started.connect(self._on_listening_started)
        self.pipeline.listening_stopped.connect(self._on_listening_stopped)
        self.pipeline.partial.connect(self._on_partial)
        self.pipeline.final.connect(self._on_final)
        self.pipeline.speaking_started.connect(self._on_speaking_started)
        self.pipeline.speaking_finished.connect(self._on_speaking_finished)
        self.pipeline.error.connect(self._on_error)

        QApplication.instance().aboutToQuit.connect(self.pipeline.shutdown)

    def start(self) -> None:
        self.window.show()
        self.tray.show()

    def _show_menu_at(self, pos: QPoint) -> None:
        self.tray._menu.exec(pos)

    def _toggle_visible(self) -> None:
        visible = not self.window.isVisible()
        self.window.setVisible(visible)
        if not visible:
            self.bubble.dismiss()

    def _on_window_moved(self) -> None:
        if self.bubble.isVisible():
            self.bubble._reposition()

    def _on_listening_started(self) -> None:
        self.window.set_state(FloatState.LISTENING)
        self.bubble.show_text("我在听…", "listening", auto_hide_ms=None)

    def _on_listening_stopped(self) -> None:
        if not self.pipeline.is_speaking():
            self.window.set_state(FloatState.IDLE)

    def _on_partial(self, text: str) -> None:
        if text:
            self.bubble.show_text(text, "listening", auto_hide_ms=None)

    def _on_final(self, text: str) -> None:
        if text:
            self.bubble.show_text(text, "final", auto_hide_ms=None)
        else:
            self.bubble.dismiss()

    def _on_speaking_started(self) -> None:
        self.window.set_state(FloatState.SPEAKING)

    def _on_speaking_finished(self) -> None:
        self.window.set_state(FloatState.IDLE)
        self.bubble.dismiss()

    def _on_error(self, msg: str) -> None:
        self.window.set_state(FloatState.IDLE)
        self.bubble.show_text(msg, "error", auto_hide_ms=4000)

    def _on_speak_test(self) -> None:
        self.pipeline.speak("你好呀，这是一次测试，来看看声音干不干净。")


def main() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    floating = FloatingApp()
    floating.start()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
