"""一键上传：脱敏 -> 提交 -> 推送到 GitHub。"""
from datetime import datetime
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_staged  # noqa: E402
import sanitize  # noqa: E402


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, check=check)


def main() -> int:
    print("第 1 步：脱敏")
    if sanitize.main() != 0:
        return 1

    print("\n第 2 步：提交")
    git("add", "-A")
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        print("没有变化，不需要上传。")
        return 0
    if check_staged.main() != 0:  # 不管有没有装提交前的钩子，都先做一遍安全检查
        git("reset", "-q", check=False)
        return 1
    msg = "更新记录 " + datetime.now().strftime("%Y-%m-%d %H:%M")
    if git("commit", "-m", msg, check=False).returncode != 0:
        print("提交失败（可能被安全检查拦下了），没有上传。")
        return 1

    print("\n第 3 步：推送到 GitHub")
    remotes = subprocess.run(["git", "remote"], cwd=ROOT, capture_output=True, text=True).stdout
    if not remotes.strip():
        print("还没有绑定 GitHub 仓库，已在本地提交，暂不推送。")
        return 0
    if git("push", check=False).returncode != 0:
        print("推送失败，请检查网络或 GitHub 登录。")
        return 1
    print("\n完成！")
    return 0


if __name__ == "__main__":
    sys.exit(main())
