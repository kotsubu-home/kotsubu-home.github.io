# -*- coding: utf-8 -*-
"""
Xの投稿から予定（配信・出演・イベントなど）を拾って docs/data/x_events.json に保存し、GitHub に送る。
PC で動かしっぱなしにすると、30〜39分（ランダム）ごとに見に行く。

  python x_watch.py --login   … 最初の1回：ブラウザが開くので、自分で X にログインして閉じる
  python x_watch.py --once    … 1回だけ取得（テスト用）
  python x_watch.py           … ずっと動かす（7:00〜22:00 の間、30〜39分ごと）
"""
import os, re, sys, json, time, random, datetime as dt, subprocess, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "docs", "data", "x_events.json")
PROFILE = os.path.join(HERE, "profile")
LOG = os.path.join(HERE, "log.txt")
JST = dt.timezone(dt.timedelta(hours=9))

CONFIG = {
    "accounts": [
        {"user": "Kotsubu__retro", "filter": None},
        {"user": "babamikado", "filter": "村下|小粒"},
    ],
    "interval_min": 30, "interval_max": 39,
    "active_from": "07:00", "active_to": "22:00",
    "headless": True,
}
cfg_path = os.path.join(HERE, "xwatch_config.json")
if os.path.exists(cfg_path):
    with open(cfg_path, encoding="utf-8") as f:
        CONFIG.update(json.load(f))

KEYWORDS = re.compile(r"配信|出演|ライブ|LIVE|ＬＩＶＥ|イベント|開催|生放送|放送|特典会|ステージ|登場|来店|オンエア|ON ?AIR|"
                      r"公演|大会|ゲスト|生誕|撮影会|物販|スタート|開演|開場|OPEN|START|予定|告知|お知らせ", re.I)


def log(msg):
    line = f"{dt.datetime.now(JST):%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ---------------- 予定の取り出し ----------------
WD = "[月火水木金土日]"
P_FULL = re.compile(r"(20\d\d)\s*[./年]\s*(\d{1,2})\s*[./月]\s*(\d{1,2})日?")
P_MD = re.compile(r"(?<![\d./])(\d{1,2})\s*(?:月|/)\s*(\d{1,2})\s*日?(?![\d/])")
P_TIME = re.compile(r"(\d{1,2})\s*(?:時|:|：)\s*(\d{2})?\s*(?:分)?\s*(?:〜|~|～|から|スタート|開始|START|start|より)?")
P_REL = re.compile(r"本日|今日|今夜|今晩|明日|あした|明後日|あさって")


def _time_after(text, pos):
    """日付のすぐ後ろ（40文字以内）にある時刻を探す"""
    seg = text[pos:pos + 40]
    seg = re.sub(r"[（(]\s*" + WD + r"[^）)]*[）)]", " ", seg)  # (土) などを消す
    m = P_TIME.search(seg)
    if m:
        h = int(m.group(1))
        if 0 <= h <= 29:
            return f"{h:02d}:{m.group(2) or '00'}"
    return None


def extract_events(text, posted):
    """投稿の文から予定を取り出す。posted は投稿日時（datetime, JST）"""
    if not KEYWORDS.search(text):
        return []
    found = {}
    pdate = posted.date()

    def add(d, t, pos):
        if d < pdate - dt.timedelta(days=1) or d > pdate + dt.timedelta(days=200):
            return
        k = d.isoformat()
        if k not in found or (t and not found[k]):
            found[k] = t

    for m in P_FULL.finditer(text):
        try:
            add(dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))), _time_after(text, m.end()), m.start())
        except ValueError:
            pass
    spans = [m.span() for m in P_FULL.finditer(text)]
    for m in P_MD.finditer(text):
        if any(a <= m.start() < b for a, b in spans):
            continue
        mo, da = int(m.group(1)), int(m.group(2))
        if not (1 <= mo <= 12 and 1 <= da <= 31):
            continue
        y = pdate.year
        try:
            d = dt.date(y, mo, da)
            if d < pdate - dt.timedelta(days=60):
                d = dt.date(y + 1, mo, da)
        except ValueError:
            continue
        add(d, _time_after(text, m.end()), m.start())
    if not found:
        m = P_REL.search(text)
        if m:
            w = m.group(0)
            off = 2 if w in ("明後日", "あさって") else 1 if w in ("明日", "あした") else 0
            add(pdate + dt.timedelta(days=off), _time_after(text, m.end()), m.start())
    return sorted(found.items())


GENERIC = re.compile(r"\s*(お知らせ|告知|拡散希望|重要|速報|情報解禁|解禁)\s*")


def make_title(text):
    for m in re.finditer(r"[「『【](.{2,40}?)[」』】]", text):
        if not GENERIC.fullmatch(m.group(1)):
            return m.group(1).strip()[:40]
    lines = []
    for l in text.splitlines():
        l = re.sub(r"[【】\[\]]", "", l).strip(" 　📢✨🎮👾🎉‼！!")
        if l and not GENERIC.fullmatch(l):
            lines.append(l)
    t = lines[0] if lines else text
    t = re.sub(r"https?://\S+|#\S+|@\S+", "", t)
    # 先頭の日付・時刻を消す
    t = re.sub(r"^\s*(20\d\d\s*[./年])?\s*\d{1,2}\s*[./月]\s*\d{1,2}\s*日?\s*([（(][^）)]*[）)])?\s*(\d{1,2}\s*(時|:|：)\s*\d{0,2}\s*(分)?)?\s*(〜|~|～|から|スタート|開始|より)?[！!、,\s]*", "", t)
    return t.strip()[:40] or "お知らせ"


