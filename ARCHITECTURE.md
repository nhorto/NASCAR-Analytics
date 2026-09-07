# Architecture — NASCAR Analytics

## What This Is

NASCAR Analytics is a modern web platform that ingests NASCAR race data (loop data, results, lap times, pit stops) from public sources, computes proprietary analytics metrics, and presents them alongside betting odds context. The goal: replace outdated tools like Lap Raptor and FRCS.pro with a clean, mobile-first experience that NASCAR fans actually want to use.

## Project Structure

```
src/
├── app/                     Application wiring, CLI, web server, and static export
│   ├── index.ts             CLI: backfill / sync / status / compute / driver / serve / export / capture / grant / refresh
│   ├── render.ts            Page-render functions (shared by server + export)
│   ├── server.ts            Bun.serve(): prefix-aware router mirroring the static URL scheme, wrapped in the production pipeline (request id → route → gzip → security/cache headers → JSON log) + GET /health
│   ├── env.ts               Typed server config from env; production boots fail fast on malformed values
│   ├── http.ts              Pure HTTP hardening helpers: request ids, per-route Cache-Control (private for cookie-bearing requests), CSP/HSTS security headers, gzip, JSON log lines
│   ├── viewer.ts            Per-request Viewer (session cookie → accounts user + billing Pro status), cookie builders, CSRF double-submit, client IP — the accounts×billing composition point (WS-D)
│   ├── gate.ts              PURE gating verdicts: series/race teaser gates, Pro feature flags, series-JSON blocking (WS-D)
│   ├── auth.ts              Auth + account routes: /signup /signin /reset /verify /account /pricing + POST /auth/* (PRG, CSRF-checked, rate-limited) (WS-D)
│   ├── scheduler.ts         In-process crons: weekly refresh (Mon 12:00 UTC, advisory lock, spawns the CLI) + daily canary (09:00 UTC) — launch plan D18/WS-C
│   ├── fallback-sync.ts     `sync --source nascar-data`: fill missing results from the nascaR.data release, or --verify-last N against CDN rows
│   ├── export.ts            Static-site generator → dist/ (Cloudflare Pages)
│   ├── capture.ts           Live-feed capture ops tool (`bun run capture`) — raw snapshots for fixtures/validation
│   ├── canary.ts            Upstream-feed canary (`bun run canary`) — composes ingestion + live normalizers with the data-health runner; exit 1 on any failure
│   ├── data.ts              Compact JSON payloads for the client pages (+ per-series live baselines)
│   ├── layout.ts            Page shell (app bar, series switch, tab bar), 404
│   ├── html.ts              esc/fmt/badge/sparkline/card helpers + path-based withSeries
│   ├── style.css            Design tokens + components (per docs/DESIGN.md)
│   ├── client/              Browser JS for the client-rendered pages (compare.js, tracks.js)
│   └── pages/               Page templates (home, drivers, races, metrics, career, recap) + client shells (compare, tracks) + auth/account/pricing forms and the Pro teaser (WS-D)
├── domains/
│   ├── data-ingestion/      NASCAR CDN data fetching and storage  [BUILT]
│   │   ├── types.ts         CDN feed shapes + normalized row types
│   │   ├── config.ts        Endpoint URLs, coverage boundaries, track-type classification
│   │   ├── repo.ts          SQLite upserts + coverage/race read queries
│   │   ├── service.ts       Pure normalizers + backfill/sync orchestration + race reads
│   │   └── index.ts         Barrel
│   ├── drivers/             Driver identity, summaries, race logs  [BUILT]
│   │   ├── types.ts         DriverSummary, DriverRaceLogEntry, IdentityIssue
│   │   ├── config.ts        Series/points-race constants
│   │   ├── repo.ts          Summary/race-log/lookup queries
│   │   ├── service.ts       Driver index, lookup, identity-integrity check
│   │   ├── runtime.ts       JSON API handlers (/api/drivers…)
│   │   └── index.ts         Barrel
│   ├── analytics/           Pre-computed metrics (`bun run compute`)  [BUILT]
│   │   ├── types.ts         Source rows, league expectations, computed stat rows
│   │   ├── config.ts        Points filter (+ race 5580 override), buckets, form window
│   │   ├── repo.ts          Source reads + computed-table writes/reads
│   │   ├── service.ts       Metric math (pure) + computeAll orchestration + leagueBaselines
│   │   ├── runtime.ts       JSON API handlers (/api/standings, /api/tracks…)
│   │   └── index.ts         Barrel
│   ├── data-health/         Upstream-feed canary + fallback adapters  [v1 2026-09-07]
│   │   ├── types.ts         HealthCheck / CheckResult / CanaryReport / FeedStatusRow / FeedOutage + the nascaR.data fallback row shapes
│   │   ├── config.ts        Timeouts, alert threshold, race-finality buffer, fallback track/driver aliases
│   │   ├── repo.ts          feed_status reads/writes (one row per check per canary run)
│   │   ├── service.ts       PURE runner + validators + failure-streak/outage/alert logic + the pure nascaR.data → ResultRow mapping (ordinal join, name canonicalization, track guard)
│   │   └── index.ts         Barrel
│   ├── accounts/            Users, sessions, verify/reset tokens, rate limits  [WS-D 2026-09-07]
│   │   ├── types.ts         User/Session/AuthToken records, rate-limit rules, AuthResult
│   │   ├── config.ts        Password policy + common-password blocklist, TTLs, rate-limit rules, cookie names
│   │   ├── repo.ts          users / sessions / auth_tokens / auth_attempts reads+writes (token hashes only)
│   │   ├── service.ts       argon2id via Bun.password, rolling sessions, single-use tokens, sliding-window rate limiter; enumeration-safe failures
│   │   └── index.ts         Barrel
│   ├── billing/             Entitlement model (spec §7) — WS-D slice  [PARTIAL: reads + manual grants; Stripe webhooks are WS-E]
│   │   ├── types.ts         ProSource, Entitlement, ProStatus
│   │   ├── config.ts        Grace days, sources
│   │   ├── repo.ts          entitlements upsert/read/delete
│   │   ├── service.ts       proStatus/isPro (pro_until in the future), grantPro, canPurchase (verified-email guard)
│   │   └── index.ts         Barrel
│   └── live/                Live race companion — pure metrics/alerts  [PHASE 2 BUILT]
│       ├── types.ts         Raw live-feed shapes + normalized snapshot/row/alert/baseline + LivePayload
│       ├── config.ts        Flag enum, poll cadence, alert thresholds, bucket width, BROWSER_UA
│       ├── service.ts       PURE + Workers-safe: normalizeFeed, computeLiveMetrics, deriveAlerts, pitCycleModel; strategy calibration (reconstructStints, greenStintLengths, tireDropForStop, tireTierOf)
│       ├── runtime.ts       PURE processFeed(): composes service steps into the LivePayload the edge serves
│       └── index.ts         Barrel (no repo — runs in Bun AND Cloudflare Workers)
├── providers/
│   ├── index.ts             Providers interface + factory
│   ├── db.ts                bun:sqlite connection + schema (incl. computed tables)
│   ├── nascar-cdn.ts        Rate-limited, retrying CDN fetch client
│   ├── lock.ts              Cross-process advisory locks (app_locks table, TTL + takeover)
│   ├── email.ts             Resend REST client + log-only null client (canary alerts; WS-G reuses it)
│   ├── nascar-data.ts       nascaR.data Parquet-release fetcher/parser (results fallback; via hyparquet)
│   ├── sportsdataio.ts      ⚠ NOT-FOR-PRODUCTION stub: SportsDataIO types + normalizer, so a CDN lockout is config + a card
│   └── raw-archive.ts       Verbatim raw-JSON archival (CDN insurance)
└── utils/                   Generic reusable helpers
worker/                      Edge deploy target — the `looplab-live` Cloudflare Worker (OUTSIDE src; exempt from the src layer test)
├── index.ts                 LiveCoordinator Durable Object (single poll loop; fetches live-feed + live-pit-data) + fetch router (/api/live, /) + self-contained live page; imports only the pure `live` domain
├── canonicalize.ts          PURE `canonicalizeFeed` (schedule-canonical race identity) — Cloudflare-type-free so the root test program can import it
├── baselines.ts             GENERATED — baked per-series league baselines (from dist/data/baselines-*.json)
├── track-strategy.ts        GENERATED — baked per-track strategy keyed by series (typical green run + tire-severity tier; from `bun run calibrate`), with a track_id→type fallback map
├── wrangler.toml            Worker config: DO binding + sqlite migration + workers_dev
└── tsconfig.json            Cloudflare-types typecheck (separate from root)
scripts/
├── gen-worker-baselines.ts  Regenerates worker/baselines.ts from the exported dist data
├── calibrate-strategy.ts    `bun run calibrate --series N` — typical-run median + pit-discontinuity tire severity from the backfill → track-strategy.ts (LOCAL: needs the backfill DB + archives)
├── backtest-strategy.ts     `bun run backtest` — held-out (temporal-split) evaluation of the pit-cadence prediction vs baselines → docs/research/2026-07-06_strategy-backtest.md
├── restore-drill.ts         `bun run restore-drill` — restore the Litestream replica into a temp dir, boot the server against it, assert /health + home render
├── spike-loop-from-timing.ts  WS-C experiment: recompute loop metrics from lap_times + cautions, score agreement vs official loop_stats → docs/research/2026-09-07_loop-metrics-from-timing-spike.md
└── docker-entrypoint.sh     Container entrypoint: Litestream restore-if-missing, then replicate -exec around the server
Dockerfile / fly.toml / .dockerignore   Production container (Bun + Litestream) and Fly.io app config — see docs/runbooks/deploy.md
tests/
├── architecture.test.ts     Enforces the layer rules below (part of `bun test`; scans src/ only)
├── data-health.service.test.ts  Validators, runner classification (HTTP / shape / transport), report text, and the real check list against the captured fixtures
├── seed.ts                  In-memory db + row factories for domain tests
└── fixtures/                Trimmed real CDN responses
data/                        (gitignored) SQLite db + raw JSON archive
```

