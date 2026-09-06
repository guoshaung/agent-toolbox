import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import BodyLabel, FluentStyleSheet, InfoBar, InfoBarPosition, PrimaryPushButton, StrongBodyLabel

from ui.audio_player import AudioPlayer
from ui.mic_asr_stream import MicAsrStream
from ui.mic_recorder import MicRecorder, available_devices
from ui.tts_stream import DEFAULT_RESOURCE_ID as TTS_RESOURCE_ID, TtsStream


class VoiceInterface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        FluentStyleSheet.SETTING_CARD.apply(self)
        self.setObjectName("voiceInterface")

        self.recorder = MicRecorder()
        self.asr: MicAsrStream | None = None
        self.tts: TtsStream | None = None
        self.player = AudioPlayer(sample_rate=24000)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 24)
        layout.setSpacing(16)

        title = QLabel("语音对话")
        title.setStyleSheet("font-size: 26px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = BodyLabel("先验证麦克风 ASR：按住说话，松开后等待转写结果。")
        subtitle.setStyleSheet("color: #777;")
        layout.addWidget(subtitle)

        form = QWidget()
        form_layout = QVBoxLayout(form)
        form_layout.setContentsMargins(0, 0, 0, 0)
        form_layout.setSpacing(10)

        self.device_combo = QComboBox()
        self._refresh_devices()

        self.endpoint_edit = QLineEdit("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async")
        self.endpoint_edit.setPlaceholderText("Volcano SAUC WebSocket endpoint")

        self.api_key_edit = QLineEdit()
        self.api_key_edit.setPlaceholderText("新版控制台：X-Api-Key（填了就用新版鉴权）")
        self.api_key_edit.setEchoMode(QLineEdit.Password)

        self.app_key_edit = QLineEdit()
        self.app_key_edit.setPlaceholderText("旧版控制台：X-Api-App-Key")

        self.access_key_edit = QLineEdit()
        self.access_key_edit.setPlaceholderText("旧版控制台：X-Api-Access-Key")
        self.access_key_edit.setEchoMode(QLineEdit.Password)

        self.resource_id_edit = QLineEdit("volc.bigasr.sauc.duration")
        self.resource_id_edit.setPlaceholderText("X-Api-Resource-Id")

        for label, widget in [
            ("麦克风", self.device_combo),
            ("ASR Endpoint", self.endpoint_edit),
            ("Api Key（新版）", self.api_key_edit),
            ("App Key（旧版）", self.app_key_edit),
            ("Access Key（旧版）", self.access_key_edit),
            ("Resource Id", self.resource_id_edit),
        ]:
            row = QHBoxLayout()
            row.addWidget(QLabel(label), 0)
            row.addWidget(widget, 1)
            form_layout.addLayout(row)

        layout.addWidget(form)

        self.talk_btn = PrimaryPushButton("按住说话")
        self.talk_btn.setMinimumHeight(90)
        self.talk_btn.pressed.connect(self._start_recording)
        self.talk_btn.released.connect(self._stop_recording)
        layout.addWidget(self.talk_btn)

        status = QHBoxLayout()
        self.state_label = StrongBodyLabel("未开始")
        self.state_label.setStyleSheet("color: #777;")
        status.addWidget(self.state_label)
        status.addStretch()
        refresh_btn = QPushButton("刷新麦克风")
        refresh_btn.clicked.connect(self._refresh_devices)
        status.addWidget(refresh_btn)
        layout.addLayout(status)

        self.partial_label = BodyLabel("实时转写：")
        self.partial_label.setWordWrap(True)
        self.partial_label.setStyleSheet("color: #555;")
        layout.addWidget(self.partial_label)

        self.final_edit = QPlainTextEdit()
        self.final_edit.setPlaceholderText("最终转写结果会显示在这里。")
        self.final_edit.setMinimumHeight(160)
        layout.addWidget(self.final_edit)

        tts_title = StrongBodyLabel("TTS 合成（seed-tts-2.0）")
        tts_title.setStyleSheet("margin-top: 6px;")
        layout.addWidget(tts_title)

        self.tts_speaker_edit = QLineEdit()
        self.tts_speaker_edit.setPlaceholderText("Speaker（音色 ID，从控制台音色库获取）")

        tts_speaker_row = QHBoxLayout()
        tts_speaker_row.addWidget(QLabel("Speaker"), 0)
        tts_speaker_row.addWidget(self.tts_speaker_edit, 1)
        layout.addLayout(tts_speaker_row)

        self.tts_text_edit = QPlainTextEdit()
        self.tts_text_edit.setPlaceholderText("输入要合成的文本，然后点击“合成并播放”。")
        self.tts_text_edit.setMinimumHeight(80)
        layout.addWidget(self.tts_text_edit)

        tts_actions = QHBoxLayout()
        self.tts_btn = PrimaryPushButton("合成并播放")
        self.tts_btn.clicked.connect(self._start_tts)
        tts_actions.addWidget(self.tts_btn)
        self.auto_tts_check = QCheckBox("识别完成后自动合成")
        tts_actions.addWidget(self.auto_tts_check)
        tts_actions.addStretch()
        layout.addLayout(tts_actions)

        self.tts_state_label = BodyLabel("TTS 未开始")
        self.tts_state_label.setStyleSheet("color: #777;")
        layout.addWidget(self.tts_state_label)

        QApplication.instance().aboutToQuit.connect(self._stop_everything)

    def _refresh_devices(self):
        current = self.device_combo.currentData()
        self.device_combo.clear()
        for device in available_devices():
            print('===', device)
            self.device_combo.addItem(str(device["name"]), device["index"])
        if current is not None:
            for i in range(self.device_combo.count()):
                if self.device_combo.itemData(i) == current:
                    self.device_combo.setCurrentIndex(i)
                    break

    def _asr_config(self) -> dict:
        return {
            "endpoint": self.endpoint_edit.text().strip(),
            "api_key": self.api_key_edit.text().strip(),
            "api_app_key": self.app_key_edit.text().strip(),
            "api_access_key": self.access_key_edit.text().strip(),
            "resource_id": self.resource_id_edit.text().strip(),
        }

    def _start_recording(self):
        if self.asr and self.asr.isRunning():
            return
        if self.recorder._stream is not None:
            return
        has_new = bool(self.api_key_edit.text().strip())
        has_old = bool(self.app_key_edit.text().strip() and self.access_key_edit.text().strip())
        if not has_new and not has_old:
            self._show_info("缺少配置", "填 Api Key（新版），或同时填 App Key + Access Key（旧版）。", success=False)
            return
        if not self.resource_id_edit.text().strip():
            self._show_info("缺少配置", "请填写 Resource Id。", success=False)
            return
        device_index = self.device_combo.currentData()
        device = None if device_index == -1 else int(device_index)
        try:
            self.recorder.start(device=device)
        except Exception as exc:
            self._show_info("无法录音", str(exc), success=False)
            return
        self.asr = MicAsrStream(self.recorder, self._asr_config(), self)
        self.asr.partial.connect(self._on_partial)
        self.asr.final.connect(self._on_final)
        self.asr.error.connect(self._on_error)
        self.asr.finished.connect(lambda: self._on_finished(self.asr))
        self.asr.start()
        self.state_label.setText("录音中…")
        self.state_label.setStyleSheet("color: #27a56a;")
        self.talk_btn.setText("松开结束")

    def _stop_recording(self):
        if self.asr is None:
            return
        self.asr.stop()
        self.recorder.stop()
        self.state_label.setText("等待转写…")
        self.state_label.setStyleSheet("color: #f0ad4e;")
        self.talk_btn.setText("按住说话")

    def _on_finished(self, worker: MicAsrStream | None):
        if self.asr is worker:
            self.asr = None
        self.recorder.stop()
        if self.state_label.text() == "等待转写…":
            self.state_label.setText("未开始")
            self.state_label.setStyleSheet("color: #777;")

    def _on_partial(self, text: str):
        self.partial_label.setText(f"实时转写：{text}")

    def _on_final(self, text: str):
        self.final_edit.appendPlainText(text)
        self.partial_label.setText("实时转写：")
        self.state_label.setText("未开始")
        self.state_label.setStyleSheet("color: #777;")
        if text.strip() and self.auto_tts_check.isChecked():
            if not self.tts_speaker_edit.text().strip():
                self._show_info("缺少 Speaker", "自动合成需要先填 Speaker 音色 ID。", success=False)
                return
            self.tts_text_edit.setPlainText(text)
            self._start_tts()

    def _on_error(self, error: str):
        self._show_info("ASR 失败", error, success=False)
        self.state_label.setText("未开始")
        self.state_label.setStyleSheet("color: #777;")

    def _start_tts(self):
        if self.tts and self.tts.isRunning():
            return
        api_key = self.api_key_edit.text().strip()
        if not api_key:
            self._show_info("缺少配置", "TTS 需要 X-Api-Key（新版控制台）。", success=False)
            return
        speaker = self.tts_speaker_edit.text().strip()
        if not speaker:
            self._show_info("缺少配置", "请填写 Speaker（音色 ID）。", success=False)
            return
        text = self.tts_text_edit.toPlainText().strip()
        if not text:
            self._show_info("缺少内容", "请输入要合成的文本。", success=False)
            return

        self.player.stop()
        self.player.start()

        self.tts = TtsStream({
            "api_key": api_key,
            "resource_id": TTS_RESOURCE_ID,
            "speaker": speaker,
            "text": text,
            "format": "pcm",
            "sample_rate": 24000,
        }, self)
        self.tts.audio.connect(self.player.feed)
        self.tts.done.connect(self._on_tts_done)
        self.tts.error.connect(self._on_tts_error)
        self.tts.finished.connect(lambda: self._on_tts_finished(self.tts))
        self.tts.start()

        self.tts_state_label.setText("TTS 合成中…")
        self.tts_state_label.setStyleSheet("color: #27a56a;")
        self.tts_btn.setEnabled(False)

    def _on_tts_done(self):
        self.player.finish()
        self.tts_state_label.setText("TTS 完成，播放中…")
        self.tts_state_label.setStyleSheet("color: #777;")

    def _on_tts_error(self, error: str):
        self.player.stop()
        self._show_info("TTS 失败", error, success=False)
        self.tts_state_label.setText("TTS 未开始")
        self.tts_state_label.setStyleSheet("color: #777;")

    def _on_tts_finished(self, worker: TtsStream | None):
        if self.tts is worker:
            self.tts = None
        self.tts_btn.setEnabled(True)

    def _stop_everything(self):
        if self.asr and self.asr.isRunning():
            self.asr.stop()
            self.asr.wait(3000)
        self.recorder.stop()
        if self.tts and self.tts.isRunning():
            self.tts.stop()
            self.tts.wait(3000)
        self.player.stop()

    def _show_info(self, title: str, content: str, success: bool = True):
        if success:
            InfoBar.success(title=title, content=content, orient=Qt.Horizontal,
                            parent=self, position=InfoBarPosition.TOP_RIGHT, duration=2500)
        else:
            InfoBar.error(title=title, content=content, orient=Qt.Horizontal,
                          parent=self, position=InfoBarPosition.TOP_RIGHT, duration=3000)
