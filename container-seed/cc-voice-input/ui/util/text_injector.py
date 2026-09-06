"""Paste text into another app via clipboard + paste keystroke.

macOS:   pbcopy -> activate target app -> Cmd+V (AppleScript, needs
         Accessibility permission for the host process).
Windows: Win32 clipboard (CF_UNICODETEXT) -> focus target window ->
         Ctrl+V via SendInput.

No Enter is sent - the user confirms manually.
"""

from __future__ import annotations

import ctypes
import subprocess
import sys
import time
from ctypes import wintypes

IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    VK_CONTROL = 0x11
    VK_V = 0x56

    ULONG_PTR = ctypes.c_size_t

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = (
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        )

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = (
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        )

    class _INPUTUNION(ctypes.Union):
        _fields_ = (
            ("mi", MOUSEINPUT),
            ("ki", KEYBDINPUT),
        )

    class INPUT(ctypes.Structure):
        _fields_ = (
            ("type", wintypes.DWORD),
            ("union", _INPUTUNION),
        )

    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalAlloc.argtypes = (wintypes.UINT, ctypes.c_size_t)
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalUnlock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalFree.restype = wintypes.HGLOBAL
    kernel32.GlobalFree.argtypes = (wintypes.HGLOBAL,)
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.SetClipboardData.argtypes = (wintypes.UINT, wintypes.HANDLE)
    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))


def _escape_applescript(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


# ---------------------------------------------------------------------------
# Windows implementation
# ---------------------------------------------------------------------------

def _win_set_clipboard(text: str) -> None:
    data = ctypes.create_unicode_buffer(text)
    size = ctypes.sizeof(data)

    if not user32.OpenClipboard(None):
        raise OSError("OpenClipboard failed")
    try:
        user32.EmptyClipboard()
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not handle:
            raise OSError("GlobalAlloc failed")
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            kernel32.GlobalFree(handle)
            raise OSError("GlobalLock failed")
        try:
            ctypes.memmove(pointer, data, size)
        finally:
            kernel32.GlobalUnlock(handle)
        if not user32.SetClipboardData(CF_UNICODETEXT, handle):
            kernel32.GlobalFree(handle)
            raise OSError("SetClipboardData failed")
    finally:
        user32.CloseClipboard()


def _win_find_window(name: str) -> int:
    """Return the first visible top-level window whose title contains `name`."""
    matches = []
    name_lower = name.lower()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def on_window(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if name_lower in buffer.value.lower():
            matches.append(hwnd)
        return True

    user32.EnumWindows(on_window, 0)
    return matches[0] if matches else 0


def _win_send_ctrl_v() -> None:
    def key(vk: int, flags: int) -> INPUT:
        event = INPUT()
        event.type = INPUT_KEYBOARD
        event.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags, time=0, dwExtraInfo=0)
        return event

    events = (INPUT * 4)(
        key(VK_CONTROL, 0),
        key(VK_V, 0),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    )
    sent = user32.SendInput(4, events, ctypes.sizeof(INPUT))
    if sent != 4:
        raise OSError("SendInput failed")


def _win_foreground_is_self() -> bool:
    """True if the foreground window belongs to this process (e.g. the bubble
    stole focus) - pasting then would send the text nowhere."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return False
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value == ctypes.windll.kernel32.GetCurrentProcessId()


def _win_inject(text: str, app_name: str | None) -> None:
    _win_set_clipboard(text)

    if app_name:
        hwnd = _win_find_window(app_name)
        if hwnd:
            user32.SetForegroundWindow(hwnd)
        # If the window was not found, paste into whatever has focus.
    elif _win_foreground_is_self():
        raise RuntimeError("焦点被悬浮球占用，请先点击目标窗口再结束录音")

    time.sleep(0.15)  # let clipboard + focus settle before the keystroke
    _win_send_ctrl_v()


# ---------------------------------------------------------------------------
# macOS implementation (unchanged)
# ---------------------------------------------------------------------------

def _macos_inject(text: str, app_name: str | None) -> None:
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)

    if app_name:
        script = (
            f'tell application "{_escape_applescript(app_name)}" to activate\n'
            'delay 0.2\n'
            'tell application "System Events" to keystroke "v" using command down'
        )
    else:
        script = 'tell application "System Events" to keystroke "v" using command down'

    subprocess.Popen(
        ["osascript", "-e", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def inject_text(text: str, app_name: str | None = None) -> None:
    text = text or ""
    if not text:
        return

    if IS_WINDOWS:
        _win_inject(text, app_name)
    else:
        _macos_inject(text, app_name)
