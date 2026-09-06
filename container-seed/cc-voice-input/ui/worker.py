from PySide6.QtCore import QThread, Signal


class Worker(QThread):
    finished = Signal(str, bool, object, str)

    def __init__(self, action: str, fn, parent=None):
        super().__init__(parent)
        self.action = action
        self.fn = fn
        self.finished.connect(self._cleanup)

    def _cleanup(self):
        self.deleteLater()

    def run(self):
        try:
            payload = self.fn()
        except Exception as exc:
            self.finished.emit(self.action, False, None, str(exc))
        else:
            self.finished.emit(self.action, True, payload, "")
