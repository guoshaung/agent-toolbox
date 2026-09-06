import json
import platform
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QFrame, QApplication,
)
from qfluentwidgets import (
    PrimaryPushButton, PushButton, LineEdit, TextEdit,
    OptionsSettingCard, InfoBar, InfoBarPosition,
    FluentStyleSheet,
)

from ui.process_runner import ProcessRunner


def _get_stay_binary() -> str | None:
    system = platform.system().lower()
    machine = platform.machine().lower()

    os_map = {"darwin": "darwin", "linux": "linux", "windows": "windows"}
    arch_map = {"arm64": "arm64", "aarch64": "arm64", "amd64": "amd64", "x86_64": "amd64"}

    os_name = os_map.get(system)
    arch_name = arch_map.get(machine)
    if not os_name or not arch_name:
        return None

    ext = ".exe" if os_name == "windows" else ""
    return f"stay-{os_name}-{arch_name}{ext}"


def _settings_path() -> Path:
    base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
    return base / "resources" / "wechat" / "assets" / "setting.json"


def _load_settings() -> dict:
    with open(_settings_path(), "r") as f:
        return json.load(f)


def _save_settings(data: dict):
    with open(_settings_path(), "w") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


class AgentInterface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        FluentStyleSheet.SETTING_CARD.apply(self)

        self.setObjectName("agentInterface")
        self._settings_group_enabled = True
        self._runner = ProcessRunner(self)
        self._runner.output.connect(self._on_output)
        self._runner.error.connect(self._on_error)
        self._runner.finished.connect(self._on_finished)
        QApplication.instance().aboutToQuit.connect(self._runner.stop)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(14)

        title = QLabel("核心代理")
        title.setStyleSheet("font-size: 26px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = QLabel("启动、停止核心代理，并查看实时日志。")
        subtitle.setStyleSheet("color: #777;")
        layout.addWidget(subtitle)

        btn_layout = QHBoxLayout()
        self.start_btn = PrimaryPushButton("启动")
        self.start_btn.setFixedWidth(110)
        self.start_btn.clicked.connect(self._start)
        self.stop_btn = PushButton("停止")
        self.stop_btn.setFixedWidth(110)
        self.stop_btn.clicked.connect(self._stop)
        self.stop_btn.setEnabled(False)
        self.save_btn = PrimaryPushButton("保存")
        self.save_btn.setFixedWidth(110)
        self.save_btn.clicked.connect(self._save)

        btn_layout.addWidget(self.start_btn)
        btn_layout.addWidget(self.stop_btn)
        btn_layout.addWidget(self.save_btn)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        group = QLabel("配置")
        group.setStyleSheet("font-size: 16px; font-weight: 600; margin-top: 4px;")
        layout.addWidget(group)

        form_widget = QWidget()
        form_widget.setMaximumWidth(520)
        form = QFormLayout(form_widget)
        form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)
        form.setSpacing(10)
        form.setLabelAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        form.setRowWrapPolicy(QFormLayout.DontWrapRows)

        self.port_edit = LineEdit()
        self.redis_host = LineEdit()
        self.redis_port = LineEdit()
        self.redis_pass = LineEdit()
        self.redis_pass.setEchoMode(LineEdit.Password)

        form.addRow("端口", self.port_edit)
        form.addRow("Redis 地址", self.redis_host)
        form.addRow("Redis 端口", self.redis_port)
        form.addRow("Redis 密码", self.redis_pass)
        layout.addWidget(form_widget)

        log_title = QLabel("日志")
        log_title.setStyleSheet("font-size: 16px; font-weight: 600; margin-top: 4px;")
        layout.addWidget(log_title)

        self.log = TextEdit()
        self.log.setReadOnly(True)
        self.log.setStyleSheet("font-family: Menlo, Consolas, monospace; font-size: 12px;")
        layout.addWidget(self.log)

        self._load()

    def _load(self):
        cfg = _load_settings()
        self.port_edit.setText(cfg.get("port", ""))
        redis = cfg.get("redisConfig", {})
        self.redis_host.setText(redis.get("Host", ""))
        self.redis_port.setText(str(redis.get("Port", "")))
        self.redis_pass.setText(redis.get("Pass", ""))

    def _save(self):
        cfg = _load_settings()
        cfg["port"] = self.port_edit.text().strip()
        cfg["redisConfig"]["Host"] = self.redis_host.text().strip()
        try:
            cfg["redisConfig"]["Port"] = int(self.redis_port.text().strip())
        except ValueError:
            cfg["redisConfig"]["Port"] = 0
        cfg["redisConfig"]["Pass"] = self.redis_pass.text().strip()

        _save_settings(cfg)
        InfoBar.success(
            title="已保存",
            content="重启核心代理后生效",
            orient=Qt.Horizontal,
            parent=self,
            position=InfoBarPosition.TOP_RIGHT,
        )

    def _set_running(self, running: bool):
        self.start_btn.setEnabled(not running)
        self.stop_btn.setEnabled(running)
        self.save_btn.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        self.redis_host.setEnabled(not running)
        self.redis_port.setEnabled(not running)
        self.redis_pass.setEnabled(not running)

    def _start(self):
        binary = _get_stay_binary()
        if binary is None:
            self.log.append("[错误] 不支持的系统架构")
            return

        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        cmd = str(base / "resources" / "wechat" / binary)

        if not Path(cmd).exists():
            self.log.append(f"[错误] 找不到文件: {cmd}")
            return

        cwd = str(base / "resources" / "wechat")
        self.log.append(f"[启动核心代理] {binary}")
        self._runner.start([cmd], cwd=cwd)
        self._set_running(True)

    def _stop(self):
        self.log.append("[停止核心代理...]")
        self._runner.stop()

    def _on_output(self, text):
        self.log.append(text.strip())

    def _on_error(self, text):
        self.log.append(f"[错误] {text.strip()}")

    def _on_finished(self, exit_code):
        self.log.append(f"[已停止，退出码: {exit_code}]")
        self._set_running(False)
