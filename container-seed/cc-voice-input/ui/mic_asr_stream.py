import asyncio
import gzip
import json
import struct
import uuid

import aiohttp
from PySide6.QtCore import QThread, Signal

from ui.mic_recorder import MicRecorder


PROTOCOL_VERSION_V1 = 0b0001

MSG_CLIENT_FULL_REQUEST = 0b0001
MSG_CLIENT_AUDIO_ONLY_REQUEST = 0b0010
MSG_SERVER_FULL_RESPONSE = 0b1001
MSG_SERVER_ERROR_RESPONSE = 0b1111

FLAG_POS_SEQUENCE = 0b0001
FLAG_NEG_WITH_SEQUENCE = 0b0011

SERIALIZATION_JSON = 0b0001
COMPRESSION_GZIP = 0b0001

DEFAULT_RESOURCE_ID = "volc.bigasr.sauc.duration"


def _header(message_type: int, flags: int) -> bytes:
    return bytes([
        (PROTOCOL_VERSION_V1 << 4) | 1,
        (message_type << 4) | flags,
        (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP,
        0x00,
    ])


def build_full_client_request(seq: int, payload: dict) -> bytes:
    header = _header(MSG_CLIENT_FULL_REQUEST, FLAG_POS_SEQUENCE)
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    return header + struct.pack(">i", seq) + struct.pack(">I", len(body)) + body


def build_audio_only_request(seq: int, segment: bytes, is_last: bool) -> bytes:
    if is_last:
        flags = FLAG_NEG_WITH_SEQUENCE
        seq = -seq
    else:
        flags = FLAG_POS_SEQUENCE
    header = _header(MSG_CLIENT_AUDIO_ONLY_REQUEST, flags)
    body = gzip.compress(segment)
    return header + struct.pack(">i", seq) + struct.pack(">I", len(body)) + body


def parse_response(msg: bytes) -> dict:
    header_size = msg[0] & 0x0f
    message_type = msg[1] >> 4
    flags = msg[1] & 0x0f
    compression = msg[2] & 0x0f
    payload = msg[header_size * 4:]

    result: dict = {"message_type": message_type, "is_last_package": False, "code": 0, "payload_msg": None}

    if flags & 0x01:
        result["payload_sequence"] = struct.unpack(">i", payload[:4])[0]
        payload = payload[4:]
    if flags & 0x02:
        result["is_last_package"] = True
    if flags & 0x04:
        result["event"] = struct.unpack(">i", payload[:4])[0]
        payload = payload[4:]

    if message_type == MSG_SERVER_FULL_RESPONSE:
        payload_size = struct.unpack(">I", payload[:4])[0]
        payload = payload[4:4 + payload_size]
    elif message_type == MSG_SERVER_ERROR_RESPONSE:
        result["code"] = struct.unpack(">i", payload[:4])[0]
        payload_size = struct.unpack(">I", payload[4:8])[0]
        payload = payload[8:8 + payload_size]

    if not payload:
        return result

    if compression == COMPRESSION_GZIP:
        try:
            payload = gzip.decompress(payload)
        except OSError:
            return result

    try:
        result["payload_msg"] = json.loads(payload.decode("utf-8"))
    except Exception:
        pass
    return result


def build_auth_headers(config: dict) -> dict:
    resource_id = config.get("resource_id") or DEFAULT_RESOURCE_ID
    request_id = config.get("request_id") or str(uuid.uuid4())
    connect_id = config.get("connect_id") or str(uuid.uuid4())
    if config.get("api_key"):
        return {
            "X-Api-Key": config.get("api_key", ""),
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
            "X-Api-Connect-Id": connect_id,
        }
    if config.get("api_app_key") and config.get("api_access_key"):
        return {
            "X-Api-App-Key": config.get("api_app_key", ""),
            "X-Api-Access-Key": config.get("api_access_key", ""),
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
            "X-Api-Connect-Id": connect_id,
        }
    raise RuntimeError("请配置火山 ASR：新控制台需要 api_key + resource_id；旧控制台需要 api_app_key + api_access_key + resource_id")


class MicAsrStream(QThread):
    partial = Signal(str)
    final = Signal(str)
    error = Signal(str)

    def __init__(self, recorder: MicRecorder, config: dict, parent=None):
        super().__init__(parent)
        self.recorder = recorder
        self.config = config
        self._running = True
        self._session: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._got_final = False

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
        endpoint = self.config.get("endpoint") or "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
        try:
            headers = build_auth_headers(self.config)
            self._session = aiohttp.ClientSession()
            # aiohttp 默认 heartbeat=None、receive_timeout=None：服务端要是静默掉线
            # （网络抖动、NAT 超时、服务端到时长上限直接不吭声），下面那个 async for
            # 会永远阻塞，界面就一直停在“正在听”。加上心跳和接收超时才能察觉。
            self._ws = await self._session.ws_connect(
                endpoint, headers=headers, heartbeat=15, receive_timeout=30,
            )
            await self._send_full_client_request()
            sender = asyncio.create_task(self._send_audio())
            receiver = asyncio.create_task(self._receive_results())
            # 必须用 FIRST_COMPLETED。
            # FIRST_EXCEPTION 只在“有任务抛异常”或“全部任务结束”时才返回 ——
            # 服务端关连接时 receiver 是**正常返回**的，sender 还在 while True 里转，
            # 于是这里永远等不到，线程不退出、finished 不触发，
            # 界面就卡在“正在听”，再也不出字。这就是那个卡死。
            done, pending = await asyncio.wait(
                {sender, receiver},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.error.emit(f"ASR 失败: {exc}")

    async def _send_full_client_request(self):
        assert self._ws is not None
        payload = {
            "user": {"uid": self.config.get("uid") or "desktop-voice-test"},
            "audio": {
                "format": "pcm",
                "codec": "raw",
                "rate": self.recorder.sample_rate,
                "bits": 16,
                "channel": self.recorder.channels,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": True,
                "show_utterances": True,
                "enable_nonstream": False,
            },
        }
        await self._ws.send_bytes(build_full_client_request(1, payload))

    async def _send_audio(self):
        assert self._ws is not None
        seq = 2
        pending: bytes | None = None
        while True:
            # 连接已经断了就别再空转了，否则会陪着一个死掉的 ws 一直循环
            if self._ws is None or self._ws.closed:
                return
            chunk = self.recorder.read()
            if chunk is None:
                err = self.recorder.error()
                if err:
                    raise RuntimeError(err)
                if not self._running:
                    if pending is not None:
                        await self._ws.send_bytes(build_audio_only_request(seq, pending, is_last=True))
                    else:
                        await self._ws.send_bytes(build_audio_only_request(seq, b"", is_last=True))
                    return
                await asyncio.sleep(0.02)
                continue
            if pending is not None:
                await self._ws.send_bytes(build_audio_only_request(seq, pending, is_last=False))
                seq += 1
            pending = chunk

    async def _receive_results(self):
        assert self._ws is not None
        last_text = ""
        async for msg in self._ws:
            if msg.type is aiohttp.WSMsgType.ERROR:
                raise RuntimeError(f"连接出错: {self._ws.exception()}")
            if msg.type is not aiohttp.WSMsgType.BINARY:
                # CLOSE / CLOSING / CLOSED 都从这里出去，交给下面统一收尾
                break
            response = parse_response(msg.data)
            payload_msg = response.get("payload_msg") or {}
            if response.get("code"):
                raise RuntimeError(f"ASR 服务错误 code={response['code']} msg={payload_msg}")
            text = (((payload_msg.get("result") or {}).get("text")) or "").strip()
            if text:
                last_text = text
                self.partial.emit(text)
            if response.get("is_last_package"):
                self.final.emit(text or last_text)
                self._got_final = True
                return
        # 服务端没给最后一包就断了（超时/到时长上限/网络断）：
        # 已经识别出来的那部分不能丢，照样交出去。
        if last_text and not self._got_final:
            self._got_final = True
            self.final.emit(last_text)

    async def _close(self):
        try:
            if self._ws is not None and not self._ws.closed:
                await self._ws.close()
        finally:
            if self._session is not None and not self._session.closed:
                await self._session.close()
