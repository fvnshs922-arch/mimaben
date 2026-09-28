"""联网找图标用到的辅助数据和判断（不联网，方便单独测试）。

- KNOWN：常用网站 / 应用的名字 -> 官网域名、Simple Icons 图标名、App Store 英文名
- name_score：App Store 搜到的应用名和记录名对不对得上
- image_size：读图片文件头拿到宽度，用来把模糊的小图排到后面
"""
from __future__ import annotations

import re
import struct

# 名字（多个别名用 | 分开） -> (官网域名, Simple Icons 名, App Store 搜索用的英文名)
_KNOWN = {
    "微信|wechat|weixin": ("weixin.qq.com", "wechat", "WeChat"),
    "企业微信|wecom": ("work.weixin.qq.com", None, "WeCom"),
    "qq|腾讯qq": ("im.qq.com", "tencentqq", "QQ"),
    "qq邮箱|qqmail": ("mail.qq.com", None, "QQ Mail"),
    "腾讯视频": ("v.qq.com", None, "Tencent Video"),
    "腾讯会议|voov": ("meeting.tencent.com", None, "VooV Meeting"),
    "腾讯云": ("cloud.tencent.com", None, None),
    "王者荣耀|honor of kings": ("pvp.qq.com", None, "Honor of Kings"),
    "和平精英": ("gp.qq.com", None, None),
    "英雄联盟|lol|league of legends": ("lol.qq.com", "leagueoflegends", "League of Legends"),
    "淘宝|taobao": ("taobao.com", "taobao", "Taobao"),
    "天猫|tmall": ("tmall.com", None, "Tmall"),
    "支付宝|alipay": ("alipay.com", "alipay", "Alipay"),
    "闲鱼|goofish|xianyu": ("goofish.com", None, "Xianyu"),
    "阿里云|aliyun|alibaba cloud": ("aliyun.com", "alibabacloud", None),
    "钉钉|dingtalk": ("dingtalk.com", None, "DingTalk"),
    "夸克|quark": ("quark.cn", None, "Quark"),
    "优酷|youku": ("youku.com", None, "Youku"),
    "高德|高德地图|amap": ("amap.com", None, "Amap"),
    "饿了么|eleme": ("ele.me", None, None),
    "京东|jd|jingdong": ("jd.com", None, "JD"),
    "拼多多|pinduoduo|pdd": ("pinduoduo.com", None, "Pinduoduo"),
    "美团|meituan": ("meituan.com", "meituan", "Meituan"),
    "大众点评|dianping": ("dianping.com", None, "Dianping"),
    "抖音|douyin": ("douyin.com", None, "Douyin"),
    "今日头条|头条|toutiao": ("toutiao.com", None, "Toutiao"),
    "飞书|feishu|lark": ("feishu.cn", None, "Lark"),
    "剪映|capcut": ("capcut.com", "capcut", "CapCut"),
    "tiktok": ("tiktok.com", "tiktok", "TikTok"),
    "快手|kuaishou|kwai": ("kuaishou.com", "kuaishou", "Kuaishou"),
    "哔哩哔哩|b站|bilibili": ("bilibili.com", "bilibili", "bilibili"),
    "微博|新浪微博|weibo": ("weibo.com", "sinaweibo", "Weibo"),
    "知乎|zhihu": ("zhihu.com", "zhihu", "Zhihu"),
    "小红书|xiaohongshu|rednote": ("xiaohongshu.com", "xiaohongshu", "RED"),
    "豆瓣|douban": ("douban.com", "douban", "Douban"),
    "百度|baidu": ("baidu.com", "baidu", "Baidu"),
    "百度网盘|百度云|baidu netdisk": ("pan.baidu.com", None, "Baidu Netdisk"),
    "网易云音乐|网易云|netease cloud music": ("music.163.com", "neteasecloudmusic", "NetEase Cloud Music"),
    "网易邮箱|163邮箱|163": ("mail.163.com", None, "NetEase Mail"),
    "126邮箱|126": ("mail.126.com", None, None),
    "网易|netease": ("163.com", "netease", None),
    "qq音乐|qqmusic": ("y.qq.com", None, "QQ Music"),
    "酷狗|酷狗音乐|kugou": ("kugou.com", None, "Kugou"),
    "爱奇艺|iqiyi": ("iqiyi.com", "iqiyi", "iQIYI"),
    "芒果tv|mangotv": ("mgtv.com", None, "MangoTV"),
    "虎牙|huya": ("huya.com", None, "Huya"),
    "斗鱼|douyu": ("douyu.com", None, "Douyu"),
    "携程|ctrip|trip.com": ("ctrip.com", "tripdotcom", "Trip.com"),
    "去哪儿|qunar": ("qunar.com", None, None),
    "飞猪|fliggy": ("fliggy.com", None, "Fliggy"),
    "12306|铁路12306": ("12306.cn", None, None),
    "滴滴|didi": ("didiglobal.com", "didi", "DiDi"),
    "唯品会|vip.com": ("vip.com", None, None),
    "苏宁|苏宁易购": ("suning.com", None, None),
    "得物|dewu|poizon": ("dewu.com", None, "POIZON"),
    "米哈游|mihoyo|hoyoverse": ("mihoyo.com", "hoyoverse", None),
    "原神|genshin|genshin impact": ("ys.mihoyo.com", "genshinimpact", "Genshin Impact"),
    "崩坏星穹铁道|星穹铁道|honkai star rail": ("sr.mihoyo.com", None, "Honkai: Star Rail"),
    "网易游戏": ("game.163.com", None, None),
    "招商银行|招行|cmb": ("cmbchina.com", None, "China Merchants Bank"),
    "工商银行|工行|icbc": ("icbc.com.cn", "icbc", "ICBC"),
    "建设银行|建行|ccb": ("ccb.com", None, None),
    "农业银行|农行|abc": ("abchina.com", None, None),
    "中国银行|中行|boc": ("boc.cn", None, None),
    "交通银行|交行": ("bankcomm.com", None, None),
    "邮储银行|邮政储蓄": ("psbc.com", None, None),
    "浦发银行": ("spdb.com.cn", None, None),
    "中信银行": ("citicbank.com", None, None),
    "平安银行|平安": ("pingan.com", None, None),
    "云闪付|银联|unionpay": ("unionpay.com", "unionpay", "UnionPay"),
    "中国移动|移动|10086": ("10086.cn", None, None),
    "中国联通|联通|10010": ("10010.com", None, None),
    "中国电信|电信|189": ("189.cn", None, None),
    "学信网|chsi": ("chsi.com.cn", None, None),
    "个人所得税|个税": ("etax.chinatax.gov.cn", None, None),
    "交管12123|12123": ("122.gov.cn", None, None),
    "华为|huawei": ("huawei.com", "huawei", "Huawei"),
    "小米|xiaomi|mi": ("mi.com", "xiaomi", "Xiaomi"),
    "oppo": ("oppo.com", "oppo", None),
    "vivo": ("vivo.com", "vivo", None),
    "联想|lenovo": ("lenovo.com", "lenovo", None),
    "telegram|电报|tg": ("telegram.org", "telegram", "Telegram Messenger"),
    "whatsapp": ("whatsapp.com", "whatsapp", "WhatsApp Messenger"),
    "signal": ("signal.org", "signal", "Signal"),
    "line": ("line.me", "line", "LINE"),
    "discord": ("discord.com", "discord", "Discord"),
    "slack": ("slack.com", "slack", "Slack"),
    "zoom": ("zoom.us", "zoom", "Zoom"),
    "skype": ("skype.com", "skype", "Skype"),
    "google|谷歌": ("google.com", "google", "Google"),
    "gmail|谷歌邮箱|google邮箱": ("mail.google.com", "gmail", "Gmail"),
    "youtube|油管": ("youtube.com", "youtube", "YouTube"),
    "google drive|谷歌云端硬盘": ("drive.google.com", "googledrive", "Google Drive"),
    "apple|苹果|apple id|icloud": ("apple.com", "apple", None),
    "microsoft|微软|outlook|hotmail|office|microsoft 365": ("microsoft.com", "microsoft", "Microsoft Outlook"),
    "xbox": ("xbox.com", "xbox", "Xbox"),
    "playstation|psn|索尼": ("playstation.com", "playstation", "PlayStation App"),
    "nintendo|任天堂|switch": ("nintendo.com", "nintendo", "Nintendo Switch Online"),
    "steam": ("store.steampowered.com", "steam", "Steam Mobile"),
    "epic|epic games": ("epicgames.com", "epicgames", "Epic Games Store"),
    "ubisoft|育碧": ("ubisoft.com", "ubisoft", None),
    "ea|origin": ("ea.com", "ea", None),
    "battle.net|暴雪|blizzard|战网": ("battle.net", "battledotnet", None),
    "twitter|推特|x": ("x.com", "x", "X"),
    "facebook|脸书|fb": ("facebook.com", "facebook", "Facebook"),
    "instagram|ins|ig": ("instagram.com", "instagram", "Instagram"),
    "threads": ("threads.net", "threads", "Threads"),
    "reddit": ("reddit.com", "reddit", "Reddit"),
    "linkedin|领英": ("linkedin.com", "linkedin", "LinkedIn"),
    "tumblr": ("tumblr.com", "tumblr", "Tumblr"),
    "pinterest": ("pinterest.com", "pinterest", "Pinterest"),
    "twitch": ("twitch.tv", "twitch", "Twitch"),
    "netflix|网飞|奈飞": ("netflix.com", "netflix", "Netflix"),
    "spotify": ("spotify.com", "spotify", "Spotify"),
    "disney+|disney plus|迪士尼": ("disneyplus.com", None, "Disney+"),
    "amazon|亚马逊": ("amazon.com", "amazon", "Amazon Shopping"),
    "ebay": ("ebay.com", "ebay", "eBay"),
    "paypal|贝宝": ("paypal.com", "paypal", "PayPal"),
    "github": ("github.com", "github", "GitHub"),
    "gitlab": ("gitlab.com", "gitlab", None),
    "gitee|码云": ("gitee.com", "gitee", None),
    "dropbox": ("dropbox.com", "dropbox", "Dropbox"),
    "notion": ("notion.so", "notion", "Notion"),
    "evernote|印象笔记": ("evernote.com", "evernote", "Evernote"),
    "figma": ("figma.com", "figma", None),
    "canva": ("canva.com", "canva", "Canva"),
    "adobe": ("adobe.com", "adobe", None),
    "chatgpt|openai": ("chatgpt.com", "openai", "ChatGPT"),
    "claude|anthropic": ("claude.ai", "claude", "Claude by Anthropic"),
    "gemini": ("gemini.google.com", "googlegemini", "Google Gemini"),
    "deepseek|深度求索": ("deepseek.com", None, "DeepSeek"),
    "kimi|月之暗面": ("kimi.com", None, "Kimi"),
    "豆包|doubao": ("doubao.com", None, None),
    "minecraft|我的世界|mc": ("minecraft.net", "minecraft", "Minecraft"),
    "roblox|罗布乐思": ("roblox.com", "roblox", "Roblox"),
    "cloudflare": ("cloudflare.com", "cloudflare", None),
    "stack overflow|stackoverflow": ("stackoverflow.com", "stackoverflow", None),
    "wikipedia|维基百科": ("wikipedia.org", "wikipedia", "Wikipedia"),
    "airbnb|爱彼迎": ("airbnb.com", "airbnb", "Airbnb"),
    "uber": ("uber.com", "uber", "Uber"),
    "booking": ("booking.com", "bookingdotcom", "Booking.com"),
    "binance|币安": ("binance.com", "binance", "Binance"),
    "okx|欧易": ("okx.com", "okx", "OKX"),
    "coinbase": ("coinbase.com", "coinbase", "Coinbase"),
}
KNOWN = {alias.strip(): v for keys, v in _KNOWN.items() for alias in keys.split("|")}


