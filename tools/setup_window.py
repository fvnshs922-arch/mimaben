"""打开程序前检查窗口组件 pywebview（由 打开程序.bat 调用）。

没装就用 pip 装一次（需要联网，一两分钟）。装不上也没关系，程序会改用 Edge 窗口，
失败后 3 天内不再重试，免得每次打开都卡住。
"""
import importlib
import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path

MARK = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "个人密码记录程序" / "pywebview安装失败.txt"
RETRY_DAYS = 3


def main() -> int:
    if os.name != "nt" or importlib.util.find_spec("webview"):
        return 0
    if MARK.exists() and time.time() - MARK.stat().st_mtime < RETRY_DAYS * 86400:
        return 0
    print("正在安装窗口组件 pywebview（只需要一次，要联网，大约一两分钟）……\n")
    code = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "pywebview"]).returncode
    importlib.invalidate_caches()
    if code == 0 and importlib.util.find_spec("webview"):
        MARK.unlink(missing_ok=True)
        print("\n安装完成。")
        return 0
    MARK.parent.mkdir(parents=True, exist_ok=True)
    MARK.write_text(time.strftime("%Y-%m-%d %H:%M"), encoding="utf-8")
    print(f"\n安装失败，这次先用 Edge 窗口打开，{RETRY_DAYS} 天后会再试。")
    time.sleep(5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
