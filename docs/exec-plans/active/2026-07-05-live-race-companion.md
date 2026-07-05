# Live Race Day Companion (MVP)

**Status:** ACTIVE — owner-approved 2026-07-05. Phase 0/1 complete; Phase 2 (edge Durable Object) in progress — targeting a live, tester-shareable URL for tonight's Cup race (22:00 UTC).
**Started:** 2026-07-05
**Research:** [docs/research/2026-07-05_live-race-companion.md](../../research/2026-07-05_live-race-companion.md)

## Phase 0 findings (confirmed locally 2026-07-05)

Ran the confirm-locally checklist from a local machine (the cloud env that wrote
this plan could not reach `cf.nascar.com`). All feeds reachable with a browser
`User-Agent`; fixtures captured to `tests/fixtures/`.

- **`live-feed.json`** — 200, ~88KB, 38 vehicles. Captured (last session at capture
  time: Xfinity Cuervo 300, Chicagoland, checkered). `vehicles[]` schema matches the
  research doc with **zero missing fields**; extras present (`average_restart_speed`,
  `best_lap`, `vehicle_elapsed_time`, `qualifying_status`).
- **Two schema corrections** the parser must honor:
  1. `laps_led` is a `{start_lap,end_lap}[]` **array of ranges**, not an int counter
     (laps led = Σ(end−start+1)).
  2. `vehicles[].pit_stops[]` uses `pit_in_lap_count` + `pit_out_elapsed_time`
     (no `pit_out_lap_count`). Entries carry **leading zero-padding** then the real
     pit-in laps (e.g. `[0,0,0,0,0,48,94,134,157]` = 4 stops), so the parser counts
     only entries with `pit_in_lap_count > 0` — those real laps drive the pit-cycle
     model directly. The separate `live-pit-data.json` (248 rows) adds richer
     timing/duration for Phase 2.
- **CORS absent** (`Access-Control-Allow-Origin` not set) → browsers cannot fetch the
  CDN directly → the one-poll-fan-out proxy architecture is **required**, as designed.
- **No `Cache-Control`** on the feed → we own the polling cadence (~5s).
- **`live-flag-data.json`** (array[18]) and **`live-pit-data.json`** (array[248]) — both 200; captured.
- **`loopstats/prod/2026/{series}/{race_id}.json`** — populated for the finished race
  (array[1]) → confirms the post-race authoritative-swap path.
- **Schedule detector:** both `cacher/2026/race_list_basic.json` (series-keyed object)
  and `cacher/2026/{series}/schedule-feed.json` (per-series array) return data; the
  latter carries `start_time_utc` per race — usable to detect the current/next session.
- **Live validation window:** a Cup race ("eero 400") is scheduled 2026-07-05 22:00 UTC;
  owner opted to run a live capture during it for realistic alert/pit test data.

## Problem

The product is a static, weekly-refreshed analytics site. During a race — the
moment fans are most engaged (~87% use a second screen) — it does nothing. The
market has an emotionally-charged, unfilled hole where **RaceView** used to be,
the official app's live leaderboard is **paywalled and unreliable at green-flag
peak load**, and loop data exists only as **static analyst tables**. Our loop-data
moat is the exact wedge, but only if it goes live.

## Goal

A **free, in-app, mobile-first live race companion** that, while a session is on
track, shows a glanceable live leaderboard with our proprietary metrics, a
follow-your-driver view with in-app event alerts, and a loop-data strategy tracker.

Scope confirmed with the owner (2026-07-05):
- ✅ Live leaderboard + our loop-data metrics (live)
- ✅ My-driver alerts (in-app only — **no push** in MVP)
- ✅ Strategy tracker (pit-cycle / tire-falloff)
- ❌ Live betting / DFS — **deferred**
- Hosting: **Cloudflare Worker/Durable Object proxy** (owner-approved)
- Access: **free for everyone**

## Non-goals (MVP)

- No web push / lock-screen Live Activities (a fast-follow phase).
- No authentication / accounts — "my driver" persists in `localStorage`.
- No betting/odds, no win-probability layer (adjacent future work).
- No WebSocket push — client polls our own cached endpoint (scale path only).
- No new **official** data vendor — we build on the NASCAR public CDN we already
  use (Sportradar is the licensed path to revisit before monetizing).

