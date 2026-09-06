from PySide6.QtCore import QProcess, Signal, QObject


class ProcessRunner(QObject):
    """非阻塞进程管理，与 Qt 事件循环集成"""

    output = Signal(str)
    error = Signal(str)
    finished = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._proc: QProcess | None = None

    def start(self, cmd: str | list[str], args: list[str] | None = None, cwd: str | None = None):
        self._proc = QProcess(self)
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_finished)

        if cwd:
            self._proc.setWorkingDirectory(cwd)

        if isinstance(cmd, list):
            self._proc.start(cmd[0], cmd[1:])
        elif args:
            self._proc.start(cmd, args)
        else:
            self._proc.start(cmd)

    def _on_stdout(self):
        data = self._proc.readAllStandardOutput().data().decode(errors="replace")
        self.output.emit(data)

    def _on_stderr(self):
        data = self._proc.readAllStandardError().data().decode(errors="replace")
        self.error.emit(data)

    def _on_finished(self, exit_code):
        self.finished.emit(exit_code)

    def stop(self):
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.terminate()
            if not self._proc.waitForFinished(3000):
                self._proc.kill()
