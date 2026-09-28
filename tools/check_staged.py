"""提交前的安全检查（由 .githooks/pre-commit 调用）。

发现以下任意情况就拒绝提交：
  1. 暂存了 私密原件/ 下的文件
  2. 暂存了图片 / 表格 / 文档等无法检查内容的文件（只有 docs/图片/ 里给 README 用的 png 截图例外，截图只用假数据拍）
  3. 暂存的 txt 里，有任何字段后面有值，或有脱敏后不该出现的整行文字
"""
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sanitize import sanitize_line  # noqa: E402

BLOCKED_EXT = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".tif", ".tiff",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".zip", ".rar", ".7z",
}
DOC_IMAGES = re.compile(r"^docs/图片/[^/]+\.png$")  # README 的截图，只放行这一个文件夹里的 png


ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def main() -> int:
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    paths = [p for p in names.decode("utf-8").split("\0") if p]

    problems = []
    for p in paths:
        if p.startswith("私密原件/"):
            problems.append(f"{p}：私密原件不允许上传")
            continue
        if Path(p).suffix.lower() in BLOCKED_EXT and not DOC_IMAGES.match(p):
            problems.append(f"{p}：图片/文档类文件不允许上传")
            continue
        if not p.endswith(".txt"):
            continue
        content = git("show", f":{p}").decode("utf-8", errors="replace")
        for n, line in enumerate(content.splitlines(), 1):
            if line.lstrip().startswith("#") and not p.startswith("记录/"):
                continue  # 模板.txt 这类说明文件可以有注释
            if sanitize_line(line) != line:
                problems.append(f"{p} 第 {n} 行：有没清空的内容")

    if problems:
        print("\n[安全检查] 已阻止提交，发现可能泄露的内容：")
        for x in problems:
            print("  - " + x)
        print("请用 上传.bat 提交（它会先自动脱敏）。\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
