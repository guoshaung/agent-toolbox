import sys
from pathlib import Path

import httpx
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    BodyLabel,
    FluentStyleSheet,
    InfoBar,
    InfoBarPosition,
    LineEdit,
    PrimaryPushButton,
    ProgressBar,
    PushButton,
    StrongBodyLabel,
)

from ui.wechat_login_client import WeChatLoginClient
from ui.worker import Worker


class WeChatLoginInterface(QWidget):
    open_agent_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        FluentStyleSheet.SETTING_CARD.apply(self)
        self.setObjectName("wechatLoginInterface")

        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        data_path = base / "resources" / "wechat_config.json"
        self.client = WeChatLoginClient(data_path)

        self._worker: Worker | None = None
        self._qr_url = ""
        self._polling = False
        self._online = False
        self._backend_alive = False

        self._timer = QTimer(self)
        self._timer.setInterval(3000)
        self._timer.timeout.connect(self._poll_status)
        QApplication.instance().aboutToQuit.connect(self._stop_worker)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(14)

        title = QLabel("微信登录")
        title.setStyleSheet("font-size: 26px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = BodyLabel("创建设备、扫码登录，并保存当前微信账号状态。")
        subtitle.setStyleSheet("color: #777;")
        layout.addWidget(subtitle)

        self.device_group = QLabel("设备")
        self.device_group.setStyleSheet("font-size: 16px; font-weight: 600; margin-top: 4px;")
        layout.addWidget(self.device_group)

        form_widget = QWidget()
        form_widget.setMaximumWidth(520)
        form_widget.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        form = QFormLayout(form_widget)
        form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)
        form.setSpacing(10)
        form.setLabelAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        form.setRowWrapPolicy(QFormLayout.DontWrapRows)

        self.key_edit = LineEdit()
        self.key_edit.setReadOnly(True)
        self.key_edit.setPlaceholderText("点击“创建设备”生成")
        self.proxy_edit = LineEdit()
        self.proxy_edit.setPlaceholderText("可选，例如 socks5://user:pass@127.0.0.1:7890")
        self.status_label = StrongBodyLabel("未创建设备")
        self.profile_label = BodyLabel("未登录")
        self.message_label = BodyLabel("请先创建设备。")

        form.addRow("设备 Key", self.key_edit)
        form.addRow("登录代理", self.proxy_edit)
        form.addRow("状态", self.status_label)
        form.addRow("账号", self.profile_label)
        form.addRow("提示", self.message_label)
        layout.addWidget(form_widget, 0, Qt.AlignLeft)

        self.progress = ProgressBar()
        self.progress.hide()
        layout.addWidget(self.progress)

        btn_layout = QHBoxLayout()
        self.create_device_btn = PrimaryPushButton("创建设备")
        self.create_device_btn.setFixedWidth(120)
        self.create_device_btn.clicked.connect(self._create_device)
        self.qr_btn = PushButton("获取二维码")
        self.qr_btn.setFixedWidth(120)
        self.qr_btn.clicked.connect(self._show_qr)
        self.check_btn = PushButton("检查状态")
        self.check_btn.setFixedWidth(120)
        self.check_btn.clicked.connect(self._check_status)
        self.logout_btn = PushButton("退出微信")
        self.logout_btn.setFixedWidth(120)
        self.logout_btn.clicked.connect(self._logout)
        self.launch_agent_btn = PrimaryPushButton("去启动核心代理")
        self.launch_agent_btn.setFixedWidth(160)
        self.launch_agent_btn.clicked.connect(self.open_agent_requested)
        self.launch_agent_btn.hide()

        btn_layout.addWidget(self.create_device_btn)
        btn_layout.addWidget(self.qr_btn)
        btn_layout.addWidget(self.check_btn)
        btn_layout.addWidget(self.logout_btn)
        btn_layout.addWidget(self.launch_agent_btn)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        qr_layout = QHBoxLayout()
        self.qr_label = QLabel("扫码后会持续检查登录状态")
        self.qr_label.setAlignment(Qt.AlignCenter)
        self.qr_label.setFixedSize(260, 260)
        self.qr_label.setStyleSheet("border: 1px dashed #ddd; border-radius: 12px; color: #888;")
        qr_layout.addWidget(self.qr_label)
        qr_layout.addStretch()
        layout.addLayout(qr_layout)
        layout.addStretch(1)

        self._load()

    def _load(self):
        data = self.client.load()
        self.key_edit.setText(data.get("wx_key") or "")
        self.proxy_edit.setText(data.get("proxy") or "")
        profile = data.get("profile") or {}
        self._set_profile(profile.get("nickname", ""), profile.get("wxid", ""))
        self._stop_polling()
        self._refresh_state()
        if self.key_edit.text().strip():
            self._check_status()

    def _set_busy(self, busy: bool):
        self.progress.setVisible(busy)
        self.create_device_btn.setEnabled(not busy and not bool(self.key_edit.text().strip()))
        self.qr_btn.setEnabled(not busy)
        self.check_btn.setEnabled(not busy)
        self.logout_btn.setEnabled(not busy)

    def _run(self, action: str, fn, busy: bool = True):
        if self._worker and self._worker.isRunning():
            return
        if busy:
            self._set_busy(True)
        worker = Worker(action, fn, self)
        self._worker = worker
        worker.finished.connect(self._handle_finished)
        worker.finished.connect(lambda: self._clear_worker(worker))
        worker.start()

    def _clear_worker(self, worker: Worker | None):
        if worker and worker.isFinished():
            worker.deleteLater()
        if self._worker is worker:
            self._worker = None

    def _create_device(self):
        if not self._guard_alive():
            return
        self._stop_polling()
        proxy = self.proxy_edit.text().strip()
        self._run("create_device", lambda: self.client.create_device(proxy))

    def _show_qr(self):
        if not self._guard_alive():
            return
        self._stop_polling()
        self._run("qrcode", self.client.qrcode)

    def _check_status(self):
        if not self._guard_alive():
            return
        self._run("status", self.client.status, busy=not self._polling)

    def _poll_status(self):
        if not self._guard_alive():
            return
        self._run("status", self.client.status, busy=False)

    def _logout(self):
        if not self._guard_alive():
            return
        self._stop_polling()
        self._run("logout", self.client.logout)

    def showEvent(self, event):
        super().showEvent(event)
        self._probe_backend()

    def refresh_backend(self):
        self._probe_backend()

    def _probe_backend(self) -> bool:
        alive = self.client.is_alive()
        was_alive = self._backend_alive
        self._backend_alive = alive
        if alive != was_alive:
            self._refresh_state()
            if alive and self.key_edit.text().strip():
                self._check_status()
        return alive

    def _guard_alive(self) -> bool:
        if self._probe_backend():
            return True
        self._stop_polling()
        return False

    def _handle_finished(self, action: str, ok: bool, payload: object, error: str):
        self._set_busy(False)
        if not ok:
            self.message_label.setText(error or "操作失败")
            self._show_info("操作失败", error, success=False)
            return

        if action == "create_device":
            _, wx_key = payload
            self._stop_polling()
            self._qr_url = ""
            self._online = False
            self._show_qr_placeholder()
            self._load()
            self.message_label.setText("设备创建成功，请获取二维码登录。")
            self._show_info("创建成功", f"设备 Key: {wx_key}")
            return

        if action == "qrcode":
            _, qr_url = payload
            self._qr_url = qr_url
            self._show_qr_image(qr_url)
            self.message_label.setText("二维码已获取，请使用要托管的微信扫码。")
            self._start_polling()
            return

        if action == "status":
            _, online, state, status_error = payload
            self._online = online
            if online:
                self._stop_polling()
                self.status_label.setText("在线")
                self.status_label.setStyleSheet("color: #27a56a;")
                profile_ok, profile, profile_error = self.client.profile()
                if profile_ok:
                    self._set_profile(profile.get("nickname", ""), profile.get("wxid", ""))
                    self.message_label.setText("微信已在线。")
                else:
                    self.profile_label.setText(profile_error or "获取资料失败")
                    self.message_label.setText("微信已在线，但获取账号资料失败。")
            else:
                self.status_label.setText("离线")
                self.status_label.setStyleSheet("color: #888;")
                if self._polling:
                    self.message_label.setText(f"等待扫码登录中，当前状态码：{state}。")
                else:
                    self.message_label.setText(f"未登录，状态码：{state}。")
            if status_error and not self._polling:
                self.message_label.setText(status_error)
            self._refresh_state()
            return

        if action == "logout":
            self._qr_url = ""
            self._online = False
            self._show_qr_placeholder()
            self._set_profile("", "")
            self.status_label.setText("离线")
            self.status_label.setStyleSheet("color: #888;")
            self.message_label.setText(str(payload or "已退出微信。"))
            self._refresh_state()
            self._show_info("已退出", str(payload or "已退出微信"))

    def _show_qr_image(self, qr_url: str):
        try:
            with httpx.Client(timeout=30, follow_redirects=True) as client:
                response = client.get(qr_url)
                response.raise_for_status()
            pixmap = QPixmap()
            pixmap.loadFromData(response.content)
            if pixmap.isNull():
                content_type = response.headers.get("content-type", "")
                raise RuntimeError(f"二维码地址返回的不是有效图片: {content_type}")
            self.qr_label.setPixmap(pixmap.scaled(240, 240, Qt.KeepAspectRatio, Qt.SmoothTransformation))
            self.qr_label.setText("")
        except Exception as exc:
            self._show_qr_placeholder()
            self.message_label.setText(f"二维码加载失败：{exc}")
            self._show_info("二维码加载失败", str(exc), success=False)

    def _stop_worker(self):
        self._stop_polling()
        if self._worker and self._worker.isRunning():
            self._worker.finished.disconnect(self._handle_finished)
            self._worker.wait(3000)
            self._worker.deleteLater()
        self._worker = None

    def _show_qr_placeholder(self):
        self.qr_label.clear()
        self.qr_label.setText("扫码后会持续检查登录状态")
        self.qr_label.setStyleSheet("border: 1px dashed #ddd; border-radius: 12px; color: #888;")

    def _start_polling(self):
        self._polling = True
        self._timer.start()

    def _stop_polling(self):
        self._polling = False
        self._timer.stop()

    def _refresh_state(self):
        has_key = bool(self.key_edit.text().strip())
        worker_busy = bool(self._worker and self._worker.isRunning())
        alive = self._backend_alive

        self.launch_agent_btn.setVisible(not alive)
        self.create_device_btn.setEnabled(alive and not worker_busy and not has_key)
        self.qr_btn.setEnabled(alive and not worker_busy and has_key and not self._online)
        self.check_btn.setEnabled(alive and not worker_busy and has_key and not self._online)
        self.logout_btn.setEnabled(alive and not worker_busy and self._online)
        self.proxy_edit.setEnabled(alive and not worker_busy and has_key and not self._online)

        if not alive:
            self.status_label.setText("核心代理未启动")
            self.status_label.setStyleSheet("color: #d9534f;")
            self.message_label.setText("请先启动核心代理，登录才能进行。")
            self._show_qr_placeholder()
            return

        if not has_key:
            self.status_label.setText("未创建设备")
            self.status_label.setStyleSheet("color: #888;")
            self.profile_label.setText("未登录")
            self.message_label.setText("请先创建设备。")
            self._show_qr_placeholder()
            return

        if self._online:
            self.status_label.setText("在线")
            self.status_label.setStyleSheet("color: #27a56a;")
            self.message_label.setText("微信已在线。")
            return

        self.status_label.setText("离线")
        self.status_label.setStyleSheet("color: #888;")

        if not self.message_label.text():
            self.message_label.setText("设备已创建，获取二维码后扫码登录。")

    def _set_profile(self, nickname: str, wxid: str):
        if nickname and wxid:
            self.profile_label.setText(f"{nickname} · {wxid}")
        elif nickname:
            self.profile_label.setText(nickname)
        else:
            self.profile_label.setText("未登录")

    def _show_info(self, title: str, content: str, success: bool = True):
        if success:
            InfoBar.success(
                title=title,
                content=content,
                orient=Qt.Horizontal,
                parent=self,
                position=InfoBarPosition.TOP_RIGHT,
                duration=2500,
            )
        else:
            InfoBar.error(
                title=title,
                content=content,
                orient=Qt.Horizontal,
                parent=self,
                position=InfoBarPosition.TOP_RIGHT,
                duration=2500,
            )
