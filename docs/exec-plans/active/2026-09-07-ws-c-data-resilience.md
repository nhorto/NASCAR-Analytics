# WS-C — Data resilience (implementation plan)

**Status:** ACTIVE — build detail for workstream WS-C of
[the launch plan](2026-09-07-production-and-paid-launch.md) (§5 WS-C, weeks 2–3,
parallel with WS-B). Builds on the WS-B branch (scheduler + server pipeline).
Acceptance boxes live in the launch plan.

## Source facts established 2026-09-07

- The `nascaR.data` release is **Parquet-only** (the README's CSV URLs 404):
  `https://nascar.kylegrealis.com/{cup_series,nxs_series,truck_series}.parquet`,
  updated Mondays 05:00 ET in season, sourced from DriverAverages.com with
  permission. Cup file ≈ 1 MB for 1949–present; columns
  `Season, Race, Track, Name, Length, Surface, Finish, Start, Car, Driver,
  Make, Pts, Laps, Led, Status, Team, S1, S2, S3, Rating, Win`. `Race` is the
  points-race ordinal within the season; there are no CDN race/driver ids, so
  the adapter joins on (season, points-race ordinal) → our `races` and
  normalized driver name → our `drivers`.
- Parsing Parquet in Bun needs a reader: **`hyparquet`** (pure JS, MIT, no
  native deps) — the repo's first runtime dependency. Verified against the real
  Cup file (101,157 rows; 2026 rows match yesterday's Southern 500).

## Design

| Piece | Where | What |
|---|---|---|
| `feed_status` | `providers/db.ts` schema + new `src/domains/data-health/repo.ts` | One row per (check_id, run_at): ok, http status, problem, ms. Repo owns reads/writes: record a report, latest runs per check, consecutive-failure count, active outages. |
| Canary v1 | `src/app/canary.ts` + `src/app/index.ts` | After each run: persist results to `feed_status` (when a db is available), compute outages, and when a check **crosses** `CONSECUTIVE_FAILURES_TO_ALERT` (== 2, exactly at the threshold so one outage → one email) send the owner an alert through the email provider. Still exits 1 on any failure. |
| Email provider | `src/providers/email.ts` | Minimal Resend REST client (`fetch`, no SDK) + a null client that logs when `RESEND_API_KEY`/`ALERT_EMAIL_TO` are absent — so the canary alert path is testable and deploy-safe before the owner's Resend account exists. |
| Daily canary cron | `src/app/scheduler.ts` | `nextDailyAt(hourUtc)` + a daily job at 09:00 UTC (same as CI) spawning the canary CLI, enabled by `ENABLE_CANARY_CRON`. GitHub's `canary.yml` keeps running until the server is live (same sequencing logic as the D18 flip). |
| "Data delayed" notice | `src/app/http.ts` + `server.ts` | When `feed_status` shows an active outage, page responses get a small banner injected after `<main class="screen">` (60 s in-memory cache on the outage query). Static export unchanged — the notice is a dynamic-server behaviour. |
| Per-race transaction | `data-ingestion/service.ts` | `ingestRaceData` now fetches all three payloads first, then writes them in **one** `db.transaction` — a race commits fully or not at all. A write failure rolls back and is logged per race; the backfill loop continues (the race stays uncovered and retries next run). |
| Fallback adapter | `src/providers/nascar-data.ts` + data-health service + ingestion service | Provider downloads + parses the Parquet release (`parseSeriesParquet` is separately exported for fixture tests). Data-health service maps release rows → `ResultRow[]` via injected race/driver indexes (pure; unmatched drivers reported, never guessed). Ingestion applies them atomically per race. |
| `sync --source nascar-data` | `src/app/index.ts` + `src/app/fallback-sync.ts` | Fills races missing CDN results from the fallback; `--verify-last N` compares fallback rows against stored CDN rows (finish, start, laps led) and prints a per-race report — the acceptance evidence. |
| SportsDataIO stub | `src/providers/sportsdataio.ts` | Types + URL builders + a `normalizeResults` against their documented schema, clearly marked NOT FOR PRODUCTION (never wired into sync); a lockout becomes config + a card. Untestable against the live API without the owner's trial key. |
| Runbook | `docs/runbooks/feed-loss.md` | First hour / first day / first week, per data type, from the data-risk backup plan. |
| Spike | `scripts/spike-loop-from-timing.ts` → `docs/research/` | Recompute avg running position, green-flag passes, quality passes, fast laps, closing-laps diff from `lap_times` + `cautions` for the 2025 Cup season; report per-metric agreement vs official `loop_stats`. Ships as a documented experiment (promotion post-launch unless >95% agreement). |

## Sequencing / owner-gated

- Real alert **emails** need the owner's Resend account (A4) — until then the
  null client logs the alert. The injected-403 → email path is fully unit-tested
  with a fake transport; the launch-plan acceptance box ("in staging, emailed
  within 24 h") stays open until a deployed server + Resend key exist.
- `canary.yml` (CI) is retired together with the D18 flip, once the server
  canary is live — tracked with the existing tech-debt entry.
- Runbook review is an owner step.

## Build checklist

- [x] feed_status table + data-health repo + tests (consecutive-failure math, outage detection, threshold-crossing alert exactly once)
- [x] Email provider (Resend + null) + tests
- [x] Canary CLI v1 (persist + alert) + tests with injected 403s
- [x] Daily canary cron + tests (nextDailyAt boundaries)
- [x] Data-delayed banner + server test
- [x] Per-race ingest transaction + injected mid-race failure test + backfill-continues test
- [x] nascar-data provider + pure mapping + `sync --source nascar-data` + fixture tests
- [x] Real-download verification (2026-09-07): last three 2026 Cup races —
      36/40/38 drivers compared, **exact match on finish/start/laps-led in all
      three** (withdrawn finish-0 CDN entries excluded). Full-2025 stress test:
      35/36 races exact; the 36th is race 5580 itself (no CDN rows to compare),
      and **write mode filled it** — the known YellaWood-500 hole is now
      recoverable with one command.
- [x] SportsDataIO stub + fixture test
- [x] docs/runbooks/feed-loss.md
- [x] Spike run + [report](../../research/2026-09-07_loop-metrics-from-timing-spike.md):
      position-derived metrics recoverable (r = 1.000), raw pass counts are NOT
      (per-lap resolution floor, ~2× undercount), pass-efficiency ratio usable
      as a labeled estimate (MAE 0.045). Promotion bar not met → stays an
      experiment, per plan default.
- [x] ARCHITECTURE.md / QUALITY_SCORE.md / tech-debt updates

## Findings folded into config (2026-09-07)

- Track aliases needed against the real release: EchoPark Speedway→Atlanta,
  Naval Base Coronado→San Diego Street Course, Chicago Street Course→Chicago
  Street Race, Dover International→Dover Motor Speedway. Driver alias:
  John Hunter Nemechek→John H. Nemechek. (`data-health/config.ts`)
- `POINTS_RACE_ID_OVERRIDES` added to ingestion config so the 5580 hole
  doesn't shift fallback ordinals (the track-name guard caught the shift
  before the fix — the guard works).
