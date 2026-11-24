# -*- coding: utf-8 -*-
"""YouTube Data API から配信・動画の情報を集めて docs/data に保存する（GitHub Actions が10分ごとに実行）"""
import os, re, json, time, datetime as dt, urllib.request, urllib.parse, urllib.error
import events

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
VIEWERS = os.path.join(DATA, "viewers")
API = "https://www.googleapis.com/youtube/v3/"
KEY = os.environ.get("YOUTUBE_API_KEY", "")


def api(path, **params):
    params["key"] = KEY
    url = API + path + "?" + urllib.parse.urlencode(params)
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:500]
            if e.code in (500, 503) and i < 2:
                time.sleep(3)
                continue
            raise RuntimeError(f"YouTube API エラー {e.code}: {body}")


def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(name, obj):
    os.makedirs(os.path.dirname(os.path.join(DATA, name)), exist_ok=True)
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def iso_dur(s):
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return 0
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


def to_unix(s):
    return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()) if s else None


# ゲーム名ではない言葉（「」や【】に入っていても数えない）。config.json の not_games でも足せる
NOT_GAME = re.compile(r"配信|LIVE|ライブ|告知|ショート|切り抜き|お知らせ|生放送|アーカイブ|コラボ|生中継|村下小粒|"
                      r"雑学|雑談|あるある|ラジオ|記念|トーク|やってみた|歌ってみた|レビュー|Vlog|水着|^#|^第.+回$|^[0-9]{4}年", re.I)
# 番組そのものがゲームのプレイではないもの（基板・レバーの修理など）
NOT_GAME_TITLE = re.compile(r"超必殺技伝授|歌ってみた")


def game_of(title, ignore=()):
    if NOT_GAME_TITLE.search(title):
        return None
    for pat in (r"[「『](.+?)[」』]", r"【(.+?)】"):
        for m in re.finditer(pat, title):
            g = m.group(1).strip()
            if g in ignore or NOT_GAME.search(g):
                continue
            g = re.sub(r"^(AC版|アーケード版)|(大会|タイムアタック)$", "", g).strip()
            if g:
                return g
    # 「」のない題名（例：クイズミリオネア式 ドラクエ2完全初見実況プレイ3）
    m = re.search(r"クイズミリオネア式\s*(.+?)(?:完全初見)?実況プレイ", title)
    return m.group(1).strip() if m else None


def set_games(videos, ignore):
    """全部の動画のゲーム名を付け直す。ショートは煽り文句が多いので、裏付けのある名前だけ採用する"""
    known = set()
    for v in videos:
        if v.get("status") != "short":
            v["game"] = game_of(v["title"], ignore)
            known.add(v["game"])
    for v in videos:
        if v.get("status") == "short":
            g = game_of(v["title"], ignore)
            v["game"] = g if g and (g in known or "#" + g in v["title"]) else None