Planned domains not yet built: `odds` (deferred — see completed MVP plan). Check "Current Guarantees" and "What Does NOT Exist" below for actual state.

**Where pages live:** every page composes data from ≥2 domains, and cross-domain service imports are forbidden — so page templates and route wiring live in the app layer (`src/app/pages`, `src/app/server.ts`). Domain `ui/` folders stay reserved for future domain-specific components. Domain `runtime.ts` files carry the JSON API handlers.

## The DDD Layer Model

Each business domain is divided into fixed layers with strictly validated dependency directions.

```
┌─────────────────────────────────────────────────┐
│  Business Domain (e.g., data-ingestion, etc.)   │
│                                                 │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│  │  Types   │──▶│ Config  │──▶│  Repo   │       │
│  └─────────┘   └─────────┘   └─────────┘       │
│       │                           │             │
│       ▼                           ▼             │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│  │ Service  │──▶│ Runtime │──▶│   UI    │       │
│  └─────────┘   └─────────┘   └─────────┘       │
│       ▲                                         │
│  ┌─────────┐                                    │
│  │Providers│ (cross-cutting: db, APIs, auth)    │
│  └─────────┘                                    │
└─────────────────────────────────────────────────┘
```

### Layer Definitions

| Layer | Responsibility | Can Import From | Cannot Import From |
|-------|---------------|----------------|-------------------|
| **Types** | Pure type definitions, interfaces, enums. Zero runtime code. | `utils/` only | Config, Repo, Service, Runtime, UI |
| **Config** | Constants, thresholds, default values. No logic, no I/O. | Types, `utils/` | Repo, Service, Runtime, UI |
| **Repo** | Database access. Queries, inserts, updates. No business logic. | Types, Config, `providers/` | Service, Runtime, UI |
| **Service** | Business logic. Pure functions + orchestration. | Types, Config, Repo, `providers/` | Runtime, UI |
| **Runtime** | API route handlers. Parse request → call service → return response. | Types, Config, Service, `providers/` | UI, Repo (must go through Service) |
| **UI** | Frontend components and pages. | Types, Config | Repo, Service, Providers |

