"""个人密码记录程序的图形界面（双击 打开程序.bat 启动）。

- 只监听 127.0.0.1，每次启动生成随机令牌，别的网页读不到数据
- 数据只读写 私密原件/ 下的 txt，格式与 模板.txt 相同
- 每次保存前把旧文件备份到 私密原件/.备份/
- 界面窗口关闭后自动退出
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import contextlib
import hashlib
import html
import importlib
import importlib.util
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_staged  # noqa: E402
import icons  # noqa: E402
import importer  # noqa: E402
import sanitize  # noqa: E402

# 用 UTF-8 读写文件；打开程序.bat 会设好，安装版的快捷方式带 -X utf8。设在环境里，重启、换窗口时开的新进程也跟着用
os.environ.setdefault("PYTHONUTF8", "1")
ROOT, SRC = sanitize.ROOT, sanitize.SRC
WEB = Path(__file__).resolve().parent / "web"
BACKUP = SRC / ".备份"
ICON_DIR = SRC / "图标"
DATA_DIR = Path(os.environ.get("LOCALAPPDATA") or ROOT) / "个人密码记录程序"
IMAGE_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
}
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/map.js": ("map.js", "text/javascript; charset=utf-8"),
    "/boot.js": ("boot.js", "text/javascript; charset=utf-8"),
    "/fonts.css": ("fonts.css", "text/css; charset=utf-8"),
}
FONT_RE = re.compile(r"^/fonts/([a-z0-9-]+\.woff2)$")
CSP = ("default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
TOKEN = os.environ.pop("PWBOOK_TOKEN", "") or secrets.token_urlsafe(18)  # 更新后重启时沿用旧令牌
TITLE_RE = re.compile(r"^\s*【(.*)】\s*$")
ICON_LABEL = "图标"  # 这一栏由程序维护，不显示在字段列表里
ICON_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
              ".ico": "image/x-icon", ".bmp": "image/bmp", ".svg": "image/svg+xml"}
ICON_NAME_RE = re.compile(r"^[0-9a-f]{16}\.(png|jpg|gif|webp|ico|bmp|svg)$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_ICON = 2 * 1024 * 1024
ICON_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
BAD_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
KEEP_BACKUPS = 30
MAX_UPLOAD = 40 * 1024 * 1024
IDLE_EXIT = 600  # 窗口失联这么多秒后退出


# ---------- txt 读写 ----------

def parse(text: str) -> tuple[list[str], list[dict]]:
    header, entries, cur = [], [], None
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        m = TITLE_RE.match(line)
        if m:
            cur = {"title": m.group(1).strip(), "fields": []}
            entries.append(cur)
            continue
        if s.startswith("#"):
            header.append(s)
            continue
        if cur is None:
            cur = {"title": "未命名", "fields": []}
            entries.append(cur)
        fm = sanitize.FIELD_RE.match(line)
        if fm and fm.group(2).strip() == ICON_LABEL:
            cur["icon"] = parse_icon(fm.group(4))
        elif fm:
            cur["fields"].append({"label": fm.group(2).strip(), "value": fm.group(4).strip()})
        else:
            cur["fields"].append({"label": "", "value": s})
    return header, entries


def parse_icon(s: str) -> dict:
    """「图标：颜色=#e84a5f 文字=😀 图片=0123456789abcdef.png」→ dict，认不出的部分忽略。"""
    keys = {"颜色": "color", "文字": "text", "图片": "image"}
    raw = {}
    for tok in str(s or "").split():
        k, _, v = tok.partition("=")
        if k in keys:
            raw[keys[k]] = v
    return clean_icon(raw)


def clean_icon(d) -> dict:
    if not isinstance(d, dict):
        return {}
    out = {}
    color, text, image = str(d.get("color") or ""), str(d.get("text") or ""), str(d.get("image") or "")
    if COLOR_RE.match(color):
        out["color"] = color.lower()
    text = re.sub(r"\s", "", text)[:24]
    if text:
        out["text"] = text
    if ICON_NAME_RE.match(image):
        out["image"] = image
    return out


def dump_icon(d: dict) -> str:
    d = clean_icon(d)
    parts = [f"{k}={d[e]}" for k, e in (("颜色", "color"), ("文字", "text"), ("图片", "image")) if e in d]
    return " ".join(parts)


def decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


def one_line(s) -> str:
    return str(s or "").replace("\r", " ").replace("\n", " ").strip()


def clean_label(s) -> str:
    # 字段名不能有冒号，且不超过 20 字，否则脱敏规则认不出来
    return re.sub(r"[：:【】]", "", one_line(s))[:20].strip()


def dump(header: list[str], entries: list[dict]) -> str:
    out = list(header)
    if header:
        out.append("")
    for e in entries:
        out.append(f"【{re.sub(r'[【】]', '', one_line(e.get('title'))) or '未命名'}】")
        icon = dump_icon(e.get("icon"))
        if icon:
            out.append(f"{ICON_LABEL}：{icon}")
        for f in e.get("fields", []):
            label, value = clean_label(f.get("label")), one_line(f.get("value"))
            if label:
                out.append(f"{label}：{value}")
            elif value:
                out.append(value)
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


def cat_path(name) -> Path:
    name = str(name or "").strip()
    if not name or len(name) > 40 or BAD_NAME.search(name) or name.startswith("."):
        raise ValueError('分类名不能为空，也不能包含 \\ / : * ? " < > |')
    return SRC / f"{name}.txt"


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def backup(path: Path) -> None:
    if not path.exists():
        return
    BACKUP.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, BACKUP / f"{path.stem}-{stamp()}{path.suffix}.bak")
    olds = sorted(BACKUP.glob(f"{glob_escape(path.stem)}-2*{path.suffix}.bak"))
    for old in olds[:-KEEP_BACKUPS]:
        old.unlink()


def glob_escape(s: str) -> str:
    return re.sub(r"([\[\]*?])", r"[\1]", s)


def move_to_backup(path: Path, tag: str) -> Path:
    BACKUP.mkdir(parents=True, exist_ok=True)
    dst = BACKUP / f"{path.stem}-{tag}-{stamp()}{path.suffix}.bak"
    path.rename(dst)
    return dst


DELETED_RE = re.compile(r"^(.+)-已删除-(\d{8}-\d{6}-\d{3})\.txt\.bak$")


def list_deleted() -> list[dict]:
    """删掉的分类（在 .备份/ 里），新的在前。"""
    if not BACKUP.exists():
        return []
    out = []
    for p in BACKUP.glob("*-已删除-*.txt.bak"):
        m = DELETED_RE.match(p.name)
        if not m:
            continue
        try:
            n = len(parse(sanitize.read_text(p))[1])
        except (OSError, SystemExit):
            continue
        if n:  # 空分类不用恢复
            out.append({"file": p.name, "name": m.group(1), "stamp": m.group(2), "count": n})
    return sorted(out, key=lambda x: x["stamp"], reverse=True)


def restore_deleted(file: str) -> str:
    """把删掉的分类放回来；同名分类已存在时改名为「名字（恢复）」。返回恢复后的分类名。"""
    m = DELETED_RE.match(str(file))
    src = BACKUP / str(file)
    if not m or src.parent != BACKUP or not src.is_file():
        raise ValueError("找不到这个删除的分类")
    name, n = m.group(1), 1
    while (target := cat_path(name)).exists():
        n += 1
        name = f"{m.group(1)}（恢复{'' if n == 2 else n - 1}）"
    src.rename(target)
    return name


