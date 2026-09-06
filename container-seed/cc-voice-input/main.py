import sys
from pathlib import Path

from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication

from ui.floating.app import FloatingApp

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    icon = Path(__file__).parent / "resources" / "icon.png"
    if icon.exists():
        app.setWindowIcon(QIcon(str(icon)))

    floating = FloatingApp()
    floating.start()

    sys.exit(app.exec())
