import sys
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QTableWidgetItem,
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
    StrongBodyLabel,
    TableWidget,
)

from ui.wechat_login_client import WeChatLoginClient
from ui.worker import Worker


def _classify(wxid: str) -> str:
    if wxid.endswith("@chatroom"):
        return "群聊"
    if wxid.startswith("gh_"):
        return "公众号"
    return "好友"


class ContactsInterface(QWidget):
    open_agent_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        FluentStyleSheet.SETTING_CARD.apply(self)
        self.setObjectName("contactsInterface")

        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        data_path = base / "resources" / "wechat_config.json"
        self.client = WeChatLoginClient(data_path)

        self._worker: Worker | None = None
        self._contacts: list[dict] = []
        self._search = ""

        QApplication.instance().aboutToQuit.connect(self._stop_worker)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(14)

        title = QLabel("通讯录")
        title.setStyleSheet("font-size: 26px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = BodyLabel("同步并查看当前微信的联系人、群聊和公众号。")
        subtitle.setStyleSheet("color: #777;")
        layout.addWidget(subtitle)

        top = QHBoxLayout()
        top.setSpacing(10)
        self.sync_btn = PrimaryPushButton("同步通讯录")
        self.sync_btn.setFixedWidth(140)
        self.sync_btn.clicked.connect(self._sync)
        self.count_label = StrongBodyLabel("共 0 条")
        self.message_label = BodyLabel("")
        self.message_label.setStyleSheet("color: #888;")
        self.search_edit = LineEdit()
        self.search_edit.setPlaceholderText("搜索昵称、备注或 wxid")
        self.search_edit.setMaximumWidth(320)
        self.search_edit.textChanged.connect(self._on_search_changed)

        top.addWidget(self.sync_btn)
        top.addWidget(self.count_label)
        top.addWidget(self.message_label)
        top.addStretch()
        top.addWidget(self.search_edit)
        layout.addLayout(top)

        self.progress = ProgressBar()
        self.progress.hide()
        layout.addWidget(self.progress)

        self.table = TableWidget()
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(["昵称", "备注", "wxid", "类型"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(TableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(TableWidget.SelectRows)
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        layout.addWidget(self.table)

        self._load_cached()

    def _load_cached(self):
        self._contacts = self.client.load_contacts()
        self._refresh_table()

    def _sync(self):
        if self._worker and self._worker.isRunning():
            return
        if not self.client.is_alive():
            self.message_label.setText("核心代理未启动")
            self._show_info("同步失败", "核心代理未启动，请先启动核心代理。", success=False)
            return
        cfg = self.client.load()
        if not (cfg.get("wx_key") or "").strip():
            self.message_label.setText("尚未创建设备")
            self._show_info("同步失败", "请先在\"微信登录\"页创建设备并登录。", success=False)
            return
        self._set_busy(True)
        self.message_label.setText("正在同步…")
        worker = Worker("sync", self.client.sync_contacts, self)
        self._worker = worker
        worker.finished.connect(self._handle_finished)
        worker.finished.connect(lambda: self._clear_worker(worker))
        worker.start()

    def _handle_finished(self, action, ok, payload, error):
        self._set_busy(False)
        if not ok:
            self.message_label.setText(error or "同步失败")
            self._show_info("同步失败", error, success=False)
            return
        _ok, count, err = payload
        if not _ok:
            self.message_label.setText(err or "同步失败")
            self._show_info("同步失败", err, success=False)
            return
        self._contacts = self.client.load_contacts()
        self._refresh_table()
        self.message_label.setText(f"已同步 {count} 条")
        self._show_info("同步成功", f"共 {count} 条联系人")

    def _clear_worker(self, worker):
        if worker and worker.isFinished():
            worker.deleteLater()
        if self._worker is worker:
            self._worker = None

    def _stop_worker(self):
        if self._worker and self._worker.isRunning():
            try:
                self._worker.finished.disconnect(self._handle_finished)
            except (RuntimeError, TypeError):
                pass
            self._worker.wait(3000)
            self._worker.deleteLater()
        self._worker = None

    def _set_busy(self, busy: bool):
        self.progress.setVisible(busy)
        self.sync_btn.setEnabled(not busy)
        self.search_edit.setEnabled(not busy)

    def _on_search_changed(self, text: str):
        self._search = text.strip().lower()
        self._refresh_table()

    def _filtered(self) -> list[dict]:
        if not self._search:
            return list(self._contacts)
        out = []
        for c in self._contacts:
            hay = " ".join([
                c.get("nickname", ""),
                c.get("remark", ""),
                c.get("wxid", ""),
            ]).lower()
            if self._search in hay:
                out.append(c)
        return out

    def _refresh_table(self):
        filtered = self._filtered()
        self.table.setRowCount(len(filtered))
        for i, c in enumerate(filtered):
            self.table.setItem(i, 0, QTableWidgetItem(c.get("nickname", "")))
            self.table.setItem(i, 1, QTableWidgetItem(c.get("remark", "")))
            self.table.setItem(i, 2, QTableWidgetItem(c.get("wxid", "")))
            self.table.setItem(i, 3, QTableWidgetItem(_classify(c.get("wxid", ""))))
        total = len(self._contacts)
        shown = len(filtered)
        if self._search:
            self.count_label.setText(f"匹配 {shown} / 共 {total} 条")
        else:
            self.count_label.setText(f"共 {total} 条")

    def _show_info(self, title: str, content: str, success: bool = True):
        if success:
            InfoBar.success(
                title=title, content=content, orient=Qt.Horizontal,
                parent=self, position=InfoBarPosition.TOP_RIGHT, duration=2500,
            )
        else:
            InfoBar.error(
                title=title, content=content, orient=Qt.Horizontal,
                parent=self, position=InfoBarPosition.TOP_RIGHT, duration=3000,
            )