def norm(s: str) -> str:
    return re.sub(r"[\s\-_.·・:：()（）'’!！+]", "", str(s or "").lower())


# 名字里的区服 -> App Store 地区
REGIONS = {"日区": "jp", "日服": "jp", "日本": "jp", "美区": "us", "美服": "us", "港区": "hk", "港服": "hk",
           "台区": "tw", "台服": "tw", "国区": "cn", "国服": "cn", "韩区": "kr", "韩服": "kr", "英区": "gb",
           "欧服": "de", "国际服": "us", "外服": "us"}
_SUFFIX = ("大号", "小号", "主号", "备用号", "备用", "账号", "帐号", "账户", "登录", "会员", "官网", "网页版", "客户端",
           "app", "id") + tuple(REGIONS)
_BRACKETS = re.compile(r"[（(\[【{《][^）)\]】}》]*[）)\]】}》]")


def core_name(name: str) -> str:
    """去掉括号里的备注和「日区」「小号」这类后缀：Apple ID（日区）-> Apple ID，Steam小号 -> Steam。"""
    s = _BRACKETS.sub(" ", str(name or "")).strip()
    changed = True
    while changed and s:
        changed = False
        for suf in _SUFFIX:
            if s.lower().endswith(suf) and len(s) > len(suf) and not (suf == "id" and lookup_exact(s)):
                s = s[:-len(suf)].rstrip(" -_·—:：/|")
                changed = True
        s2 = re.sub(r"[\s\-_#]*\d{1,2}$", "", s)  # 末尾编号：QQ2、微信 2
        if s2 != s and s2:
            s, changed = s2, True
    return s.strip() or str(name or "").strip()


