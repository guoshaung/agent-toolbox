from PySide6.QtCore import QObject
from PySide6.QtGui import QAction, QIcon
from PySide6.QtWidgets import QMenu, QSystemTrayIcon


class AppTray(QObject):
    def __init__(self, window, icon: QIcon):
        super().__init__()
        self.window = window
        self.tray = QSystemTrayIcon(icon, window)
        self.tray.setToolTip("CC Voice 输入助手")
        self.tray.setContextMenu(self._build_menu())
        self.tray.activated.connect(self._on_activated)

    def show(self):
        self.tray.show()

    def _build_menu(self):
        menu = QMenu()

        show_action = QAction("显示", self.window)
        show_action.triggered.connect(self.window.show_window)
        menu.addAction(show_action)

        agent_action = QAction("核心代理", self.window)
        agent_action.triggered.connect(self.window.show_agent)
        menu.addAction(agent_action)

        login_action = QAction("微信登录", self.window)
        login_action.triggered.connect(self.window.show_wechat_login)
        menu.addAction(login_action)

        menu.addSeparator()

        quit_action = QAction("退出", self.window)
        quit_action.triggered.connect(self.window.quit_app)
        menu.addAction(quit_action)

        return menu

    def _on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self.window.show_window()
