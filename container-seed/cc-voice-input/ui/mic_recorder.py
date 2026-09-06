import json
import os
import queue
import uuid
from pathlib import Path

import sounddevice as sd
import numpy as np


class AudioStreamError(RuntimeError):
    pass


class MicRecorder:
    # 队列给个上限。原来是无上限的：一旦消费端卡住（连接断了还在转），
    # 录音回调会一直往里塞，内存只涨不降。丢旧的比把内存吃光强。
    MAX_PENDING_CHUNKS = 100      # 200ms 一块，约 20 秒的缓冲

    def __init__(self, sample_rate: int = 16000, channels: int = 1, chunk_ms: int = 200):
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_ms = chunk_ms
        self.chunk_frames = int(sample_rate * chunk_ms / 1000)
        self._stream: sd.InputStream | None = None
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=self.MAX_PENDING_CHUNKS)
        self._last_error: str | None = None
        self._dropped = 0

    def start(self, device: int | None = None):
        if self._stream is not None:
            return
        self._last_error = None
        self._dropped = 0
        self._queue = queue.Queue(maxsize=self.MAX_PENDING_CHUNKS)
        self._stream = sd.InputStream(
            device=device,
            channels=self.channels,
            samplerate=self.sample_rate,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self):
        stream = self._stream
        if stream is None:
            return
        try:
            stream.stop()
        finally:
            stream.close()
            self._stream = None

    def read(self) -> bytes | None:
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    def error(self) -> str | None:
        return self._last_error

    def dropped(self) -> int:
        """因为消费端跟不上而丢掉的音频块数，用来判断是不是卡住了。"""
        return self._dropped

    def _callback(self, indata, _frames, _time_info, status):
        if status:
            self._last_error = str(status)
        if self._last_error:
            return
        pcm = (indata[:, 0].clip(-1.0, 1.0) * 32767).astype("<i2").tobytes()
        # 这是 PortAudio 的实时回调线程，绝对不能阻塞：满了就丢最旧的一块。
        try:
            self._queue.put_nowait(pcm)
        except queue.Full:
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(pcm)
                self._dropped += 1
            except (queue.Empty, queue.Full):
                pass


def available_devices() -> list[dict[str, object]]:
    try:
        devices = sd.query_devices()
    except sd.PortAudioError as exc:
        return [{"index": -1, "name": f"无法枚举麦克风: {exc}", "max_input_channels": 0}]

    out: list[dict[str, object]] = []
    for index, device in enumerate(devices):
        if int(device["max_input_channels"]) <= 0:
            continue
        out.append({
            "index": index,
            "name": str(device["name"]),
            "max_input_channels": int(device["max_input_channels"]),
            "default_samplerate": float(device["default_samplerate"] or 0),
        })
    return out


def save_demo_audio(path: str | Path, seconds: float = 3.0) -> str:
    sample_rate = 16000
    duration = int(sample_rate * seconds)
    recording = sd.rec(duration, samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    pcm = (recording[:, 0].clip(-1.0, 1.0) * 32767).astype("<i2").tobytes()
    Path(path).write_bytes(pcm)
    return str(path)


def play_demo_audio(path):
    pcm = np.fromfile(path, dtype=np.int16)
    sd.play(
        pcm.astype(np.float32) / 32768,
        samplerate=16000
    )

    sd.wait()


if __name__ == "__main__":
    # save_demo_audio("demo.pcm", 10)
    play_demo_audio("demo.pcm")