### Domain Directory Structure

```
src/domains/{domain-name}/
├── types.ts          Pure type definitions
├── config.ts         Constants, defaults, thresholds
├── repo.ts           Database queries (receives db from Providers)
├── service.ts        Business logic (or service/ directory if large)
├── runtime.ts        API route handlers
├── ui/               React/frontend components (if applicable)
└── index.ts          Barrel export
```

### Providers Pattern

```typescript
// src/providers/index.ts
export interface Providers {
  db: DatabaseClient;          // SQLite or Postgres
  nascarCdn: NascarCdnClient;  // cf.nascar.com/cacher fetcher
  oddsApi?: OddsApiClient;     // The Odds API (optional, paid)
}
```

### Cross-Domain Rules

1. Type imports across domains are allowed
2. Service-to-service calls go through Providers — not direct imports
3. Repo is never shared across domains
4. No circular dependencies between domains

## Tech Stack

| Choice | Technology | Why |
|--------|-----------|-----|
| Runtime | Bun | Fast, TypeScript-native, built-in SQLite |
| Language | TypeScript | Type safety, PAI standard |
| Database | bun:sqlite (local) → Postgres (production) | Start simple, scale later |
| HTTP | Bun.serve() | Built-in, no dependencies |
| Frontend | Server-rendered HTML (template functions) + a little vanilla JS for the two interactive pages | No framework; `bun run export` pre-renders to static files |
| Hosting | Today: Cloudflare Pages (static). Target (launch plan D10, scaffolded, awaiting owner accounts): Fly.io Bun container + SQLite volume + Litestream, with the static export as read-only fallback | The paid tier needs per-user serving; one box runs the code as written |
| Styling | Hand-written CSS design tokens (src/app/style.css, spec in docs/DESIGN.md) | Replaced the original Tailwind plan — zero tooling |
| Testing | bun test | Built-in |

