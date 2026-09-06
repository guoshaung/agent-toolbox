import sys
import time
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QSplitter,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    BodyLabel,
    FluentStyleSheet,
    InfoBar,
    InfoBarPosition,
    PrimaryPushButton,
    StrongBodyLabel,
)

from ui.message_stream import MessageStream
from ui.wechat_login_client import WeChatLoginClient
from ui.worker import Worker

STATE_STYLES = {
    "connected": ("#27a56a", "已连接"),
    "connecting": ("#f0ad4e", "连接中…"),
    "disconnected": ("#888", "未连接"),
    "error": ("#d9534f", "连接异常"),
}

# 群名 / 群成员的懒拉取 TTL（秒），照抄 wx_bot 的 GROUP_SYNC_TTL
GROUP_INFO_TTL = 600


class MessagesInterface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        FluentStyleSheet.SETTING_CARD.apply(self)
        self.setObjectName("messagesInterface")

        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        data_path = base / "resources" / "wechat_config.json"
        self.client = WeChatLoginClient(data_path)

        self._stream: MessageStream | None = None
        # session 只存原始数据，不 resolve 名字
        self._sessions: dict[str, dict] = {}
        # 好友 / 群名（从 wechat_contacts.json 读进来）
        self._contact_map: dict[str, str] = {}
        # 懒拉取补充：群名 / 群成员（内存）
        self._group_names: dict[str, dict[str, str]] = {}
        self._group_members: dict[str, dict[str, str]] = {}
        # TTL 时间戳：key = ("names", "batch") 或 ("members", chat_key)
        self._fetch_ts: dict[tuple, float] = {}
        self._pending: set[tuple] = set()
        # 追踪懒拉取 worker，退出时统一等一等
        self._active_workers: set[Worker] = set()

        self._current_chat_key = ""
        self._auto_started = False

        QApplication.instance().aboutToQuit.connect(self._stop_everything)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(12)

        title = QLabel("消息")
        title.setStyleSheet("font-size: 26px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = BodyLabel("实时接收微信消息（不落盘）。切换 tab 不断连，退出 App 清零。")
        subtitle.setStyleSheet("color: #777;")
        layout.addWidget(subtitle)

        top = QHBoxLayout()
        top.setSpacing(10)
        self.state_dot = QLabel("●")
        self.state_dot.setStyleSheet("color: #888; font-size: 18px;")
        self.state_label = StrongBodyLabel("未连接")
        self.state_detail = BodyLabel("")
        self.state_detail.setStyleSheet("color: #888;")
        self.connect_btn = PrimaryPushButton("连接")
        self.connect_btn.setFixedWidth(100)
        self.connect_btn.clicked.connect(self._toggle_stream)
        top.addWidget(self.state_dot)
        top.addWidget(self.state_label)
        top.addWidget(self.state_detail)
        top.addStretch()
        top.addWidget(self.connect_btn)
        layout.addLayout(top)

        splitter = QSplitter(Qt.Horizontal)
        self.session_list = QListWidget()
        self.session_list.setMinimumWidth(260)
        self.session_list.currentItemChanged.connect(self._on_session_changed)
        splitter.addWidget(self.session_list)

        right_wrap = QWidget()
        right_layout = QVBoxLayout(right_wrap)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(6)
        self.chat_header = StrongBodyLabel("请从左侧选择一个会话")
        self.chat_header.setStyleSheet("padding: 4px 8px; color: #444;")
        right_layout.addWidget(self.chat_header)
        self.message_list = QListWidget()
        self.message_list.setWordWrap(True)
        right_layout.addWidget(self.message_list)
        splitter.addWidget(right_wrap)

        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 3)
        layout.addWidget(splitter)

        self._reload_contact_map()

    def showEvent(self, event):
        super().showEvent(event)
        self._reload_contact_map()
        # 联系人可能刚同步了群名，会话列表/详情视图刷一遍显示
        if self._sessions:
            self._refresh_session_list()
            if self._current_chat_key:
                self._render_current_session()
        if not self._auto_started:
            self._auto_started = True
            self._try_start()

    def _reload_contact_map(self):
        self._contact_map.clear()
        for c in self.client.load_contacts():
            wxid = c.get("wxid", "")
            if not wxid:
                continue
            self._contact_map[wxid] = c.get("remark") or c.get("nickname") or ""

    # ---------- name resolve（渲染时才查） ----------
    def _chat_display_name(self, chat_key: str) -> str:
        name = self._contact_map.get(chat_key) or ""
        if name:
            return name
        cached = self._group_names.get(chat_key)
        if cached and cached.get("name"):
            return cached["name"]
        return chat_key

    def _sender_display_name(self, chat_key: str, sender: str) -> str:
        name = self._contact_map.get(sender) or ""
        if name:
            return name
        members = self._group_members.get(chat_key) or {}
        if members.get(sender):
            return members[sender]
        return sender

    # ---------- 生命周期 ----------
    def _try_start(self):
        if self._stream and self._stream.isRunning():
            return
        if not self.client.is_alive():
            self._show_info("无法连接", "核心代理未启动。", success=False)
            return
        cfg = self.client.load()
        wx_key = (cfg.get("wx_key") or "").strip()
        own_wxid = ((cfg.get("profile") or {}).get("wxid") or "").strip()
        if not wx_key:
            self._show_info("无法连接", "请先在\"微信登录\"页创建设备。", success=False)
            return
        if not own_wxid:
            self._show_info("无法连接", "自身 wxid 未知，请先在\"微信登录\"页扫码登录。", success=False)
            return
        stream = MessageStream(self.client.wx_base, wx_key, own_wxid, self)
        stream.message_received.connect(self._on_message)
        stream.state_changed.connect(self._on_state)
        self._stream = stream
        stream.start()

    def _stop_stream(self):
        stream = self._stream
        if stream and stream.isRunning():
            try:
                stream.message_received.disconnect(self._on_message)
                stream.state_changed.disconnect(self._on_state)
            except (RuntimeError, TypeError):
                pass
            stream.stop()
            stream.wait(3000)
            stream.deleteLater()
        self._stream = None

    def _stop_everything(self):
        self._stop_stream()
        # 等一波懒拉取 worker 干净退出，避免子 QThread 被强析构
        for w in list(self._active_workers):
            if w.isRunning():
                try:
                    w.finished.disconnect()
                except (RuntimeError, TypeError):
                    pass
                w.wait(2000)
        self._active_workers.clear()

    def _toggle_stream(self):
        if self._stream and self._stream.isRunning():
            self._stop_stream()
            self._on_state("disconnected", "")
        else:
            self._try_start()

    # ---------- 事件处理 ----------
    def _on_state(self, state: str, detail: str):
        color, label = STATE_STYLES.get(state, ("#888", state))
        self.state_dot.setStyleSheet(f"color: {color}; font-size: 18px;")
        self.state_label.setText(label)
        self.state_detail.setText(detail)
        self.connect_btn.setText("断开" if state in ("connected", "connecting") else "连接")

    def _on_message(self, parsed: dict):
        chat_key = parsed["chat_key"]
        sess = self._sessions.get(chat_key)
        if not sess:
            sess = {
                "chat_key": chat_key,
                "is_group": bool(parsed.get("is_group")),
                "last_ts": 0.0,
                "messages": [],
            }
            self._sessions[chat_key] = sess

        ts = float(parsed.get("ts") or time.time())
        sess["last_ts"] = ts
        sess["messages"].append({
            "ts": ts,
            "sender": parsed["sender"],
            "text": parsed.get("text", ""),
            "kind": parsed.get("kind", "text"),
        })

        self._refresh_session_list()
        if chat_key == self._current_chat_key:
            self._append_message_row(sess["messages"][-1], sess["is_group"], sess["chat_key"])

    # ---------- 渲染 ----------
    def _refresh_session_list(self):
        self.session_list.blockSignals(True)
        self.session_list.clear()
        ordered = sorted(self._sessions.items(), key=lambda kv: kv[1]["last_ts"], reverse=True)
        for ck, sess in ordered:
            item = QListWidgetItem()
            title = self._chat_display_name(ck)
            if sess["is_group"]:
                title = f"[群] {title}"
            preview = ""
            hhmm = ""
            if sess["messages"]:
                last = sess["messages"][-1]
                sender_name = self._sender_display_name(ck, last["sender"])
                preview = f"{sender_name}: {last['text']}" if sess["is_group"] else last["text"]
                preview = preview[:60]
                hhmm = datetime.fromtimestamp(last["ts"]).strftime("%H:%M:%S")
            item.setText(f"{title}\n{preview}  · {hhmm}")
            item.setData(Qt.UserRole, ck)
            self.session_list.addItem(item)
            if ck == self._current_chat_key:
                self.session_list.setCurrentItem(item)
        self.session_list.blockSignals(False)
        self._maybe_fetch_group_names()

    def _on_session_changed(self, current, _previous):
        if not current:
            return
        self._current_chat_key = current.data(Qt.UserRole)
        self._render_current_session()

    def _render_current_session(self):
        sess = self._sessions.get(self._current_chat_key)
        if not sess:
            return
        prefix = "[群] " if sess["is_group"] else ""
        display = self._chat_display_name(sess["chat_key"])
        self.chat_header.setText(f"{prefix}{display} · {sess['chat_key']}")
        self.message_list.clear()
        for m in sess["messages"]:
            self._append_message_row(m, sess["is_group"], sess["chat_key"])
        if sess["is_group"]:
            self._maybe_fetch_group_members(sess["chat_key"])

    def _append_message_row(self, m: dict, is_group: bool, chat_key: str):
        hhmmss = datetime.fromtimestamp(m["ts"]).strftime("%H:%M:%S")
        who = self._sender_display_name(chat_key, m["sender"]) if is_group else ""
        prefix = f"{who}: " if who else ""
        item = QListWidgetItem(f"[{hhmmss}] {prefix}{m['text']}")
        self.message_list.addItem(item)
        self.message_list.scrollToBottom()

    # ---------- 懒拉取 ----------
    def _maybe_fetch_group_names(self):
        unknown = [
            ck for ck, sess in self._sessions.items()
            if sess["is_group"]
               and not self._contact_map.get(ck)
               and not self._group_names.get(ck)
        ]
        if not unknown:
            return
        key = ("names", "batch")
        if key in self._pending:
            return
        now = time.monotonic()
        if now - self._fetch_ts.get(key, 0) < GROUP_INFO_TTL:
            return
        self._fetch_ts[key] = now
        self._pending.add(key)
        self._spawn_worker(
            "group_names",
            lambda: self.client.get_group_names(unknown),
            self._on_group_names_result,
            key,
        )

    def _maybe_fetch_group_members(self, chat_key: str):
        key = ("members", chat_key)
        if key in self._pending:
            return
        now = time.monotonic()
        if now - self._fetch_ts.get(key, 0) < GROUP_INFO_TTL:
            return
        self._fetch_ts[key] = now
        self._pending.add(key)
        self._spawn_worker(
            "group_members",
            lambda: self.client.get_group_members(chat_key),
            lambda action, ok, payload, err: self._on_group_members_result(chat_key, action, ok, payload, err),
            key,
        )

    def _spawn_worker(self, action: str, fn, on_result, pending_key: tuple):
        worker = Worker(action, fn, self)
        self._active_workers.add(worker)
        worker.finished.connect(on_result)
        worker.finished.connect(lambda: self._pending.discard(pending_key))
        worker.finished.connect(lambda: self._active_workers.discard(worker))
        worker.start()

    def _on_group_names_result(self, _action, ok, payload, _err):
        if not ok:
            return
        _ok, group_data, _msg = payload
        if not _ok or not group_data:
            return
        for ck, info in group_data.items():
            self._group_names[ck] = info
        self._refresh_session_list()
        if self._current_chat_key:
            self._render_current_session()

    def _on_group_members_result(self, chat_key: str, _action, ok, payload, _err):
        if not ok:
            return
        _ok, members, _msg = payload
        if not _ok or not members:
            return
        self._group_members[chat_key] = members
        if self._current_chat_key == chat_key:
            self._render_current_session()
        self._refresh_session_list()

    # ---------- 提示 ----------
    def _show_info(self, title: str, content: str, success: bool = True):
        if success:
            InfoBar.success(title=title, content=content, orient=Qt.Horizontal,
                            parent=self, position=InfoBarPosition.TOP_RIGHT, duration=2500)
        else:
            InfoBar.error(title=title, content=content, orient=Qt.Horizontal,
                          parent=self, position=InfoBarPosition.TOP_RIGHT, duration=3000)