## Architecture (from the research — see doc for full rationale)

**One upstream poll, fanned out at the edge, same-origin.**

```
cf.nascar.com/live/feeds/live-feed.json  (+ live-flag-data, live-pit-data)
        │  (browser User-Agent REQUIRED, poll ~4s, only ONE poller)
        ▼
LiveCoordinator  Durable Object (alarm() loop)
        │  fetch → compute live metrics (pure) → snapshot
        ▼
Cloudflare KV  (latest snapshot)
        ▼
Pages Function  GET /api/live   (Cache-Control: s-maxage=3)
        ▼
Client  fetch('/api/live') every ~5s  →  live page render
```

- **Idle behavior:** when the feed is empty (no session live), the DO backs its
  alarm off to ~60s (or sleeps) → ~$0 off-race, ~zero CDN load.
- **Cost:** ~$5/mo (Workers Paid base) even at ~10k concurrent; $0 egress.
- **Scale path (not MVP):** swap client polling for WebSocket push via the DO
  hibernation API; shard into "room" DOs past ~1k sockets.

### New layered pieces (respect `Utils → Types → Providers → Domains → App`)

- **`live` domain** — `types → config → service → runtime`:
  - `types.ts` — live feed shapes (`LiveFeed`, `LiveVehicle`, `LiveFlag`, `LiveStage`)
    and our normalized `LiveSnapshot` / `LiveDriverRow` / `LiveAlertEvent`.
  - `config.ts` — poll cadence, idle backoff, flag-state enum, alert thresholds.
  - `service.ts` — **pure** functions: `normalizeFeed`, `computeLiveMetrics`
    (`feed + baselines → LiveDriverRow[]` incl. live pass-efficiency / closer
    estimate), `deriveAlerts(prev, next)` (position changes, pit in/out, caution,
    stage end), `pitCycleModel` (green-flag falloff → predicted cycle). Runs in
    both Bun (dev) and the Workers runtime → **no `bun:sqlite`, no Node built-ins.**
  - `runtime.ts` — the DO `alarm()` handler + the `GET /api/live` handler.
- **`live-store` provider** — KV/Cache binding (cross-cutting entry point).
- **`nascar-cdn` provider** — add the **mandatory browser `User-Agent`** and the
  live endpoints; reuse the existing rate-limited/retrying pattern.
- **Weekly batch** — additionally emit `baselines.json` (per-series, per-bucket
  league baselines the live metrics compare against). The static site and existing
  pipeline are otherwise unchanged.
- **App layer** — one new **client-rendered** live page (+ `client/live.js`), a
  home-page "🔴 LIVE" banner when a session is on track, and the `/api/live` wiring.

## Phases

**Phase 0 — Confirm-locally. ✅ DONE (2026-07-05).** Ran the checklist locally; all
feeds reachable, `vehicles[]` schema confirmed, CORS absent, no `Cache-Control`,
`loopstats/prod` populated post-race, both schedule detectors return data. Two
parser corrections found (`laps_led` range array; pit zero-padding). Fixtures saved
to `tests/fixtures/`. See the **Phase 0 findings** section above.

**Phase 1 — Live domain, pure + tested (no network). ✅ DONE (2026-07-05).** Built the
Workers-safe `live` domain (`types` → `config` → `service`, barrel `index.ts`) with
`normalizeFeed`, `computeLiveMetrics` (live pass efficiency + adjusted residual vs
baseline, closer estimate gated to closing laps), `deriveAlerts` (lead change, flag,
stage end, big movers / focus-driver moves, pit, out), and a `pitCycleModel` that
infers stint length from a car's own pit laps. 22 unit tests in
`tests/live.service.test.ts` (fixture + synthesized snapshots); architecture tests
green (zero external imports in types/config, pure service). Weekly batch now emits
per-series `dist/data/baselines-{series}.json` (`analyticsService.leagueBaselines`).
Added a `bun run capture` CLI (`src/app/capture.ts`) to record live snapshots
(feed+flag+pit) for realistic fixtures / live validation — smoke-tested against the
CDN. **Next:** run a capture during tonight's Cup race (22:00 UTC), then Phase 2 (edge DO).

