# Architecture — NASCAR Analytics

## What This Is

NASCAR Analytics is a modern web platform that ingests NASCAR race data (loop data, results, lap times, pit stops) from public sources, computes proprietary analytics metrics, and presents them alongside betting odds context. The goal: replace outdated tools like Lap Raptor and FRCS.pro with a clean, mobile-first experience that NASCAR fans actually want to use.

## Project Structure

```
src/
├── app/                     Application wiring, CLI, web server, and static export
│   ├── index.ts             CLI: backfill / sync / status / compute / driver / serve / export
│   ├── render.ts            Page-render functions (shared by server + export)
│   ├── server.ts            Bun.serve(): prefix-aware router mirroring the static URL scheme
│   ├── export.ts            Static-site generator → dist/ (Cloudflare Pages)
│   ├── data.ts              Compact JSON payloads for the client pages
│   ├── layout.ts            Page shell (app bar, series switch, tab bar), 404
│   ├── html.ts              esc/fmt/badge/sparkline/card helpers + path-based withSeries
│   ├── style.css            Design tokens + components (per docs/DESIGN.md)
│   ├── client/              Browser JS for the client-rendered pages (compare.js, tracks.js)
│   └── pages/               Page templates (home, drivers, races, metrics, career, recap) + client shells (compare, tracks)
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
│   └── analytics/           Pre-computed metrics (`bun run compute`)  [BUILT]
│       ├── types.ts         Source rows, league expectations, computed stat rows
│       ├── config.ts        Points filter (+ race 5580 override), buckets, form window
│       ├── repo.ts          Source reads + computed-table writes/reads
│       ├── service.ts       Metric math (pure) + computeAll orchestration
│       ├── runtime.ts       JSON API handlers (/api/standings, /api/tracks…)
│       └── index.ts         Barrel
├── providers/
│   ├── index.ts             Providers interface + factory
│   ├── db.ts                bun:sqlite connection + schema (incl. computed tables)
│   ├── nascar-cdn.ts        Rate-limited, retrying CDN fetch client
│   └── raw-archive.ts       Verbatim raw-JSON archival (CDN insurance)
└── utils/                   Generic reusable helpers
tests/
├── architecture.test.ts     Enforces the layer rules below (part of `bun test`)
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
| Hosting | Cloudflare Pages (static, Direct Upload) | Free, globally cached, no server; read-only data changes only weekly |
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
- **Weekly race recap (2026-07-05)**: `/recap` (each series' latest completed race) and `/recap/{raceId}` (un-prefixed, race_id is global) — an auto-generated post-race page composing four sections: result summary (winner + podium), "What the Loop Data Saw" (per-race adjPE + Closer standouts from `race_metric_standouts`), "Championship Picture" (points-standings movement vs. the prior race with a per-series cut line, `PLAYOFF_CUT_BY_SERIES`), and form-vs-result driver callouts. New Recap nav tab; the Home "Last Race" card links in; `/api/recap/:id`. All analytics is pure/unit-tested (`computeRaceStandouts`, `computeStandingsMovement`, `pickFormCallouts`) reading precomputed tables; regenerated by the standard sync → compute → export chain. The playoff picture is a **simplified points cut line**, not the real elimination/reset format (see tech-debt tracker).
- **Series switching (2026-07-05)**: a Cup/Xfinity/Trucks segmented switcher (top-level nav axis, under the app bar). Series lives in the URL **path** (`/`, `/xfinity`, `/trucks`) so each series is its own static file; threaded through every page and internal link. A race page (`/race/{id}`, un-prefixed) derives its series from the race itself.
- **Static export + deployment (2026-07-05)**: `bun run export` pre-renders the whole site to `dist/` (~1,800 pages) using the same `render.ts` as the dev server, plus client JSON for the two interactive pages. Deployed to **Cloudflare Pages** via Direct Upload (`bunx wrangler pages deploy dist`) — the ~160MB DB stays local, only static output ships. Compare + track explorer render client-side from `dist/data/*.json`. See [docs/DEPLOY.md](docs/DEPLOY.md).
- Known data holes are documented in [the re-verification doc](docs/research/2026-07-05_data-sources-reverification.md) (2025 YellaWood 500 results; exhibition heat races).

## What Does NOT Exist Here

> Honest list of gaps. Must be kept updated.

- No cross-series *statistical* comparison (e.g. normalizing a Cup season against an Xfinity season side by side) — the career page unifies a driver's Cup+Xfinity+Truck record, but the analytics/compare/tracks views still each stay within one series
- No real playoff-format model — the recap's "Championship Picture" cut line is a simplified points order (top 16/12/10 per series); it does not model playoff rounds, eliminations, points resets, or win-and-in (see tech-debt tracker)
- No scheduled automation — the weekly refresh (sync → compute → export → deploy) is run by hand
- Not yet live — the static export is built and verified locally; the one-time Cloudflare Pages connect (needs the owner's login) is pending, per docs/DEPLOY.md
- No odds integration (deferred — see exec plan)
- No user authentication (deliberately out of MVP scope)
- No scheduled/CI deploy — deploys are the manual local build+upload in docs/DEPLOY.md

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
