"""把随手记的 txt 文字识别成记录（导入用）。

能认的写法（可以混着用）：
  1. 程序自己的格式：【QQ】 下面一行一个「字段：内容」
  2. 一段一个网站，第一行是名字，下面是「账号：xxx」「密码 xxx」这样的行
  3. 一行一个网站：「QQ 123456 abc123」「steam: user / pass」「微信----138xxxx----密码」
没有写字段名的内容按样子猜：网址、邮箱、手机号能认出来；剩下的依次当账户名、密码，再多的放备注。
"""
from __future__ import annotations

import re

# 常见写法 -> 程序里的字段名。长的写在前面，先匹配「支付密码」再匹配「密码」
LABELS = [
    (r"支付密码|交易密码", "支付密码"),
    (r"二级密码|安全密码", "二级密码"),
    (r"密保问题|安全问题|问题", "密保问题"),
    (r"密保答案|答案", "密保答案"),
    (r"密保邮箱|安全邮箱|备用邮箱", "密保邮箱"),
    (r"恢复码|恢复代码|备用码|recovery\s*codes?", "恢复码"),
    (r"绑定手机|手机号码|手机号|手机|电话|phone|mobile|tel", "绑定手机"),
    (r"邮箱|电子邮件|e-?mail|mail", "邮箱"),
    (r"密码|口令|password|passwd|pwd|pass|pw|密碼", "密码"),
    (r"密保", "密保"),
    (r"账户名|账户|账号|帳號|帐号|用户名|用户|登录名|登录账号|login|user(?:name)?|account|acc|id|uid|QQ号", "账户名"),
    (r"网址|网站|官网|地址|链接|url|link|site|website", "网址"),
    (r"备注|说明|note|notes|memo|remark", "备注"),
]
LABEL_RE = re.compile(r"(?i)(" + "|".join(p for p, _ in LABELS) + r")\s*[:：=＝]?\s*")
LABEL_START_RE = re.compile(r"(?i)^\s*(" + "|".join(p for p, _ in LABELS) + r")\s*(?:[:：=＝]\s*|\s+|$)")
URL_RE = re.compile(r"(?i)^(https?://\S+|www\.\S+|[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|cn|net|org|io|me|co|cc|tv|top|xyz|info|app|dev|gov|edu|hk|tw|jp|uk|us)(/\S*)?)$")
EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")
PHONE_RE = re.compile(r"^(\+?86[- ]?)?1[3-9]\d{9}$")
TITLE_RE = re.compile(r"^\s*【(.+?)】\s*(.*)$")
CUSTOM_RE = re.compile(r"^([^:：\s]{1,10})\s*[:：](?!//)\s*(.+)$")
SPLIT_RE = re.compile(r"\s*(?:-{2,}|\|+|/|，|,|；|;|\t|\s{1,})\s*")
ORDER = ["网址", "账户名", "邮箱", "绑定手机", "密码"]


def norm_label(raw: str) -> str:
    for pat, name in LABELS:
        if re.fullmatch(f"(?i)(?:{pat})", raw.strip()):
            return name
    return raw.strip()


def kind(tok: str) -> str:
    if EMAIL_RE.match(tok):
        return "邮箱"
    if URL_RE.match(tok):
        return "网址"
    if PHONE_RE.match(tok.replace(" ", "")):
        return "绑定手机"
    return ""


def label_matches(text: str) -> list:
    """找出一行里的字段名。英文字段名后面紧跟字母数字的不算（passport 里的 pass 不是密码）。"""
    out = []
    for m in LABEL_RE.finditer(text):
        word, i = m.group(1), m.start(1)
        prev = text[i - 1] if i else ""
        nxt = text[i + len(word):i + len(word) + 1]
        after = text[i + len(word):].lstrip()[:1]
        if word.isascii():
            if prev and (prev.isalnum() or prev in "_-.@/"):
                continue  # gh-pass、tb_user 里的 pass / user
            if nxt and (nxt.isalnum() or nxt in "_-.@"):
                continue  # passport 里的 pass
            if out and after not in (":", "：", "=", "＝"):
                continue  # 行中间的英文词要带冒号才算字段名，免得把「Pass word」拆开
        elif prev and "\u4e00" <= prev <= "\u9fff":
            continue  # 「网易邮箱」「游戏密码」这种是名字的一部分
        out.append(m)
    return out


def split_tokens(text: str) -> list[str]:
    """按空格、/、|、----、逗号等切开；网址整个保留，不在 / 处切断。"""
    out, pos = [], 0
    for m in re.finditer(r"(?i)https?://[^\s，,；;|]+", text):
        out += SPLIT_RE.split(text[pos:m.start()].strip())
        out.append(m.group(0))
        pos = m.end()
    out += SPLIT_RE.split(text[pos:].strip())
    return [t for t in out if t]


