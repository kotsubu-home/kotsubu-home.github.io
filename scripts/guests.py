# -*- coding: utf-8 -*-
"""ほかのチャンネルへの出演を1日1回さがす

- guest_videos   … 出演を確かめた動画（必ず載せる）
- guest_channels … 出演したことのあるチャンネル。新しい動画のうち、題名か「MC・ゲスト・出演」の欄に名前があるものを載せる
- それ以外のチャンネルは名前で検索し、載せずに docs/data/candidates.json へ候補として残す
  （本人について語るだけの動画や切り抜きが混ざるため）
"""
import re, html, datetime as dt

NAME = re.compile(r"村下\s*小粒")
CAST = re.compile(r"(MC|ゲスト|出演)[^\n]{0,30}村下\s*小粒")
JST = dt.timezone(dt.timedelta(hours=9))


def appears(title, desc):
    return bool(NAME.search(title or "") or CAST.search(desc or ""))


def due(state, now):
    """日本時間の朝6時以降に1日1回"""
    t = dt.datetime.fromtimestamp(now, JST)
    return t.hour >= 6 and state.get("guest_day") != t.strftime("%Y-%m-%d")


def find(api, cfg, state, own_ids, old_candidates, known_ids, now):
    """(載せる動画ID, 候補の一覧) を返す。一部が失敗しても、取れた分は使う"""
    ids, cands = set(cfg.get("guest_videos", [])), {c["id"]: c for c in old_candidates}
    chans = cfg.get("guest_channels", {})
    done = state.setdefault("guest_backfilled", [])
    ok = True
    for cid in chans:
        try:
            token, pages, limit = None, 0, 1 if cid in done else 8  # 初回だけ過去400本まで
            while pages < limit:
                p = {"part": "snippet,contentDetails", "playlistId": "UU" + cid[2:], "maxResults": 50}
                if token:
                    p["pageToken"] = token
                r = api("playlistItems", **p)
                for it in r.get("items", []):
                    if appears(it["snippet"].get("title"), it["snippet"].get("description")):
                        ids.add(it["contentDetails"]["videoId"])
                token, pages = r.get("nextPageToken"), pages + 1
                if not token:
                    break
            if cid not in done:
                done.append(cid)
        except Exception as e:
            ok = False
            print(f"出演チャンネルを読めませんでした: {chans[cid]}: {e}")
    skip = set(cfg.get("guest_exclude", []))
    try:
        for order in ("date", "relevance"):
            r = api("search", part="snippet", q="村下小粒", type="video", order=order, maxResults=50, regionCode="JP")
            for it in r.get("items", []):
                sn, vid = it["snippet"], it["id"]["videoId"]
                title = html.unescape(sn["title"])
                if not NAME.search(title) or sn["channelId"] in own_ids or sn["channelTitle"] in skip:
                    continue
                if sn["channelId"] in chans:
                    ids.add(vid)
                else:
                    cands.setdefault(vid, {"id": vid, "title": title, "channel": sn["channelTitle"],
                                           "channelId": sn["channelId"], "date": sn["publishedAt"][:10]})
    except Exception as e:
        ok = False
        print(f"名前での検索に失敗しました: {e}")
    out = [c for c in cands.values() if c["id"] not in ids and c["id"] not in known_ids
           and c["channel"] not in skip and c["channelId"] not in chans]
    # 失敗しても同じ日に何度も検索しない（検索は使える回数が少ないため）
    state["guest_day"] = dt.datetime.fromtimestamp(now, JST).strftime("%Y-%m-%d")
    print(f"ほかのチャンネル: 出演 {len(ids)} 本・候補 {len(out)} 本{'' if ok else '（一部失敗）'}")
    return ids, sorted(out, key=lambda c: c["date"], reverse=True)
