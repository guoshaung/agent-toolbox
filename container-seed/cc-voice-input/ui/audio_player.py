import queue
import struct
import threading

import sounddevice as sd


FADE_OUT_SAMPLES = 240


class AudioPlayer:
    def __init__(self, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2):
        self.sample_rate = sample_rate
        self.channels = channels
        self.sample_width = sample_width
        self._queue: queue.Queue[bytes | None] = queue.Queue()
        self._buf = bytearray()
        self._stream: sd.RawOutputStream | None = None
        self._lock = threading.Lock()
        self._last_sample = 0
        self._fade_done = False

    def start(self):
        with self._lock:
            if self._stream is not None:
                return
            self._queue = queue.Queue()
            self._buf = bytearray()
            self._last_sample = 0
            self._fade_done = False
            self._stream = sd.RawOutputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=0,
                callback=self._callback,
            )
            self._stream.start()

    def feed(self, chunk: bytes):
        if chunk:
            self._fade_done = False
            self._queue.put(chunk)

    def finish(self):
        self._queue.put(None)

    def stop(self):
        with self._lock:
            stream = self._stream
            self._stream = None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

    def _append_fade(self) -> None:
        if self._fade_done:
            return
        if len(self._buf) >= 2:
            last = int.from_bytes(bytes(self._buf[-2:]), "little", signed=True)
        else:
            last = self._last_sample
        if last != 0:
            fade = bytearray()
            for i in range(FADE_OUT_SAMPLES):
                factor = 1.0 - (i + 1) / FADE_OUT_SAMPLES
                fade.extend(struct.pack("<h", int(last * factor)))
            self._buf.extend(fade)
        self._fade_done = True

    def _callback(self, outdata, frames, time_info, status):
        need = frames * self.channels * self.sample_width
        while len(self._buf) < need:
            try:
                chunk = self._queue.get_nowait()
            except queue.Empty:
                break
            if chunk is None:
                self._append_fade()
                break
            self._buf.extend(chunk)
        take = min(len(self._buf), need)
        outdata[:take] = bytes(self._buf[:take])
        if take >= 2:
            self._last_sample = int.from_bytes(bytes(self._buf[take - 2:take]), "little", signed=True)
        if take < need:
            outdata[take:] = b"\x00" * (need - take)
        del self._buf[:take]