def region(name: str) -> str:
    return next((c for k, c in REGIONS.items() if k in str(name or "")), "")


def lookup_exact(name: str):
    n = str(name or "").strip().lower()
    if n in KNOWN:
        return KNOWN[n]
    nn = norm(n)
    return next((v for alias, v in KNOWN.items() if norm(alias) == nn), None)


def lookup(name: str):
    """记录名 -> (域名, Simple Icons 名, App Store 英文名)；认不出返回 None。
    先按全名找，再按去掉备注后的名字找，最后看名字开头是不是某个常用网站（Steam小号 -> Steam）。"""
    core = core_name(name)
    for n in (name, core):
        if v := lookup_exact(n):
            return v
    nc = norm(core)
    for alias in sorted(KNOWN, key=lambda a: -len(norm(a))):
        na = norm(alias)
        if len(na) >= 2 and nc.startswith(na):
            rest = nc[len(na):len(na) + 1]
            if na.isascii() and rest.isascii() and rest.isalnum():
                continue  # 英文名要整词对上：mi 不能匹配 minecraft
            return KNOWN[alias]
    return None


def simple_icon_slug(name: str) -> str:
    """Simple Icons 的图标名：小写、去掉空格和符号，比如 Netflix -> netflix。"""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower().replace("+", "plus").replace(".", "dot"))


