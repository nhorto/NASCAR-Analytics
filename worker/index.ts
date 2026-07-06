// looplab-live — the edge live race companion.
//
// A standalone Cloudflare Worker that (1) runs ONE upstream poller as a Durable
// Object alarm loop, computing our live metrics + alerts via the pure `live`
// domain, and (2) serves both the JSON API (GET /api/live) and a self-contained
// live page (GET /). One workers.dev URL is the whole product — no Pages
// redeploy, no cross-origin. See docs/exec-plans/active/2026-07-05-live-race-companion.md.

import { liveConfig, liveRuntime, liveService } from "../src/domains/live/index.ts";
import type {
  LiveAlertEvent,
  LiveFeed,
  LiveHistory,
  LivePayload,
  LivePitRecord,
  LiveSnapshot,
  NextRace,
  NormalizedPitStop,
} from "../src/domains/live/index.ts";
import { BASELINES } from "./baselines.ts";
import { strategyFor } from "./track-strategy.ts";

interface Env {
  LIVE: DurableObjectNamespace;
  /** Override the upstream feed (tests / a specific series). Defaults to base. */
  LIVE_FEED_URL?: string;
  /** Override the upstream pit feed (tests). Defaults to the per-race CDN URL. */
  LIVE_PIT_URL?: string;
}

const DEFAULT_FEED_URL = "https://cf.nascar.com/live/feeds/live-feed.json";
/** Stop the poll loop after this long with no client interest; restarts on demand. */
const STOP_AFTER_IDLE_MS = 15 * 60 * 1000;
const MAX_ALERTS = 40;

// ---- Durable Object: the single poller + snapshot store ----