def load_all() -> dict:
    cats = []
    for p in sorted(SRC.glob("*.txt"), key=lambda p: p.stem):
        _, entries = parse(sanitize.read_text(p))
        cats.append({"name": p.stem, "entries": entries})
    return {"categories": cats, "deleted": list_deleted(), "settings": load_settings(), "graph": load_graph(),
            "autolink": load_autolink()}


def save_category(name: str, entries) -> None:
    path = cat_path(name)
    if not isinstance(entries, list):
        raise ValueError("数据格式不对")
    header = parse(sanitize.read_text(path))[0] if path.exists() else []
    clean = [{"title": str(e.get("title", "")),
              "icon": clean_icon(e.get("icon")),
              "fields": [{"label": str(f.get("label", "")), "value": str(f.get("value", ""))}
                         for f in e.get("fields", [])
                         if isinstance(f, dict) and clean_label(f.get("label")) != ICON_LABEL]}
             for e in entries if isinstance(e, dict)]
    SRC.mkdir(exist_ok=True)
    backup(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(dump(header, clean), encoding="utf-8")
    os.replace(tmp, path)


def category_action(body: dict) -> dict:
    if body.get("action") == "restore":
        return {"ok": True, "name": restore_deleted(body.get("file"))}
    action, path = body.get("action"), cat_path(body.get("name"))
    if action == "create":
        if path.exists():
            raise ValueError("已经有这个分类了")
        SRC.mkdir(exist_ok=True)
        path.write_text("", encoding="utf-8")
    elif action == "rename":
        new = cat_path(body.get("newName"))
        if new.exists():
            raise ValueError("已经有这个分类了")
        backup(path)
        path.rename(new)
    elif action == "delete":
        # 删分类只删这一栏：里面的记录先并到另一个分类，原文件留一份在 .备份/
        if path.exists():
            entries = parse(sanitize.read_text(path))[1]
            if entries:
                dst = cat_path(body.get("moveTo"))
                if dst == path:
                    raise ValueError("不能移到要删除的分类里")
                header, old = parse(sanitize.read_text(dst)) if dst.exists() else ([], [])
                backup(dst)
                tmp = dst.with_suffix(".tmp")
                tmp.write_text(dump(header, old + entries), encoding="utf-8")
                os.replace(tmp, dst)
                move_to_backup(path, "已并入" + dst.stem)
            else:
                path.unlink()
    else:
        raise ValueError("未知操作")
    return {"ok": True}


# ---------- 关系图（卡片位置和连线，存在 私密原件/关系图.json，不上传） ----------

GRAPH_FILE = SRC / "关系图.json"
MAX_GRAPH_NODES = 5000
MAX_GRAPH_LINKS = 5000
GRAPH_KEY_MAX = 200


def _num(v, lo: float, hi: float, default: float = 0) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v or v in (float("inf"), float("-inf")) else min(hi, max(lo, v))


def _gkey(v) -> str:
    v = str(v or "")
    if not v or len(v) > GRAPH_KEY_MAX or re.search(r"[\x00-\x1f]", v):
        raise ValueError("关系图数据格式不对")
    return v


def clean_graph(body) -> dict:
    """节点用「分类/标题」做键（同名的加 #2、#3），自动关联的中间点以 @ 开头；只收数字和短文字。"""
    if not isinstance(body, dict):
        raise ValueError("关系图数据格式不对")
    nodes = body.get("nodes") or {}
    links = body.get("links") or []
    view = body.get("view") or {}
    if not isinstance(nodes, dict) or not isinstance(links, list) or not isinstance(view, dict):
        raise ValueError("关系图数据格式不对")
    if len(nodes) > MAX_GRAPH_NODES or len(links) > MAX_GRAPH_LINKS:
        raise ValueError("关系图太大了")
    out_nodes = {}
    for k, v in nodes.items():
        if not isinstance(v, (list, tuple)) or len(v) not in (2, 3):  # [x, y] 或 [x, y, 这张卡片的缩放]
            raise ValueError("关系图数据格式不对")
        out_nodes[_gkey(k)] = [round(_num(v[0], -1e6, 1e6)), round(_num(v[1], -1e6, 1e6))]
        if len(v) == 3 and (s := round(_num(v[2], 0.3, 4, 1), 2)) != 1:
            out_nodes[_gkey(k)].append(s)
    out_links, seen = [], set()
    for x in links:
        if not isinstance(x, dict):
            raise ValueError("关系图数据格式不对")
        a, b = _gkey(x.get("a")), _gkey(x.get("b"))
        if a == b or (a, b) in seen:
            continue
        seen.add((a, b))
        out_links.append({"a": a, "b": b, "label": one_line(x.get("label"))[:40]})
    zones = []  # 自动理图分出来的组（画底色用）：每组是一串卡片的键
    for z in body.get("zones") or []:
        if isinstance(z, list) and len(zones) < MAX_GRAPH_NODES:
            keys = [_gkey(k) for k in z[:MAX_GRAPH_NODES] if isinstance(k, str)]
            if len(keys) > 1:
                zones.append(keys)
    return {
        "version": 1,
        "auto": bool(body.get("auto", True)),
        "view": {"x": round(_num(view.get("x"), -1e7, 1e7), 1), "y": round(_num(view.get("y"), -1e7, 1e7), 1),
                 "k": round(_num(view.get("k"), 0.1, 4, 1), 3)},
        "nodes": out_nodes,
        "links": out_links,
        "zones": zones,
    }


def load_graph() -> dict:
    with contextlib.suppress(OSError, ValueError):
        return clean_graph(json.loads(GRAPH_FILE.read_text(encoding="utf-8")))
    return clean_graph({})


class GraphLock:
    lock = threading.Lock()
    backed_up = False  # 每次打开程序只在第一次保存前备份一份旧的


def save_graph(body) -> None:
    data = clean_graph(body)
    with GraphLock.lock:
        SRC.mkdir(exist_ok=True)
        if not GraphLock.backed_up:
            backup(GRAPH_FILE)
            GraphLock.backed_up = True
        tmp = GRAPH_FILE.with_name(GRAPH_FILE.name + ".tmp")  # 别和同名分类「关系图.txt」的 .tmp 撞上
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, GRAPH_FILE)


# ---------- 一键连线的记录（撤回用，存在 私密原件/一键连线.json，不上传） ----------

AUTOLINK_FILE = SRC / "一键连线.json"
AUTOLINK_KEEP = 20  # 最多记最近几次
AUTOLINK_MAX = 2 * 1024 * 1024


def _short(v, n: int) -> str:
    return one_line(v)[:n]


def clean_autolink(runs) -> list[dict]:
    """每次一键连线改了什么：加了哪些线、改了哪些关系说明、卡片哪一栏填了什么（撤回时按这个改回去）。"""
    if not isinstance(runs, list):
        raise ValueError("一键连线记录格式不对")
    out = []
    for r in runs[-AUTOLINK_KEEP:]:
        if not isinstance(r, dict):
            raise ValueError("一键连线记录格式不对")
        links = [{"a": _gkey(x.get("a")), "b": _gkey(x.get("b")), "label": _short(x.get("label"), 40)}
                 for x in r.get("links") or [] if isinstance(x, dict)]
        relabels = [{"a": _gkey(x.get("a")), "b": _gkey(x.get("b")), "old": _short(x.get("old"), 40), "new": _short(x.get("new"), 40)}
                    for x in r.get("relabels") or [] if isinstance(x, dict)]
        fields = [{"e": _gkey(x.get("e")), "label": clean_label(x.get("label")), "mode": x.get("mode"),
                   "value": _short(x.get("value"), 500), "old": _short(x.get("old"), 500)}
                  for x in r.get("fields") or [] if isinstance(x, dict) and x.get("mode") in ("add", "fill", "overwrite")]
        out.append({"time": int(_num(r.get("time"), 0, 1e13)), "links": links, "relabels": relabels, "fields": fields})
    return out


