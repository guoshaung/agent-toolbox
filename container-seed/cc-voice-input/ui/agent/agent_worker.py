"""Long-lived asyncio loop for LLM SDK clients, plus a Qt dispatch helper.

Why a persistent loop: httpx.AsyncClient (used by openai/anthropic SDKs)
lazily binds its connection pool to the event loop that issues the first
request. If we used asyncio.run() per chat, the pool would be tied to a
loop that gets closed right after, and subsequent calls fail with
"Connection error". Keeping one loop alive for the app avoids that.
"""

from __future__ import annotations

import asyncio
import threading

from PySide6.QtCore import QObject, QThread, Signal

from ui.agent.local_agent import LocalAgent


class AsyncioThread(QThread):
    """One long-lived asyncio event loop, shared across chat calls."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._ready = threading.Event()

    def run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self.loop = loop
        self._ready.set()
        try:
            loop.run_forever()
        finally:
            loop.close()
            self.loop = None

    def wait_ready(self, timeout: float = 5.0) -> bool:
        return self._ready.wait(timeout)

    def stop_loop(self) -> None:
        loop = self.loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(loop.stop)
        self.wait(2000)


class AgentDispatcher(QObject):
    """Send LocalAgent.chat() to the asyncio thread; results come back as Qt signals."""

    reply = Signal(str)
    error = Signal(str)

    def __init__(self, agent: LocalAgent, thread: AsyncioThread, parent=None) -> None:
        super().__init__(parent)
        self._agent = agent
        self._thread = thread

    def submit(self, text: str) -> None:
        loop = self._thread.loop
        if loop is None:
            self.error.emit("agent 事件循环未就绪")
            return
        asyncio.run_coroutine_threadsafe(self._run(text), loop)

    async def _run(self, text: str) -> None:
        try:
            reply = await self._agent.chat(text)
        except Exception as exc:
            self.error.emit(f"agent 出错：{exc}")
            return
        self.reply.emit(reply)