export class LiveCoordinator {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const series = clampSeries(url.searchParams.get("series"));
    if (url.pathname === "/snapshot") {
      await this.ensureRunning(series);
      const latest = await this.state.storage.get<LivePayload>("latest");
      return jsonResponse(latest ?? warming());
    }
    if (url.pathname === "/kick") {
      await this.ensureRunning(series);
      return jsonResponse({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  /** Record client interest, remember which series to poll, and keep the loop ticking. */
  private async ensureRunning(series: number): Promise<void> {
    await this.state.storage.put("lastClientAt", Date.now());
    await this.state.storage.put("series", series);
    const alarm = await this.state.storage.getAlarm();
    if (alarm == null) {
      await this.state.storage.setAlarm(Date.now() + 50); // fetch almost immediately
    }
  }

  async alarm(): Promise<void> {
    let live = false;
    const series = (await this.state.storage.get<number>("series")) ?? 1;
    try {
      const feed = await fetchLiveFeed(this.env, series);
      if (feed) {
        const prevSnapshot = (await this.state.storage.get<LiveSnapshot>("prevSnapshot")) ?? null;
        const prevAlerts = (await this.state.storage.get<LiveAlertEvent[]>("alerts")) ?? [];
        const prevHistory = (await this.state.storage.get<LiveHistory>("history")) ?? null;
        const baselines = BASELINES[feed.series_id] ?? BASELINES[1] ?? null;

        // The real pit feed (green-flag aware) supersedes the live-feed's
        // placeholder-zeroed pit_stops; the baked calibration sets the fuel window.
        const pitStops = await fetchPitStops(this.env, feed);
        // The live feed carries track_id but not track type; the baked table's
        // per-track-id entry is the primary lookup (type fallback is for the batch).
        const trackStrategy = strategyFor(feed.track_id ?? 0, null);

        const { payload, snapshot, history } = liveRuntime.processFeed(feed, {
          baselines,
          prevSnapshot,
          prevAlerts,
          prevHistory,
          pitStops,
          trackStrategy,
          maxAlerts: MAX_ALERTS,
          fetchedAt: Date.now(),
        });
        live = payload.live;

        // Only the idle state needs "Next Up"; skip the schedule fetch while racing.
        if (!live) payload.nextRace = await this.getNextRace(feed.series_id || series);

        await this.state.storage.put("latest", payload);
        await this.state.storage.put("prevSnapshot", snapshot);
        await this.state.storage.put("alerts", payload.alerts);
        await this.state.storage.put("history", history);
      }
    } catch {
      // Keep the last good snapshot; just try again next tick.
    }

    // Reschedule: fast while live, slow while idle, stop when unwatched.
    const lastClientAt = (await this.state.storage.get<number>("lastClientAt")) ?? 0;
    if (Date.now() - lastClientAt > STOP_AFTER_IDLE_MS) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const next = live ? liveConfig.POLL_INTERVAL_MS : liveConfig.IDLE_POLL_INTERVAL_MS;
    await this.state.storage.setAlarm(Date.now() + next);
  }

  /** Next scheduled session for the idle "Next Up" card; schedule cached ~10 min. */
  private async getNextRace(seriesId: number): Promise<NextRace | null> {
    const CACHE_MS = 10 * 60 * 1000;
    try {
      const now = Date.now();
      const cached = await this.state.storage.get<{ at: number; seriesId: number; races: unknown[] }>("schedule");
      let races = cached?.races;
      if (!cached || cached.seriesId !== seriesId || now - cached.at > CACHE_MS) {
        const year = new Date().getUTCFullYear();
        const url = `https://cf.nascar.com/cacher/${year}/${seriesId}/schedule-feed.json`;
        const res = await fetch(url, { headers: { "User-Agent": liveConfig.BROWSER_UA }, cf: { cacheTtl: 60 } });
        if (res.ok) {
          const parsed = await res.json();
          if (Array.isArray(parsed)) {
            races = parsed;
            await this.state.storage.put("schedule", { at: now, seriesId, races });
          }
        }
      }
      return pickNextRace(races ?? [], seriesId);
    } catch {
      return null;
    }
  }
}

// ---- schedule helpers ----

/** Parse a NASCAR schedule timestamp, tolerating a missing UTC marker. */
function parseUtc(raw: string): number {
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z";
  return Date.parse(s);
}

/** The soonest race in the schedule feed that starts after now. */
function pickNextRace(races: unknown[], seriesId: number): NextRace | null {
  const now = Date.now();
  let best: Record<string, unknown> | null = null;
  let bestT = Infinity;
  for (const r of races) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const raw = (rec.start_time_utc ?? rec.race_date_utc ?? rec.start_time) as string | undefined;
    if (!raw) continue;
    const t = parseUtc(raw);
    if (Number.isFinite(t) && t > now && t < bestT) {
      bestT = t;
      best = rec;
    }
  }
  if (!best) return null;
  return {
    seriesId,
    name: (best.race_name as string) ?? (best.scheduled_event_name as string) ?? null,
    trackName: (best.track_name as string) ?? null,
    startTimeUtc: (best.start_time_utc as string) ?? (best.race_date_utc as string) ?? null,
  };
}

// ---- upstream fetch ----

/** Base feed = current on-track session (series 1); series_2/3 target that series. */
function liveFeedUrl(series: number): string {
  return series > 1
    ? `https://cf.nascar.com/live/feeds/series_${series}/live-feed.json`
    : DEFAULT_FEED_URL;
}

/** Coerce a request's ?series to 1/2/3 (default 1). */
function clampSeries(raw: string | null): number {
  const n = Number(raw);
  return n === 2 || n === 3 ? n : 1;
}

/**
 * The authoritative pit feed for the current race. Carries real pit-in laps AND
 * flag status (green vs caution), unlike the live-feed's placeholder-zeroed
 * pit_stops. Returns [] on any miss — the model degrades gracefully to the feed.
 */
async function fetchPitStops(env: Env, feed: LiveFeed): Promise<NormalizedPitStop[]> {
  const series = feed.series_id || 1;
  const raceId = feed.race_id;
  if (!raceId) return [];
  const url =
    env.LIVE_PIT_URL ||
    `https://cf.nascar.com/cacher/live/series_${series}/${raceId}/live-pit-data.json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": liveConfig.BROWSER_UA, Accept: "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return [];
    return liveService.pitStopsFromLivePitData(json as LivePitRecord[]);
  } catch {
    return [];
  }
}

async function fetchLiveFeed(env: Env, series: number): Promise<LiveFeed | null> {
  const url = env.LIVE_FEED_URL || liveFeedUrl(series);
  const res = await fetch(url, {
    headers: { "User-Agent": liveConfig.BROWSER_UA, Accept: "application/json" },
    // The feed sends no Cache-Control; bypass Cloudflare's default subrequest cache
    // so every tick reads fresh.
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) return null;
  let feed: unknown;
  try {
    feed = await res.json();
  } catch {
    return null;
  }
  if (!feed || typeof feed !== "object" || !Array.isArray((feed as { vehicles?: unknown }).vehicles)) {
    return null;
  }
  return feed as LiveFeed;
}

// ---- HTTP helpers ----

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function warming(): LivePayload & { warming: true } {
  return {
    ok: true,
    live: false,
    warming: true,
    fetchedAt: Date.now(),
    // Minimal empty snapshot so the client can render its waiting state.
    snapshot: {
      raceId: 0, seriesId: 0, runName: null, trackName: null, trackLength: null,
      lap: 0, lapsInRace: 0, lapsToGo: 0, elapsedTime: 0, flag: "none", flagState: 0,
      stage: null, cautionSegments: 0, leadChanges: 0, numberOfLeaders: 0, isLive: false, drivers: [],
    },
    alerts: [],
    pitCycles: [],
    movers: { gaining: [], fading: [] },
    battles: [],
    fieldLeaders: [],
    nextRace: null,
  };
}

// ---- Worker entry ----

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/live") {
      const series = clampSeries(url.searchParams.get("series"));
      const stub = env.LIVE.get(env.LIVE.idFromName(`live-${series}`));
      const r = await stub.fetch(`https://do/snapshot?series=${series}`);
      const body = await r.text();
      return new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, s-maxage=3, max-age=0",
          ...CORS,
        },
      });
    }

    // Slim liveness probe for the nav dot / home banner headline (no driver rows).
    if (url.pathname === "/api/live/status") {
      const series = clampSeries(url.searchParams.get("series"));
      const stub = env.LIVE.get(env.LIVE.idFromName(`live-${series}`));
      const r = await stub.fetch(`https://do/snapshot?series=${series}`);
      const full = (await r.json()) as LivePayload & { warming?: boolean };
      const s = full.snapshot;
      const status = {
        ok: true,
        live: full.live,
        warming: full.warming ?? false,
        seriesId: s.seriesId,
        runName: s.runName,
        trackName: s.trackName,
        flag: s.flag,
        lap: s.lap,
        lapsInRace: s.lapsInRace,
        stage: s.stage,
      };
      return new Response(JSON.stringify(status), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, s-maxage=3, max-age=0",
          ...CORS,
        },
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "looplab-live" }, CORS);
    }

    if (url.pathname === "/" || url.pathname === "/live" || url.pathname === "/index.html") {
      return new Response(PAGE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ---- the self-contained live page ----
// Inline CSS + vanilla JS (string-concatenation only — no nested template
// literals — so this stays inside one outer template string). Design tokens
// mirror src/app/style.css (Looplab dark).

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>Looplab LIVE</title>
<style>
  :root{
    --bg:#0a0c10;--surface:#12151c;--surface-2:#191d26;--border:#262c38;
    --text:#e9edf4;--muted:#8b95a6;--accent:#ffd23f;--pos:#34d399;--neg:#f87171;
    --display:"Avenir Next Condensed","Arial Narrow","Roboto Condensed",system-ui,sans-serif;
    --body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{background:#06070a}
  body{background:var(--bg);color:var(--text);font-family:var(--body);-webkit-font-smoothing:antialiased}
  .num{font-variant-numeric:tabular-nums}
  .shell{max-width:520px;margin:0 auto;min-height:100dvh;background:var(--bg);border-left:1px solid #14181f;border-right:1px solid #14181f}
  .appbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;position:sticky;top:0;background:rgba(10,12,16,.92);backdrop-filter:blur(6px);z-index:5;border-bottom:1px solid #14181f}
  .wordmark{font-family:var(--display);font-weight:700;font-size:20px;letter-spacing:.06em;text-transform:uppercase}
  .wordmark em{font-style:normal;color:var(--accent)}
  .livechip{display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:5px 10px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .livechip.on{color:#fff;border-color:rgba(52,211,153,.5)}
  .livechip.on .dot{background:var(--pos);box-shadow:0 0 0 0 rgba(52,211,153,.7);animation:pulse 1.6s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.6)}70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
  @media (prefers-reduced-motion:reduce){.livechip.on .dot{animation:none}}
  .screen{padding:12px 12px 40px;display:flex;flex-direction:column;gap:12px}
  .status{border-radius:14px;padding:13px 15px;display:flex;align-items:center;gap:12px}
  .status .flabel{font-family:var(--display);text-transform:uppercase;letter-spacing:.06em;font-weight:700;font-size:15px}
  .status .rname{margin-left:auto;text-align:right;font-size:12.5px;opacity:.92}
  .status .rname b{display:block;font-family:var(--display);font-size:15px;letter-spacing:.02em}
  .chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .chip{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:9px 6px;text-align:center}
  .chip b{display:block;font-family:var(--display);font-size:20px;letter-spacing:.02em}
  .chip span{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:13px}
  .card-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px}
  .card-h h3{font-family:var(--display);font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:8px}
  .card-h h3::before{content:"";width:4px;height:11px;background:var(--accent);border-radius:2px}
  select{width:100%;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:14px;font-family:var(--body)}
  .fcard{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;margin-top:11px;padding-top:11px;border-top:1px solid #1d222c}
  .fpos{font-family:var(--display);font-weight:700;font-size:30px;line-height:1;text-align:center}
  .fpos small{display:block;font-size:9px;letter-spacing:.1em;color:var(--muted);font-family:var(--body);margin-top:3px}
  .fstats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
  .fstat{background:var(--surface-2);border-radius:9px;padding:7px 6px;text-align:center}
  .fstat b{display:block;font-size:14px;font-weight:700}
  .fstat span{font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .alerts{display:flex;flex-direction:column;gap:6px;max-height:210px;overflow-y:auto}
  .alert{display:flex;gap:9px;align-items:baseline;font-size:12.5px;padding:6px 8px;background:var(--surface-2);border-radius:8px;border-left:3px solid var(--border)}
  .alert .lap{color:var(--muted);font-size:10.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .alert.caution{border-left-color:var(--accent)} .alert.green{border-left-color:var(--pos)}
  .alert.lead_change{border-left-color:var(--accent)} .alert.out{border-left-color:var(--neg)}
  .alert.position_gain{border-left-color:var(--pos)} .alert.position_loss{border-left-color:var(--neg)}
  .alert.stage_end{border-left-color:#4b83f0}
  .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);text-align:left;padding:4px 6px;font-weight:600;position:sticky;top:0;background:var(--surface)}
  td{padding:7px 6px;border-top:1px solid #1d222c;font-variant-numeric:tabular-nums;white-space:nowrap}
  th.r,td.r{text-align:right}
  tr.me td{background:rgba(255,210,63,.08)}
  .car{color:var(--muted);font-size:11px}
  .dn{color:var(--muted)}
  .foot{font-size:11px;color:var(--muted);line-height:1.5;text-align:center;padding:4px 8px}
  .empty{text-align:center;padding:26px 14px;color:var(--muted);font-size:13.5px;line-height:1.55}
  .empty .big{font-family:var(--display);text-transform:uppercase;font-size:19px;color:var(--text);letter-spacing:.03em;margin-bottom:6px}
</style>
</head>
<body>
<div class="shell">
  <header class="appbar">
    <span class="wordmark">Loop<em>lab</em> Live</span>
    <span id="livechip" class="livechip"><span class="dot"></span><span id="livetext">Connecting</span></span>
  </header>
  <main class="screen">
    <div id="status" class="status" style="background:var(--surface);border:1px solid var(--border)">
      <span class="flabel">—</span>
    </div>
    <div id="chips" class="chips" hidden></div>

    <div class="card" id="followcard">
      <div class="card-h"><h3>Follow a driver</h3></div>
      <select id="follow"><option value="">Pick your driver…</option></select>
      <div id="fbody"></div>
    </div>

    <div class="card" id="alertcard" hidden>
      <div class="card-h"><h3>Race feed</h3></div>
      <div id="alerts" class="alerts"></div>
    </div>

    <div class="card" id="boardcard">
      <div class="card-h"><h3 id="boardtitle">Leaderboard</h3></div>
      <div id="board"></div>
    </div>

    <p class="foot" id="foot">Live loop data via the NASCAR public feed — unofficial, for fun.</p>
  </main>
</div>
<script>
(function(){
  var POLL=5000;
  var followId=localStorage.getItem("looplab_follow")||"";
  var rosterSig="", lastFetchedAt=0, everLive=false;

  var elLiveChip=document.getElementById("livechip");
  var elLiveText=document.getElementById("livetext");
  var elStatus=document.getElementById("status");
  var elChips=document.getElementById("chips");
  var elFollow=document.getElementById("follow");
  var elFBody=document.getElementById("fbody");
  var elAlertCard=document.getElementById("alertcard");
  var elAlerts=document.getElementById("alerts");
  var elBoard=document.getElementById("board");
  var elBoardTitle=document.getElementById("boardtitle");
  var elFoot=document.getElementById("foot");

  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function pct(n){return n==null?"—":Math.round(n*100)+"%";}
  function signed(n,dp){if(n==null)return "—";var v=Number(n).toFixed(dp==null?1:dp);return n>0?"+"+v:v.replace("-","\\u2212");}
  function gap(d){if(d.position===1)return "LDR";if(d.gapToLeader==null)return "—";return "+"+Number(d.gapToLeader).toFixed(1);}

  function flagInfo(flag,live){
    var m={
      green:{label:"Green flag",bg:"#15803d",fg:"#fff"},
      yellow:{label:"Caution",bg:"#ca8a04",fg:"#1a1300"},
      red:{label:"Red flag",bg:"#b91c1c",fg:"#fff"},
      white:{label:"White flag — last lap",bg:"#d1d5db",fg:"#111"},
      checkered:{label:"Checkered — final",bg:"#374151",fg:"#fff"},
      cold:{label:"Track cold",bg:"#1f2937",fg:"#c7cedb"},
      hot:{label:"Track hot",bg:"#7c2d12",fg:"#fff"},
      none:{label:"Not on track",bg:"#1f2937",fg:"#c7cedb"},
      unknown:{label:"Standby",bg:"#1f2937",fg:"#c7cedb"}
    };
    return m[flag]||m.unknown;
  }

  function driverOpts(drivers){
    var sorted=drivers.slice().sort(function(a,b){return String(a.driverName).localeCompare(b.driverName);});
    var html='<option value="">Pick your driver…</option>';
    for(var i=0;i<sorted.length;i++){var d=sorted[i];html+='<option value="'+d.driverId+'">'+esc(d.driverName)+" (#"+esc(d.carNumber)+")</option>";}
    return html;
  }

  function renderFollow(data){
    var drivers=data.snapshot.drivers||[];
    var me=null;for(var i=0;i<drivers.length;i++){if(String(drivers[i].driverId)===String(followId)){me=drivers[i];break;}}
    if(!followId||!me){elFBody.innerHTML="";return;}
    var pc=null,cyc=data.pitCycles||[];for(var j=0;j<cyc.length;j++){if(String(cyc[j].driverId)===String(followId)){pc=cyc[j];break;}}
    var nextPit=pc&&pc.estimatedNextPitLap!=null?("~L"+pc.estimatedNextPitLap):"—";
    elFBody.innerHTML='<div class="fcard">'+
      '<div class="fpos">P'+me.position+'<small>'+esc(me.driverName)+"</small></div>"+
      '<div class="fstats">'+
        fstat(gap(me),"Gap")+
        fstat(me.lastLapSpeed==null?"—":Number(me.lastLapSpeed).toFixed(0),"Last mph")+
        fstat(pct(me.livePassEfficiency),"Pass eff")+
        fstat(signed(me.adjPassEfficiency),"Adj PE")+
        fstat(String(me.lapsLed),"Laps led")+
        fstat(me.pitStopCount+" · "+nextPit,"Pits · next")+
      "</div></div>";
  }
  function fstat(v,l){return '<div class="fstat"><b class="num">'+esc(v)+"</b><span>"+esc(l)+"</span></div>";}

  function renderAlerts(data){
    var a=data.alerts||[];
    if(!a.length){elAlertCard.hidden=true;return;}
    elAlertCard.hidden=false;
    var html="";
    for(var i=0;i<a.length;i++){var e=a[i];
      html+='<div class="alert '+esc(e.kind)+'"><span>'+esc(e.message)+'</span><span class="lap" style="margin-left:auto">L'+e.atLap+"</span></div>";
    }
    elAlerts.innerHTML=html;
  }

  function renderBoard(data){
    var drivers=data.snapshot.drivers||[];
    if(!drivers.length){elBoard.innerHTML='<p class="dn" style="font-size:12.5px">Waiting for cars on track…</p>';return;}
    var rows="";
    for(var i=0;i<drivers.length;i++){var d=drivers[i];
      var mine=String(d.driverId)===String(followId);
      var adj=d.adjPassEfficiency;
      var adjCls=adj==null?"dn":(adj>0?"pos":"neg");
      var adjStyle=adj==null?"":(adj>0?"color:var(--pos)":"color:var(--neg)");
      rows+='<tr'+(mine?' class="me"':"")+">"+
        '<td class="num">'+d.position+"</td>"+
        '<td class="car num">'+esc(d.carNumber)+"</td>"+
        "<td>"+esc(d.driverName)+"</td>"+
        '<td class="r num">'+gap(d)+"</td>"+
        '<td class="r num">'+(d.lastLapSpeed==null?"—":Number(d.lastLapSpeed).toFixed(0))+"</td>"+
        '<td class="r num">'+pct(d.livePassEfficiency)+"</td>"+
        '<td class="r num" style="'+adjStyle+'">'+signed(adj)+"</td>"+
        "</tr>";
    }
    elBoard.innerHTML='<div class="tbl-wrap"><table>'+
      "<thead><tr><th>P</th><th>#</th><th>Driver</th><th class=r>Gap</th><th class=r>Last</th><th class=r>Pass</th><th class=r>Adj PE</th></tr></thead>"+
      "<tbody>"+rows+"</tbody></table></div>";
  }

  function render(data){
    if(!data||!data.snapshot){return;}
    lastFetchedAt=data.fetchedAt||Date.now();
    var snap=data.snapshot, drivers=snap.drivers||[], live=!!data.live;
    if(live)everLive=true;

    // live chip
    elLiveChip.className="livechip"+(live?" on":"");
    elLiveText.textContent=live?"Live":(data.warming?"Connecting":"Off air");

    // status strip
    var fi=flagInfo(snap.flag,live);
    elStatus.setAttribute("style","background:"+fi.bg+";color:"+fi.fg+";border:1px solid rgba(255,255,255,.08)");
    var right=snap.runName?('<span class="rname"><b>'+esc(snap.runName)+"</b>"+esc(snap.trackName||"")+"</span>"):"";
    elStatus.innerHTML='<span class="flabel">'+esc(fi.label)+"</span>"+right;

    // chips
    if(drivers.length){
      elChips.hidden=false;
      var lapTxt=snap.lapsInRace?(snap.lap+" / "+snap.lapsInRace):"—";
      var stage=snap.stage?("St "+snap.stage.num):"—";
      elChips.innerHTML=
        chip(lapTxt,"Lap")+chip(stage,"Stage")+chip(String(snap.cautionSegments||0),"Cautions")+chip(String(snap.leadChanges||0),"Lead chg");
    } else { elChips.hidden=true; }

    // roster (only rebuild select when it changes, to not fight an open dropdown)
    var sig=drivers.map(function(d){return d.driverId;}).join(",");
    if(sig!==rosterSig){rosterSig=sig;if(drivers.length){elFollow.innerHTML=driverOpts(drivers);elFollow.value=followId;}}

    renderFollow(data);
    renderAlerts(data);

    // board title reflects state
    if(!drivers.length){ elBoardTitle.textContent="Leaderboard"; }
    else if(live){ elBoardTitle.textContent="Live leaderboard"; }
    else if(snap.flag==="checkered"||snap.flag==="cold"){ elBoardTitle.textContent="Final — last session"; }
    else { elBoardTitle.textContent="Leaderboard"; }
    renderBoard(data);

    // pre-race empty hint
    if(!drivers.length){
      elBoard.innerHTML='<div class="empty"><div class="big">Standing by</div>This page comes alive when the green flag drops. Keep it open — it refreshes itself every 5 seconds.</div>';
    }
    updateFoot();
  }

  function chip(v,l){return '<div class="chip"><b class="num">'+esc(v)+"</b><span>"+esc(l)+"</span></div>";}

  function updateFoot(){
    var ago=Math.max(0,Math.round((Date.now()-lastFetchedAt)/1000));
    elFoot.innerHTML="Updated "+ago+"s ago · auto-refreshing · unofficial loop data, for fun";
  }

  elFollow.addEventListener("change",function(){
    followId=elFollow.value;localStorage.setItem("looplab_follow",followId);
    // re-render immediately from the last payload if we have it
    if(window.__last)render(window.__last);
  });

  function tick(){
    fetch("/api/live",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){window.__last=d;render(d);}).catch(function(){});
  }
  tick();
  setInterval(tick,POLL);
  setInterval(updateFoot,1000);
})();
</script>
</body>
</html>`;
