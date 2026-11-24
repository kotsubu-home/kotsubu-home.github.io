# -*- coding: utf-8 -*-
"""動画の概要欄から、日付のある告知（ライブ・イベント・配信）を拾う"""
import re, datetime as dt, unicodedata

JST = dt.timezone(dt.timedelta(hours=9))
DATE = re.compile(r"(?<![\d./:])(?:(20\d\d)\s*[./年]\s*)?(\d{1,2})\s*([./月])\s*(\d{1,2})(?![\d./:%])(?:日(?!曜))?")
TIME = re.compile(r"(\d{1,2})\s*(?:時(?:(\d{1,2})分)?|:(\d{2}))")
WEEK = re.compile(r"\s*(?:[(][^)]{1,6}[)]|[月火水木金土日]曜日?)?")
SKIP = re.compile(r"発売|販売|ON ?SALE|募集", re.I)
END = re.compile(r"お振込|ゲーセンミカド大会スケジュール|再生リスト")  # ここから下は毎回同じ案内
NOT_TITLE = re.compile(r"(会場|場所|日時|時間|出演|チケット|ゲスト)\s*[:▶]")


def _find(line, posted):
    for m in DATE.finditer(line):
        y, mo, sep, da = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
        if sep == "." and not y:
            continue  # 「1.5」のような数字を日付と間違えない
        days = []
        for yy in ([int(y)] if y else [posted.year - 1, posted.year, posted.year + 1]):
            try:
                days.append(dt.date(yy, mo, da))
            except ValueError:
                pass
        if not days:
            continue
        d = min(days, key=lambda x: abs((x - posted).days))
        if posted - dt.timedelta(days=1) <= d <= posted + dt.timedelta(days=200):
            rest = line[m.end():]
            rest = rest[WEEK.match(rest).end():]
            t = TIME.match(rest.lstrip(" 、,~〜"))
            hm = None
            if t:
                h, mi = int(t.group(1)), int(t.group(2) or t.group(3) or 0)
                if h <= 29 and mi < 60:
                    hm = f"{h:02d}:{mi:02d}"
            return d, hm, line[:m.start()], rest
    return None


def _clean(s):
    s = re.sub(r"https?://\S+|#\S+", "", s)
    clock = r"\d{1,2}\s*(?:時(?:\d{1,2}分)?|:\d{2})"
    s = re.sub(r"^\s*" + clock + r"\s*(?:から|より|~|〜|-)?\s*(?:" + clock + r"\s*(?:まで)?)?", "", s)
    s = re.sub(r"^\s*(?:から|より|~|〜|スタート|START|OPEN|開演|開場|開始)+[\s!、,]*", "", s, flags=re.I)
    return s.strip(" 　、,。!！~〜-・:")


def _title(candidates):
    for s in candidates:
        c = _clean(s)
        if not c or NOT_TITLE.match(c):
            continue
        # 行ぜんたいがカッコなら、外側だけ外す
        m = re.match(r"[「『【](.+)[」』】]$", c)
        if m:
            c = m.group(1)
        elif c[0] == "【" and "】" in c and len(c[1:c.index("】")]) >= 10:
            c = c[1:c.index("】")]
        return c[:50]
    return None


def extract(description, posted_unix):
    """[(日付, 時刻 or None, 題名, 本文)] を返す"""
    posted = dt.datetime.fromtimestamp(posted_unix, JST).date()
    text = unicodedata.normalize("NFKC", description or "")
    out = {}
    for block in re.split(r"\n\s*\n", text):
        if END.search(block):
            break
        lines = [x.strip() for x in block.splitlines() if x.strip() and not x.strip().startswith("http")]
        for i, line in enumerate(lines[:2]):  # 日付は最初の2行にあるものだけ
            f = _find(line, posted)
            if not f:
                continue
            if SKIP.search(line):
                break
            d, hm, before, rest = f
            title = _title([before, *lines[:i], rest, *lines[i + 1:]])
            if title:
                body = re.sub(r"https?://\S+", "", " ".join(lines))
                out[(d.isoformat(), title)] = (d.isoformat(), hm, title, body[:160])
            break
    return list(out.values())


def merge(old, found, today):
    """found: [(video_id, label, posted_unix, [予定...])]。同じ日・同じ題名は新しい動画の内容を使う"""
    by = {(e["date"], e["title"]): e for e in old}
    for vid, label, posted, evs in sorted(found, key=lambda x: x[2]):
        for d, hm, title, body in evs:
            prev = by.get((d, title))
            if prev and prev["posted"] > posted:
                continue
            by[(d, title)] = {"date": d, "time": hm or (prev or {}).get("time"), "title": title, "text": body,
                              "src": "yt", "url": "https://www.youtube.com/watch?v=" + vid,
                              "account": label, "posted": posted}
    limit = (today - dt.timedelta(days=400)).isoformat()
    return sorted((e for e in by.values() if e["date"] >= limit), key=lambda e: (e["date"], e["time"] or ""))
