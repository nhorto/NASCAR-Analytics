# Live Race Day Companion — Research (2026-07-05)

> Research backing the "live race companion" candidate in [PLANS.md](../PLANS.md).
> Scope decided with the owner: **live leaderboard + our loop-data metrics, my-driver
> alerts, and a strategy tracker** — all **free**, **in-app** (no push in the MVP).
> Live betting/DFS is explicitly **deferred**.

**Bottom line:** A live companion is feasible on the **same NASCAR public CDN we already
use** — no new data vendor is required for the MVP. The live feed carries live positions,
laps-to-go, flags, gaps, lap speeds, pit status, stages, **and live loop-style passing
stats** (so our proprietary metrics apply live, not just post-race). The only real work is
architectural: production is currently a static Cloudflare Pages site, and "live" needs a
tiny always-fresh layer. The recommended answer is a **single Cloudflare Durable Object that
polls the CDN and fans out through an edge-cached Pages Function** — same origin, ~$5/mo even
at 10k concurrent, and it drops into the existing Direct-Upload deploy.

---

## ⚠️ Validation note — could not probe the live CDN from this environment

Both this session's egress policy **and** NASCAR's CDN bot-filter blocked direct probing:

- This cloud environment's proxy **denies `CONNECT cf.nascar.com:443` (403 policy denial)**.
  The historical ingestion / weekly refresh run **locally**, where the CDN is reachable —
  this lockdown is specific to the web session.
- NASCAR's CDN itself **403s any request without a browser `User-Agent`.** Every working
  open-source client sends `User-Agent: Mozilla/5.0 (...)`. **This is mandatory** and is the
  single most important operational detail for the fetch client.