class Entry:
    def __init__(self, title: str = ""):
        self.title = title.strip()
        self.fields: list[list[str]] = []
        self.bracket = False

    def get(self, label):
        return next((f for f in self.fields if f[0] == label), None)

    def has_id(self) -> bool:
        return any(self.get(k) for k in ("账户名", "邮箱", "绑定手机"))

    def complete(self) -> bool:
        return self.has_id() and bool(self.get("密码"))

    def add(self, label: str, value: str) -> None:
        value = value.strip().strip("，,;；")
        if not value:
            return
        f = self.get(label)
        if f and label == "备注":
            f[1] += "；" + value
        else:
            self.fields.append([label, value])

    def add_guess(self, tok: str) -> None:
        """没写字段名的内容：网址、邮箱、手机号按样子认；其他的没有账号就当账号，有账号就当密码，再多放备注。"""
        k = kind(tok)
        if k and not self.get(k):
            return self.add(k, tok)
        if not self.has_id():
            return self.add("账户名", tok)
        if not self.get("密码"):
            return self.add("密码", tok)
        self.add("备注", tok)

    def add_text(self, text: str) -> None:
        """一段文字：前面没字段名的部分按样子猜，后面「字段名 内容」按字段名放。"""
        ms = label_matches(text)
        prefix = text[:ms[0].start()] if ms else text
        for t in split_tokens(prefix):
            self.add_guess(t)
        for i, m in enumerate(ms):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
            self.add(norm_label(m.group(1)), text[m.end():end])

    def done(self) -> dict | None:
        if not self.fields:
            return None
        title = self.title or guess_title(self)
        fields = sorted(self.fields, key=lambda f: ORDER.index(f[0]) if f[0] in ORDER else len(ORDER))
        return {"title": title[:60], "fields": [{"label": a, "value": b} for a, b in fields]}


def starts_with_label(line: str) -> bool:
    ms = label_matches(line)
    return bool(ms) and ms[0].start() == 0 and bool(LABEL_START_RE.match(line))


def guess_title(e: Entry) -> str:
    url = (e.get("网址") or [None, ""])[1] or ""
    host = re.sub(r"(?i)^https?://", "", url).split("/")[0].removeprefix("www.")
    if host:
        parts = host.split(".")
        return parts[-2] if len(parts) >= 2 else host
    mail = (e.get("邮箱") or [None, ""])[1]
    if mail and "@" in mail:
        return mail.split("@")[1].split(".")[0]
    return "未命名"


def one_line_entry(line: str) -> dict | None:
    """「QQ 123456 abc123」「steam: user / pass」「微信----138xxxx----密码」这种一行一个。"""
    line = line.strip()
    m = re.match(r"^([^:：\s]+?)\s*[:：](?!//)\s*(.+)$", line)
    if m:
        head, rest = m.group(1), m.group(2)
    else:
        toks = split_tokens(line)
        if len(toks) < 2:
            return None
        head, rest = toks[0], line[line.index(toks[0]) + len(toks[0]):]
    e = Entry()
    if kind(head) or starts_with_label(head + " "):  # 第一段就是账号 / 网址，不是名字
        e.add_text(line)
    else:
        e.title = head
        e.add_text(rest)
    return e.done()


def parse_text(text: str) -> list[dict]:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("　", " ")
    out: list[dict] = []
    cur: Entry | None = None

    def flush():
        nonlocal cur
        if cur is not None and (d := cur.done()):
            out.append(d)
        cur = None

    for raw in text.split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            if cur is not None and not cur.bracket:  # 空行结束一段；【】格式靠下一个【】分段
                flush()
            continue
        t = TITLE_RE.match(line)
        if t:
            flush()
            cur = Entry(t.group(1))
            cur.bracket = True
            if t.group(2):
                cur.add_text(t.group(2))
            continue
        if starts_with_label(line):
            if cur is None:
                cur = Entry()
            cur.add_text(line)
            continue
        toks = split_tokens(line)
        custom = CUSTOM_RE.match(line)
        if custom and label_matches(custom.group(2)) and (single := one_line_entry(line)):
            flush()  # 「网易邮箱: xx 密码: yy」：冒号后面还有字段名，是新的一条
            out.append(single)
            continue
        if custom and cur is not None and cur.title and (cur.bracket or not cur.complete()):
            cur.add(custom.group(1), custom.group(2))  # 没见过的字段名，比如「卡号：6225 ...」
            continue
        if cur is not None and cur.title:
            if len(toks) == 1 and cur.complete() and not kind(line) and not cur.bracket:
                flush()  # 上一个网站账号密码都齐了，又来一个单独的词：是下一个网站的名字
                cur = Entry(re.sub(r"[:：]\s*$", "", line))
                continue
            if len(toks) == 1 or kind(line) or not cur.fields or cur.bracket:
                cur.add_text(line)
                continue
        single = one_line_entry(line)
        if single:
            flush()
            out.append(single)
            continue
        flush()
        cur = Entry(re.sub(r"[:：]\s*$", "", line))
    flush()
    return out