def load_autolink() -> list[dict]:
    with contextlib.suppress(OSError, ValueError):
        return clean_autolink(json.loads(AUTOLINK_FILE.read_text(encoding="utf-8")))
    return []


def save_autolink(runs) -> None:
    data = json.dumps(clean_autolink(runs), ensure_ascii=False, separators=(",", ":"))
    if len(data.encode("utf-8")) > AUTOLINK_MAX:
        raise ValueError("一键连线记录太大了")
    SRC.mkdir(exist_ok=True)
    if not data.strip("[]"):
        AUTOLINK_FILE.unlink(missing_ok=True)
        return
    tmp = AUTOLINK_FILE.with_name(AUTOLINK_FILE.name + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    os.replace(tmp, AUTOLINK_FILE)


# ---------- 图标 ----------

def sniff(data: bytes) -> str:
    """按文件头判断图片类型，返回扩展名；不是图片返回空串。"""
    head = data[:512]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:4] == b"\x00\x00\x01\x00":
        return ".ico"
    if head[:2] == b"BM":
        return ".bmp"
    text = head.decode("utf-8", "ignore").lstrip("\ufeff \t\r\n").lower()
    if text.startswith("<svg") or (text.startswith("<?xml") and "<svg" in data[:4096].decode("utf-8", "ignore").lower()):
        return ".svg"
    return ""


def save_icon(data: bytes) -> str:
    if len(data) > MAX_ICON:
        raise ValueError("图标太大（上限 2MB）")
    ext = sniff(data)
    if not ext:
        raise ValueError("只支持 png / jpg / gif / webp / ico / bmp / svg 图片")
    name = hashlib.sha256(data).hexdigest()[:16] + ext
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    p = ICON_DIR / name
    if not p.exists():
        p.write_bytes(data)
    return name


def icon_path(name: str) -> Path:
    if not ICON_NAME_RE.match(str(name)):
        raise ValueError("图标名不对")
    p = ICON_DIR / name
    if not p.is_file():
        raise ValueError("图标不存在")
    return p


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
LINK_RE = re.compile(r"<link\b[^>]*>", re.I)
ATTR_RE = re.compile(r"""([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""")


def fetch(url: str, limit: int, timeout: float = 6) -> tuple[bytes, str]:
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("只支持 http / https")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ValueError("文件太大")
        return data, r.geturl()


def site_of(url: str) -> str:
    """把用户填的网址整理成 https://域名，填的不像网址就返回空串。"""
    url = one_line(url)
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        u = urlparse(url)
        host, port = (u.hostname or "").lower(), u.port
    except ValueError:
        return ""
    if "." not in host or not re.match(r"^[a-z0-9.-]+$", host):
        return ""
    return f"{u.scheme.lower()}://{host}" + (f":{port}" if port else "")


def page_icons(site: str) -> list[tuple[str, str]]:
    """读网站首页里声明的图标，大图优先。"""
    try:
        data, final = fetch(site + "/", 1024 * 1024)
    except Exception:  # noqa: BLE001
        return []
    found = []
    for tag in LINK_RE.findall(data.decode("utf-8", "ignore")):
        attrs = {k.lower(): html.unescape(v.strip("\"'")) for k, v in ATTR_RE.findall(tag)}
        rel, href = attrs.get("rel", "").lower(), attrs.get("href", "")
        if "icon" not in rel or not href or href.startswith("data:"):
            continue
        size = max((int(n) for n in re.findall(r"(\d+)x\d+", attrs.get("sizes", ""))), default=0)
        if "apple-touch-icon" in rel:
            size = max(size, 180)
        if href.lower().split("?")[0].endswith(".svg") or "svg" in attrs.get("type", ""):
            size = max(size, 256)
        found.append((size, urljoin(final, href)))
    found.sort(key=lambda x: -x[0])
    return [(u, "网站图标" if size < 96 else "网站大图标") for size, u in found[:4]]


def app_store_icons(terms: list[str], query: str, countries=("cn", "us")) -> list[tuple[str, str, int]]:
    """用 App Store 公开搜索接口（中国区 + 美区，名字里写了区服就加上那个区）按应用名找图标，只留名字对得上的。"""
    reqs = [(t, c) for t in terms for c in dict.fromkeys(countries)]

    def one(tc):
        term, country = tc
        url = f"https://itunes.apple.com/search?country={country}&entity=software&limit=8&term={quote(term)}"
        try:
            data, _ = fetch(url, 1024 * 1024, timeout=8)
            return json.loads(data.decode("utf-8")).get("results", [])
        except Exception:  # noqa: BLE001
            return []

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = [r for rs in ex.map(one, reqs) for r in rs]
    best: dict = {}
    for r in results:
        art, title = r.get("artworkUrl512") or r.get("artworkUrl100"), one_line(r.get("trackName"))
        score = max(icons.name_score(t, title) for t in [query, *terms])
        if art and score and score > best.get(r.get("trackId"), (0,))[0]:
            best[r.get("trackId")] = (score, art, title)
    return [(art, "App Store · " + title[:30], score) for score, art, title in best.values()]


def simple_icon_tile(svg: bytes) -> bytes | None:
    """Simple Icons 的品牌标志做成方块图标：品牌色底 + 白色图形（浅色品牌用深色图形）。"""
    text = svg.decode("utf-8", "ignore")
    color = re.search(r'fill="#([0-9a-fA-F]{6})"', text)
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', text)
    if not color or not paths:
        return None
    hexc = color.group(1)
    r, g, b = (int(hexc[i:i + 2], 16) for i in (0, 2, 4))
    fg = "#1d2233" if 0.2126 * r + 0.7152 * g + 0.0722 * b > 190 else "#ffffff"
    body = "".join(f'<path d="{html.escape(d, quote=True)}"/>' for d in paths)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256">'
            f'<rect width="24" height="24" fill="#{hexc}"/>'
            f'<g transform="translate(4.8 4.8) scale(.6)" fill="{fg}">{body}</g></svg>').encode()