def main():
    if not KEY:
        raise SystemExit("YOUTUBE_API_KEY が設定されていません（GitHub の Secrets に登録してください）")
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        config = json.load(f)
    channels = load("channels.json", {})
    videos = {v["id"]: v for v in load("videos.json", [])}
    state = load("state.json", {"backfilled": [], "full_refresh": ""})
    now = int(time.time())
    old_events = load("events.json", None)
    recent = now - (14 if old_events is not None else 60) * 86400  # 初回だけ60日分の概要欄を見る
    found = []

    # 1) チャンネル情報（初回だけ）
    for ch in config["channels"]:
        h = ch["handle"]
        if h not in channels:
            r = api("channels", part="snippet,contentDetails", forHandle=h)
            if not r.get("items"):
                print(f"チャンネルが見つかりません: {h}")
                continue
            it = r["items"][0]
            channels[h] = {"id": it["id"], "title": it["snippet"]["title"],
                           "uploads": it["contentDetails"]["relatedPlaylists"]["uploads"]}
        channels[h].update({"label": ch.get("label", h), "color": ch.get("color", "#888")})

    # 2) 新しい動画・配信を探す（初回は過去分を全部）
    check = set()
    for ch in config["channels"]:
        h = ch["handle"]
        if h not in channels:
            continue
        pat = re.compile(ch["filter"]) if ch.get("filter") else None
        full = h not in state["backfilled"]
        token, pages = None, 0
        while True:
            params = {"part": "snippet,contentDetails", "playlistId": channels[h]["uploads"], "maxResults": 50}
            if token:
                params["pageToken"] = token
            r = api("playlistItems", **params)
            for it in r.get("items", []):
                if pat and not pat.search(it["snippet"]["title"]):
                    continue
                vid = it["contentDetails"]["videoId"]
                check.add(vid)
                videos.setdefault(vid, {"id": vid, "ch": h})
            token, pages = r.get("nextPageToken"), pages + 1
            if not token or (not full and pages >= 1) or pages >= 300:
                break
        if full:
            state["backfilled"].append(h)
            print(f"{h}: 過去分を {pages} ページ読み込みました")

    # 3) 情報を更新する動画を決める（配信中・予定・最近のもの。1日1回は全部）
    today = dt.datetime.utcnow().strftime("%Y-%m-%d")
    if state.get("full_refresh") != today:
        check |= set(videos)
        state["full_refresh"] = today
    for v in videos.values():
        if v.get("status") in ("live", "upcoming") or (v.get("start") or 0) > recent:
            check.add(v["id"])

    # 4) 動画の詳しい情報
    ids = sorted(check)
    seen = set()
    for i in range(0, len(ids), 50):
        r = api("videos", part="snippet,contentDetails,statistics,liveStreamingDetails", id=",".join(ids[i:i + 50]))
        for it in r.get("items", []):
            vid = it["id"]
            seen.add(vid)
            sn, ls, st = it["snippet"], it.get("liveStreamingDetails") or {}, it.get("statistics") or {}
            old = videos.get(vid, {"id": vid})
            dur = iso_dur(it["contentDetails"].get("duration"))
            lbc = sn.get("liveBroadcastContent", "none")
            if lbc in ("live", "upcoming"):
                status = lbc
            elif ls.get("actualStartTime"):
                status = "archive"
            elif dur and (dur <= 60 or (dur <= 180 and "#short" in (sn["title"] + sn.get("description", "")).lower())):
                status = "short"
            else:
                status = "video"
            start = to_unix(ls.get("actualStartTime") or ls.get("scheduledStartTime") or sn.get("publishedAt"))
            end = to_unix(ls.get("actualEndTime"))
            if status == "archive" and not dur and end and start:
                dur = end - start
            rec = {**old, "title": sn["title"], "status": status, "start": start, "end": end, "dur": dur,
                   "views": int(st.get("viewCount", 0) or 0), "likes": int(st.get("likeCount", 0) or 0),
                   "comments": int(st.get("commentCount", 0) or 0)}
            # 同接（配信中だけ取れる）
            if status == "live" and ls.get("concurrentViewers"):
                cv = int(ls["concurrentViewers"])
                vf = os.path.join("viewers", vid + ".json")
                samples = load(vf, [])
                samples.append([now, cv])
                save(vf, samples)
                rec["now"] = cv
                rec["peak"] = max(cv, old.get("peak") or 0)
                rec["hasCurve"] = True
            else:
                rec.pop("now", None)
            videos[vid] = rec
            posted = to_unix(sn.get("publishedAt")) or start
            if status != "short" and posted and posted > now - 60 * 86400:
                label = channels.get(rec.get("ch"), {}).get("label", "")
                found.append((vid, label, posted, events.extract(sn.get("description"), posted)))
    # 消された・非公開になった動画を外す
    for vid in [v for v in ids if v not in seen]:
        videos.pop(vid, None)

    out = sorted((v for v in videos.values() if v.get("title")), key=lambda v: -(v.get("start") or 0))
    set_games(out, set(config.get("not_games", [])))
    save("videos.json", out)
    evs = events.merge(old_events or [], found, dt.datetime.now(events.JST).date())
    save("events.json", evs)
    print(f"概要欄の予定 {len(evs)} 件")
    save("channels.json", channels)
    save("state.json", state)
    save("meta.json", {"updated": now, "site_name": config.get("site_name", "こつぶホーム")})
    print(f"動画・配信 {len(out)} 件を保存しました（確認したもの {len(ids)} 件）")


if __name__ == "__main__":
    main()
