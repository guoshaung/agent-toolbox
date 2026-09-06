import sys
from pathlib import Path

from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication
from qfluentwidgets import FluentWindow, NavigationItemPosition, FluentIcon

from ui.agent_interface import AgentInterface
from ui.contacts_interface import ContactsInterface
from ui.messages_interface import MessagesInterface
from ui.tray_manager import AppTray
from ui.voice_interface import VoiceInterface
from ui.wechat_login_interface import WeChatLoginInterface


class MainWindow(FluentWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("CodingFlying AutoBot")
        self.resize(960, 680)

        icon_path = self.resource_path("resources/icon.png")
        icon = QIcon(icon_path) if Path(icon_path).exists() else QIcon()

        self.agent_interface = AgentInterface(self)
        self.wechat_login_interface = WeChatLoginInterface(self)
        self.wechat_login_interface.open_agent_requested.connect(self.show_agent)
        self.contacts_interface = ContactsInterface(self)
        self.messages_interface = MessagesInterface(self)
        self.voice_interface = VoiceInterface(self)

        self.init_navigation()
        self.stackedWidget.currentChanged.connect(self._on_page_changed)
        self.navigationInterface.setMinimumWidth(220)
        self.navigationInterface.setExpandWidth(220)
        self.tray_manager = AppTray(self, icon)

    def init_navigation(self):
        self.addSubInterface(
            self.wechat_login_interface,
            FluentIcon.ROBOT,
            "微信登录",
            NavigationItemPosition.TOP
        )

        self.addSubInterface(
            self.contacts_interface,
            FluentIcon.PEOPLE,
            "通讯录",
            NavigationItemPosition.TOP
        )

        self.addSubInterface(
            self.messages_interface,
            FluentIcon.MESSAGE,
            "消息",
            NavigationItemPosition.TOP
        )

        self.addSubInterface(
            self.voice_interface,
            FluentIcon.MICROPHONE,
            "语音对话",
            NavigationItemPosition.TOP
        )

        self.addSubInterface(
            self.agent_interface,
            FluentIcon.SETTING,
            "核心代理",
            NavigationItemPosition.TOP
        )

    def _on_page_changed(self, _index: int):
        if self.stackedWidget.currentWidget() is self.wechat_login_interface:
            self.wechat_login_interface.refresh_backend()

    def resource_path(self, relative: str) -> str:
        if getattr(sys, "frozen", False):
            base = Path(sys._MEIPASS)
        else:
            base = Path(__file__).parent.parent
        return str(base / relative)

    def show_window(self):
        self.show()
        self.raise_()
        self.activateWindow()

    def show_wechat_login(self):
        self.navigationInterface.setCurrentItem("wechatLoginInterface")
        self.stackedWidget.setCurrentWidget(self.wechat_login_interface)
        self.show_window()

    def quit_app(self):
        QApplication.instance().quit()

    def show_agent(self):
        self.navigationInterface.setCurrentItem("agentInterface")
        self.stackedWidget.setCurrentWidget(self.agent_interface)
        self.show_window()