def fetch_icons(url: str, name: str, limit: int = 12) -> list[tuple[str, bytes]]:
    """联网找图标，按可信度分档，同一档里清楚的排前面：
    0 网站声明的大图标（填了网址，或者名字在常用网站表里）
    1 App Store 名字完全对上的应用
    2 Simple Icons 品牌标志
    3 App Store 名字开头对上的 / Google 高清网站图标
    4 网站小图标 / favicon / icon.horse
    5 其他（DuckDuckGo、名字只是包含、按「名字.com」猜的网站）
    """
    full = one_line(name)[:60]
    known, name = icons.lookup(full), icons.core_name(full)  # Apple ID（日区）-> 按 Apple ID 找
    countries = ("cn", "us", icons.region(full) or "us")
    site = site_of(url) or (f"https://{known[0]}" if known else "")
    guess = ""
    if not site and re.fullmatch(r"[A-Za-z0-9-]{2,30}", name):
        guess = f"https://{name.lower()}.com"  # 不在常用表里的英文名，才猜 名字.com，而且排在最后
    slug = (known[1] if known else None) or (icons.simple_icon_slug(name) if name.isascii() and name else "")
    terms = [t for t in dict.fromkeys([name, known[2] if known else None]) if t]

    cands: list[tuple[str, str, int]] = []  # (地址, 说明, 档次)
    with ThreadPoolExecutor(max_workers=3) as ex:
        a = ex.submit(page_icons, site) if site else None
        g = ex.submit(page_icons, guess) if guess else None
        b = ex.submit(app_store_icons, terms, name, countries) if terms else None
        for u, label in (a.result() if a else []):
            cands.append((u, label, 0 if label == "网站大图标" else 4))
        for u, label, score in (b.result() if b else []):
            cands.append((u, label, {3: 1, 2: 3}.get(score, 5)))
        for u, label in (g.result() if g else []):
            cands.append((u, "猜测 · " + urlparse(guess).hostname, 5))
    if slug:
        cands.append((f"https://cdn.simpleicons.org/{slug}", "Simple Icons · " + slug, 2))
    if site:
        host = urlparse(site).hostname
        cands += [(f"https://www.google.com/s2/favicons?domain={host}&sz=256", "Google · " + host, 3),
                  (site + "/favicon.ico", "网站图标", 4),
                  (f"https://icon.horse/icon/{host}", "icon.horse · " + host, 4),
                  (f"https://icons.duckduckgo.com/ip3/{host}.ico", "DuckDuckGo · " + host, 5)]
    seen_url, uniq = set(), []
    for c in sorted(cands, key=lambda c: c[2]):
        if c[0] not in seen_url:
            seen_url.add(c[0])
            uniq.append(c)

    def grab(item):
        u, label, tier = item
        try:
            data, _ = fetch(u, MAX_ICON)
        except Exception:  # noqa: BLE001
            return None
        if label.startswith("Simple Icons"):
            data = simple_icon_tile(data) or b""
        if not sniff(data) or len(data) < 100:
            return None
        return tier, icons.image_size(data), label, data

    with ThreadPoolExecutor(max_workers=10) as ex:
        got = [x for x in ex.map(grab, uniq[:20]) if x]
    if any(size >= 64 for _, size, _, _ in got):
        got = [x for x in got if x[1] == 0 or x[1] >= 32]  # 有清楚的就不要 16px 这种糊的
    got.sort(key=lambda x: (x[0], -min(x[1], 256)))
    seen, out = set(), []
    for _, _, label, data in got:
        if (h := hashlib.sha256(data).hexdigest()) not in seen:
            seen.add(h)
            out.append((label, data))
    return out[:limit]


def icon_search(url: str, name: str) -> list[dict]:
    """联网找图标候选，给「图片」面板显示。"""
    return [{"label": label, "data": f"data:{ICON_TYPES[sniff(data)]};base64,{base64.b64encode(data).decode('ascii')}"}
            for label, data in fetch_icons(url, name)]


def auto_icon(url: str, name: str) -> str:
    """自动找图标：取最好的一个存下来，返回图标文件名；找不到返回空串。"""
    got = fetch_icons(url, name, limit=1)
    return save_icon(got[0][1]) if got else ""


# ---------- git / 上传 ----------

# 用安装程序装的「安装版」不是 git 仓库：数据只存在本机，检查更新改看 GitHub 上发布的新版本
IS_REPO = (ROOT / ".git").exists()
NOT_REPO_MSG = ("安装版只把数据保存在这台电脑上，不带 GitHub 同步。"
                "想把脱敏后的网站列表同步到自己的 GitHub 私有仓库，请看说明里的「用 git 同步」。")

def git(*args: str, timeout: int = 60) -> tuple[int, str, str]:
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    try:
        r = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=ROOT, env=env,
                           capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout,
                           creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        return 1, "", "操作超时，请检查网络。"
    except OSError:
        return 127, "", "这台电脑上没有找到 git。"
    dec = lambda b: b.decode("utf-8", "replace").strip()  # noqa: E731
    return r.returncode, dec(r.stdout), dec(r.stderr)


