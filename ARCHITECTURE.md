# Architecture — NASCAR Analytics

## What This Is

NASCAR Analytics is a modern web platform that ingests NASCAR race data (loop data, results, lap times, pit stops) from public sources, computes proprietary analytics metrics, and presents them alongside betting odds context. The goal: replace outdated tools like Lap Raptor and FRCS.pro with a clean, mobile-first experience that NASCAR fans actually want to use.

## Project Structure

```
src/
├── app/                     Application wiring and entrypoint
│   └── index.ts             CLI: backfill / sync / status (HTTP routes come with the UI phase)
├── domains/
│   ├── data-ingestion/      NASCAR CDN data fetching and storage  [BUILT]
│   │   ├── types.ts         CDN feed shapes + normalized row types
│   │   ├── config.ts        Endpoint URLs, coverage boundaries, track-type classification
│   │   ├── repo.ts          SQLite upserts + coverage queries
│   │   ├── service.ts       Pure normalizers + backfill/sync orchestration
│   │   └── index.ts         Barrel
│   ├── drivers/             Driver identity, summaries, race logs  [BUILT]
│   │   ├── types.ts         DriverSummary, DriverRaceLogEntry, IdentityIssue
│   │   ├── config.ts        Series/points-race constants
│   │   ├── repo.ts          Summary/race-log/lookup queries
│   │   ├── service.ts       Driver index, lookup, identity-integrity check
│   │   └── index.ts         Barrel
│   └── analytics/           Pre-computed metrics (`bun run compute`)  [BUILT]
│       ├── types.ts         Source rows, league expectations, computed stat rows
│       ├── config.ts        Points filter (+ race 5580 override), buckets, form window
│       ├── repo.ts          Source reads + computed-table writes/reads
│       ├── service.ts       Metric math (pure) + computeAll orchestration
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

Planned domains not yet built: `odds` (deferred — see exec plan). Check "Current Guarantees" and "What Does NOT Exist" below for actual state.

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
| Frontend | HTML imports via Bun.serve() | No Vite/webpack needed |
| Styling | Tailwind CSS | Utility-first, mobile-first |
| Testing | bun test | Built-in |

## Data Sources

| Source | Type | What We Get |
|--------|------|------------|
| `cf.nascar.com/cacher/{year}/{series}/{race_id}/` | Public CDN (free, no auth) | Schedules 2016+, results 2017+, lap times 2020+, pit data, live race data. Payload-verified 2026-07-05 — see [re-verification](docs/research/2026-07-05_data-sources-reverification.md) |
| `cf.nascar.com/loopstats/prod/{year}/{series}/{race_id}.json` | Public CDN (free, no auth) | Full official loop data per race (Driver Rating, quality passes, fast laps, etc.), 2019+ |
| nascaR.data (R package) | Free, CRAN | Historical results 1949-present (v3.1.0, actively maintained) |
| ~~The Odds API~~ | ❌ Does NOT cover NASCAR | Verified 2026-07-05. Odds source TBD — betting/odds domain deferred |
| rNascar23.Sdk reference | GitHub | Documents all NASCAR CDN endpoint patterns including LoopData |

## Current Guarantees

> What the system currently does reliably. Updated as features ship.

- **Data ingestion pipeline (2026-07-05)**: `bun run backfill` / `bun run sync` ingest Cup Series data from the NASCAR CDN into `data/nascar.db` (SQLite). Idempotent — re-runs fetch only missing races. Rate-limited and retrying.
- **Ingested dataset (verified against known history)**: schedules 2016–2026, results 2017–2026 (13.7k rows, incl. DQ handling), loop stats 2019–2026 (10.7k rows), lap-by-lap times 2020–2026 (2.24M rows), cautions, race leaders. Winner spot-checks pass for 2017/2019/2020/2022/2024 marquee races.
- **Raw archival**: every 200 CDN response is stored verbatim under `data/raw/` with a `raw_fetches` index (URL, sha256, status) — the dataset survives any future CDN access change.
- **Track-type classification**: every 2016–2026 Cup track classified (superspeedway/intermediate/short/road/dirt), including Atlanta's 2022 reprofile via season override.
- **Architecture tests**: layer dependency rules are enforced by `bun test` (tests/architecture.test.ts).
- **Computed analytics (2026-07-05)**: `bun run compute` rebuilds `driver_season_stats`, `driver_track_type_stats`, and `driver_form` (trailing-6-race form) from points races (`race_type_id = 1` + the race-5580 override). Includes two proprietary metrics — Adjusted Pass Efficiency and Closer Score, both residuals vs. league-average baselines per running-position bucket. Verified against known history (season wins leaders 2017–2024, SVG road stats, Elliott 2023 injury season).
- **Drivers domain (2026-07-05)**: driver summaries, race logs, id/name lookup (`driver --name "..."` CLI), and an identity-integrity check. CDN driver_id verified stable across 2017–2026 — no alias table needed.
- Known data holes are documented in [the re-verification doc](docs/research/2026-07-05_data-sources-reverification.md) (2025 YellaWood 500 results; exhibition heat races).

## What Does NOT Exist Here

> Honest list of gaps. Must be kept updated.

- No web UI or HTTP API endpoints (Phase 3 of the active exec plan)
- No Xfinity/Truck series data (Cup only so far)
- No scheduled automation — sync is run manually after race weekends
- No odds integration (deferred — see exec plan)
- No user authentication (deliberately out of MVP scope)
- No deployment infrastructure

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
