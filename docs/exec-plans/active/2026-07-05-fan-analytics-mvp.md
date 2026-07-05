# Exec Plan: Fan Analytics Platform MVP

**Status:** ACTIVE
**Created:** 2026-07-05
**Depends on:** [Data sources re-verification](../../research/2026-07-05_data-sources-reverification.md)

## Decisions Made (2026-07-05)

Direction confirmed with Nick after full docs review and live endpoint re-verification:

1. **MVP = fan-facing analytics platform** (modern, mobile-first stats explorer). This matches PRODUCT_SENSE.md's primary persona.
2. **Live race companion is the intended follow-on** — architecture must not preclude it (the CDN live-feed endpoint is verified working; ingestion should be designed so a live polling mode can be added later).
3. **Betting/odds is DEFERRED** — The Odds API turned out not to cover NASCAR, and the [odds-sources research](../../research/2026-07-05_odds-sources.md) found no viable cheap self-serve alternative (best lead: SportsDataIO Discovery Lab, ~$99–149/mo with unresolved licensing questions). Future betting context will lead with **our own model-generated win probabilities** (no odds license needed) rather than republished sportsbook lines.
4. **Project ambition: serious hobby, maybe monetize later.** NO auth, NO billing, NO freemium gating in the MVP. Public site, optimize for data quality and polish.

## Competitive positioning note (2026-07-05 refresh)

The [competitive refresh](../../research/2026-07-05_competitive-refresh.md) found the official NASCAR Mobile app (v16, 2026) now has modern driver pages with track-by-track history, and a new free modern historical-stats site (nascar-reference.com) exists. **The open lane is loop-data-first analytics**: interactive loop-data exploration, loop-metric head-to-head comparisons, track-type splits, proprietary computed metrics. "Driver profile pages exist" is no longer differentiation on its own — analytical depth and comparison/exploration UX is.

## Goal

A working, deployed-locally (first) web app where a NASCAR fan can, on their phone:
- Browse driver profiles with current-season and historical loop-data stats
- See race pages (results + loop data + lap-time-derived insights) for any race 2016–present
- Compare two drivers head-to-head
- Explore track-type splits (superspeedway / intermediate / short track / road course)

## Data Reality (payload-verified during ingestion, 2026-07-05)

- Results: CDN, 2017–present (2016 has schedule only; per-race feeds 403)
- Loop stats: CDN, 2019–present (2016–2017 serve HTTP 200 with `null` bodies; 2018 403s)
- Lap-by-lap times: CDN, 2020–present
- Known holes: 2025 YellaWood 500 results (null feed; loop stats/laps fine); exhibition heat races
- Raw JSON archival from day one (CDN is unofficial — the archived data IS the long-term asset)

## Progress