def status() -> dict:
    now = {}
    if SRC.exists():
        for src in SRC.rglob("*.txt"):
            now[src.relative_to(SRC).as_posix()] = sanitize.sanitize_text(sanitize.read_text(src))
    old = {}
    code, out, _ = git("ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "记录")
    if code == 0:
        for path in filter(None, out.split("\0")):
            old[path[len("记录/"):]] = git("show", f"HEAD:{path}")[1]
    norm = lambda s: s.replace("\r\n", "\n").strip()  # noqa: E731
    changes = []
    for rel in sorted(set(now) | set(old)):
        if rel not in old:
            st = "新增"
        elif rel not in now:
            st = "删除"
        elif norm(now[rel]) != norm(old[rel]):
            st = "修改"
        else:
            continue
        changes.append({"file": rel, "status": st, "preview": now.get(rel, "")})
    _, porcelain, _ = git("status", "--porcelain", "-z")
    other = [x[3:] for x in porcelain.split("\0") if len(x) > 3 and not x[3:].startswith("记录/")]
    code, out, _ = git("rev-list", "--count", "@{u}..HEAD")
    ahead = int(out) if code == 0 and out.isdigit() else 0
    code, remote, _ = git("remote", "get-url", "origin")
    return {"changes": changes, "other": len(other), "ahead": ahead, "repo": IS_REPO,
            "remote": remote if code == 0 else ""}


def upload_step(step: str) -> dict:
    if not IS_REPO:
        return {"ok": False, "log": NOT_REPO_MSG}
    if step == "sanitize":
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = sanitize.main()
        return {"ok": code == 0, "log": buf.getvalue().strip()}
    if step == "commit":
        git("add", "-A")
        if git("diff", "--cached", "--quiet")[0] == 0:
            return {"ok": True, "log": "没有新的变化需要提交。"}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = check_staged.main()  # 不管有没有装提交前的钩子，都先做一遍安全检查
        if code:
            git("reset", "-q")
            return {"ok": False, "log": buf.getvalue().strip()}
        code, out, err = git("commit", "-m", "更新记录 " + datetime.now().strftime("%Y-%m-%d %H:%M"))
        return {"ok": code == 0, "log": "\n".join(x for x in (out, err) if x)}
    if step == "push":
        if not git("remote")[1]:
            return {"ok": False, "log": "还没有绑定 GitHub 仓库。"}
        code, out, err = git("push", timeout=180)
        log = "\n".join(x for x in (out, err) if x)
        if code == 0:
            try:
                if snapshot_upload():
                    log += "\n已把上传时的「私密原件」存了一份，以后可以一键撤回到这个状态。"
            except Exception:  # noqa: BLE001
                log_error()  # 快照失败不影响上传本身
        return {"ok": code == 0, "log": log}
    raise ValueError("未知步骤")


# ---------- 跟随 GitHub 更新 ----------

VERSION_FILE = Path(__file__).resolve().parent / "version.json"  # {"version": "1.0.0", "repo": "用户名/仓库名"}


def app_version() -> dict:
    with contextlib.suppress(OSError, ValueError):
        v = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
        if isinstance(v, dict):
            return v
    return {}


def _vnum(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", str(v))[:3])


def release_check() -> dict:
    """安装版：看 GitHub 上最新发布的版本比本机新不新。只读。"""
    info = app_version()
    repo, cur = str(info.get("repo") or ""), str(info.get("version") or "0")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        return {"ok": False, "log": "不知道去哪里检查新版本（tools/version.json 里没写仓库）。"}
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/latest",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": "mimaben-update-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:  # 还没有发布过版本
            return {"ok": True, "release": True, "branch": f"{repo} 的发布版本", "behind": 0, "ahead": 0, "commits": [], "code": False}
        return {"ok": False, "log": f"连接 GitHub 失败：HTTP {e.code}"}
    except (OSError, ValueError) as e:
        return {"ok": False, "log": f"连接 GitHub 失败：{e}"}
    tag = str(data.get("tag_name") or "")
    newer = bool(tag) and _vnum(tag) > _vnum(cur)
    return {"ok": True, "release": True, "branch": f"{repo} 的发布版本（本机 v{cur}）", "behind": 1 if newer else 0, "ahead": 0,
            "commits": [{"hash": tag, "when": str(data.get("published_at") or "")[:10], "subject": str(data.get("name") or tag)}] if newer else [],
            "code": False, "latest": tag, "url": str(data.get("html_url") or "")}


UPDATE_BRANCH = "main"  # 检查更新只跟随 GitHub 上的这个分支


def not_on_main() -> str:
    """本机不在 main 上时不更新，返回提示；在 main 上返回空串。"""
    cur = git("rev-parse", "--abbrev-ref", "HEAD")[1]
    return "" if cur == UPDATE_BRANCH else f"本机当前在「{cur}」分支上，检查更新只跟随 {UPDATE_BRANCH}，请先切回 {UPDATE_BRANCH}。"


def update_check() -> dict:
    """从 GitHub 的 main 拉取最新信息，看本机落后多少。只读，不改动任何文件。"""
    if not IS_REPO:
        return release_check()
    if not git("remote")[1]:
        return {"ok": False, "log": "还没有绑定 GitHub 仓库。"}
    if msg := not_on_main():
        return {"ok": False, "log": msg}
    code, out, err = git("fetch", "--quiet", "origin", UPDATE_BRANCH, timeout=90)
    if code:
        return {"ok": False, "log": err or out or "连接 GitHub 失败"}
    up = f"origin/{UPDATE_BRANCH}"
    count = lambda rng: int(o) if (o := git("rev-list", "--count", rng)[1]).isdigit() else 0  # noqa: E731
    behind, ahead = count(f"HEAD..{up}"), count(f"{up}..HEAD")
    commits = []
    if behind:
        log = git("log", "-30", "--date=format:%m-%d %H:%M", "--format=%h%x09%cd%x09%s", f"HEAD..{up}")[1]
        for line in filter(None, log.splitlines()):
            h, when, subj = (line.split("\t", 2) + ["", ""])[:3]
            commits.append({"hash": h, "when": when, "subject": subj})
    files = [f for f in git("diff", "--name-only", f"HEAD...{up}")[1].splitlines() if f]
    return {"ok": True, "branch": up, "behind": behind, "ahead": ahead, "commits": commits,
            "code": any(not f.startswith("记录/") for f in files)}


def update_apply() -> dict:
    """把 GitHub main 上的新提交合进来。本机还没推送的记录提交会接在后面，有冲突就放弃，什么都不改。"""
    if not IS_REPO:
        r = release_check()
        if not r.get("ok") or not r.get("url"):
            return {"ok": False, "log": r.get("log") or "没有找到新版本的下载页。"}
        webbrowser.open(r["url"])
        return {"ok": True, "release": True, "code": False,
                "log": f"已在浏览器打开 {r['latest']} 的下载页。下载新的安装程序，装到原来的位置就行，「私密原件」里的记录不会动。"}
    if msg := not_on_main():
        return {"ok": False, "log": msg}
    try:
        snap = snapshot("更新前")
    except Exception as e:  # noqa: BLE001
        log_error()
        return {"ok": False, "log": f"备份「私密原件」失败，为了安全没有更新。\n{e}"}
    before = git("rev-parse", "HEAD")[1]
    code, out, err = git("pull", "--rebase", "--autostash", "--quiet", "origin", UPDATE_BRANCH, timeout=180)
    if code:
        git("rebase", "--abort")
        msg = "\n".join(x for x in (out, err) if x)
        return {"ok": False, "log": "更新失败，已恢复原样。\n" + msg}
    after = git("rev-parse", "HEAD")[1]
    files = [f for f in git("diff", "--name-only", before, after)[1].splitlines() if f] if before != after else []
    return {"ok": True, "code": any(not f.startswith("记录/") for f in files),
            "log": git("log", "-1", "--format=现在的版本：%h %s")[1] + f"\n更新前的数据已备份：私密原件/.备份/{snap.name}"}


# ---------- 整个 私密原件 的快照（更新前自动备份，可一键恢复） ----------

SNAP_TAGS = ("更新前", "恢复前", "上传时", "连线前")
SNAP_KEEP = 10  # 每种快照保留最近几份
SNAP_RE = re.compile(r"^(更新前|恢复前|上传时|连线前)-\d{8}-\d{6}-\d{3}\.zip$")
NO_COMPRESS = set(IMAGE_EXT) | {".heic", ".zip"}


def private_files() -> list[Path]:
    """私密原件/ 下除 .备份/ 以外的所有文件。"""
    if not SRC.exists():
        return []
    return sorted(p for p in SRC.rglob("*") if p.is_file() and BACKUP not in p.parents)


def snapshot(tag: str) -> Path:
    """把 私密原件/（不含 .备份/）打包成 zip，写完校验一遍再落盘。"""
    BACKUP.mkdir(parents=True, exist_ok=True)
    path = BACKUP / f"{tag}-{stamp()}.zip"
    tmp = path.with_name(path.name + ".tmp")
    try:
        with zipfile.ZipFile(tmp, "w") as z:
            for f in private_files():
                kind = zipfile.ZIP_STORED if f.suffix.lower() in NO_COMPRESS else zipfile.ZIP_DEFLATED
                z.write(f, f.relative_to(SRC).as_posix(), compress_type=kind)
        with zipfile.ZipFile(tmp) as z:
            if z.testzip() is not None:
                raise ValueError("备份文件校验失败")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    for old in sorted(BACKUP.glob(f"{glob_escape(tag)}-2*.zip"))[:-SNAP_KEEP]:
        old.unlink()
    return path


def list_snapshots() -> list[dict]:
    if not BACKUP.exists():
        return []
    items = [p for p in BACKUP.glob("*.zip") if SNAP_RE.match(p.name)]
    out = []
    for p in sorted(items, key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with zipfile.ZipFile(p) as z:
                n = len([i for i in z.infolist() if not i.is_dir()])
        except zipfile.BadZipFile:
            continue
        st = p.stat()
        out.append({"name": p.name, "tag": p.name.split("-", 1)[0], "size": st.st_size,
                    "mtime": int(st.st_mtime), "files": n})
    return out


def snapshot_files(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as z:
        return {i.filename: z.read(i) for i in z.infolist() if not i.is_dir()}


def current_files() -> dict[str, bytes]:
    return {f.relative_to(SRC).as_posix(): f.read_bytes() for f in private_files()}


def latest_snapshot(tag: str) -> Path | None:
    snaps = [p for p in BACKUP.glob(f"{glob_escape(tag)}-2*.zip") if SNAP_RE.match(p.name)] if BACKUP.exists() else []
    return max(snaps, key=lambda p: p.name, default=None)


def snapshot_upload() -> Path | None:
    """上传成功后存一份「上传时」快照；和上一份一模一样就不重复存。"""
    last = latest_snapshot("上传时")
    with contextlib.suppress(zipfile.BadZipFile, OSError):
        if last and snapshot_files(last) == current_files():
            return None
    return snapshot("上传时")


def entry_map(raw: bytes) -> dict[str, dict]:
    """txt → {标题: 记录}，同名的依次加 #2、#3。"""
    out = {}
    for e in parse(decode_text(raw))[1]:
        k, n = e["title"], 1
        while k in out:
            n += 1
            k = f"{e['title']} #{n}"
        out[k] = e
    return out


def describe_changes(old: dict[str, bytes], new: dict[str, bytes]) -> list[dict]:
    """两份 私密原件 的差别：只说哪个分类、哪几条记录变了，不带账号密码。"""
    out, icons = [], 0
    for rel in sorted(set(old) | set(new)):
        a, b = old.get(rel), new.get(rel)
        if a == b:
            continue
        if rel.endswith(".txt") and "/" not in rel:
            ea, eb = entry_map(a or b""), entry_map(b or b"")
            item = {"kind": "cat", "name": rel[:-4], "status": "新增" if a is None else "删除" if b is None else "修改",
                    "added": [k for k in eb if k not in ea], "removed": [k for k in ea if k not in eb],
                    "changed": [k for k in eb if k in ea and eb[k] != ea[k]]}
            if item["added"] or item["removed"] or item["changed"] or item["status"] != "修改":
                out.append(item)
        elif rel in (GRAPH_FILE.name, AUTOLINK_FILE.name):
            if {"kind": "graph"} not in out:
                out.append({"kind": "graph"})
        elif rel.startswith("图标/"):
            icons += 1
        else:
            out.append({"kind": "file", "name": rel})
    if icons:
        out.append({"kind": "icons", "count": icons})
    return out


def revert_info() -> dict:
    """撤回到上次上传：最近一份「上传时」快照，以及现在和它比改了什么。"""
    last = latest_snapshot("上传时")
    if not last:
        return {"snap": None}
    return {"snap": {"name": last.name, "mtime": int(last.stat().st_mtime)},
            "changes": describe_changes(snapshot_files(last), current_files())}


def restore_snapshot(name: str) -> dict:
    """把 私密原件/ 恢复成快照里的样子。恢复前先把当前状态另存一份「恢复前」快照。"""
    if not SNAP_RE.match(str(name)) or not (BACKUP / name).is_file():
        raise ValueError("找不到这个备份")
    src = BACKUP / name
    base = SRC.resolve()
    with zipfile.ZipFile(src) as z:
        if z.testzip() is not None:
            raise ValueError("备份文件已损坏，没有恢复")
        members = [i for i in z.infolist() if not i.is_dir()]
        for i in members:
            target = (SRC / i.filename).resolve()
            if base not in target.parents or BACKUP.resolve() in target.parents or target == BACKUP.resolve():
                raise ValueError(f"备份里有不安全的路径：{i.filename}")
        safety = snapshot("恢复前")
        for f in private_files():
            f.unlink()
        for d in sorted((d for d in SRC.rglob("*") if d.is_dir() and d != BACKUP and BACKUP not in d.parents),
                        key=lambda d: len(d.parts), reverse=True):
            with contextlib.suppress(OSError):
                d.rmdir()
        for i in members:
            target = SRC / i.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(i) as fin, open(target, "wb") as fout:
                shutil.copyfileobj(fin, fout)
    return {"ok": True, "safety": safety.name}


# ---------- 生命周期 ----------

class Life:
    last = time.monotonic()
    bye = False
    restart = False


def watchdog(srv: ThreadingHTTPServer) -> None:
    while True:
        time.sleep(2)
        if Win.window is not None:
            continue  # pywebview 窗口：窗口关了程序才退出，不看网页心跳
        idle = time.monotonic() - Life.last
        if (Life.bye and idle > 5) or idle > IDLE_EXIT or Life.restart:
            srv.shutdown()
            return


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "pwbook"

    def log_message(self, *args):
        pass

    def send(self, code: int, body: bytes, ctype: str, csp: str = CSP, cache: bool = False) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=31536000, immutable" if cache else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", csp)
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code: int = 200) -> None:
        self.send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def prepare(self):
        # 校验 Host，防止 DNS 重绑定攻击
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send(403, b"forbidden", "text/plain")
            return None
        u = urlparse(self.path)
        return u, parse_qs(u.query)

    def authed(self, qs) -> bool:
        tok = self.headers.get("X-Token") or (qs.get("t") or [""])[0]
        return secrets.compare_digest(tok.encode(), TOKEN.encode())

    def do_GET(self):
        got = self.prepare()
        if not got:
            return
        u, qs = got
        if u.path in STATIC:
            name, ctype = STATIC[u.path]
            body = (WEB / name).read_bytes()
            if name == "index.html":  # 把本机保存的主题和设置带给页面，端口每次不同，浏览器自己存的会丢
                st = load_settings()
                attrs = (f'data-theme="dark" data-saved-theme="{saved_theme()}" data-font="{st["font"]}"'
                         f'{" data-font-ui" if st["fontUI"] else ""} style="--av:{st["iconSize"] / 100};--mav:{st["mapIconSize"] / 100}"')
                body = body.replace(b'data-theme="dark"', attrs.encode(), 1)
            return self.send(200, body, ctype)
        if m := FONT_RE.match(u.path):  # 内置字体，不含隐私内容，可以缓存
            f = WEB / "fonts" / m.group(1)
            if f.is_file():
                return self.send(200, f.read_bytes(), "font/woff2", cache=True)
        if not self.authed(qs):
            return self.json({"error": "令牌无效，请重新打开程序"}, 401)
        try:
            if u.path == "/api/data":
                return self.json(load_all())
            if u.path == "/api/status":
                return self.json(status())
            if u.path == "/api/window":
                return self.json(window_state())
            if u.path == "/api/snapshots":
                return self.json({"snapshots": list_snapshots()})
            if u.path == "/api/revert-info":
                return self.json(revert_info())
            if u.path == "/api/icon":
                p = icon_path((qs.get("name") or [""])[0])
                return self.send(200, p.read_bytes(), ICON_TYPES[p.suffix.lower()], ICON_CSP)
        except Exception as e:  # noqa: BLE001
            log_error()
            return self.json({"error": str(e)}, 400)
        self.json({"error": "not found"}, 404)

    def do_POST(self):
        got = self.prepare()
        if not got:
            return
        u, qs = got
        if not self.authed(qs):
            return self.json({"error": "令牌无效，请重新打开程序"}, 401)
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            return self.json({"error": "文件太大（上限 40MB）"}, 413)
        raw = self.rfile.read(length) if length else b""
        try:
            if u.path == "/api/ping":
                Life.last, Life.bye = time.monotonic(), False
                return self.json({"ok": True, "pid": os.getpid()})
            if u.path == "/api/bye":
                Life.last, Life.bye = time.monotonic(), True
                return self.json({"ok": True})
            if u.path == "/api/icon":
                return self.json({"ok": True, "name": save_icon(raw)})
            if u.path == "/api/parse-text":  # 导入 txt：原始字节，自动识别 UTF-8 / GBK
                text = decode_text(raw)
                return self.json({"ok": True, "entries": importer.parse_text(text), "text": text})
            body = json.loads(raw.decode("utf-8") or "{}")
            if u.path == "/api/save":
                save_category(body.get("name"), body.get("entries"))
                return self.json({"ok": True})
            if u.path == "/api/category":
                return self.json(category_action(body))
            if u.path == "/api/graph":
                save_graph(body)
                return self.json({"ok": True})
            if u.path == "/api/autolink-log":
                save_autolink(body.get("runs"))
                return self.json({"ok": True})
            if u.path == "/api/autolink-snapshot":  # 一键连线前整体备份一份，在「备份」里也能恢复
                return self.json({"ok": True, "name": snapshot("连线前").name})
            if u.path == "/api/icon-auto":
                return self.json({"ok": True, "name": auto_icon(body.get("url"), body.get("name"))})
            if u.path == "/api/icon-search":
                return self.json({"ok": True, "icons": icon_search(body.get("url"), body.get("name"))})
            if u.path == "/api/update-check":
                return self.json(update_check())
            if u.path == "/api/update-apply":
                return self.json(update_apply())
            if u.path == "/api/snapshot-restore":
                return self.json(restore_snapshot(body.get("name")))
            if u.path == "/api/restart":
                request_restart()
                return self.json({"ok": True})
            if u.path == "/api/window-open":
                if window_state()["state"] != "ready":
                    raise ValueError("新窗口还没准备好")
                Win.want.set()
                return self.json({"ok": True})
            if u.path == "/api/settings":
                return self.json({"ok": True, "settings": save_settings(body)})
            if u.path == "/api/theme":
                set_theme(body.get("theme"))
                return self.json({"ok": True})
            if u.path == "/api/upload":
                return self.json(upload_step(body.get("step")))
        except Exception as e:  # noqa: BLE001
            log_error()
            return self.json({"error": str(e)}, 400)
        self.json({"error": "not found"}, 404)


def log_error_text(msg: str) -> None:
    with contextlib.suppress(OSError):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(DATA_DIR / "错误日志.txt", "a", encoding="utf-8") as f:
            f.write(f"\n[{datetime.now():%Y-%m-%d %H:%M:%S}]\n{msg}\n")


def log_error() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(DATA_DIR / "错误日志.txt", "a", encoding="utf-8") as f:
            f.write(f"\n[{datetime.now():%Y-%m-%d %H:%M:%S}]\n{traceback.format_exc()}")
    except OSError:
        pass


# ---------- 窗口 ----------
# 优先用 pywebview（WebView2）开一个普通的 Windows 窗口，把标题栏涂成和界面一样的颜色；
# 没装 pywebview 或 WebView2 用不了时，退回 Edge / Chrome 的应用模式窗口（标题栏颜色改不了）。

ICON = Path(__file__).resolve().parent / "app_icon.ico"
THEME_FILE = DATA_DIR / "主题.txt"
TITLE_BAR = {"light": ("#eceef8", "#151927"), "dark": ("#0c0e16", "#eceef7")}  # 标题栏背景色、文字色


class Win:
    window = None  # pywebview 窗口；用 Edge 窗口时是 None
    hwnd = 0
    theme = ""
    installing = False
    error = ""                      # 装不上 / 打不开新窗口的原因
    want = threading.Event()        # Edge 窗口里的页面请求换成新窗口


def webview_installed() -> bool:
    importlib.invalidate_caches()
    with contextlib.suppress(Exception):  # 刚用 pip --user 装好时，用户目录可能还不在 sys.path 里
        import site
        user_site = site.getusersitepackages()
        if os.path.isdir(user_site) and user_site not in sys.path:
            site.addsitedir(user_site)
    return importlib.util.find_spec("webview") is not None


def install_webview_async() -> None:
    """没装 pywebview 就在后台悄悄装（要联网），装好后页面会自动换成新窗口。"""
    if os.name != "nt" or Win.installing or webview_installed():
        return
    Win.installing, Win.error = True, ""

    def work():
        try:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "pywebview"],
                               capture_output=True, stdin=subprocess.DEVNULL, timeout=600, creationflags=NO_WINDOW)
            if r.returncode or not webview_installed():
                tail = (r.stderr or r.stdout).decode("utf-8", "replace").strip().splitlines()[-3:]
                Win.error = "安装 pywebview 失败：" + (" / ".join(tail) or f"pip 返回 {r.returncode}")
        except Exception as e:  # noqa: BLE001
            Win.error = f"安装 pywebview 失败：{e}"
        finally:
            Win.installing = False
        if Win.error:
            log_error_text(Win.error)

    threading.Thread(target=work, daemon=True).start()


