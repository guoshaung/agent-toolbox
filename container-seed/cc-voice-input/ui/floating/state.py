from enum import Enum
from PySide6.QtGui import QColor


class FloatState(Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"

    @property
    def label(self) -> str:
        return {
            FloatState.IDLE: "待命",
            FloatState.LISTENING: "在听",
            FloatState.THINKING: "在想",
            FloatState.SPEAKING: "在说",
        }[self]

    @property
    def halo(self) -> QColor:
        return {
            FloatState.IDLE: QColor(160, 160, 160, 160),
            FloatState.LISTENING: QColor(64, 158, 255, 220),
            FloatState.THINKING: QColor(255, 165, 0, 220),
            FloatState.SPEAKING: QColor(80, 200, 120, 220),
        }[self]
