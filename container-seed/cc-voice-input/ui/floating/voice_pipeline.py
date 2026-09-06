from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, QObject, QTimer, Signal

from ui.audio_player import AudioPlayer
from ui.mic_asr_stream import MicAsrStream
from ui.mic_recorder import MicRecorder
from ui.tts_stream import DEFAULT_RESOURCE_ID as TTS_RESOURCE_ID, TtsStream
from ui.util.text_injector import inject_text

CONFIG_FILE = Path(__file__).resolve().parents[2] / "resources" / "voice_config.json"

DEFAULT_CONFIG = {
    "device": None,
    "asr": {
        "endpoint": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        "api_key": "",
        "resource_id": "volc.bigasr.sauc.duration",
    },
    "tts": {
        "api_key": "",
        "speaker": "",
        "resource_id": TTS_RESOURCE_ID,
        "sample_rate": 24000,
    },
    "injector": {
        "app_name": "iTerm2",
    },
}


def load_voice_config() -> dict:
    if not CONFIG_FILE.exists():
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False))
        return DEFAULT_CONFIG
    try:
        return json.loads(CONFIG_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return DEFAULT_CONFIG


class VoicePipeline(QObject):
    listening_started = Signal()
    listening_stopped = Signal()
    partial = Signal(str)
    final = Signal(str)
    speaking_started = Signal()
    speaking_finished = Signal()
    error = Signal(str)

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.config = load_voice_config()
        tts_rate = int(self.config.get("tts", {}).get("sample_rate", 24000))
        self.recorder = MicRecorder()
        self.player = AudioPlayer(sample_rate=tts_rate)
        self._asr: MicAsrStream | None = None
        self._tts: TtsStream | None = None
        self._is_listening = False
        self._playing = False
        self._playback_timer = QTimer(self)
        self._playback_timer.setInterval(150)
        self._playback_timer.timeout.connect(self._poll_playback)
        self._tts_done = False

    def is_listening(self) -> bool:
        return self._is_listening

    def is_speaking(self) -> bool:
        return self._playing

    def is_busy(self) -> bool:
        return self._is_listening or self._playing

    def toggle_listening(self) -> None:
        if self._playing:
            return
        if self._is_listening:
            self.stop_listening()
        else:
            self.start_listening()

    def start_listening(self) -> None:
        if self._is_listening or self._playing:
            return
        asr = self.config.get("asr") or {}
        if not asr.get("api_key"):
            self.error.emit(f"请在 {CONFIG_FILE.name} 里填 asr.api_key")
            return
        try:
            self.recorder.start(device=self.config.get("device"))
        except Exception as exc:
            self.error.emit(f"无法录音：{exc}")
            return
        self._asr = MicAsrStream(self.recorder, asr, self)
        self._asr.partial.connect(self.partial.emit)
        self._asr.final.connect(self._on_final)
        self._asr.error.connect(self._on_asr_error)
        self._asr.finished.connect(self._on_asr_finished)
        self._asr.start()
        self._is_listening = True
        self.listening_started.emit()

    def stop_listening(self) -> None:
        if not self._is_listening or self._asr is None:
            return
        asr = self._asr
        asr.stop()
        self.recorder.stop()
        # 兜底：线程正常情况下会自己收尾（finished -> _on_asr_finished）。
        # 万一它还是卡在网络等待上，2.5 秒后强制把界面状态放出来，
        # 不能让「正在听」永远挂在屏幕上点不动。
        QTimer.singleShot(2500, lambda: self._force_release(asr))

    def _force_release(self, asr) -> None:
        if asr is not self._asr:
            return                      # 已经正常收尾了
        if asr.isRunning():
            asr.terminate()             # 最后手段：线程卡在 IO 上时只能这样
            asr.wait(500)
        self.recorder.stop()
        self._asr = None
        if self._is_listening:
            self._is_listening = False
            self.listening_stopped.emit()
            self.error.emit("识别超时，已停止录音（网络或服务端没有响应）")

    def speak(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        if self._playing:
            return
        tts_cfg = self.config.get("tts") or {}
        api_key = tts_cfg.get("api_key")
        speaker = tts_cfg.get("speaker")
        if not api_key or not speaker:
            self.error.emit(f"请在 {CONFIG_FILE.name} 里填 tts.api_key 和 tts.speaker")
            return

        rate = int(tts_cfg.get("sample_rate", 24000))
        self.player.stop()
        self.player.start()

        self._tts = TtsStream({
            "api_key": api_key,
            "resource_id": tts_cfg.get("resource_id") or TTS_RESOURCE_ID,
            "speaker": speaker,
            "text": text,
            "format": "pcm",
            "sample_rate": rate,
        }, self)
        self._tts.audio.connect(self.player.feed)
        self._tts.done.connect(self._on_tts_done)
        self._tts.error.connect(self._on_tts_error)
        self._tts.finished.connect(self._on_tts_finished)
        self._tts_done = False
        self._playing = True
        self._tts.start()
        self.speaking_started.emit()
        self._playback_timer.start()

    def shutdown(self) -> None:
        if self._asr and self._asr.isRunning():
            self._asr.stop()
            self._asr.wait(2000)
        self.recorder.stop()
        if self._tts and self._tts.isRunning():
            self._tts.stop()
            self._tts.wait(2000)
        self._playback_timer.stop()
        self.player.stop()

    def _on_final(self, text: str) -> None:
        self.final.emit(text)
        text = text.strip()
        if not text:
            return
        injector_cfg = self.config.get("injector") or {}
        app_name = injector_cfg.get("app_name") or None
        try:
            inject_text(text, app_name=app_name)
        except Exception as exc:
            self.error.emit(f"注入失败：{exc}")

    def _on_asr_error(self, msg: str) -> None:
        self.error.emit(msg)

    def _on_asr_finished(self) -> None:
        self.recorder.stop()
        self._asr = None
        if self._is_listening:
            self._is_listening = False
            self.listening_stopped.emit()

    def _on_tts_done(self) -> None:
        self.player.finish()
        self._tts_done = True

    def _on_tts_error(self, msg: str) -> None:
        self._playback_timer.stop()
        self.player.stop()
        self._playing = False
        self.error.emit(msg)
        self.speaking_finished.emit()

    def _on_tts_finished(self) -> None:
        self._tts = None

    def _poll_playback(self) -> None:
        if not self._playing:
            self._playback_timer.stop()
            return
        if not self._tts_done:
            return
        if self.player._queue.empty() and len(self.player._buf) == 0:
            self._playback_timer.stop()
            self._playing = False
            self.speaking_finished.emit()