def window_state() -> dict:
    if Win.window is not None:
        state = "active"
    elif os.name != "nt":
        state = "unsupported"
    elif Win.installing:
        state = "installing"
    elif Win.error:
        state = "failed"
    elif webview_installed():
        state = "ready"
    else:
        state = "missing"
    return {"state": state, "error": Win.error}


def saved_theme() -> str:
    try:
        t = THEME_FILE.read_text(encoding="utf-8").strip()
        if t in TITLE_BAR:
            return t
    except OSError:
        pass
    return ""


def system_theme() -> str:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as k:
            return "light" if winreg.QueryValueEx(k, "AppsUseLightTheme")[0] else "dark"
    except Exception:  # noqa: BLE001
        return "dark"


SETTINGS_FILE = DATA_DIR / "设置.json"
LAYOUTS = ("grid", "graph")  # 卡片 / 关系图
ICON_SIZE = (60, 200)  # 图标大小，百分比
MAP_ICON_SIZE = (50, 300)  # 关系图里再单独乘的倍数，百分比


def icon_size(v, rng=ICON_SIZE) -> int:
    try:
        v = int(round(float(v)))
    except (TypeError, ValueError, OverflowError):
        return 100
    return min(rng[1], max(rng[0], v))


QUICK_FIELDS = ["支付密码", "绑定手机", "密保问题", "密保答案", "恢复码", "用户ID"]  # 编辑窗口「添加字段」里的按钮
NEW_FIELDS = ["网址", "账户名", "邮箱", "密码", "密保", "备注"]  # 新增记录时默认带的字段
TIDY_GAPS = ("s", "m", "l")  # 关系图「自动理图」的距离：小 / 中 / 大
LINK_WORDS = ["注册邮箱", "绑定手机", "第三方登录", "找回密码", "同一账号", "子账号", "付款"]  # 关系图里写连线关系时的快捷词


