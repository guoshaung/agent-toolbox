"""
Build script:  python build.py
Output:  dist/cc-voice-input.app (macOS)  or  dist/cc-voice-input/ (Windows)
Display name (Dock / Finder / 托盘): CC Voice 输入助手

Mac icon:  pip install pillow && python build.py --icon
"""
import platform
import plistlib
import subprocess
import sys
from pathlib import Path

APP_NAME = "cc-voice-input"
DISPLAY_NAME = "CC Voice 输入助手"


def generate_macos_icon(png_path: str, iconset_dir: str):
    """将 PNG 转为 macOS .icns"""
    from PIL import Image

    img = Image.open(png_path)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    paths = []
    for s in sizes:
        resized = img.resize((s, s))
        p = f"{iconset_dir}/icon_{s}x{s}.png"
        resized.save(p)
        p2x = f"{iconset_dir}/icon_{s}x{s}@2x.png"
        resized_2x = img.resize((s * 2, s * 2))
        resized_2x.save(p2x)
        paths.extend([p, p2x])

    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", f"{iconset_dir}.icns"], check=True)

    import shutil
    shutil.rmtree(iconset_dir)


def build():
    system = platform.system()
    sep = ";" if system == "Windows" else ":"

    cmd = [
        "pyinstaller",
        "--noconfirm",
        "--windowed",
        "--name", APP_NAME,
        "--add-data", f"resources{sep}resources",
        "main.py",
    ]

    if system == "Darwin":
        png = "resources/icon.png"
        if Path(png).exists():
            try:
                generate_macos_icon(png, "resources/icon.iconset")
                cmd += ["--icon", "resources/icon.icns"]
            except Exception as e:
                print(f"跳过 icon 生成: {e}")
    elif system == "Windows":
        cmd += ["--icon", "resources/icon.ico"]

    subprocess.run(cmd, check=True)

    if system == "Darwin":
        patch_macos_display_name()


def patch_macos_display_name():
    """给 .app 的 Info.plist 加上中文显示名 (Dock / Finder / 菜单栏)。"""
    plist_path = Path("dist") / f"{APP_NAME}.app" / "Contents" / "Info.plist"
    if not plist_path.exists():
        print(f"跳过 Info.plist patch: {plist_path} 不存在")
        return
    with plist_path.open("rb") as f:
        info = plistlib.load(f)
    info["CFBundleDisplayName"] = DISPLAY_NAME
    info["CFBundleName"] = DISPLAY_NAME
    with plist_path.open("wb") as f:
        plistlib.dump(info, f)
    print(f"已写入 CFBundleDisplayName = {DISPLAY_NAME}")


if __name__ == "__main__":
    build()