def name_score(query: str, app_name: str) -> int:
    """App Store 搜到的应用名和记录名的吻合程度：3 完全一样，2 开头一样，1 包含，0 对不上（不要）。"""
    q, a = norm(query), norm(app_name)
    if not q or not a:
        return 0
    if a == q:
        return 3
    first = norm(re.split(r"[\s\-–—:：|·(（]", str(app_name).strip())[0])
    if first == q or a.startswith(q) or q.startswith(a):
        return 2
    if len(q) >= 2 and q in a:
        return 1
    return 0


def image_size(data: bytes) -> int:
    """图片宽度（像素）；svg 当作很大；读不出来返回 0。"""
    try:
        head = data[:64]
        if head.startswith(b"\x89PNG"):
            return struct.unpack(">I", data[16:20])[0]
        if head[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<H", data[6:8])[0]
        if head[:4] == b"\x00\x00\x01\x00":  # ico：取最大的那张，0 表示 256
            n = struct.unpack("<H", data[4:6])[0]
            return max((data[6 + 16 * i] or 256) for i in range(min(n, 32)))
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8 ":
                return struct.unpack("<H", data[26:28])[0] & 0x3FFF
            if chunk == b"VP8L":
                return (struct.unpack("<I", data[21:25])[0] & 0x3FFF) + 1
            if chunk == b"VP8X":
                return int.from_bytes(data[24:27], "little") + 1
        if head[:2] == b"\xff\xd8":  # jpeg：找 SOF 段
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    return struct.unpack(">H", data[i + 7:i + 9])[0]
                i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
        if head[:2] == b"BM":
            return abs(struct.unpack("<i", data[18:22])[0])
        text = data[:4096].decode("utf-8", "ignore").lower()
        if "<svg" in text:
            return 512
    except (struct.error, IndexError):
        pass
    return 0
