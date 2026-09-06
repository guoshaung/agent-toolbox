import asyncio
import json
import uuid

import websockets
from PySide6.QtCore import QThread, Signal

from ui.protocols import (
    EventType,
    MsgType,
    full_client_request,
    receive_message,
)

TTS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream"
DEFAULT_RESOURCE_ID = "seed-tts-2.0"


class TtsStream(QThread):
    audio = Signal(bytes)
    done = Signal()
    error = Signal(str)

    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.config = config
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._running = True

    def stop(self):
        self._running = False

    def run(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._run_async())
        finally:
            try:
                loop.run_until_complete(self._close())
            finally:
                loop.close()

    async def _run_async(self):
        api_key = (self.config.get("api_key") or "").strip()
        speaker = (self.config.get("speaker") or "").strip()
        text = self.config.get("text") or ""
        if not api_key:
            self.error.emit("请填写 X-Api-Key")
            return
        if not speaker:
            self.error.emit("请填写 Speaker（音色 ID）")
            return
        if not text.strip():
            self.error.emit("请输入要合成的文本")
            return

        headers = {
            "X-Api-Key": api_key,
            "X-Api-Resource-Id": self.config.get("resource_id") or DEFAULT_RESOURCE_ID,
            "X-Api-Request-Id": self.config.get("request_id") or str(uuid.uuid4()),
            "X-Api-Connect-Id": self.config.get("connect_id") or str(uuid.uuid4()),
        }

        body = {
            "req_params": {
                "speaker": speaker,
                "text": text,
                "audio_params": {
                    "format": self.config.get("format") or "pcm",
                    "sample_rate": int(self.config.get("sample_rate") or 24000),
                },
            }
        }

        try:
            self._ws = await websockets.connect(
                TTS_ENDPOINT,
                additional_headers=headers,
                max_size=10 * 1024 * 1024,
            )
            await full_client_request(self._ws, json.dumps(body).encode())
            while self._running:
                msg = await receive_message(self._ws)
                if msg.type == MsgType.AudioOnlyServer and msg.payload:
                    self.audio.emit(bytes(msg.payload))
                elif msg.type == MsgType.FullServerResponse and msg.event == EventType.SessionFinished:
                    break
                elif msg.type == MsgType.Error:
                    self.error.emit(f"TTS 失败 code={msg.error_code} payload={msg.payload!r}")
                    return
            self.done.emit()
        except Exception as exc:
            self.error.emit(f"TTS 失败: {exc}")

    async def _close(self):
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