def field_list(v, default: list[str]) -> list[str]:
    if not isinstance(v, list):
        return list(default)
    out = []
    for x in v[:40]:
        label = clean_label(x)
        if label and label != ICON_LABEL and label not in out:
            out.append(label)
    return out


def word_list(v, default: list[str]) -> list[str]:
    if not isinstance(v, list):
        return list(default)
    out = []
    for x in v[:40]:
        w = one_line(x)[:20].strip()
        if w and w not in out:
            out.append(w)
    return out


FONTS = ("system", "thin", "news", "song", "wenkai", "xiaowei", "brush", "mono")  # 和 style.css 里的 data-font 对应


def load_settings() -> dict:
    st = {"font": "system", "fontUI": False, "autoIcon": True, "layout": "grid", "iconSize": 100, "mapIconSize": 100,
          "quickFields": list(QUICK_FIELDS), "newFields": list(NEW_FIELDS), "linkWords": list(LINK_WORDS), "tidyGap": "m"}
    with contextlib.suppress(OSError, ValueError):
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if raw.get("font") in FONTS:
            st["font"] = raw["font"]
        st["fontUI"] = bool(raw.get("fontUI"))
        st["autoIcon"] = bool(raw.get("autoIcon", True))
        if raw.get("layout") in LAYOUTS:
            st["layout"] = raw["layout"]
        st["iconSize"] = icon_size(raw.get("iconSize", 100))
        st["mapIconSize"] = icon_size(raw.get("mapIconSize", 100), MAP_ICON_SIZE)
        st["quickFields"] = field_list(raw.get("quickFields"), QUICK_FIELDS)
        st["newFields"] = field_list(raw.get("newFields"), NEW_FIELDS)
        st["linkWords"] = word_list(raw.get("linkWords"), LINK_WORDS)
        if raw.get("tidyGap") in TIDY_GAPS:
            st["tidyGap"] = raw["tidyGap"]
    return st