So the schema/cadence below is **reconstructed from authoritative open-source consumers**
(chiefly the C# `rNascar23.Sdk` AutoMapper profiles, cross-checked against ~6 Python live
parsers) — field names are **CONFIRMED against source code**, but a few runtime details are
**INFERRED**. Anything marked INFERRED must be confirmed with **one local probe during an
actual live session** before we finalize the parser. See the [confirm-locally checklist](#confirm-locally-checklist).

---

## 1. Data feasibility — NASCAR public CDN live feeds

### Endpoint map (CONFIRMED from `rNascar23.Sdk`)

| Data | URL | Live during race? |
|---|---|---|
| **Live feed (Cup)** | `cf.nascar.com/live/feeds/live-feed.json` | **YES — primary source** |
| Live feed (mirror) | `cf.nascar.com/cacher/live/live-feed.json` | YES (same payload) |
| Live feed (Xfinity / Trucks) | `cf.nascar.com/live/feeds/series_2/live-feed.json`, `.../series_3/...` | YES |
| **Flag state** | `cf.nascar.com/live/feeds/live-flag-data.json` | **YES** (lightweight) |
| **Live pit data** | `cf.nascar.com/cacher/live/series_{series}/{race_id}/live-pit-data.json` | **YES** |
| Live points | `cf.nascar.com/live/feeds/series_{series}/{race_id}/live_points.json` | YES |
| Lap times | `cf.nascar.com/cacher/{year}/{series}/{race_id}/lap-times.json` | Updates live, lags feed |
| Weekend feed (results) | `cf.nascar.com/cacher/{year}/{series}/{race_id}/weekend-feed.json` | **Post-session** |
| **Official loop stats** | `cf.nascar.com/loopstats/prod/{year}/{series}/{race_id}.json` | **Post-race** (Driver Rating) |
| Schedule / race list | `cf.nascar.com/cacher/{year}/race_list_basic.json` | Static per season |

**Series IDs:** 1 = Cup, 2 = Xfinity, 3 = Trucks. Idle behavior: live endpoints return
**HTTP 200 with an empty/null body** when nothing is on track (matches what we already know).

> **Discrepancy to reconcile:** our ingestion `config.ts` uses `schedule-feed.json`, which
> worked for the historical backfill. The live-data research found the community-canonical
> schedule file is `race_list_basic.json` and found **no** code references to `schedule-feed.json`.
> Both may exist; `race_list_basic.json` carries the richer per-race fields (below) and is what
> we should use to **detect the current/next on-track session**. Confirm locally.

### `live-feed.json` schema (CONFIRMED field names)

Top-level: `lap_number`, `laps_in_race`, `laps_to_go`, `elapsed_time`, `flag_state`,
`race_id`, `run_id`, `run_name`, `run_type`, `series_id`, `track_id`, `track_length`,
`track_name`, `number_of_caution_segments`, `number_of_caution_laps`,
`number_of_lead_changes`, `number_of_leaders`, `avg_diff_1to3`, `stage` (object),
`vehicles` (array).

**`flag_state` enum:** `0 None · 1 Green · 2 Yellow · 3 Red · 4 White · 5 Checkered ·
8 HotTrack · 9 ColdTrack`.

**`stage` object:** `stage_num`, `finish_at_lap`, `laps_in_stage`.

**`vehicles[]` per car (the important part):**

| Field | Meaning |
|---|---|
| `running_position` | **live running order / position** |
| `vehicle_number` | car number |
| `driver` | `{ driver_id, full_name, first_name, last_name, is_in_chase }` |
| `delta` | **gap to leader** |
| `last_lap_time`, `last_lap_speed` | most recent lap |
| `best_lap_time`, `best_lap_speed` | best lap so far |
| `average_speed`, `average_running_position` | live cumulative |
| `laps_completed`, `laps_led` | live counters |
| `passes_made`, `times_passed`, `passing_differential` | **live green-flag passing** |
| `quality_passes` | **live quality passes** |
| `position_differential_last_10_percent` | **live closer-style metric** |
| `fastest_laps_run`, `laps_position_improved` | live loop-style counters |
| `pit_stops[]` | `pit_in_lap_count`, `pit_out_lap_count`, `pit_in_rank`, `pit_out_rank`, `positions_gained_lossed` |
| `is_on_track`, `is_on_dvp`, `status` | on track / damaged-vehicle clock / running-or-out |
| `starting_position`, `sponsor_name`, `vehicle_manufacturer` | context |

**Not in the feed:** raw telemetry (throttle/brake/RPM/GPS) — that's the proprietary
SMT/RaceView pipeline, not the public JSON.

### Are our proprietary metrics available live?

- **Live component stats: YES.** `quality_passes`, `passes_made`, `passing_differential`,
  `average_running_position`, `position_differential_last_10_percent`, `fastest_laps_run`,
  `laps_led` all update **during** the race per car. So "quality passes so far", "avg running
  position", and a live pass-efficiency read are achievable **now** off the live feed.
- **Official Driver Rating: post-race.** The headline composite (2.0–150.0) needs full-race
  denominators (mid-race position, closer over the final 10%, laps-in-top-15 across the whole
  race), so the authoritative `loopstats/prod/...` file only finalizes at/after race end.
- **Our own metrics (Adjusted Pass Efficiency, Closer Score)** are residuals vs. league
  baselines per running-position bucket. The **baselines** come from our existing weekly batch;
  the **live inputs** (passing, running position) are in the live feed. So we can compute a
  *live estimate* of our metrics = `liveFeed + baselines`, and swap to the authoritative
  post-race value once `loopstats/prod` populates. This is the moat, live.

### Cadence, latency, rate limits (CONFIRMED unless noted)

- **Poll every 3–5 s.** The most-used community collector hard-codes a 5 s interval; the CDN
  snapshot refreshes ~1–3 s, so faster polling yields nothing new. (Exact `Cache-Control` TTL
  is INFERRED — measure it live.)
- **Near-real-time, ahead of TV** (INFERRED, strong): NASCAR.com's own leaderboard uses this
  same data and ships a "sync/pause with your TV" control — you only need that if data arrives
  *before* the ~5–30 s broadcast delay. (Note: third-party *distributors* like SportsDataIO can
  be 10–15 min behind on low tiers — that's a distributor artifact, **not** the raw CDN.)
- **No published rate limit / no auth**, but it's Cloudflare-fronted, so a flood of identical
  requests risks a WAF 403/429/1015. **Mitigation = we poll once server-side and fan out** (the
  architecture below), and always send a browser User-Agent.

### Legal / ToS risk

The CDN is **unofficial and unlicensed** — no terms grant redistribution. NASCAR's real-time
data rights are licensed to **Sportradar** (official), distributed via **SMT**. For a *free
fan-analytics MVP* the CDN is the pragmatic source (as dozens of fan projects do), but a
**monetized / betting** product at scale should line up a licensed path (**Sportradar** —
trial keys available). Betting is deferred, so this is a "know it, revisit before we
commercialize or add odds" item, not an MVP blocker.

---

## 2. Recommended architecture — Cloudflare Durable Object + edge-cached Pages Function

**Why not just let browsers poll the CDN?** It needs a browser User-Agent (fetch from our
origin won't have the right one cleanly), it's almost certainly CORS-blocked, every user would
hammer NASCAR's CDN (ban risk), and there'd be **nowhere to compute our proprietary metrics** —
we'd be shipping our data source instead of our product. Rejected.

**Two constraints that decide the design:**

1. **Cloudflare Cron Triggers have a 1-minute minimum** — you can't "cron every 3 s". The only
   primitive that gives a true global-singleton few-second poll is a **Durable Object
   `alarm()` loop** that reschedules itself.
2. **Egress is the real fan-out cost, and only Cloudflare zeroes it.** Pushing the feed to
   thousands of users every few seconds is tens–hundreds of GB per race. On Cloudflare that's
   **$0**; on Fly/Railway/a VPS it's the dominant line item.

### MVP design (ship this)

1. **`LiveCoordinator` Durable Object (singleton).** `alarm()` every ~4 s → `fetch()` the CDN
   live feed **with a browser User-Agent** → if non-empty, run our **pure** live-metric
   functions (`liveFeed + baselines.json`) → write a **compact snapshot** to **KV** →
   reschedule. When the feed is empty (no session), back off to ~60 s (or sleep). This DO is
   the **only** thing that touches `cf.nascar.com`.
2. **Pages Function `GET /api/live`.** Reads the latest KV snapshot, returns JSON with
   `Cache-Control: s-maxage=3`. Cloudflare's edge cache fans this out to all users at ~$0 origin
   cost and **$0 egress**.
3. **Client.** Vanilla `fetch('/api/live')` every ~5 s on a new live page; render the snapshot.
   Same-origin → **no CORS**, and it fits the repo's "a little vanilla JS" status quo.

Result: **one** upstream poll regardless of user count, proprietary math hidden server-side,
scales to ~10k concurrent on ~$5/mo, and deploys as a `functions/` addition to the existing
Direct-Upload flow — **no new host, no server to babysit.**

### Scale path (later, when latency/polish matters)

- Replace client polling with **WebSocket push** via the DO **hibernation API** (coordinator
  pushes each new snapshot) → ~3–5 s end-to-end, fewer requests; hibernates to ~$0 between races.
- If concurrent sockets per DO exceed ~1k, add **fan-out "room" DOs**.
- Keep KV + `/api/live` as the fallback. Still $0 egress, still ~$5/mo base at 10k.

### Validate-fast option

Prototype the whole live pipeline as a **plain local Bun server** first (it runs the real
domain code and lets us nail the metric math against a live race in an afternoon), then port
the **pure** metric functions into the DO for production. Don't make the Bun server the
production fan-out.

### Rough cost (per ~3.5 h race)

| | Client-direct | **CF DO + KV (MVP)** | CF DO WS push (scale) | Bun on Fly |
|---|---|---|---|---|
| Upstream CDN load | N× users (abusive) | **1 poll / 4 s** | 1 poll / 4 s | 1 poll / 4 s |
| Latency | poll interval | 3–10 s | **3–5 s** | 3–5 s |
| Egress cost | $0 (ours) | **$0** | **$0** | metered — the problem |
| 10k concurrent | $0 + **ban risk** | **~$5–15/mo** | **~$5/mo** | ~$5–10/mo + egress + ops |
| Metrics server-side | ❌ | ✅ | ✅ | ✅ |
| Same-origin / no CORS | ❌ | ✅ | ✅ | ❌ (2nd origin) |

### How it fits the layered architecture

- New **`live` domain** on the standard layer model: `types → config → service (pure
  live-metric math) → runtime (DO handler + `/api/live` handler)`. It consumes the batch-produced
  `baselines.json` **artifact**, not the `analytics` service directly — preserving
  `Utils → Types → Providers → Domains → App` and the intra-domain order.
- New **`live-store` provider** (KV/Cache binding) as the cross-cutting entry point; the CDN
  fetch reuses the `nascar-cdn` provider pattern (add the mandatory User-Agent there).
- **Weekly batch pipeline is unchanged** — it merely *also* emits `baselines.json`. The static
  site is unchanged; the live page is one new client-rendered page.
- Deploy stays **Direct Upload**, now including a `functions/` dir; DO + KV bindings configured
  on the Pages project (`wrangler.toml` currently has no bindings).

---

## 3. Competitive / market landscape

The live second-screen market is **fragmented across five silos** — no single tool combines
live timing + loop data + strategy context. Fans run 2–3 at once.

| Tool | Live offering | Price | Weakness we exploit |
|---|---|---|---|
| **NASCAR Mobile (official, v16)** | Live leaderboard, lap times/averages, pit insights, telemetry, scanner | Free basics; **Premium $4.99/mo or $29.99/season** | The useful live analytics (Win Probability, Movers & Fallers, 10/20-lap avgs, telemetry) are **paywalled**; leaderboard **fails at green-flag peak load**; fragmented UX |
| **RaceView / RaceView 3D** | 3D live cars, throttle/brake/wheel, time-off-leader | **Discontinued ~2020** | The market's clearest unmet demand — an active Change.org petition wants it back; replaced by an app fans say has "<5% of the data" |
| **Lap Raptor** | Loop-data search/lookup/CSV, lap-by-lap | Free | Static analyst dashboard, **not a live mobile second-screen** |
| **Win The Race** | Loop data incl. "Closers", DFS optimizer | Paid | Overlaps our Closer Score, but analyst/DFS-grinder oriented, not a live fan companion |
| **FRCS.pro** | AccuPredict projections, DFS tools | Paid | Proves a paying niche exists; 2008 UX, not live |
| **MRN / PRN radio** | Free live audio play-by-play | Free | Audio only, no data; alternates by track |
| **X (Bob Pockrass) / Reddit threads** | Fastest strategy/penalty info; communal | Free | Unstructured, no data layer — fans reverse-engineer pit strategy from tweets |

### What fans complain is missing/broken (the pain points we win on)

1. **RaceView's removal gutted the live data** — the emotional core; stats now update "once a
   lap if you're lucky, sometimes 2–3 laps."
2. **Useful live loop stats are paywalled or absent** — pass differential / Driver Rating live
   sends fans to Lap Raptor / Win The Race / FRCS.
3. **The leaderboard literally fails at peak load** — "leaderboard doesn't work half the time,"
   "failed to refresh track position, current lap, flag color" during Cup races. Reliability at
   the green-flag moment is a repeated grievance (**28% of fans say they'd pay just for
   reliability**).
4. **Fragmented UX** — timing/video/radio siloed; no single unified live-race view.

### Features worth stealing (F1 is the benchmark)

F1's strategic lesson: **the data companion (live timing + telemetry + driver-tracker map) is
the cheap acquisition hook** (F1 TV Access ~$3.49/mo); live video is the upsell. Concrete
mechanics to port:

- **Mini-sector color coding** (green = faster than own best, purple = fastest overall) — the
  most-praised micro-detail. NASCAR analog: **color-code loop-data segments to show who's
  gaining, on whom, right now.**
- **Per-driver status chips** — pit-road status, fresh vs. old tires, in/out of fuel window,
  drafting-partner indicator.
- **Predicted pit windows from tire-degradation trends** — NASCAR's "cycle out" is the exact
  analog; **loop-data lap-time falloff is the perfect input** for a green-flag pit-cycle /
  undercut predictor.
- **Driver-tracker radar map** — real-time positions, highlight *your* driver, see draft/battles.
- **Sync-to-TV delay slider** — F1 power tools offer a user-adjustable delay; cheap to build,
  disproportionately loved, and directly answers NASCAR fans' "the data is ahead of my TV" pain.
- **theScore stickiness** — lock-screen Live Activities + granular user-controlled alerts drive
  ~100 opens/user/month. (Relevant to the *later* push-notification phase.)

### Monetization (deferred, but design toward it)

Price anchors cluster $5–$13/mo; a niche single-sport companion realistically lives at
**$4.99–$7.99/mo or ~$29.99/season** (matching the incumbent and the 38-race calendar). We ship
**free** now (per the product principle that the free tier drives growth, and because 55% of
fans "check out" when core access is paywalled). Future premium = **live proprietary metrics +
strategy tracker + reliability + richer alerts**; the largest latent line is a **betting
affiliate** ($100–$300 CPA/depositor) synergistic with a future **live win-probability** layer.

### The opportunity gaps (weighted to our in-scope pillars)

1. **A live, glanceable, mobile-first loop-data leaderboard** — nobody presents live proprietary
   metrics on an F1-style color-coded board; today it's static analyst tables or paywalled/slow
   official data. **This is the core differentiator.**
2. **A loop-data strategy / pit-cycle tracker** — green-flag pit cycles, tire falloff, undercut
   opportunities from loop-data lap-time falloff. Genuinely novel, squarely in scope.
3. **Best-in-class "my-driver" personalization** — follow-your-driver mode + precise events. The
   retention engine. (Alerts in-app now; lock-screen/push later.)
4. **Reliability + a single unified live-race view** — out-execute the incumbent on the thing it
   fails at: fast, no-refresh, one screen (leaderboard + metrics + strategy + your driver).
5. **(Adjacent, defer) live loop-data win-probability** — table stakes in NFL/NBA, absent in
   NASCAR; positions the eventual betting-affiliate line without us becoming a sportsbook.

**Strategic framing:** the market has an emotionally-charged unfilled hole (RaceView), incumbent
reliability failures at peak need, and loop data trapped in analyst tables. A mobile-first,
loop-data-driven live companion is positioned to take all three.

> **Sourcing caveat:** consumer domains (nascar.com, App/Play Store, Reddit, change.org) block
> automated fetch, so prices/features are cross-checked from search summaries, not direct reads.
> Treat exact dollar figures as "approximately correct, verify before publishing." Several
> secondary pain points (gap-to-leader display, fuel-window tracking, DFS live-scoring lag) were
> searched but **not** confirmed with a verbatim fan quote — do a targeted authenticated Reddit
> sweep before citing them in marketing.

---

## Confirm-locally checklist

Run these **locally** (CDN reachable) — ideally **during a live session** — before building the parser:

- [ ] `curl -H 'User-Agent: Mozilla/5.0' -I https://cf.nascar.com/live/feeds/live-feed.json`
      — confirm 200 + capture `Cache-Control`/`max-age` (drives polling cadence).
- [ ] `curl -H 'User-Agent: Mozilla/5.0' -H 'Origin: https://<our-pages-domain>' -I <live-feed>`
      — confirm CORS is absent (kills the client-direct option for good).
- [ ] During a live race: capture one `live-feed.json` payload and diff the real `vehicles[]`
      keys against §1 (source-reconstructed).
- [ ] Confirm `live-flag-data.json` and `live-pit-data.json` shapes.
- [ ] Poll `loopstats/prod/2026/1/{race_id}.json` during the race to observe when it first
      populates (expected: empty/null until race end).
- [ ] Confirm whether `race_list_basic.json` and/or `schedule-feed.json` is the right
      current-session detector.
- [ ] Verify the CDN vs. TV latency direction (data ahead of broadcast?).

## Sources

- `rNascar23.Sdk` (endpoints + models): https://github.com/RRoberts4382/rNascar23.Sdk
- Live-feed consumers (fields/cadence/UA): `shameusburp/NascarLiveTracker` (POLL_INTERVAL=5),
  `MattLD13/SportsTickerBackend` (User-Agent + `cacher/live/live-feed.json`),
  `ooohfascinating/NascarApi`, `anthonysackman/racing-api`, `jstevenscl/tickarr`
- Schedule structure: https://github.com/armstjc/racing-data-repository
- Cadence/scale: https://ably.com/resources/webinars/how-nascar-delivers-realtime-data
- Broadcast sync/pause: https://www.nascar.com/followlive/
- Official providers: Sportradar NASCAR v3 https://developer.sportradar.com/docs/read/racing/NASCAR_v3 · SMT https://smt.com/case-study/nascar/
- Cloudflare: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
  [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) ·
  [DO WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