- ✅ **Phase 0 complete (2026-07-05)** — Bun/TypeScript scaffold, DDD folder structure, architecture dependency tests running under `bun test`
- ✅ **Phase 1 complete (2026-07-05)** — ingestion domain + providers built; full Cup backfill run: 13.7k results (2017–2026), 10.7k loop-stat rows (2019–2026), 2.24M lap-time rows (2020–2026), cautions + leaders; raw archive 191MB / 1,300+ responses; winner spot-checks and DQ handling verified; idempotent re-runs confirmed
- ✅ **Phase 2 complete (2026-07-05)** — drivers + analytics domains built. Computed on the real dataset: 633 driver-season rows, 2,022 track-type rows, 13,032 form rows. driver_id verified stable (163 drivers, no duplicate names, no alias table needed). Verified vs. known history: season wins leaders 2017–2024 all correct (incl. the 2018 Harvick/Busch tie at 8 and Larson's 35-race 2024), SVG's 8 road wins since 2023, Elliott's 29-race 2023. `bun run compute`, `driver --name` CLI. 67 tests green.
- ⬜ Phase 3 — runtime + UI

## Phases

### Phase 0 — Scaffold
- `bun init`, TypeScript, folder structure per ARCHITECTURE.md (`src/app`, `src/domains`, `src/providers`, `src/utils`)
- Architecture dependency tests (enforce layer import rules) running under `bun test`

### Phase 1 — Data ingestion domain
- Provider: `NascarCdnClient` (fetch with retry/backoff, polite rate limiting, User-Agent)
- Raw archive: every fetched JSON stored verbatim (content-addressed or `raw_fetches` table) before parsing
- SQLite schema: `series`, `tracks`, `races`, `drivers`, `race_entries`(results), `loop_stats`, `lap_times`
- Track table includes track_type classification (superspeedway/intermediate/short/road) — small hand-curated config, keyed by track_id
- Backfill: 2016–2026 schedules + weekend-feeds + loopstats; 2020–2026 lap-times. Cup series (series_id 1) first; Xfinity/Trucks later
- Update command: idempotent "sync latest" run after each race weekend

### Phase 2 — Drivers + analytics domains

Detailed design (2026-07-05, after data verification against the ingested DB):

**Data facts established up front:**
- `driver_id` is stable across seasons: 163 drivers, zero duplicate names across different ids, long-tenure drivers hold one id across all 10 seasons. **No alias table needed.**
- `race_type_id`: 1 = points (341), 2 = exhibition (28), 3 = exhibition variant (1 — the 2025 Cook Out Clash at Bowman Gray). Points filter = `race_type_id = 1`.
- One data-bearing race has NULL `race_type_id`: the 2025 YellaWood 500 (race 5580, loop stats only — its weekend feed is null upstream). It IS a points race → analytics config carries a `POINTS_RACE_ID_OVERRIDES = [5580]` so its loop stats count.
- `closing_laps_diff = closing_ps − finish_ps` (verified on all 10,716 rows): positive = positions gained over the closing laps.
- `finishing_status`: `"Running"` = finished; failure reason = DNF; blank / `"Stage N Winner"` oddities = treated as unknown (not DNF).

**drivers domain** (identity + race log; reads ingestion-owned tables via its own repo):
- `types.ts`: `DriverSummary` (id, name, first/last season, race counts, latest team/car number), `DriverRaceLogEntry` (per-race result + loop rating)
- `repo.ts`: driver summaries, race log (results × races × loop_stats join), lookup by id or case-insensitive name
- `service.ts`: driver index, race log, identity-integrity check (duplicate-name detection so future ingests surface id instability)

**analytics domain** (pre-computed metrics, per core belief #5 — computed by `bun run compute`, stored in SQLite, read instantly in Phase 3):
- New tables in the db provider: `driver_season_stats`, `driver_track_type_stats`, `driver_form`
- Base metrics per (driver, season) and per (driver, season, track_type): races, wins, top-5s, top-10s, DNFs, avg start/finish, laps led, points, playoff points; loop-derived: avg Driver Rating, top-15 lap %, fast-lap %, green-flag pass efficiency
- Rolling form (`driver_form`): per (driver, race), trailing-6-points-races avg finish / avg rating / avg closing gain — powers Phase 3 trend sparklines
- **Proprietary metric 1 — Adjusted Pass Efficiency (adjPE):** raw pass efficiency = `passes_gf / (passes_gf + passed_gf)` (share of green-flag passing encounters won). Mid-pack cars see more passing chances than leaders, so we compute the league-average efficiency per average-running-position bucket (width 5) across all points-race loop rows, then score each driver-race as *actual − expected*. Season adjPE = mean residual × 100 (percentage points above position-expected).
- **Proprietary metric 2 — Closer Score:** same expectation mechanism applied to closing laps: league-average `closing_laps_diff` per closing-position bucket (a P2 car can't gain much; a P25 car can), residual = actual − expected. Season Closer Score = mean residual (positions gained in closing laps vs. expectation).
- Full recompute each run (dataset is small; delete + insert in a transaction, idempotent)
- CLI: `bun run compute` (recompute all), `bun run src/app/index.ts driver --name "..."` (quick profile lookup for verification)

**Phase 2 verification:** all tests green (pure metric math + e2e compute on seeded in-memory db + architecture rules); compute run on the real DB sanity-checked against known history (season wins leaders: 2017 Truex 8, 2020 Harvick 9, 2021 Larson 10, 2022 Elliott 5, 2023 Byron 6, 2024 Larson 6).

### Phase 3 — Runtime + UI
- `Bun.serve()` API routes per domain runtime layer
- Mobile-first dark UI (DESIGN.md): driver profile page, race page, head-to-head comparison, track-type explorer
- Page load target: < 1s on cached data

### Future (explicitly NOT in this plan)
- Live race companion (phase 2 product — live-feed polling, gaps, position chart)
- Odds/betting domain (pending odds-source research)
- Xfinity/Truck series backfill
- Auth, billing, deployment/hosting decisions

## Verification

- `bun test` zero failures, including architecture tests
- Data quality: spot-check ingested results vs. NASCAR.com official results for 5+ races across eras
- Loop stats row counts match schedule race counts per season (minus known 2018 gap)

## Risks

| Risk | Mitigation |
|------|-----------|
| CDN access restricted by NASCAR | Raw JSON archival from day one; polite fetch rates |
| 2018 loop data gap | Ship with gap noted; later source from nascaR.data/DriverAverages if needed |
| driver_id instability across old seasons | Verify during backfill; add alias table if needed |
