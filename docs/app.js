/* こつぶホーム 画面の動き */
"use strict";

const S = { videos: [], xev: [], mev: [], nc: { games: {}, episodes: {} }, channels: {}, meta: {}, tl: { type: "all", ch: "all", game: "", shown: 60 },
  cal: null, calSel: null, rk: { metric: "peak", period: "all", type: "stream" }, charts: {} };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Asia/Tokyo";
const WD = ["日", "月", "火", "水", "木", "金", "土"];

/* ---------- 便利関数 ---------- */
function jst(unix) {
  const d = new Date(unix * 1000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "numeric",
    day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour.padStart(2, "0"), mm: p.minute, wd: p.weekday };
}
const dayKey = (u) => { const j = jst(u); return `${j.y}-${String(j.m).padStart(2, "0")}-${String(j.d).padStart(2, "0")}`; };
const fmtDay = (u) => { const j = jst(u); return `${j.y}年${j.m}月${j.d}日（${j.wd}）`; };
const fmtTime = (u) => { const j = jst(u); return `${j.hh}:${j.mm}`; };
function fmtDur(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
const fmtHours = (s) => (s / 3600).toFixed(1);
function fmtNum(n) {
  if (n == null) return "-";
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
  return n.toLocaleString("ja-JP");
}
const isStream = (v) => ["archive", "live", "upcoming"].includes(v.status);
const ytUrl = (v) => `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`;
const chOf = (v) => { const c = S.channels[v.ch] || { label: v.ch, color: "#888" }; return v.chName ? { ...c, label: v.chName } : c; };
const XCOLOR = "#c08a00";
const xDateUnix = (e) => Math.floor(new Date(`${e.date}T${e.time || "00:00"}:00+09:00`).getTime() / 1000);
const todayKey = () => dayKey(Date.now() / 1000);
const evLabel = (e) => (e.src === "yt" ? "YouTube告知" : "X告知");
function xcard(e) {
  const d = new Date(`${e.date}T00:00:00+09:00`);
  return `<a class="vcard" href="${esc(e.url)}" target="_blank" rel="noopener">
    <span class="bar" style="background:${XCOLOR}"></span>
    <span>
      <span class="row1"><span>${e.time || "時間未定"}</span>
        <span class="badge xb">${evLabel(e)}</span><span class="note">${e.src === "yt" ? `${esc(e.account)}の動画の概要欄` : `@${esc(e.account)} のポスト`}から拾った予定</span></span>
      <div class="title">${esc(e.title)}</div>
      <div class="meta"><span>${esc(e.text)}</span></div>
    </span></a>`;
}
const TYPE_LABEL = { archive: "配信", live: "配信中", upcoming: "配信予定", video: "動画", short: "ショート" };

// 予定時刻を6時間以上過ぎても始まっていない「配信予定」（使われなかった配信枠）を外す
const dropStale = (vs) => vs.filter((v) => v.status !== "upcoming" || !v.start || v.start > Date.now() / 1000 - 6 * 3600);

/* ---------- 動画カード ---------- */
function card(v) {
  const c = chOf(v);
  const meta = [];
  if (v.dur) meta.push(`長さ <b>${fmtDur(v.dur)}</b>`);
  if (v.status !== "upcoming") meta.push(`再生 <b>${fmtNum(v.views)}</b>`);
  if (v.peak) meta.push(`最高同接 <b>${fmtNum(v.peak)}</b>`);
  if (v.likes) meta.push(`いいね <b>${fmtNum(v.likes)}</b>`);
  return `<a class="vcard" href="${ytUrl(v)}" target="_blank" rel="noopener">
    <span class="bar" style="background:${esc(c.color)}"></span>
    <span>
      <span class="row1">
        <span>${v.start ? fmtTime(v.start) : ""}</span>
        <span class="badge ch" style="--c:${esc(c.color)}">${esc(c.label)}</span>
        <span class="badge ${v.status}">${TYPE_LABEL[v.status] || ""}</span>
        ${v.game ? `<span class="badge game">${esc(v.game)}</span>` : ""}
      </span>
      <div class="title">${esc(v.title)}</div>
      <div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
    </span></a>`;
}
function listByDay(vs) {
  if (!vs.length) return `<p class="empty">ありません</p>`;
  let html = "", last = "";
  for (const v of vs) {
    const k = v.start ? dayKey(v.start) : "";
    if (k !== last) { html += `<div class="day-head">${v.start ? fmtDay(v.start) : "日付なし"}</div>`; last = k; }
    html += card(v);
  }
  return html;
}

/* ---------- タイムライン ---------- */
function renderTimeline() {
  const live = S.videos.filter((v) => v.status === "live");
  $("#live-area").innerHTML = live.map((v) => `<a class="live-card" href="${ytUrl(v)}" target="_blank" rel="noopener">
      <div class="label">いま配信中！</div>
      <div class="t">${esc(v.title)}</div>
      <div>${esc(chOf(v).label)} ・ ${fmtTime(v.start)}〜 ${v.now ? `・ 同接 <span class="now">${fmtNum(v.now)}</span>` : ""}</div>
    </a>`).join("");
  const now = Date.now() / 1000;
  const up = S.videos.filter((v) => v.status === "upcoming" && v.start).sort((a, b) => a.start - b.start);
  const xup = S.xev.filter((e) => e.date >= todayKey());
  const items = [
    ...xup.map((e) => ({ t: xDateUnix(e), html: `<a class="up-card x" href="${esc(e.url)}" target="_blank" rel="noopener">
      <span class="when">${fmtDay(xDateUnix(e)).replace(/^\d+年/, "")} ${e.time || "時間未定"}</span>
      <span><span class="badge xb">${evLabel(e)}</span><br>${esc(e.title)}</span></a>` })),
    ...up.map((v) => {
      const left = v.start - now;
      const rel = left > 86400 ? `あと${Math.floor(left / 86400)}日` : left > 3600 ? `あと${Math.floor(left / 3600)}時間` : left > 0 ? `あと${Math.ceil(left / 60)}分` : "まもなく";
      return { t: v.start, html: `<a class="up-card" href="${ytUrl(v)}" target="_blank" rel="noopener">
      <span class="when">${fmtDay(v.start).replace(/^\d+年/, "")} ${fmtTime(v.start)}<br><small>${rel}</small></span>
      <span><span class="badge ch" style="--c:${esc(chOf(v).color)}">${esc(chOf(v).label)}</span><br>${esc(v.title)}</span></a>` };
    }),
  ].sort((a, b) => a.t - b.t);
  $("#upcoming-area").innerHTML = items.length ? `<h3>これからの予定</h3>` + items.map((x) => x.html).join("") : "";

  const { type, ch, game, shown } = S.tl;
  const base = S.videos.filter((v) => v.status !== "upcoming" && v.status !== "live")
    .filter((v) => type === "all" || (type === "stream" ? v.status === "archive" : v.status === type))
    .filter((v) => ch === "all" || v.ch === ch);
  // ゲームの選択肢（種類・チャンネルで絞った中の本数つき。選択中のものは0本でも残す）
  const cnt = {};
  for (const v of base) if (v.game) cnt[v.game] = (cnt[v.game] || 0) + 1;
  if (game && !cnt[game]) cnt[game] = 0;
  const opts = Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  const gs = $("#tl-game");
  gs.innerHTML = `<option value="">全ゲーム</option>` + opts.map(([g, n]) => `<option value="${esc(g)}">${esc(g)}（${n}）</option>`).join("");
  gs.value = game;
  const vs = game ? base.filter((v) => v.game === game) : base;
  $("#tl-list").innerHTML = S.videos.length ? listByDay(vs.slice(0, shown))
    : `<p class="empty">まだデータがありません。GitHub Actions の「データ更新」が動くと表示されます。</p>`;
  $("#tl-more").hidden = vs.length <= shown;
}

/* ---------- イベント ---------- */
function eventsByDay(es) {
  let html = "", last = "";
  for (const e of es) {
    if (e.date !== last) { html += `<div class="day-head">${fmtDay(xDateUnix({ date: e.date }))}</div>`; last = e.date; }
    html += xcard(e);
  }
  return html || `<p class="empty">ありません</p>`;
}
function renderEvents() {
  const src = S.evSrc || "all", today = todayKey();
  const es = S.xev.filter((e) => src === "all" || (e.src === "yt" ? "yt" : "x") === src);
  const cmp = (a, b) => xDateUnix(a) - xDateUnix(b);
  $("#ev-next").innerHTML = eventsByDay(es.filter((e) => e.date >= today).sort(cmp));
  $("#ev-past").innerHTML = eventsByDay(es.filter((e) => e.date < today)
    .sort((a, b) => (a.date === b.date ? cmp(a, b) : a.date < b.date ? 1 : -1)));
}

/* ---------- カレンダー ---------- */
function renderCalendar() {
  if (!S.cal) { const j = jst(Date.now() / 1000); S.cal = { y: j.y, m: j.m }; }
  const { y, m } = S.cal;
  $("#cal-title").textContent = `${y}年${m}月`;
  const byDay = {};
  for (const v of S.videos) if (v.start) (byDay[dayKey(v.start)] ||= []).push(v);
  const xByDay = {};
  for (const e of S.xev) (xByDay[e.date] ||= []).push(e);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = dayKey(Date.now() / 1000);
  let html = WD.map((w, i) => `<div class="wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");
  for (let i = 0; i < first; i++) html += `<div class="cell blank"></div>`;
  let cnt = 0, secs = 0, streams = 0;
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const vs = byDay[k] || [];
    cnt += vs.length;
    for (const v of vs) if (v.status === "archive") { streams++; secs += v.dur || 0; }
    const xs = xByDay[k] || [];
    const pips = xs.slice(0, 2).map((e) => `<span class="pip" style="--c:${XCOLOR}" title="${esc(e.title)}"></span>`).join("")
      + vs.slice(0, 6 - Math.min(2, xs.length)).map((v) => `<span class="pip" style="--c:${esc(chOf(v).color)}" title="${esc(v.title)}"></span>`).join("");
    html += `<button class="cell ${k === today ? "today" : ""} ${k === S.calSel ? "sel" : ""}" data-day="${k}" aria-label="${m}月${d}日 ${vs.length + xs.length}件"><span class="d">${d}</span><span class="pips">${pips}</span></button>`;
  }
  $("#cal-grid").innerHTML = html;
  $("#cal-summary").innerHTML = tile("この月の配信", streams, "回") + tile("配信時間", fmtHours(secs), "時間") + tile("動画・配信の合計", cnt, "本");
  $("#cal-legend").innerHTML = Object.values(S.channels).map((c) => `<span style="--c:${esc(c.color)}">${esc(c.label)}</span>`).join("")
    + `<span style="--c:${XCOLOR}">イベント告知</span>`;
  const sel = S.calSel && (byDay[S.calSel] || []);
  const xsel = S.calSel && (xByDay[S.calSel] || []);
  $("#cal-day-title").textContent = S.calSel ? S.calSel.replace(/-0?/g, "/").replace(/^(\d+)\//, "$1年").replace(/\/(\d+)$/, "月$1日") : "日付をえらぶと、その日の配信が出ます";
  $("#cal-day-list").innerHTML = S.calSel ? ((sel.length || xsel.length) ? xsel.map(xcard).join("") + sel.map(card).join("") : `<p class="empty">この日はありません</p>`) : "";
}
const tile = (label, val, unit) => `<div class="tile"><small>${label}</small><b>${val}<em>${unit}</em></b></div>`;

/* ---------- さがす ---------- */
function renderGames() {
  const g = {};
  for (const v of S.videos) if (v.game) g[v.game] = (g[v.game] || 0) + 1;
  $("#games").innerHTML = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 40)
    .map(([k, n]) => `<button data-g="${esc(k)}">${esc(k)}<span class="count">${n}</span></button>`).join("") || `<span class="note">まだありません</span>`;
}
function renderSearch() {
  const q = $("#q").value.trim().toLowerCase();
  if (!q) { $("#q-count").textContent = ""; $("#q-list").innerHTML = ""; return; }
  const words = q.split(/\s+/);
  const vs = S.videos.filter((v) => words.every((w) => (v.title + " " + (v.game || "")).toLowerCase().includes(w)));
  $("#q-count").textContent = `「${$("#q").value.trim()}」 ${vs.length}件`;
  $("#q-list").innerHTML = listByDay(vs.slice(0, 200));
}

/* ---------- ランキング ---------- */
function inPeriod(v, p) {
  if (p === "all") return true;
  const j = jst(v.start || 0), n = jst(Date.now() / 1000);
  if (p === "year") return j.y === n.y;
  if (p === "month") return j.y === n.y && j.m === n.m;
  const ly = n.m === 1 ? n.y - 1 : n.y, lm = n.m === 1 ? 12 : n.m - 1;
  return j.y === ly && j.m === lm;
}
function renderRanking() {
  const { metric, period, type } = S.rk;
  const unit = { peak: "人", views: "回", likes: "", dur: "" }[metric];
  const vs = S.videos.filter((v) => v.status !== "upcoming")
    .filter((v) => type === "all" || isStream(v)).filter((v) => inPeriod(v, period))
    .filter((v) => (v[metric] || 0) > 0).sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 30);
  $("#rk-note").textContent = metric === "peak"
    ? "同接（同時に見ていた人数）は、このサイトが記録を始めた後の配信だけ集計できます。" : "";
  $("#rk-list").innerHTML = vs.length ? vs.map((v, i) => `<li>
      <span class="rank-no">${i + 1}</span>
      <a href="${ytUrl(v)}" target="_blank" rel="noopener"><div class="t">${esc(v.title)}</div>
        <div class="s">${v.start ? fmtDay(v.start) : ""} ・ ${esc(chOf(v).label)}${v.game ? " ・ " + esc(v.game) : ""}</div></a>
      <span class="val">${metric === "dur" ? fmtDur(v.dur) : fmtNum(v[metric])}<small>${unit}</small></span></li>`).join("")
    : `<p class="empty">この条件のデータはまだありません</p>`;
}

/* ---------- ぶんせき ---------- */
const INK2 = "#b9b9d6", GRID = "rgba(185,185,214,.12)", SURFACE = "#16162e";
function chartDefaults() {
  Chart.defaults.color = INK2;
  Chart.defaults.font.family = '"Noto Sans JP", sans-serif';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = "#26264a";
  Chart.defaults.plugins.tooltip.borderColor = "#3a3a66";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
}
function draw(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  S.charts[id] = new Chart(document.getElementById(id), cfg);
}
function renderStats() {
  if (!window.Chart) { setTimeout(renderStats, 200); return; }
  chartDefaults();
  const streams = S.videos.filter((v) => v.status === "archive");
  const total = streams.reduce((a, v) => a + (v.dur || 0), 0);
  const games = new Set(S.videos.map((v) => v.game).filter(Boolean));
  const best = Math.max(0, ...S.videos.map((v) => v.peak || 0));
  $("#st-tiles").innerHTML = tile("配信の回数", streams.length, "回") + tile("配信時間の合計", fmtHours(total), "時間")
    + tile("あそんだゲーム", games.size, "本") + tile("最高同接", best ? fmtNum(best) : "-", best ? "人" : "");

  // 月ごとの配信時間（チャンネル別の積み上げ・直近12か月）
  const n = jst(Date.now() / 1000), months = [];
  for (let i = 11; i >= 0; i--) { const t = new Date(Date.UTC(n.y, n.m - 1 - i, 1)); months.push([t.getUTCFullYear(), t.getUTCMonth() + 1]); }
  const chs = Object.entries(S.channels);
  const datasets = chs.map(([h, c]) => ({
    label: c.label, backgroundColor: c.color, borderColor: SURFACE, borderWidth: { top: 2 }, borderSkipped: false,
    borderRadius: 4, maxBarThickness: 34,
    data: months.map(([y, m]) => +fmtHours(streams.filter((v) => v.ch === h && (() => { const j = jst(v.start); return j.y === y && j.m === m; })()).reduce((a, v) => a + (v.dur || 0), 0))),
  }));
  $("#st-legend").innerHTML = chs.map(([, c]) => `<span style="--c:${esc(c.color)}">${esc(c.label)}</span>`).join("");
  draw("ch-hours", { type: "bar", data: { labels: months.map(([y, m]) => (m === 1 ? `${y}年` : "") + `${m}月`), datasets },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${c.parsed.y} 時間` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: GRID }, border: { display: false }, title: { display: true, text: "時間" } } } } });

  // ゲームごとの配信時間
  const g = {};
  for (const v of streams) if (v.game) g[v.game] = (g[v.game] || 0) + (v.dur || 0);
  const top = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 10);
  draw("ch-games", { type: "bar", data: { labels: top.map((x) => x[0]),
      datasets: [{ label: "配信時間", data: top.map((x) => +fmtHours(x[1])), backgroundColor: "#e64584", borderRadius: 4, maxBarThickness: 22 }] },
    options: { indexAxis: "y", maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.parsed.x} 時間` } } },
      scales: { x: { grid: { color: GRID }, border: { display: false }, title: { display: true, text: "時間" } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback(v) { const t = this.getLabelForValue(v), n = innerWidth <= 600 ? 9 : 99; return t.length > n ? t.slice(0, n - 1) + "…" : t; } } } } } });

  // 同接の移り変わり
  const withCurve = S.videos.filter((v) => v.hasCurve);
  const sel = $("#st-stream");
  sel.innerHTML = withCurve.map((v) => `<option value="${esc(v.id)}">${v.start ? fmtDay(v.start) : ""} ${esc(v.title)}</option>`).join("");
  $("#st-curve-note").textContent = withCurve.length ? "" : "同接は、このサイトが記録を始めたあとの配信から表示されます（10分ごとに記録）。";
  if (withCurve.length) drawCurve(withCurve[0].id); else if (S.charts["ch-curve"]) S.charts["ch-curve"].destroy();
}
async function drawCurve(id) {
  try {
    const r = await fresh(`data/viewers/${encodeURIComponent(id)}.json`);
    const pts = await r.json();
    const v = S.videos.find((x) => x.id === id);
    const t0 = v && v.start ? v.start : pts[0][0];
    draw("ch-curve", { type: "line", data: { labels: pts.map((p) => fmtDur(Math.max(0, p[0] - t0)) || "0:00"),
        datasets: [{ label: "同接", data: pts.map((p) => p[1]), borderColor: "#ffd23f", backgroundColor: "rgba(255,210,63,.12)",
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, fill: true, tension: .25 }] },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { tooltip: { callbacks: { title: (c) => `開始から ${c[0].label}`, label: (c) => ` 同接 ${c.parsed.y.toLocaleString("ja-JP")} 人` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: GRID }, border: { display: false }, beginAtZero: true, title: { display: true, text: "人" } } } } });
  } catch (e) { $("#st-curve-note").textContent = "同接のデータが読めませんでした"; }
}

/* ---------- ノーコンアイドル ---------- */
const zen2han = (x) => String(x).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
function parseNoncon(v) {
  const t = zen2han(v.title);
  if (!/ノーコンアイドル/.test(t)) return null;
  const no = t.match(/第\s*(\d+)\s*回/) || t.match(/ノーコンアイドル\s*#\s*(\d+)/);
  if (!no) return null;
  const g = t.match(/[「『](.+?)[」』]/);
  const part = t.match(/その\s*(\d+)/);
  return { no: +no[1], game: g ? g[1].trim() : (v.game || "（ゲーム名なし）"), part: part ? +part[1] : null, v };
}
const tsec = (s) => s.split(":").reduce((a, x) => a * 60 + +x, 0);
function ncEpisodeHtml(e) {
  const v = e.v, rec = (S.nc.episodes || {})[String(e.no)] || {};
  const meta = [v.start ? fmtDay(v.start) : "", v.dur ? `長さ ${fmtDur(v.dur)}` : "", v.status === "upcoming" ? "配信予定" : `再生 ${fmtNum(v.views)}`,
    v.peak ? `最高同接 ${fmtNum(v.peak)}` : ""].filter(Boolean).join(" ・ ");
  const hl = (rec.highlights || []).map(([t, d]) =>
    `<li><a href="${ytUrl(v)}&t=${tsec(t)}s" target="_blank" rel="noopener"><b>${esc(t)}</b>${esc(d)}</a></li>`).join("");
  return `<div class="ep">
    <div class="ep-head"><span class="ep-no">第${e.no}回</span>
      <a href="${ytUrl(v)}" target="_blank" rel="noopener">${e.part ? `その${e.part}` : esc(e.game)}${v.status === "live" ? " 🔴配信中" : ""}</a>
      <span class="ep-meta">${meta}</span></div>
    ${rec.reach ? `<div class="ep-reach">${esc(rec.reach)}</div>` : ""}
    ${hl ? `<ul class="hl">${hl}</ul>` : ""}
  </div>`;
}
function renderNoncon() {
  const eps = S.videos.map(parseNoncon).filter(Boolean).sort((a, b) => a.no - b.no || (a.v.start || 0) - (b.v.start || 0));
  const games = [];
  for (const e of eps) {
    let g = games.find((x) => x.name === e.game);
    if (!g) games.push((g = { name: e.game, eps: [] }));
    g.eps.push(e);
  }
  const latest = games.length ? games.reduce((a, b) => (Math.max(...b.eps.map((e) => e.no)) > Math.max(...a.eps.map((e) => e.no)) ? b : a)) : null;
  const gm = S.nc.games || {};
  const done = eps.filter((e) => e.v.status !== "upcoming");
  const clears = games.filter((g) => (gm[g.name] || {}).clear).length;
  $("#nc-tiles").innerHTML = tile("放送", done.length, "回") + tile("挑戦したゲーム", games.length, "本")
    + tile("1コインクリア", clears, "本") + tile("配信時間の合計", fmtHours(done.reduce((a, e) => a + (e.v.dur || 0), 0)), "時間");

  if (latest) {
    const aired = latest.eps.filter((e) => e.v.status !== "upcoming");
    const last = aired[aired.length - 1] || latest.eps[0];
    const next = latest.eps.find((e) => e.v.status === "upcoming" || e.v.status === "live");
    const r = gm[latest.name] || {};
    $("#nc-now").innerHTML = `<div class="nc-now">
      <div class="lbl">${r.clear ? "🏆 クリア達成！" : "いま挑戦中"}</div>
      <div class="g">${esc(latest.name)}</div>
      <div>第${latest.eps[0].no}回から ${aired.length}回挑戦 ・ 最新：<a href="${ytUrl(last.v)}" target="_blank" rel="noopener">第${last.no}回${last.part ? ` その${last.part}` : ""}</a>（${last.v.start ? fmtDay(last.v.start) : ""}）</div>
      ${next && next !== last ? `<div>次回：${fmtDay(next.v.start)} ${fmtTime(next.v.start)}〜</div>` : ""}
      ${r.best ? `<div class="ep-reach">${esc(r.best)}</div>` : ""}
    </div>`;
  } else {
    $("#nc-now").innerHTML = `<p class="empty">まだデータがありません</p>`;
  }

  $("#nc-games").innerHTML = games.slice().reverse().map((g, i) => {
    const r = gm[g.name] || {};
    const isNow = g === latest && !r.clear;
    const badge = r.clear ? `<span class="res clear">🏆 1コインクリア${r.clearNo ? `（第${r.clearNo}回）` : ""}</span>`
      : isNow ? `<span class="res now">挑戦中</span>` : `<span class="res done">${r.best ? esc(r.best) : "挑戦終了"}</span>`;
    const d = g.eps.filter((e) => e.v.status !== "upcoming");
    const secs = d.reduce((a, e) => a + (e.v.dur || 0), 0), views = d.reduce((a, e) => a + (e.v.views || 0), 0);
    const first = g.eps[0], last = g.eps[g.eps.length - 1];
    return `<details class="nc-game" ${i === 0 ? "open" : ""}>
      <summary><span class="name">${esc(g.name)}</span>${badge}
        <span class="sum"><span>第${first.no}〜${last.no}回（全<b>${g.eps.length}</b>回）</span>
          <span>${first.v.start ? fmtDay(first.v.start) : ""} 〜 ${last.v.start ? fmtDay(last.v.start) : ""}</span>
          <span>配信 <b>${fmtHours(secs)}</b>時間</span><span>再生 <b>${fmtNum(views)}</b></span></span>
        ${r.note ? `<span class="sum">${esc(r.note)}</span>` : ""}
      </summary>
      ${g.eps.map(ncEpisodeHtml).join("")}
    </details>`;
  }).join("") || `<p class="empty">まだデータがありません</p>`;
}

/* ---------- タブ ---------- */
const RENDER = { timeline: renderTimeline, events: renderEvents, noncon: renderNoncon, calendar: renderCalendar, search: () => { renderGames(); renderSearch(); }, ranking: renderRanking, stats: renderStats };
function showTab() {
  const t = (location.hash || "#timeline").slice(1);
  const tab = RENDER[t] ? t : "timeline";
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + tab));
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  RENDER[tab]();
}
function chipGroup(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    fn(b.dataset.v);
  });
}

/* ---------- アクセス計測（Googleアナリティクス） ---------- */
const GA = "G-EVF4GRNC0Z";
let gaOn = false;
const gaOff = () => { try { return localStorage.getItem("no-ga") === "1"; } catch { return false; } };
function gtag() { window.dataLayer.push(arguments); }
function startGa() {
  window["ga-disable-" + GA] = gaOff();
  if (gaOn || gaOff() || location.hostname !== "kotsubu-home.github.io") return; // 手元での確認は数えない
  gaOn = true;
  window.dataLayer = window.dataLayer || [];
  gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" }); // 広告には使わない
  gtag("js", new Date());
  gtag("config", GA, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA;
  document.head.append(s);
}
const gaTab = () => { if (gaOn && !gaOff()) gtag("event", "tab_view", { tab: document.querySelector(".tabs a.on")?.dataset.tab }); };
function gaSetup() {
  const b = $("#ga-toggle");
  const label = () => { b.textContent = gaOff() ? "このブラウザは計測していません（計測を許可する）" : "このブラウザの計測を止める"; };
  b.addEventListener("click", () => {
    try { gaOff() ? localStorage.removeItem("no-ga") : localStorage.setItem("no-ga", "1"); } catch { return; }
    startGa(); label();
  });
  label(); startGa();
}

/* ---------- 起動 ---------- */
// 置き場所（CDN）とブラウザの古い控えを使わないように、1分ごとに変わる目印をつけて読む
const fresh = (url) => fetch(`${url}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
const RAW = {};
let loadedAt = 0, loading = null;
function load() { return (loading ||= loadData().finally(() => { loading = null; })); }
async function loadData() {
  // 読めなかったファイルは前の内容を使う。1つも変わっていなければ描き直さない
  const names = ["videos", "channels", "meta", "x_events", "events", "manual_events", "noncon"];
  const got = await Promise.all(names.map(async (n) => {
    try { const r = await fresh(`data/${n}.json`); return r.ok ? [n, JSON.stringify(await r.json())] : null; } catch { return null; }
  }));
  let changed = !loadedAt;
  for (const g of got) if (g && RAW[g[0]] !== g[1]) { RAW[g[0]] = g[1]; changed = changed || g[0] !== "meta"; }
  const get = (n, d) => (RAW[n] ? JSON.parse(RAW[n]) : d);
  S.meta = get("meta", {});
  if (S.meta.site_name) { $("#site-name").textContent = S.meta.site_name; document.title = `${S.meta.site_name} - 村下小粒さん 非公式ファンサイト`; }
  $("#updated").textContent = S.meta.updated ? `${fmtDay(S.meta.updated)} ${fmtTime(S.meta.updated)}` : "まだ取得していません";
  loadedAt = Date.now();
  if (!changed) return;
  S.videos = dropStale(get("videos", [])); S.mev = get("manual_events", []);
  S.xev = [...S.mev, ...get("x_events", []), ...get("events", [])];
  S.nc = get("noncon", S.nc); S.channels = get("channels", {});
  const sel = $("#tl-ch");
  sel.innerHTML = `<option value="all">全チャンネル</option>` + Object.entries(S.channels).map(([h, c]) => `<option value="${esc(h)}">${esc(c.label)}</option>`).join("");
  sel.value = S.tl.ch;
  $("#loading").hidden = true;
  showTab();
}
// 開いているページが古い版なら、1回だけ読み込み直す
async function checkVersion() {
  try {
    const mine = (document.querySelector('script[src*="app.js"]').src.match(/v=(\w+)/) || [])[1];
    const r = await fresh("index.html");
    const now = r.ok && ((await r.text()).match(/app\.js\?v=(\w+)/) || [])[1];
    if (!mine || !now || mine === now || sessionStorage.getItem("ver") === now) return;
    sessionStorage.setItem("ver", now);
    location.reload();
  } catch { /* 読めないときはそのまま使う */ }
}
document.addEventListener("DOMContentLoaded", () => {
  chipGroup("#tl-type", (v) => { S.tl.type = v; S.tl.shown = 60; renderTimeline(); });
  $("#tl-ch").addEventListener("change", (e) => { S.tl.ch = e.target.value; S.tl.shown = 60; renderTimeline(); });
  $("#tl-game").addEventListener("change", (e) => { S.tl.game = e.target.value; S.tl.shown = 60; renderTimeline(); });
  $("#tl-more").addEventListener("click", () => { S.tl.shown += 60; renderTimeline(); });
  chipGroup("#ev-src", (v) => { S.evSrc = v; renderEvents(); });
  $("#cal-prev").addEventListener("click", () => { S.cal.m--; if (S.cal.m < 1) { S.cal.m = 12; S.cal.y--; } renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { S.cal.m++; if (S.cal.m > 12) { S.cal.m = 1; S.cal.y++; } renderCalendar(); });
  $("#cal-grid").addEventListener("click", (e) => { const c = e.target.closest("[data-day]"); if (c) { S.calSel = c.dataset.day; renderCalendar(); } });
  $("#q").addEventListener("input", renderSearch);
  $("#games").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { $("#q").value = b.dataset.g; renderSearch(); } });
  chipGroup("#rk-metric", (v) => { S.rk.metric = v; renderRanking(); });
  $("#rk-period").addEventListener("change", (e) => { S.rk.period = e.target.value; renderRanking(); });
  $("#rk-type").addEventListener("change", (e) => { S.rk.type = e.target.value; renderRanking(); });
  $("#st-stream").addEventListener("change", (e) => drawCurve(e.target.value));
  window.addEventListener("hashchange", () => { showTab(); gaTab(); window.scrollTo({ top: 0, behavior: "instant" }); });
  load();
  gaSetup();
  checkVersion();
  setInterval(() => { if (!document.hidden) load(); }, 120000); // 2分ごと
  const back = () => { if (!document.hidden && Date.now() - loadedAt > 30000) { load(); checkVersion(); } }; // ほかのタブやアプリから戻ったとき
  document.addEventListener("visibilitychange", back);
  window.addEventListener("pageshow", back);
});