**Phase 2 — Edge runtime. ✅ DONE (2026-07-05) — LIVE at
[looplab-live.nhorton.workers.dev](https://looplab-live.nhorton.workers.dev).**
Deployed the `looplab-live` Worker + `LiveCoordinator` DO; validated end-to-end
against the real CDN both locally (`wrangler dev`) and in production: the DO polls
the base feed, normalizes + enriches + diffs it, and `/api/live` serves a populated
38-car snapshot. Verified same-day against **tonight's Cup race** (eero 400,
Chicagoland) — the base feed had already switched to it (flag `hot`, lap 0/267, full
field). The self-contained page (`GET /`) renders the leaderboard, follow-a-driver
card, race chips, and alert feed (screenshot-verified on a 375px viewport). Live
pass-efficiency / adjusted-PE read null pre-green (no passes yet) and populate once
racing starts. **This one URL is the tester deliverable for tonight.**

**Approach decided 2026-07-05 (deviation from the sketch above — recorded here first):**
Ship a **standalone Cloudflare Worker** `looplab-live` rather than a Pages Function,
and have that Worker also serve a **self-contained live page**. Rationale, given a
same-day "share with testers tonight" goal:
- **Lowest blast radius.** A new Worker is an independent deploy — it cannot break
  the already-live static site (Cloudflare Pages `looplab` + Vercel). The Pages
  project is untouched tonight.
- **One URL for testers.** The Worker serves both `GET /api/live` (JSON) and `GET /`
  (the live page HTML/JS, inline + self-contained). Testers get a single
  `*.workers.dev` link — no Pages redeploy, no cross-origin/CORS, no URL-baking.
- **DO state instead of a separate KV namespace.** `LiveCoordinator` stores the
  latest snapshot + prev snapshot + rolling alerts in its own (SQLite-backed) DO
  storage; `/api/live` routes to the DO to read it. Free-plan eligible via
  `new_sqlite_classes` (token confirmed: `workers_scripts`/`workers_kv`/`d1` write).
- **Baselines baked into the Worker** (`worker/baselines.ts`, generated from
  `dist/data/baselines-{1,2,3}.json` — ~450 B each). They aren't on the live sites
  yet and rarely change; baking keeps live-metric computation at the edge with zero
  external dependency. (Tech-debt: weekly refresh must regenerate this file.)

**Pieces:**
- `src/domains/live/runtime.ts` — **pure** `processFeed(feed, opts)` composing
  `normalizeFeed → computeLiveMetrics → deriveAlerts → pitCycleModel` into the
  response body the DO stores. Bun-testable; no Cloudflare imports. (Keeps the DO a
  thin adapter over already-tested logic.)
- `worker/` (new top-level deploy target, outside `src/` so it's exempt from the
  src architecture test): `index.ts` (the `LiveCoordinator` DO — alarm poll loop,
  idle backoff to 60s, stop-when-unwatched; `fetch` router for `/api/live`, `/`,
  `/health`, CORS), `baselines.ts` (baked), `wrangler.toml` (DO binding + sqlite
  migration + `workers_dev`), `tsconfig.json` (`@cloudflare/workers-types`).
- `BROWSER_UA` promoted into `live/config.ts` (the mandatory CDN UA is now shared by
  the capture CLI and the edge Worker).

**Idle behavior:** alarm reschedules at 5s while a session is live, 60s when idle,
and deletes the alarm entirely after ~15 min with no `/api/live` request (restarts
on the next request) → ~$0 off-race.

