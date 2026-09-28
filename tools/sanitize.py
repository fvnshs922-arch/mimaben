"""把 私密原件/ 里的 txt 脱敏后输出到 记录/。

规则：所有字段一律清空，只保留字段名。上传到 GitHub 的只有：
  - 【网站或应用名称】标题行
  - 字段名（例如「密码：」，后面的内容已清空）
  - 程序维护的「图标：」一栏里的颜色和图片文件名（自己输入的 emoji / 文字不上传）
  - 空行
其他内容（注释、没有字段名的整行文字）直接去掉。
私密原件/ 里的图片等非 txt 文件一律不处理、不上传。
"""
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "私密原件"
DST = ROOT / "记录"

FIELD_RE = re.compile(r"^(\s*)([^：:\r\n]{1,20}?)(\s*[：:])(.*)$")
TITLE_RE = re.compile(r"^\s*【.*】\s*$")
ICON_LABEL = "图标"
# 图标一栏只上传颜色和图片文件名（都是程序生成的），自己输入的 emoji / 文字不上传
ICON_KEEP_RE = re.compile(r"^(颜色=#[0-9a-fA-F]{6}|图片=[0-9a-f]{16}\.(png|jpg|gif|webp|ico|bmp|svg))$")


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    raise SystemExit(f"无法识别编码：{path}")


def sanitize_line(line: str) -> str | None:
    """返回脱敏后的行；返回 None 表示这一行整行去掉。"""
    if not line.strip() or TITLE_RE.match(line):
        return line
    m = FIELD_RE.match(line)
    if not m:
        return None
    indent, label, colon, _value = m.groups()
    if label.strip() == ICON_LABEL:
        keep = [t for t in _value.split() if ICON_KEEP_RE.match(t)]
        return f"{indent}{label}{colon}{' '.join(keep)}" if keep else None
    return f"{indent}{label}{colon}"


def sanitize_text(text: str) -> str:
    cleaned = [x for x in (sanitize_line(l) for l in text.splitlines()) if x is not None]
    return "\n".join(cleaned) + "\n"


def main() -> int:
    SRC.mkdir(exist_ok=True)
    DST.mkdir(exist_ok=True)

    # 先清掉旧的脱敏结果，这样原件里删掉的文件也会同步删除
    for old in DST.rglob("*.txt"):
        old.unlink()

    count = 0
    for src in sorted(SRC.rglob("*.txt")):
        rel = src.relative_to(SRC)
        out = DST / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(sanitize_text(read_text(src)), encoding="utf-8")
        count += 1
        print(f"  已脱敏：{rel}")

    print(f"共处理 {count} 个 txt 文件。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