# ---------------- X を見る ----------------
def scrape(page, user, scrolls=3):
    page.goto(f"https://x.com/{user}", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector('article[data-testid="tweet"]', timeout=30000)
    posts = {}
    for i in range(scrolls + 1):
        for art in page.query_selector_all('article[data-testid="tweet"]'):
            try:
                tm = art.query_selector("time")
                if not tm:
                    continue
                a = tm.evaluate_handle("e => e.closest('a')").as_element()
                href = a.get_attribute("href") if a else None
                if not href or "/status/" not in href:
                    continue
                txt_el = art.query_selector('div[data-testid="tweetText"]')
                text = txt_el.inner_text() if txt_el else ""
                posts[href] = {"url": "https://x.com" + href.split("?")[0], "time": tm.get_attribute("datetime"),
                               "text": text, "author": href.split("/")[1]}
            except Exception:
                continue
        if i < scrolls:
            page.mouse.wheel(0, random.randint(1800, 2600))
            page.wait_for_timeout(random.randint(1500, 3000))
    return list(posts.values())


def run_once():
    from playwright.sync_api import sync_playwright
    events = []
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            events = json.load(f)
    by_key = {(e["url"], e["date"]): e for e in events}
    new = 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, headless=CONFIG["headless"], locale="ja-JP",
                                                   timezone_id="Asia/Tokyo", viewport={"width": 1200, "height": 1400})
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            for acc in CONFIG["accounts"]:
                pat = re.compile(acc["filter"]) if acc.get("filter") else None
                try:
                    posts = scrape(page, acc["user"])
                except Exception as e:
                    log(f"@{acc['user']} を読めませんでした: {e}")
                    continue
                log(f"@{acc['user']}: 投稿 {len(posts)} 件を確認")
                for po in posts:
                    if pat and not pat.search(po["text"]):
                        continue
                    if po["author"].lower() != acc["user"].lower():
                        continue  # リポストは除く
                    posted = dt.datetime.fromisoformat(po["time"].replace("Z", "+00:00")).astimezone(JST)
                    for d, t in extract_events(po["text"], posted):
                        key = (po["url"], d)
                        rec = {"date": d, "time": t, "title": make_title(po["text"]), "text": po["text"][:160],
                               "url": po["url"], "account": acc["user"], "posted": int(posted.timestamp())}
                        if key not in by_key:
                            new += 1
                        by_key[key] = rec
                page.wait_for_timeout(random.randint(2000, 5000))
        finally:
            ctx.close()
    limit = (dt.datetime.now(JST).date() - dt.timedelta(days=400)).isoformat()
    out = sorted((e for e in by_key.values() if e["date"] >= limit), key=lambda e: (e["date"], e["time"] or ""))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"予定 {len(out)} 件を保存（新しい予定 {new} 件）")
    if new:
        push()


def push():
    if not os.path.isdir(os.path.join(REPO, ".git")):
        log("まだ GitHub のリポジトリになっていないので、送るのはスキップしました")
        return
    def git(*a):
        return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    git("add", "docs/data/x_events.json")
    if git("diff", "--cached", "--quiet").returncode == 0:
        return
    git("commit", "-m", "Xの予定を更新")
    r = git("pull", "--rebase")
    r2 = git("push")
    if r2.returncode != 0:
        log("GitHub に送れませんでした: " + (r2.stderr or r.stderr)[-300:])
    else:
        log("GitHub に送りました")


def login():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, headless=False, locale="ja-JP")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://x.com/login")
        print("開いたブラウザで X にログインしてください。終わったらブラウザを閉じてください。")
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass
        ctx.close()


def secs_until_active():
    """取得する時間帯（7:00〜22:00）の外なら、次に始まるまでの秒数を返す"""
    now = dt.datetime.now(JST)
    fh, fm = map(int, CONFIG["active_from"].split(":"))
    th, tm = map(int, CONFIG["active_to"].split(":"))
    start = now.replace(hour=fh, minute=fm, second=0, microsecond=0)
    end = now.replace(hour=th, minute=tm, second=0, microsecond=0)
    if start <= now < end:
        return 0
    if now >= end:
        start += dt.timedelta(days=1)
    return int((start - now).total_seconds()) + random.randint(0, 15 * 60)


if __name__ == "__main__":
    if "--login" in sys.argv:
        login()
    elif "--once" in sys.argv:
        run_once()
    else:
        log("自動取得を始めます")
        while True:
            rest = secs_until_active()
            if rest:
                log(f"時間外なのでお休み（{rest // 3600}時間{rest % 3600 // 60}分後に再開）")
                time.sleep(rest)
                continue
            try:
                run_once()
            except Exception as e:
                log("エラー: " + str(e) + "\n" + traceback.format_exc()[-600:])
            wait = random.randint(CONFIG["interval_min"] * 60, CONFIG["interval_max"] * 60 + 59)
            log(f"次は {wait // 60}分{wait % 60}秒後")
            time.sleep(wait)
