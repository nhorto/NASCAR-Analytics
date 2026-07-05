# Live Race Day Companion (MVP)

**Status:** PROPOSED — awaiting owner approval before implementation
**Started:** 2026-07-05
**Research:** [docs/research/2026-07-05_live-race-companion.md](../../research/2026-07-05_live-race-companion.md)

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

**Phase 0 — Confirm-locally (owner or a local run; BLOCKS the parser).**
Run the [confirm-locally checklist](../../research/2026-07-05_live-race-companion.md#confirm-locally-checklist)
against a real live session: capture a `live-feed.json` payload, verify the
`vehicles[]` keys, `Cache-Control` TTL, CORS absence, when `loopstats/prod`
populates, and the schedule-detector file. *This cloud environment cannot reach
`cf.nascar.com` (egress policy) — must be done locally.*

**Phase 1 — Live domain, pure + tested (no network).** Types/config/service against
a captured fixture (`tests/fixtures/live-feed.json`). Unit-test `normalizeFeed`,
`computeLiveMetrics`, `deriveAlerts`, `pitCycleModel`. Emit `baselines.json` from
the batch. Architecture tests stay green.

**Phase 2 — Edge runtime.** `LiveCoordinator` DO (alarm loop, idle backoff, UA
fetch, KV write), `GET /api/live` Pages Function (KV read + `s-maxage`), wrangler
bindings (KV namespace + DO). Local dev via `wrangler dev` / a Bun poller shim.

**Phase 3 — Live UI.** New live page: glanceable leaderboard (running order, gap,
flag/stage banner, **color-coded loop-data segments** à la F1 mini-sectors), a
follow-your-driver card (localStorage) with an in-app alert feed, and the strategy
/ pit-cycle panel. Home "LIVE" banner. Mobile-first per DESIGN.md.

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