def save_settings(body: dict) -> dict:
    st = load_settings()
    if "font" in body:
        if body["font"] not in FONTS:
            raise ValueError("未知字体")
        st["font"] = body["font"]
    for k in ("fontUI", "autoIcon"):
        if k in body:
            st[k] = bool(body[k])
    if "iconSize" in body:
        st["iconSize"] = icon_size(body["iconSize"])
    if "mapIconSize" in body:
        st["mapIconSize"] = icon_size(body["mapIconSize"], MAP_ICON_SIZE)
    for k, default in (("quickFields", QUICK_FIELDS), ("newFields", NEW_FIELDS)):
        if k in body:
            st[k] = field_list(body[k], default)
    if "linkWords" in body:
        st["linkWords"] = word_list(body["linkWords"], LINK_WORDS)
    if "tidyGap" in body:
        if body["tidyGap"] not in TIDY_GAPS:
            raise ValueError("未知距离")
        st["tidyGap"] = body["tidyGap"]
    if "layout" in body:
        if body["layout"] not in LAYOUTS:
            raise ValueError("未知视图")
        st["layout"] = body["layout"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    return st


def set_theme(theme) -> None:
    if theme not in TITLE_BAR:
        raise ValueError("未知主题")
    Win.theme = theme
    if saved_theme() != theme:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        THEME_FILE.write_text(theme, encoding="utf-8")
    paint_title_bar()


def paint_title_bar() -> None:
    """用 Windows 的 DWM 接口给标题栏上色（Windows 11 支持自定义颜色，Windows 10 只能深 / 浅两种）。"""
    if not Win.hwnd or os.name != "nt":
        return
    bg, fg = TITLE_BAR[Win.theme or "dark"]
    ref = lambda h: int(h[5:7], 16) << 16 | int(h[3:5], 16) << 8 | int(h[1:3], 16)  # noqa: E731  #rrggbb -> COLORREF

    def put(attr: int, value: int) -> None:
        v = ctypes.c_int(value)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(ctypes.c_void_p(Win.hwnd), ctypes.c_uint(attr),
                                                   ctypes.byref(v), ctypes.c_uint(4))
    try:
        put(20, 1 if Win.theme == "dark" else 0)  # 深色模式的标题栏按钮
        put(38, 1)                                 # 不用 Mica 半透明背景，否则自定义颜色不明显
        put(35, ref(bg))                           # 标题栏背景
        put(36, ref(fg))                           # 标题文字
    except Exception:  # noqa: BLE001
        log_error()


def load_webview():
    """能用 WebView2 时返回 webview 模块，否则返回 None。"""
    if os.name != "nt":
        return None
    try:
        import webview
        from webview.platforms import winforms
    except Exception:  # noqa: BLE001
        log_error()
        return None
    # 没有 WebView2 时 pywebview 会悄悄退回 IE 内核，界面会坏掉，宁可用 Edge 窗口
    return webview if getattr(winforms, "renderer", "") == "edgechromium" else None


def run_webview(url: str) -> bool:
    """打开 pywebview 窗口，一直阻塞到窗口关闭。打不开返回 False。"""
    webview = load_webview()
    if not webview:
        Win.error = Win.error or "新窗口打不开（pywebview 没装好，或者电脑缺少 WebView2），先用 Edge 窗口。"
        return False
    Win.theme = saved_theme() or system_theme()
    with contextlib.suppress(Exception):  # 任务栏上显示程序自己的图标，而不是 Python 的
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("pwbook.personal-password-records")
    w = webview.create_window("个人密码记录", url, width=1320, height=860, min_size=(760, 520),
                              background_color=TITLE_BAR[Win.theme][0], text_select=True)
    Win.window = w

    def on_shown():
        try:
            Win.hwnd = w.native.Handle.ToInt32()
            paint_title_bar()
            from Microsoft.Win32 import SystemEvents  # 系统切换深浅色时 pywebview 会改标题栏，改回来
            SystemEvents.UserPreferenceChanged += lambda *_: paint_title_bar()
        except Exception:  # noqa: BLE001
            log_error()

    w.events.shown += on_shown
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(DATA_DIR / "webview"),
                      icon=str(ICON) if ICON.exists() else None)
    except Exception as e:  # noqa: BLE001
        log_error()
        Win.window = None
        if not Win.hwnd:
            Win.error = f"新窗口打不开：{e}"
        return bool(Win.hwnd)  # 窗口已经出现过就算正常结束
    return True


def request_restart() -> None:
    if Win.window is not None:
        # pywebview 窗口属于这个进程：先启动新进程开新窗口，再关掉旧窗口
        subprocess.Popen([sys.executable, str(Path(__file__).resolve())], cwd=ROOT, creationflags=NO_WINDOW)
        threading.Timer(2.0, Win.window.destroy).start()
    else:
        Life.restart = True


def open_window(url: str) -> None:
    """优先用 Edge / Chrome 的应用模式打开，看起来像独立程序。"""
    cands = []
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe",
                      Path(base) / "Google/Chrome/Application/chrome.exe"]
    for exe in cands:
        if exe.exists():
            subprocess.Popen([str(exe), f"--app={url}", f"--user-data-dir={DATA_DIR / 'window'}",
                              "--window-size=1320,860", "--no-first-run", "--no-default-browser-check"],
                             creationflags=NO_WINDOW)
            return
    webbrowser.open(url)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-window", action="store_true", help="只启动服务，不打开窗口")
    args = ap.parse_args()
    SRC.mkdir(exist_ok=True)
    srv = None
    for _ in range(50):  # 重启时旧进程可能还没放开端口
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
            break
        except OSError:
            if not args.port:
                raise
            time.sleep(0.2)
    if srv is None:
        raise OSError(f"端口 {args.port} 被占用")
    url = f"http://127.0.0.1:{srv.server_port}/?t={TOKEN}"
    print(url, flush=True)
    threading.Thread(target=watchdog, args=(srv,), daemon=True).start()
    serving = threading.Thread(target=srv.serve_forever, daemon=True)
    serving.start()
    win_url = url + "&w=1"  # 页面靠这个参数知道自己在新窗口里
    if not args.no_window:
        if run_webview(win_url):  # 阻塞到窗口关闭
            srv.shutdown()
        else:
            open_window(url)
    install_webview_async()
    # 用 Edge 窗口时，等页面请求换成新窗口；pywebview 必须在主线程里跑
    while serving.is_alive():
        if Win.want.wait(0.5):
            Win.want.clear()
            if run_webview(win_url):
                srv.shutdown()
                break
    serving.join()
    srv.server_close()
    if Life.restart:
        # 更新了程序文件：用同一个端口和令牌启动新进程，窗口刷新一下就能接上
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--port", str(srv.server_port), "--no-window"],
                         cwd=ROOT, env=dict(os.environ, PWBOOK_TOKEN=TOKEN), creationflags=NO_WINDOW)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        log_error()
        raise
