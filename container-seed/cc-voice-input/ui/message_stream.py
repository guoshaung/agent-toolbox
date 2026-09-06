import asyncio
import json
import re
import time

import websockets
from PySide6.QtCore import QThread, Signal

MSG_KINDS = {1: "text", 3: "image", 34: "voice", 43: "video", 47: "emoji", 49: "file"}
_KIND_LABEL = {"image": "[图片]", "voice": "[语音]", "video": "[视频]", "emoji": "[表情]", "file": "[文件]"}
WS_RECONNECT_DELAY = 5


def split_messages(raw: str) -> list[str]:
    """一帧里可能塞多条 JSON（后端偶尔会拼在一起），靠 "},{" 切开。"""
    raw = raw.strip()
    try:
        json.loads(raw)
        return [raw]
    except json.JSONDecodeError:
        pass
    parts = re.split(r"\}\s*,\s*\{", raw)
    if len(parts) == 1:
        return [raw]
    results = []
    for i, part in enumerate(parts):
        if i == 0:
            part = part + "}"
        elif i == len(parts) - 1:
            part = "{" + part
        else:
            part = "{" + part + "}"
        results.append(part)
    return results


def _describe(kind: str, body: str) -> str:
    if kind == "file":
        m = re.search(r"<title>(.*?)</title>", body, re.S)
        if m and m.group(1).strip():
            return f"[文件] {m.group(1).strip()[:60]}"
    return _KIND_LABEL.get(kind, "[消息]")


def parse_message(raw: str, own_wxid: str) -> dict | None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return None
    mtype = msg.get("msg_type")
    if mtype not in MSG_KINDS:
        return None
    from_user = msg.get("from_user_name", {}).get("str", "")
    content = msg.get("content", {}).get("str", "")
    if not from_user or not content:
        return None
    if from_user.endswith("@chatroom"):
        parts = content.split(":\n", 1)
        if len(parts) != 2:
            return None
        sender, body = parts[0], parts[1].strip()
        if sender == own_wxid or not body:
            return None
        base = {"is_group": True, "chat_key": from_user, "sender": sender}
    else:
        if from_user == own_wxid:
            return None
        sender, body = from_user, content.strip()
        base = {"is_group": False, "chat_key": from_user, "sender": from_user}
    kind = MSG_KINDS[mtype]
    if kind == "text":
        return {**base, "kind": "text", "text": body}
    return {**base, "kind": kind, "text": _describe(kind, body)}


class MessageStream(QThread):
    message_received = Signal(dict)
    state_changed = Signal(str, str)  # (state, detail); state ∈ connecting/connected/error/disconnected

    def __init__(self, wx_base: str, wx_key: str, own_wxid: str, parent=None):
        super().__init__(parent)
        self.wx_base = wx_base.rstrip("/")
        self.wx_key = wx_key
        self.own_wxid = own_wxid
        self._running = True
        self._ws = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def stop(self):
        self._running = False
        loop, ws = self._loop, self._ws
        if loop and ws:
            try:
                asyncio.run_coroutine_threadsafe(ws.close(), loop)
            except RuntimeError:
                pass

    def run(self):
        print('11111')
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._loop_body())
        finally:
            try:
                loop.close()
            finally:
                self._loop = None

    async def _loop_body(self):
        ws_base = self.wx_base.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_base}/ws/GetSyncMsg?key={self.wx_key}"
        print('====', ws_url)
        while self._running:
            try:
                self.state_changed.emit("connecting", "")
                async with websockets.connect(ws_url, proxy=None) as ws:
                    self._ws = ws
                    self.state_changed.emit("connected", "")
                    async for raw in ws:
                        print('====', raw)
                        if not self._running:
                            break
                        if isinstance(raw, (bytes, bytearray)):
                            raw = raw.decode(errors="replace")
                        raw = raw.strip()
                        if not raw:
                            continue
                        for msg_str in split_messages(raw):
                            parsed = parse_message(msg_str, self.own_wxid)
                            if parsed:
                                parsed["ts"] = time.time()
                                self.message_received.emit(parsed)
            except Exception as e:
                self._ws = None
                if self._running:
                    self.state_changed.emit("error", f"{e}，{WS_RECONNECT_DELAY}s 后重连")
                    try:
                        await asyncio.sleep(WS_RECONNECT_DELAY)
                    except asyncio.CancelledError:
                        break
            finally:
                self._ws = None
        self.state_changed.emit("disconnected", "")
