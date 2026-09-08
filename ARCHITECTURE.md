# Architecture — NASCAR Analytics

## What This Is

NASCAR Analytics is a modern web platform that ingests NASCAR race data (loop data, results, lap times, pit stops) from public sources, computes proprietary analytics metrics, and presents them alongside betting odds context. The goal: replace outdated tools like Lap Raptor and FRCS.pro with a clean, mobile-first experience that NASCAR fans actually want to use.

## Project Structure

```
src/
├── app/                     Application wiring, CLI, web server, and static export
│   ├── index.ts             CLI: backfill / sync / status / compute / driver / serve / export / capture / canary / predict / email / grant / refresh
│   ├── render.ts            Page-render functions (shared by server + export)
│   ├── server.ts            Bun.serve(): prefix-aware router mirroring the static URL scheme, wrapped in the production pipeline (request id → route → gzip → security/cache headers → JSON log) + GET /health
│   ├── env.ts               Typed server config from env; production boots fail fast on malformed values
│   ├── http.ts              Pure HTTP hardening helpers: request ids, per-route Cache-Control (private for cookie-bearing requests), CSP/HSTS security headers, gzip, JSON log lines
│   ├── viewer.ts            Per-request Viewer (session cookie → accounts user + billing Pro status), cookie builders, CSRF double-submit, client IP — the accounts×billing composition point (WS-D)
│   ├── gate.ts              PURE gating verdicts: series/race teaser gates, Pro feature flags, series-JSON blocking (WS-D)
│   ├── auth.ts              Auth + account routes: /signup /signin /reset /verify /account /pricing + POST /auth/* (PRG, CSRF-checked, rate-limited) (WS-D)
│   ├── me.ts                GET /api/me: the one JSON view of the signed-in viewer + entitlement, for the native app (WS-J)
│   ├── pro-api.ts           GET /api/predictions + /api/dfs: JSON views of the WS-F Pro content, carrying the same gating verdicts as the pages (WS-J)
│   ├── csv.ts               PURE CSV encoding (RFC 4180 quoting, CRLF, UTF-8 BOM, formula-injection guard) + streamed download responses (WS-G)
│   ├── datasets.ts          CSV export registry: one entry per site table (columns + row builder + filename) (WS-G)
│   ├── downloads.ts         GET /export/{dataset}.csv: Pro gate → params → registry → streamed attachment (WS-G)
│   ├── emails.ts            PURE email templates: verify, reset, Monday recap, Thursday preview + unsubscribe footer/header (WS-G)
│   ├── mail.ts              Digest orchestration: recipients × Pro check × suppression × per-(user,kind,race) idempotency (WS-G)
│   ├── pwa.ts               Web app manifest, service-worker source (config injected), offline page, install banner (WS-H)
│   ├── push.ts              /api/push/* subscription routes (Pro, CSRF) + the race-day alert dispatcher (WS-H)
│   ├── webhooks.ts          POST /webhooks/resend: Svix-signed bounce/complaint events → address suppression (WS-G)
│   ├── predict.ts           `bun run predict` composition: target-race resolution, config/dfs/*.json loading, weekend-feed qualifying fetch for upcoming races (WS-F)
│   ├── scheduler.ts         In-process crons: weekly refresh (Mon 12:00 UTC, advisory lock, spawns the CLI), daily canary (09:00 UTC), Thu/Sat predictions — launch plan D18/WS-C/WS-F
│   ├── fallback-sync.ts     `sync --source nascar-data`: fill missing results from the nascaR.data release, or --verify-last N against CDN rows
│   ├── export.ts            Static-site generator → dist/ (Cloudflare Pages)
│   ├── capture.ts           Live-feed capture ops tool (`bun run capture`) — raw snapshots for fixtures/validation
│   ├── canary.ts            Upstream-feed canary (`bun run canary`) — composes ingestion + live normalizers with the data-health runner; exit 1 on any failure
│   ├── data.ts              Compact JSON payloads for the client pages (+ per-series live baselines)
│   ├── layout.ts            Page shell (app bar, series switch, tab bar), 404
│   ├── html.ts              esc/fmt/badge/sparkline/card helpers + path-based withSeries
│   ├── style.css            Design tokens + components (per docs/DESIGN.md)
│   ├── client/              Browser JS: boot.js (page config from `<html data-*>` + every delegated handler — the reason no page has an inline script), compare.js (4 drivers, cross-series, season ranges for Pro), tracks.js (full season range), live.js, sw.js (service worker), install.js, push.js
│   ├── static/icons/        Generated PWA icons (`bun run gen:icons`; source: scripts/gen-icons.ts)
│   └── pages/               Page templates (home, drivers, races, metrics, career, recap, predictions, dfs) + client shells (compare, tracks) + auth/account/pricing/unsubscribe forms and the Pro teaser (WS-D/F/G)
├── domains/
│   ├── notifications/       Web Push policy: subscriptions, per-driver/kind filtering, quiet hours, dedup  [BUILT]
│   │   ├── types.ts         PushSubscriptionRecord, CandidateAlert, VapidKeys, PushMessage
│   │   ├── config.ts        Default/global alert kinds, failure ceiling, TTLs
│   │   ├── repo.ts          push_subscriptions + push_sends (dedup ledger)
│   │   ├── service.ts       Validation, shouldSend, quiet hours, dedup keys, endpoint pruning
│   │   └── index.ts         Barrel
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
│   ├── predictions/         Race predictions + DFS projections  [WS-F 2026-09-07]
│   │   ├── types.ts         PriorRaceRow, DriverFeatures, RatingWeights, DriverPrediction, ScoringRules, DfsProjectionRow
│   │   ├── config.ts        Calibrated weights/σ/loop-rating map (provenance-commented), windows, sim runs, seeds
│   │   ├── repo.ts          Point-in-time reads (strictly pre-race) + race_predictions/dfs_projections ownership
│   │   ├── service.ts       PURE: features → rating (finish units) → seeded Monte Carlo simulation → probabilities; DFS scoring over validated config; generate orchestration
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
│   ├── webpush.ts           Web Push protocol client: RFC 8291 encryption + RFC 8292 VAPID + delivery POST
│   ├── hibp.ts              Breached-password check: HIBP k-anonymity range lookup, fails open (WS-I)
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
├── build-brand-v3.ts       Builds the standalone V3 logo gallery from preserved generated PNGs; design artifact only
├── gen-worker-baselines.ts  Regenerates worker/baselines.ts from the exported dist data
├── calibrate-strategy.ts    `bun run calibrate --series N` — typical-run median + pit-discontinuity tire severity from the backfill → track-strategy.ts (LOCAL: needs the backfill DB + archives)
├── backtest-strategy.ts     `bun run backtest` — held-out (temporal-split) evaluation of the pit-cadence prediction vs baselines → docs/research/2026-07-06_strategy-backtest.md
├── restore-drill.ts         `bun run restore-drill` — restore the Litestream replica into a temp dir, boot the server against it, assert /health + home render
├── backtest-predictions.ts  `bun run backtest:predictions [--calibrate]` — WS-F honesty bar: held-out-2025 Brier vs uniform + trailing-5 baselines, calibration table → docs/research/2026-09-07_predictions-backtest.md
├── spike-loop-from-timing.ts  WS-C experiment: recompute loop metrics from lap_times + cautions, score agreement vs official loop_stats → docs/research/2026-09-07_loop-metrics-from-timing-spike.md
└── docker-entrypoint.sh     Container entrypoint: Litestream restore-if-missing, then replicate -exec around the server
Dockerfile / fly.toml / .dockerignore   Production container (Bun + Litestream) and Fly.io app config — see docs/runbooks/deploy.md
tests/
├── architecture.test.ts     Enforces the layer rules below (part of `bun test`; scans src/ only)
├── data-health.service.test.ts  Validators, runner classification (HTTP / shape / transport), report text, and the real check list against the captured fixtures
├── seed.ts                  In-memory db + row factories for domain tests
└── fixtures/                Trimmed real CDN responses
data/                        (gitignored) SQLite db + raw JSON archive
mobile/                      Native Expo/React Native app (WS-J) — a self-contained package OUTSIDE the root program
├── src/app/                 expo-router routes (thin wrappers over feature screens)
├── src/features/<name>/     api.ts (fetch + defensive parse) / model.ts (pure view-model) / screens; api+model never import react-native, tests colocated
├── src/lib/                 server base-url config, timeout fetch, cookie/auth flows, viewer/entitlement context, stubbed purchases.ts + push.ts (owner-gated J1/J2/J5)
└── src/ui/                  theme tokens mirroring src/app/style.css + shared components
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
- **Live race companion — all 5 phases DONE (2026-09-08)**: the pure, Workers-safe `live` domain computes a normalized snapshot, live proprietary-metric estimates (live pass efficiency + adjusted residual vs. per-bucket baselines, a closing-laps Closer estimate), race alerts (`deriveAlerts`), a pit-cycle model, and — from a rolling per-lap **history** — segbar trends, movers, battles, field-leader and tire-falloff derivations. The **`looplab-live` Cloudflare Worker** (`worker/`, at **[looplab-live.nhorton.workers.dev](https://looplab-live.nhorton.workers.dev)**) runs a `LiveCoordinator` **Durable Object** as the single upstream poller (per series via `?series=`; 5s live / 60s idle / stops after 15 min unwatched), enriches the payload against generated baselines/strategy, keeps the history, and canonicalizes known race identity against the schedule so partially rolled CDN metadata cannot select the wrong track strategy or render a hybrid event. Impossible stage boundaries are discarded. The Worker serves `GET /api/live`, `/api/live/status`, and a self-contained `GET /` page. The **main site** has a `/live` page (`client/live.js`, per series) with the layered board (tap-to-drill), a Loop Rating ★ sort, Race Overview, Strategy, and My Driver sub-tabs, plus a permanent Live nav tab (🔴 dot when live) and a home LIVE banner — **live on Cloudflare Pages ([looplab-arh.pages.dev/live](https://looplab-arh.pages.dev/live))**. Phase 4 closed 2026-09-08 with `bun run soak` (`src/app/replay.ts` + `scripts/soak-replay.ts`): two archived races replayed lap-by-lap through the real production composition, zero invariant violations. See [the plan](docs/exec-plans/completed/2026-07-05-live-race-companion.md).
- **Upstream-feed canary v1 (2026-09-07, WS-C)**: `bun run canary` fetches the current schedule, picks the latest completed Cup race, and checks every endpoint pattern we depend on (schedule, weekend-feed, loopstats, lap-times, live-feed, live-flag-data) for HTTP 200 **and** a payload our own normalizers accept; prints a one-line-per-check report, optional `--json`, exits 1 on any failure. Every run persists to `feed_status`; when a check crosses **two consecutive failures** the owner is emailed exactly once per outage (Resend provider; a log-only null client until the key exists), and HTML pages carry a "data updates are delayed" banner while an outage is active (60s-cached check in the server pipeline). Scheduled two ways: `.github/workflows/canary.yml` daily (interim) and the in-process daily 09:00 UTC cron (`ENABLE_CANARY_CRON`, for the Fly server).
- **Results fallback source — verified (2026-09-07, WS-C)**: `bun run sync --source nascar-data [--season Y] [--verify-last N]` ingests official results from the `nascaR.data` Parquet release (Parquet-only; via `hyparquet`, the repo's first runtime dependency) — joined by points-race ordinal + canonical driver name with a track-name guard and config aliases; fields the release lacks stay NULL. Verified against the real download: the last three 2026 Cup races match CDN rows **exactly** (finish/start/laps-led; 36–40 drivers each), 35/36 2025 races exact, and it fills the 2025 YellaWood 500 hole (race 5580). A SportsDataIO adapter **stub** (types + normalizer, NOT for production) covers the paid-fallback path.
- **Per-race ingest atomicity (2026-09-07, WS-C)**: `ingestRaceData` fetches all feeds first, then writes results/drivers/cautions/leaders/loop/lap rows in one transaction — a race commits fully or not at all; a write failure rolls back, is logged, and the backfill continues (the race retries next run). Tested with an injected mid-race constraint failure.
- **Loop-metrics-from-timing spike (2026-09-07, WS-C)**: position-derived loop metrics (laps, lead laps, top-15 laps, avg position) are recoverable from `lap_times`+`cautions` (r=1.000); raw pass counts are NOT (per-lap resolution floor, ~2× undercount); the pass-efficiency ratio holds as a labeled estimate (MAE 0.045). Documented experiment, not a production path — see [the report](docs/research/2026-09-07_loop-metrics-from-timing-spike.md).
- **CI data cache keep-warm (2026-09-07)**: `.github/workflows/cache-keepwarm.yml` restores and re-saves the refresh's data cache every Thursday so it survives GitHub's 7-day eviction to the next Monday — until then every weekly run was a full cold backfill (observed 2026-08-24 and 08-31). Interim until the refresh moves onto the production server (launch plan D18).
- **Production-hardened server + deploy scaffold (2026-09-07, WS-B)**: `bun run serve` is now the production entrypoint — validated env (fail-fast in `APP_ENV=production`), request ids (honoring `fly-request-id`), one JSON log line per request, per-route-class `Cache-Control` (public pages/data, `no-store` health + errors), security headers (CSP derived from the live-Worker + Plausible origins, HSTS in production, `frame-ancestors 'none'`, nosniff), gzip with `Vary: Accept-Encoding`, and `GET /health` (db-backed freshness snapshot; 503 when unreadable). The weekly refresh can run **in-process** (`ENABLE_REFRESH_CRON=1`): a Monday-12:00-UTC cron takes the `weekly-refresh` advisory lock (`app_locks`, TTL + takeover — safe against a concurrent manual run) and spawns the existing refresh CLI as a child process so compute never blocks the event loop. Deploy scaffold: Dockerfile (Bun + Litestream restore-if-missing/replicate), `fly.toml` (volume at `/data`, `/health` check, auto-stop off), `bun run restore-drill` (replica → boot → assert), runbooks (`docs/runbooks/deploy.md`, `backup-restore.md`). The live-Worker origin (`LIVE_API_BASE`) is env-overridable. **Not yet deployed** — Fly account/bucket/domain are owner steps (launch plan A1/A2/A6).
- **Accounts + gating (2026-09-07, WS-D)**: email+password accounts per spec §6 — argon2id (`Bun.password`), 10+-char passwords checked against a common-password blocklist, enumeration-safe sign-in/reset, single-use verify (48 h) and reset (30 min) tokens stored as SHA-256 hashes, 30-day rolling httpOnly/SameSite=Lax sessions with "sign out everywhere", CSRF double-submit on every POST, sliding-window rate limits on sign-in/sign-up/reset (429 + Retry-After), and password-confirmed immediate account deletion. Entitlement per spec §7 (`entitlements`: `pro_until` + `pro_source`; `bun run grant` for manual tester grants). Gating per D4/D16: anonymous/free viewers get Cup + career pages; Xfinity/Trucks HTML (including un-prefixed `/race/{id}`, `/recap/{id}` by derived series) renders a **teaser** (real headline, decorative blurred table, `/pricing` CTA), and the series JSON endpoints return 403 `pro_required` so the teaser can't be bypassed. Requests carrying a session cookie get `private, no-store` page/data responses; anonymous Cup pages stay publicly cacheable. Pages: `/signup`, `/signin`, `/reset[/token]`, `/verify/{token}`, `/account` (plan, verification, sessions, delete), `/pricing` v0. Verification/reset emails go through the Resend provider (log-only until A4).
- **Race predictions + DFS projections (2026-09-07, WS-F)**: `bun run predict` builds strictly point-in-time features (trailing-5 finish, trailing-10 loop rating, track-type history, DNF rate, qualifying when available — never `driver_form`, whose window includes its own race), rates each entered driver in finish-position units, and runs a seeded 5,000-run Monte Carlo finishing-order simulation with track-type-calibrated σ; published probabilities are the simulation frequencies. **Passes the spec §9 honesty bar on held-out 2025**: beats both the uniform and trailing-5-through-the-same-sim baselines on win/top-5/top-10 Brier (report: docs/research/2026-09-07_predictions-backtest.md; re-derive via `bun run backtest:predictions`). DFS scoring is configuration (`config/dfs/dk.json`/`fd.json`, shape-validated, hand-computed-example-tested). Pages: `/predictions` (generation stamp + basis race, free top-3 with the rest as blurred decoration, post-race predicted-vs-actual), `/dfs` (Pro-only, DK/FD toggle, print cheat-sheet view), `/predictions/methodology` (states the bar + backtest numbers). Cadence: Thursday 16:00 + Saturday 22:00 UTC in-process crons (`ENABLE_PREDICTIONS_CRON`); Saturday runs pull the grid from the CDN weekend feed for upcoming races and degrade to form-only when quals haven't run. Cup at launch (D16); other series show a fast-follow note.
- **Deep tools + email (2026-09-07, WS-G)**: **CSV export** for every table the site renders — a dataset registry (`src/app/datasets.ts`, 14 datasets: standings, all season stats, drivers, race log, career, races, race results, standouts, playoff picture, metric leaders, track-type leaders, comparison, predictions, DFS) served at `/export/{dataset}.csv` as a **streamed** attachment (rows pulled lazily; gzip via `CompressionStream` so compression doesn't buffer the body), Excel-safe (UTF-8 BOM + CRLF + RFC-4180 quoting + formula-injection guarding) and named for its filters (`looplab-cup-standings-2025.csv`). Pro-only: anonymous/free requests get the same `403 pro_required` body as the series JSON gate, download responses are `private, no-store`, and pages show the link only to Pro (free sees an upsell; the static export shows nothing, having no `/pricing`). Measured on the real Cup db (2019–2026): every dataset well inside the 2 s bar — largest table 495 rows in **18 ms**, slowest dataset 461 ms. **Deep tools**: the track explorer gained a closing **to-year** (full range control), and compare handles **up to four drivers across series and season ranges** for Pro (two-driver bar view kept; 3–4 render a driver-per-column table with the best value per metric marked; loop metrics weight by `loopRaces`, which the season-stats payload now carries). **Email**: all four templates are pure builders (`emails.ts`) — verify, reset, Monday recap (free, opt-in: winner, top five with position movement, loop-data standouts, form callouts), Thursday preview (Pro, opt-in: model top five, DFS value board, methodology link) — with per-user unsubscribe tokens, a one-tap `/unsubscribe/{token}?list=…` landing page with **undo**, and a `List-Unsubscribe` header. Preferences live on `/account` (both lists default off; nothing is sent to unverified addresses). Sends are **idempotent per (user, kind, race)** — claimed before the attempt, so a re-run never double-sends, while a *recorded failure* stays retryable and an in-flight claim is never stolen. `POST /webhooks/resend` verifies the Svix signature (HMAC-SHA256 over `{id}.{timestamp}.{body}`, constant-time, ±5 min window, retry-idempotent) and suppresses bounced/complained addresses from every future digest, with the reason shown on `/account`. Digests run at the end of `refresh`/`predict` behind `ENABLE_EMAIL_DIGESTS`, or by hand: `bun run src/app/index.ts email --kind recap|preview [--to …] [--dry-run]`.
- **Installable PWA + race push alerts (2026-09-07, WS-H)**: the site is an installable app — `manifest.webmanifest` (standalone, themed, 192/512/maskable icons), an offline page, and an install prompt that captures `beforeinstallprompt` on Chromium and shows Add-to-Home-Screen guidance on iOS (where push requires an installed PWA). **Icons are generated from source** (`bun run gen:icons` → `src/utils/png.ts`, a dependency-free PNG encoder) rather than committed as unregenerable blobs. The **service worker never caches a personalized response**: anything carrying `private`/`no-store` (what every signed-in page carries after WS-D), a `Set-Cookie`, or an `Authorization` header is refused, as are account/auth/export paths by prefix — the cache is shared by everyone on the device. Data and race pages are network-first with a cache fallback; the shell is cache-first under a version-keyed cache so a deploy evicts cleanly; the worker and manifest are served `must-revalidate` so a deploy can actually land. Tests evaluate the **real shipped sw.js** in a sandbox, not a re-implementation. **Web Push** (Pro, spec §4) is implemented to spec — RFC 8291 payload encryption (ECDH P-256 → HKDF → AES-128-GCM, all WebCrypto) and RFC 8292 VAPID (ES256 JWT whose `aud` is the endpoint origin), verified by round-tripping through an independent receiver implementation. Subscriptions are per-device and owner-scoped (another account cannot claim or delete an endpoint); alerts are filtered by kind and followed driver, suppressed by timezone-aware quiet hours (off by default, and an unknown zone fails open rather than silencing someone forever), and **deduplicated per (endpoint, race, kind, driver, lap)** because the live Durable Object can restart and re-derive an alert it already emitted. Dead endpoints (404/410) are pruned immediately. The dispatcher consumes the live Worker's own derived alerts — one source of truth — polling every 20 s while racing and every 5 min when idle (`ENABLE_PUSH_DISPATCHER`), synthesizing the finish alert from the live→idle transition. Keys come from `bun run src/app/index.ts gen:vapid`.
- **Launch hardening — CSP, breached passwords, pinned deploy tool (2026-09-07, WS-I)**: the site runs under **`script-src 'self'`** — no `'unsafe-inline'`, and no hashes to maintain either, because there are no inline scripts left to hash. Page config (live-Worker origin, series, plan) travels as `<html data-live-api|data-series|data-pro>` and every former `on*=` handler is a delegated listener in `client/boot.js`, loaded blocking from `<head>` so the parser-blocking page scripts still see their globals. Verified across the **whole 628-file export**, not just fixtures: every `<script>` carries a `src` and no handler attribute survives. Tests scan both the templates and live responses, and evaluate the **real boot.js** against a stub DOM so the replacement behavior (confirm dialogs, season navigation, print, worker registration, live dot) is asserted rather than assumed. The static export now ships the **same** security headers as the Bun server (`dist/_headers`, built from the same `securityHeaders()`) — before this the actually-public Pages site had no CSP at all. `style-src 'unsafe-inline'` deliberately remains: metric-bar widths and car-badge colors are computed per row from numbers and our own palette, never user input. **Breached-password check** per spec §6: `providers/hibp.ts` does a Have I Been Pwned k-anonymity range lookup (only a 5-character SHA-1 prefix leaves the process, `Add-Padding: true` so response length leaks nothing) on sign-up and password reset, and **fails open** — a timeout or non-200 is "no opinion", never a rejection, so an HIBP outage cannot lock everyone out of the product; the offline blocklist and length rules still hold in that window. It catches what the 85-entry blocklist cannot: `nascar2020` (541 breach hits), `dalejr8888` (489), `jeffgordon24` (21,424) were all accepted before and are refused now, with the same message as the offline list so probing can't tell the two apart. **Wrangler is pinned exactly** (`4.129.1`) as a devDependency, so the weekly deploy leg runs a known local binary instead of fetching whatever is latest from the registry mid-refresh on the production server (D18); the daily canary installs with `--production` so it no longer downloads it.
- **Native mobile app — stage 1+2 scaffold (2026-09-08, WS-J)**: `mobile/` is an Expo SDK 57 + expo-router app (iOS + Android, dark-themed to match the site) consuming the existing server: free Cup screens (home, live board polling the Worker while focused, driver index/profiles, standings + metric boards via `/health`-derived latest season), email/password sign-in/sign-up/reset against the existing `/auth/*` form endpoints (platform cookie jar + echoed csrf; PRG outcomes classified from the followed response), and a Pro hub whose gating reads **server** entitlement via the new `GET /api/me` (401 anonymous; else email/verifiedAt/pro/proUntil/proSource — the app never decides Pro from a local receipt). Purchases (RevenueCat, J1/J2) and native push (APNs/FCM, J5) are stubbed behind `lib/purchases.ts` / `lib/push.ts` interfaces. Its `api.ts`/`model.ts` modules are react-native-free with colocated Bun tests; `cd mobile && bun run typecheck && bun test src`.

- **Native mobile app — Pro content screens (2026-09-08, WS-J)**: the Pro hub became a real navigation surface. **Predictions** (race board with win/top-5/top-10 and expected finish, predicted-vs-actual once the race is scored, a tappable expected-laps-led/fast-laps line, and a methodology screen whose backtest numbers come from the server so the two surfaces cannot quote different ones), **DFS** (DK/FD toggle, the platform's own rules read from `config/dfs/*.json`, and a lineup scratchpad that totals projected points as you tap — no optimizer, because there are no salaries in the dataset), and **deep tools** (compare — two Cup drivers in one season free, four drivers across series and a season range for Pro; track-type explorer with the full season range, Cup free and other series Pro). Every Pro screen renders both entitlement states, and the withholding happens **server-side**: two additive JSON views, `GET /api/predictions` (free viewers receive three real rows plus a `hiddenCount`; the rest are never serialized) and `GET /api/dfs` (403 `pro_required` for non-Pro, like the CSV exports), added for the same reason `/api/me` was — those views existed only as rendered HTML. Deep tools needed no new endpoints (`/api/tracks`, `/api/drivers/:id/stats`). One shared `ProLock` renders the locked treatment everywhere; it never links to web checkout (Apple 3.1.1) and states the stub's unavailability honestly until J1/J2. CSV export stays web-only on mobile — a download would leave the app's cookie jar behind.
- **Both TypeScript programs typecheck (2026-09-07)**: `bun run typecheck` (root: `src/` + `tests/`) and `bun run typecheck:worker` (Cloudflare types). The Worker's Cloudflare-only fetch options go through `upstreamInit()` and the pure `canonicalizeFeed` lives in `worker/canonicalize.ts`, so the root program never loads Durable Object types.
- Known data holes are documented in [the re-verification doc](docs/research/2026-07-05_data-sources-reverification.md) (2025 YellaWood 500 results; exhibition heat races).

## What Does NOT Exist Here

> Honest list of gaps. Must be kept updated.

- No cross-series *statistical normalization* (a Cup season is not adjusted to be comparable with an Xfinity season). WS-G's compare **does** put up to four drivers from any series side by side for Pro, but the numbers are raw per-series values — the tracks/metrics/standings views remain single-series
- The weekly refresh is automated (`.github/workflows/weekly-refresh.yml` → `bun run refresh`, Mondays 12:00 UTC); what's NOT automated is the deploy leg *until* the two Cloudflare secrets are added — before then the CI builds + artifacts `dist/` but skips the upload
- Canary alert **emails** degrade to a log line until the owner's Resend account exists (A4 — `RESEND_API_KEY`/`ALERT_EMAIL_TO`); until the Fly server is deployed the canary's scheduler is still the GitHub workflow, whose alert remains "the run went red"
- The main-site Live page (`/live`, `client/live.js`) reads the live Worker **cross-origin** — it depends on `looplab-live.nhorton.workers.dev` being up; if the Worker is down the page shows its connecting/idle state rather than site data
- The **Vercel mirror** (`looplab-murex.vercel.app`) may lag the Cloudflare deploy — the `/live` page shipped to **Cloudflare Pages** (`looplab-arh.pages.dev`); a Vercel redeploy was pending (transient upload error) at last update
- Live proprietary metrics are **estimates from live loop counters**, not the authoritative post-race `loopstats/prod` values; the DO does not yet swap to the official numbers after the checkered flag. Live baselines are **baked into the Worker** and must be regenerated + redeployed after a weekly refresh (see tech-debt tracker)
- The DO stops polling after ~15 min with no `/api/live` traffic, so alert diffs can jump across a gap when it restarts (no cron keep-warm) — fine while testers keep a tab open, revisit for unattended coverage
- The live **Strategy** tab is now **calibrated + deployed** (2026-07-06): per-track (with track-type fallback) **typical green run** + a **tire-severity tier** from the pit-discontinuity method, baked into `worker/track-strategy.ts` per series and shown honestly (tire narrative suppressed at low-deg draft tracks). A physical fuel *capacity* is deliberately **not** modeled — it isn't cleanly recoverable from history, so `lapsToTypicalPit` is a behavioral pit-cadence estimate, not a fuel gauge. **Held-out backtested** (`bun run backtest`, train <2022 / test 2022): per-track pit-cadence prediction is 60% lower MAE than the flat baseline (6.0 vs 15.0 laps; ±10 laps for 86% of held-out stints) — see [the results](docs/research/2026-07-06_strategy-backtest.md). The bake must be **regenerated + redeployed after a weekly refresh** (same staleness as baselines — see tech-debt). See [the plan](docs/exec-plans/completed/2026-07-06-strategy-model-calibration.md)
- **Push has never been delivered to a real device.** The protocol is implemented and round-trip-tested, but no VAPID keys are configured and no deploy exists, so the acceptance run (a test user receiving pit/caution/stage/finish alerts through a full race with no duplicates) is owner- and calendar-gated on A2/A6 plus a live race weekend. iOS additionally requires the PWA to be installed before push works at all
- The PWA install acceptance (installs on iOS and Android; Lighthouse PWA checks) is structurally satisfied — valid manifest, icon set, registered worker, reachable offline page — but has not been run against a real device or Lighthouse, which needs the deployed HTTPS origin
- **`style-src` still allows inline styles.** Closing it would mean removing ~30 `style="…"` attributes, several of which are computed per row (`width:${w}%` on metric bars, `background:${teamColor(team)}` on car badges) and therefore cannot become classes. Inline *style* injection is a much weaker primitive than inline *script* injection and every value reaching those attributes is a number or a palette entry, so this is a deliberate stop, not an oversight (tech-debt tracker)
- **The Vercel mirror gets no security headers.** `dist/_headers` is a Cloudflare Pages format; Vercel ignores it, so `looplab-murex.vercel.app` serves the same HTML with no CSP. Either give Vercel a `vercel.json` or retire the mirror at the domain cutover (A6)
- **The breached-password check is best-effort by design.** It fails open, so during an api.pwnedpasswords.com outage a breached password can still be registered — the offline blocklist and the 10-character minimum are the floor in that window. It also runs only on sign-up and reset: existing passwords are never re-checked, so a password breached *after* registration is never flagged
- No odds integration (deferred — see exec plan)
- ~~No user authentication~~ built 2026-09-07 (WS-D) — see "Accounts + gating" above
- **Prediction entry lists are a heuristic** (drivers from the last 3 completed points races — no entry-list feed is ingested), and the **DK/FD point values in `config/dfs/*.json` are unverified against the live platforms** (owner + DFS players validate before launch weekend). Xfinity/Trucks predictions are a post-launch fast-follow (D16). `/predictions` and `/dfs` have no nav tab yet — reachable by URL and from the methodology/pricing cross-links; nav placement is a WS-H polish decision
- **No payments yet**: accounts + gating exist (WS-D), but there is no Stripe checkout/portal/webhooks — Pro can only be granted manually (`bun run grant`); `/pricing` says "checkout opens soon". WS-E builds the billing state machine. Account deletion does not yet cancel a Stripe subscription (none can exist yet)
- **The mobile app has content but no commerce and no device proof** (WS-J stages 1–2; the Pro content screens landed 2026-09-08): no IAP (RevenueCat needs owner steps J1/J2), no native push (J5), no EAS/store config, and **it has never run on a device or a simulator** — every layer beneath the UI is tested and smoke-checked against the real database, but no screen has been seen rendered. Still absent from the app: Xfinity/Trucks browsing, CSV export (a download opens outside the app and leaves the session cookie behind), and races-index/recap screens (those pages have no JSON API). Sign-in relies on the platform cookie jar following the server's PRG redirects; if a real device breaks that assumption the fallback is the additive native-session endpoint named in the WS-J sub-plan
- The **static export still contains all three series** — it predates gating and is today's live free site; it must be restricted to Cup (the "static Cup fallback" of the launch plan) at launch cutover, not before (tech-debt tracker)
- **Digest email is built but has never been sent for real** — no Resend account yet (A4), so the recap/preview acceptance runs are owner-gated; with `ENABLE_EMAIL_DIGESTS=1` and no key every digest is a *recorded failure* (retryable on the next run, by design). Bounce suppression is inert until `RESEND_WEBHOOK_SECRET` is set (the endpoint answers 503 rather than trusting unsigned input), and the Resend webhook payload shape is written from their docs, never seen live
- Email bodies are **plain text only** — no HTML/multipart alternative — and there is no per-driver alert email (that is WS-H push)
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
│   ├── 2026-09-08-brand-exploration.html  Standalone naming/logo concept studio (offline SVG previews and exports; not a production route)
│   ├── 2026-09-08-brand-exploration-v3.html  Generated tire/track gallery with editable sidewall lettering; rebuilt by scripts/build-brand-v3.ts
│   ├── brand-v3-assets/     Original generated PNG masters and exact prompt provenance
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