## Data Sources

| Source | Type | What We Get |
|--------|------|------------|
| `cf.nascar.com/cacher/{year}/{series}/{race_id}/` | Public CDN (free, no auth) | Schedules 2016+, results 2017+, lap times 2020+, pit data, live race data. Payload-verified 2026-07-05 — see [re-verification](docs/research/2026-07-05_data-sources-reverification.md) |
| `cf.nascar.com/loopstats/prod/{year}/{series}/{race_id}.json` | Public CDN (free, no auth) | Full official loop data per race (Driver Rating, quality passes, fast laps, etc.), 2019+ for Cup/Xfinity, 2018+ for Trucks. Feed is a JSON array of race objects. |
| nascaR.data (R package) | Free, CRAN | Historical results 1949-present (v3.1.0, actively maintained) |
| ~~The Odds API~~ | ❌ Does NOT cover NASCAR | Verified 2026-07-05. Odds source TBD — betting/odds domain deferred |
| rNascar23.Sdk reference | GitHub | Documents all NASCAR CDN endpoint patterns including LoopData |

## Current Guarantees

> What the system currently does reliably. Updated as features ship.

- **Data ingestion pipeline (2026-07-05)**: `bun run backfill [--series N]` / `bun run sync` ingest all three national series from the NASCAR CDN into `data/nascar.db` (SQLite). Idempotent — re-runs fetch only missing races. Rate-limited and retrying.
- **Ingested dataset — all three series (verified against known history)**: Cup (series 1), Xfinity (2), Trucks (3). Results 2017–2026, loop stats 2019–2026 (2018+ for Trucks — a bonus year), lap-by-lap times 2020–2026, cautions, race leaders. Payload-verified coverage in [the multi-series plan](docs/exec-plans/completed/2026-07-05-multi-series.md). driver_id confirmed global across series (one drivers row per person; stats separated by series_id). Sanity checks pass (Cup wins leaders 2017–2024, Xfinity 2026 Allgaier, Trucks 2024 Heim/Majeski).
- **Raw archival**: every 200 CDN response is stored verbatim under `data/raw/` with a `raw_fetches` index (URL, sha256, status) — the dataset survives any future CDN access change.
- **Track-type classification**: every 2016–2026 track across all three series classified (superspeedway/intermediate/short/road/dirt), including Atlanta's 2022 reprofile via season override; zero unknown types after the Xfinity/Truck track audit.
- **Architecture tests**: layer dependency rules are enforced by `bun test` (tests/architecture.test.ts).
- **Computed analytics (2026-07-05)**: `bun run compute` rebuilds `driver_season_stats`, `driver_track_type_stats`, `driver_form` (trailing-6-race form), and `race_metric_standouts` (per-race adjPE + Closer residuals for the recap) from points races (`race_type_id = 1` + the race-5580 override). Includes two proprietary metrics — Adjusted Pass Efficiency and Closer Score, both residuals vs. league-average baselines per running-position bucket. Verified against known history (season wins leaders 2017–2024, SVG road stats, Elliott 2023 injury season).
- **Drivers domain (2026-07-05)**: driver summaries, race logs, id/name lookup (`driver --name "..."` CLI), an identity-integrity check, and a cross-series career record (`driverCareer`). CDN driver_id verified stable across 2017–2026 — no alias table needed.
- **Cross-series career pages (2026-07-05)**: `/driver/{id}` (un-prefixed, like `/race/{id}`, since driver_id is global) shows a driver's whole record across Cup + Xfinity + Trucks on one page — grand totals, a per-series breakdown linking to each series' deep profile, and a season × series timeline matrix (starts + wins per season per series). Reached via a "Full career across series →" link on each series profile. Powered entirely by the drivers domain (one GROUP BY over points races, folded by the pure `summariseSeries`), plus `/api/driver/:id/career`.
- **Web app (2026-07-05)**: `bun run serve` (default port 3000) serves the mobile-first dark UI — home, driver index/profiles, race pages with loop insights, head-to-head compare, track-type explorer, and a proprietary-metrics leaderboard — plus JSON API routes (`/api/drivers`, `/api/drivers/:id`, `/api/drivers/:id/stats`, `/api/standings/:season`, `/api/tracks`, `/api/metrics`). All reads hit precomputed tables; measured page renders < 60ms. Look & feel per [the design mockup](docs/design-docs/2026-07-05-phase3-ui-mockup.html).
- **Proprietary-metric leaderboards (2026-07-05)**: `/metrics` (per series, new nav tab) ranks the current season's loop-data regulars — drivers who ran ≥ 50% of the season's max loop-race count (`METRIC_LEADER_MIN_LOOP_SHARE`) — by Adjusted Pass Efficiency and Closer Score, with a plain-English methodology explainer. Driver profiles show each metric's rank/percentile within that field; the home page carries a "Beyond the Box Score" card linking in. Ranking is pure/unit-tested (`rankByMetric`, `qualifiedRegulars`); no new metric math — this exposes the values already in `driver_season_stats`.
- **Weekly race recap (2026-07-05)**: `/recap` (each series' latest completed race) and `/recap/{raceId}` (un-prefixed, race_id is global) — an auto-generated post-race page composing four sections: result summary (winner + podium), "What the Loop Data Saw" (per-race adjPE + Closer standouts from `race_metric_standouts`), "Championship Picture" (points-standings movement vs. the prior race with a per-series cut line, `PLAYOFF_CUT_BY_SERIES`), and form-vs-result driver callouts. New Recap nav tab; the Home "Last Race" card links in; `/api/recap/:id`. All analytics is pure/unit-tested (`computeRaceStandouts`, `computeStandingsMovement`, `pickFormCallouts`, `regularSeasonField`, `playoffStandings`) reading precomputed tables; regenerated by the standard sync → compute → export chain. The "Championship Picture" is a **season-phase-aware playoff model** (`playoffPicture`): the regular season shows the real win-and-in field (race winners in the top 30 locked, remaining spots by points, with the cut line + bubble); the playoffs show the round (16→12→8→4, per `PLAYOFF_FORMAT_BY_SERIES`) with race-winner auto-advance and eliminations. Phase is derived from the last-N races of the season schedule. Approximations (waivers, exact reset totals, ties) are logged in the tech-debt tracker.
- **Series switching (2026-07-05)**: a Cup/Xfinity/Trucks segmented switcher (top-level nav axis, under the app bar). Series lives in the URL **path** (`/`, `/xfinity`, `/trucks`) so each series is its own static file; threaded through every page and internal link. A race page (`/race/{id}`, un-prefixed) derives its series from the race itself.
- **Automated weekly refresh (hardened 2026-08-07)**: `bun run refresh` — one portable, runner-agnostic command that backfills + computes all three series, exports, regenerates the Worker's league baselines and per-series strategy calibration, then deploys both Pages and the live Worker (deployment self-gates on `CLOUDFLARE_API_TOKEN`; `--no-deploy` still builds every artifact). Scheduled by `.github/workflows/weekly-refresh.yml` (Mondays 12:00 UTC + manual dispatch), which caches the DB plus the archived weekend feeds required by strategy calibration. Calibration refuses to overwrite the bake when those archives are absent. Env-configurable (`NASCAR_DATA_DIR`, `NASCAR_PAGES_PROJECT`) so the same command can later run in a Cloudflare Container with the DB in R2. See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Static export + deployment (2026-07-05)**: `bun run export` pre-renders the whole site to `dist/` (~2,400 pages) using the same `render.ts` as the dev server, plus client JSON for the two interactive pages. Deployed to **Cloudflare Pages** via Direct Upload (`bunx wrangler pages deploy dist`) — the ~284MB DB stays local, only static output ships. Compare + track explorer render client-side from `dist/data/*.json`. See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Live in — deployed on two hosts (2026-07-05)**: the static site is live and public on **Cloudflare Pages** (`looplab-arh.pages.dev`, project `looplab`, wrangler account `nhorton@fabricationis.com`) and on **Vercel** (`looplab-murex.vercel.app`, project `looplab`). Same `dist/` build serves either; Cloudflare additionally honors `dist/_headers` cache rules.
- **Live race companion — Phases 1–3 LIVE; Phase 4 hardening (2026-08-07)**: the pure, Workers-safe `live` domain computes a normalized snapshot, live proprietary-metric estimates (live pass efficiency + adjusted residual vs. per-bucket baselines, a closing-laps Closer estimate), race alerts (`deriveAlerts`), a pit-cycle model, and — from a rolling per-lap **history** — segbar trends, movers, battles, field-leader and tire-falloff derivations. The **`looplab-live` Cloudflare Worker** (`worker/`, at **[looplab-live.nhorton.workers.dev](https://looplab-live.nhorton.workers.dev)**) runs a `LiveCoordinator` **Durable Object** as the single upstream poller (per series via `?series=`; 5s live / 60s idle / stops after 15 min unwatched), enriches the payload against generated baselines/strategy, keeps the history, and canonicalizes known race identity against the schedule so partially rolled CDN metadata cannot select the wrong track strategy or render a hybrid event. Impossible stage boundaries are discarded. The Worker serves `GET /api/live`, `/api/live/status`, and a self-contained `GET /` page. The **main site** has a `/live` page (`client/live.js`, per series) with the layered board (tap-to-drill), a Loop Rating ★ sort, Race Overview, Strategy, and My Driver sub-tabs, plus a permanent Live nav tab (🔴 dot when live) and a home LIVE banner — **live on Cloudflare Pages ([looplab-arh.pages.dev/live](https://looplab-arh.pages.dev/live))**. A complete green-flag race soak is the remaining Phase 4 gate. See [the plan](docs/exec-plans/active/2026-07-05-live-race-companion.md).
- **Upstream-feed canary v1 (2026-09-07, WS-C)**: `bun run canary` fetches the current schedule, picks the latest completed Cup race, and checks every endpoint pattern we depend on (schedule, weekend-feed, loopstats, lap-times, live-feed, live-flag-data) for HTTP 200 **and** a payload our own normalizers accept; prints a one-line-per-check report, optional `--json`, exits 1 on any failure. Every run persists to `feed_status`; when a check crosses **two consecutive failures** the owner is emailed exactly once per outage (Resend provider; a log-only null client until the key exists), and HTML pages carry a "data updates are delayed" banner while an outage is active (60s-cached check in the server pipeline). Scheduled two ways: `.github/workflows/canary.yml` daily (interim) and the in-process daily 09:00 UTC cron (`ENABLE_CANARY_CRON`, for the Fly server).
- **Results fallback source — verified (2026-09-07, WS-C)**: `bun run sync --source nascar-data [--season Y] [--verify-last N]` ingests official results from the `nascaR.data` Parquet release (Parquet-only; via `hyparquet`, the repo's first runtime dependency) — joined by points-race ordinal + canonical driver name with a track-name guard and config aliases; fields the release lacks stay NULL. Verified against the real download: the last three 2026 Cup races match CDN rows **exactly** (finish/start/laps-led; 36–40 drivers each), 35/36 2025 races exact, and it fills the 2025 YellaWood 500 hole (race 5580). A SportsDataIO adapter **stub** (types + normalizer, NOT for production) covers the paid-fallback path.
- **Per-race ingest atomicity (2026-09-07, WS-C)**: `ingestRaceData` fetches all feeds first, then writes results/drivers/cautions/leaders/loop/lap rows in one transaction — a race commits fully or not at all; a write failure rolls back, is logged, and the backfill continues (the race retries next run). Tested with an injected mid-race constraint failure.
- **Loop-metrics-from-timing spike (2026-09-07, WS-C)**: position-derived loop metrics (laps, lead laps, top-15 laps, avg position) are recoverable from `lap_times`+`cautions` (r=1.000); raw pass counts are NOT (per-lap resolution floor, ~2× undercount); the pass-efficiency ratio holds as a labeled estimate (MAE 0.045). Documented experiment, not a production path — see [the report](docs/research/2026-09-07_loop-metrics-from-timing-spike.md).
- **CI data cache keep-warm (2026-09-07)**: `.github/workflows/cache-keepwarm.yml` restores and re-saves the refresh's data cache every Thursday so it survives GitHub's 7-day eviction to the next Monday — until then every weekly run was a full cold backfill (observed 2026-08-24 and 08-31). Interim until the refresh moves onto the production server (launch plan D18).
- **Production-hardened server + deploy scaffold (2026-09-07, WS-B)**: `bun run serve` is now the production entrypoint — validated env (fail-fast in `APP_ENV=production`), request ids (honoring `fly-request-id`), one JSON log line per request, per-route-class `Cache-Control` (public pages/data, `no-store` health + errors), security headers (CSP derived from the live-Worker + Plausible origins, HSTS in production, `frame-ancestors 'none'`, nosniff), gzip with `Vary: Accept-Encoding`, and `GET /health` (db-backed freshness snapshot; 503 when unreadable). The weekly refresh can run **in-process** (`ENABLE_REFRESH_CRON=1`): a Monday-12:00-UTC cron takes the `weekly-refresh` advisory lock (`app_locks`, TTL + takeover — safe against a concurrent manual run) and spawns the existing refresh CLI as a child process so compute never blocks the event loop. Deploy scaffold: Dockerfile (Bun + Litestream restore-if-missing/replicate), `fly.toml` (volume at `/data`, `/health` check, auto-stop off), `bun run restore-drill` (replica → boot → assert), runbooks (`docs/runbooks/deploy.md`, `backup-restore.md`). The live-Worker origin (`LIVE_API_BASE`) is env-overridable. **Not yet deployed** — Fly account/bucket/domain are owner steps (launch plan A1/A2/A6).
- **Accounts + gating (2026-09-07, WS-D)**: email+password accounts per spec §6 — argon2id (`Bun.password`), 10+-char passwords checked against a common-password blocklist, enumeration-safe sign-in/reset, single-use verify (48 h) and reset (30 min) tokens stored as SHA-256 hashes, 30-day rolling httpOnly/SameSite=Lax sessions with "sign out everywhere", CSRF double-submit on every POST, sliding-window rate limits on sign-in/sign-up/reset (429 + Retry-After), and password-confirmed immediate account deletion. Entitlement per spec §7 (`entitlements`: `pro_until` + `pro_source`; `bun run grant` for manual tester grants). Gating per D4/D16: anonymous/free viewers get Cup + career pages; Xfinity/Trucks HTML (including un-prefixed `/race/{id}`, `/recap/{id}` by derived series) renders a **teaser** (real headline, decorative blurred table, `/pricing` CTA), and the series JSON endpoints return 403 `pro_required` so the teaser can't be bypassed. Requests carrying a session cookie get `private, no-store` page/data responses; anonymous Cup pages stay publicly cacheable. Pages: `/signup`, `/signin`, `/reset[/token]`, `/verify/{token}`, `/account` (plan, verification, sessions, delete), `/pricing` v0. Verification/reset emails go through the Resend provider (log-only until A4).
- **Both TypeScript programs typecheck (2026-09-07)**: `bun run typecheck` (root: `src/` + `tests/`) and `bun run typecheck:worker` (Cloudflare types). The Worker's Cloudflare-only fetch options go through `upstreamInit()` and the pure `canonicalizeFeed` lives in `worker/canonicalize.ts`, so the root program never loads Durable Object types.
- Known data holes are documented in [the re-verification doc](docs/research/2026-07-05_data-sources-reverification.md) (2025 YellaWood 500 results; exhibition heat races).

## What Does NOT Exist Here

> Honest list of gaps. Must be kept updated.

- No cross-series *statistical* comparison (e.g. normalizing a Cup season against an Xfinity season side by side) — the career page unifies a driver's Cup+Xfinity+Truck record, but the analytics/compare/tracks views still each stay within one series
- The weekly refresh is automated (`.github/workflows/weekly-refresh.yml` → `bun run refresh`, Mondays 12:00 UTC); what's NOT automated is the deploy leg *until* the two Cloudflare secrets are added — before then the CI builds + artifacts `dist/` but skips the upload
- Canary alert **emails** degrade to a log line until the owner's Resend account exists (A4 — `RESEND_API_KEY`/`ALERT_EMAIL_TO`); until the Fly server is deployed the canary's scheduler is still the GitHub workflow, whose alert remains "the run went red"
- The main-site Live page (`/live`, `client/live.js`) reads the live Worker **cross-origin** — it depends on `looplab-live.nhorton.workers.dev` being up; if the Worker is down the page shows its connecting/idle state rather than site data
- The **Vercel mirror** (`looplab-murex.vercel.app`) may lag the Cloudflare deploy — the `/live` page shipped to **Cloudflare Pages** (`looplab-arh.pages.dev`); a Vercel redeploy was pending (transient upload error) at last update
- Live proprietary metrics are **estimates from live loop counters**, not the authoritative post-race `loopstats/prod` values; the DO does not yet swap to the official numbers after the checkered flag. Live baselines are **baked into the Worker** and must be regenerated + redeployed after a weekly refresh (see tech-debt tracker)
- The DO stops polling after ~15 min with no `/api/live` traffic, so alert diffs can jump across a gap when it restarts (no cron keep-warm) — fine while testers keep a tab open, revisit for unattended coverage
- The live **Strategy** tab is now **calibrated + deployed** (2026-07-06): per-track (with track-type fallback) **typical green run** + a **tire-severity tier** from the pit-discontinuity method, baked into `worker/track-strategy.ts` per series and shown honestly (tire narrative suppressed at low-deg draft tracks). A physical fuel *capacity* is deliberately **not** modeled — it isn't cleanly recoverable from history, so `lapsToTypicalPit` is a behavioral pit-cadence estimate, not a fuel gauge. **Held-out backtested** (`bun run backtest`, train <2022 / test 2022): per-track pit-cadence prediction is 60% lower MAE than the flat baseline (6.0 vs 15.0 laps; ±10 laps for 86% of held-out stints) — see [the results](docs/research/2026-07-06_strategy-backtest.md). The bake must be **regenerated + redeployed after a weekly refresh** (same staleness as baselines — see tech-debt). See [the plan](docs/exec-plans/completed/2026-07-06-strategy-model-calibration.md)
- No odds integration (deferred — see exec plan)
- ~~No user authentication~~ built 2026-09-07 (WS-D) — see "Accounts + gating" above
- **No payments yet**: accounts + gating exist (WS-D), but there is no Stripe checkout/portal/webhooks — Pro can only be granted manually (`bun run grant`); `/pricing` says "checkout opens soon". WS-E builds the billing state machine. Account deletion does not yet cancel a Stripe subscription (none can exist yet)
- The **static export still contains all three series** — it predates gating and is today's live free site; it must be restricted to Cup (the "static Cup fallback" of the launch plan) at launch cutover, not before (tech-debt tracker)
- Verification/reset **emails degrade to a log line** until the owner's Resend key exists (A4) — sign-up works, but users can't actually receive the verify link, so `canPurchase` would block real checkouts until then (correct order: A4 before WS-E goes live)
- The production Fly.io app is scaffolded but **not deployed** — no Fly account/volume/replica bucket yet (launch plan owner steps A2 + bucket), so today's scheduler is still GitHub Actions and the public site is still the static Pages export. The CI → `--no-deploy` flip (D18) is deliberately deferred until the server refresh is verified (see the WS-B plan's "Sequencing")
- The static-fallback wiring ("Cloudflare serves the last export when the origin is unhealthy") is a documented recipe in docs/runbooks/deploy.md, not yet configured — it needs the product domain + new Cloudflare account (A1/A6)

## Documentation Map

```
CLAUDE.md                    Agent entrypoint (workflow-first)
AGENTS.md                    Codex entrypoint (progressive disclosure)
ARCHITECTURE.md              This file — code map and DDD reference
docs/
├── PLANS.md                 Index of all execution plans
├── DESIGN.md                Design system and UI patterns
├── PRODUCT_SENSE.md         Product vision, beliefs, north star metric
├── QUALITY_SCORE.md         Quality grades per domain/layer
├── RELIABILITY.md           Reliability standards
├── SECURITY.md              Security requirements
├── design-docs/
│   ├── index.md             Design docs index
│   └── core-beliefs.md      Core product beliefs
├── exec-plans/
│   ├── active/              Work in progress
│   ├── completed/           Finished plans
│   └── tech-debt-tracker.md Known tech debt
├── generated/               Auto-generated docs
├── product-specs/
│   └── index.md             Product specs index
├── references/              Reference material
└── research/                Market research and data source analysis
```