**Deferred to Phase 3 (not needed for tonight's tester link):** integrating a `/live`
route + "🔴 LIVE" banner into the main Pages site.

**Phase 3 — Live UI.** New live page: glanceable leaderboard (running order, gap,
flag/stage banner, **color-coded loop-data segments** à la F1 mini-sectors), a
follow-your-driver card (localStorage) with an in-app alert feed, and the strategy
/ pit-cycle panel. Home "LIVE" banner. Mobile-first per DESIGN.md.
Designed in the [Live UI design spec](../../design-docs/2026-07-05-live-ui-design.md)
+ [interactive mockup](../../design-docs/2026-07-05-live-ui-mockup.html): a **layered**
board (glanceable running order → **tap any car** for a full per-driver live panel:
position/gaps, live loop metrics with field rank, pit/strategy status, in-race
trend sparklines), a **Loop Rating ★** sort that re-ranks the board by our live
proprietary estimate, a Race Overview layer (movers/battles/field loop leaders),
the strategy/pit-cycle tracker, My Driver + alert feed, and an idle state. Open
questions (nav slot, sections-vs-scroll, default sort, TV-sync slider) are logged
in the spec for owner sign-off before build.

**Owner decisions (2026-07-05) — 🚧 Phase 3 IN PROGRESS:**
- **Nav:** a **permanent Live tab** (8th bottom-tab) with a 🔴 live-dot shown only
  when a session is on track. Tab bar condenses to stay usable on mobile.
- **Layout:** **secondary sub-tabs inside Live** — Board / Overview / Strategy /
  My Driver (not one long scroll).
- **Scope:** the **full mockup in one pass**. That requires the edge to accumulate
  **per-lap history** (the single `/api/live` snapshot can't power segbars, last-10-lap
  movers, tire-falloff, or the trend sparklines), so Phase 3 has two halves:

  **3a — Edge history + richer payload (pure domain + DO):**
  - `live/service.ts` gains pure history helpers: `updateHistory(prev, snapshot)`
    (append a capped per-lap frame of `{pos, spd}` per driver), plus `attachTrends`
    (segbar last-5 trend, `posTrend`/`spdTrend` sparkline series, `mover10`),
    `deriveMovers` (last-10-lap gainers/faders), `deriveBattles` (adjacent cars within
    0.4s — from the current snapshot), `deriveFieldLeaders` (per-metric live leader).
  - `live/runtime.ts` `processFeed` now also takes/returns `LiveHistory` and emits the
    enriched `LivePayload` (`movers`, `battles`, `fieldLeaders`, trend-enriched drivers,
    optional `nextRace`). New payload/types in `live/types.ts`.
  - The DO persists `history`, fetches+caches the per-series **schedule feed** for the
    idle "Next Up", and passes history through each tick. Worker redeploys.

  **3b — Main-site Live UI (client-rendered, matches the mockup):**
  - `live` nav tab in `layout.ts` (+ `window.__LIVE_API__` = the Worker origin);
    LIVE-component CSS ported into `style.css`.
  - `pages/live.ts` shell + `client/live.js`: sub-tabbed Board (Running-Order default,
    one tap to **Loop Rating ★**) with tap-to-expand drill-downs, Overview, Strategy,
    My Driver (localStorage follow) + alert feed, and the idle state.
  - Home **🔴 LIVE banner** + "While You Were Away" digest (client-detected liveness).
  - `export.ts`/`server.ts` wire `/live` per series + the client asset.

  Default sort = **Running Order** (one tap to the moat). TV-sync slider + confidence
  indicator deferred to a fast-follow.

**Phase 4 — Verify & document.** Drive it against a live (or replayed) race; tune
cadence; confirm idle → $0. Update ARCHITECTURE.md (new `live` domain + `live-store`
provider, "Current Guarantees", "What Does NOT Exist"), QUALITY_SCORE, and move this
plan to `completed/`.

## Risks / open decisions

- **CDN is unofficial/unlicensed** — fine for a free MVP (as many fan projects do);
  line up **Sportradar** before monetizing or adding odds. (Tracked, not an MVP blocker.)
- **Schema is source-reconstructed** — Phase 0 fixture capture de-risks the parser.
- **Live vs. official metric** — show live *component* stats + a live *estimate* of
  our metrics during the race; swap to authoritative `loopstats/prod` post-race.
- **First real deploy** — this rides on the still-pending one-time Cloudflare Pages
  connect (docs/DEPLOY.md); the live endpoint adds DO+KV bindings to that project.
