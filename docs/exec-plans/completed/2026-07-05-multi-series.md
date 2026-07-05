# Exec Plan: Multi-Series (Xfinity + Trucks)

**Status:** COMPLETED 2026-07-05
**Created:** 2026-07-05
**Follows:** [Fan Analytics Platform MVP](2026-07-05-fan-analytics-mvp.md) (Cup-only)

## Outcome (2026-07-05)

Shipped. Backfilled Xfinity (12.5k results, 9.5k loop rows) and Trucks (7.9k results, 6.9k loop rows, incl. the bonus 2018 loop season); all three series now hold 10 computed seasons. driver_id confirmed global across series (Larson: 327 Cup + 34 Xfinity starts, one id). Zero unknown track types after the ~10-track audit; added Dirt as a track-explorer segment and widened its default window to the loop era so sparse types populate. Xfinity race 5436 added to the points overrides (broken feed, loop-only), mirroring Cup's 5580. Series switcher (Cup/Xfinity/Trucks) threaded through every page, query, link, and the JSON API; verified in-browser across all three series. 94 tests green.

## Goal

Extend the platform from Cup-only to all three national series (Cup, Xfinity, Trucks), with a series switcher in the UI so a fan can flip between them. The ingestion/analytics pipeline is already parameterized by `series_id`; this is mostly data + a UI navigation axis, not new architecture.

## Live verification (2026-07-05, payloads not status codes)

Probed the CDN for series 2 (Xfinity) and 3 (Trucks). Schedules serve 2016+ for both. Per-race coverage:

| Data | Cup (series 1) | Xfinity (series 2) | Trucks (series 3) |
|------|----------------|--------------------|-------------------|
| Results (weekend-feed) | 2017+ | **2017+** | **2017+** |
| Loop stats | 2019+ | **2019+** | **2018+** (one bonus year) |
| Lap times | 2020+ | **2020+** | **2020+** |

Loop data (Driver Rating, pass counts, closing positions) **is** produced for all three series — so the proprietary metrics (adjusted pass efficiency, closer score) work for Xfinity and Trucks, not just Cup. Season-opening/exhibition races return empty loop bodies in every series; the existing backfill already records those as misses and moves on.

Note: the loopstats feed is a JSON **array** of race objects (`[{race_id, drivers:[…]}]`) — an initial probe that assumed a dict object under-counted. Confirmed against the array shape.

## Work

### 1. Config — track types + loop boundary
- Add the ~10 track_ids that appear in Xfinity/Truck schedules but not the Cup-curated `TRACK_TYPES` map:
  - `47` Lucas Oil Indianapolis Raceway Park → short
  - `51` The Milwaukee Mile → short (flat mile, per existing convention)
  - `72` Mid-Ohio Sports Car Course → road
  - `175` Rockingham Speedway → short (1.017mi, under the 1.25mi intermediate threshold)
  - `204` Portland International Raceway → road
  - `208` Eldora Speedway → dirt
  - `209` Canadian Tire Motorsport Park (Mosport) → road
  - `215` Knoxville Raceway → dirt
  - `220` Lime Rock Park → road
  - `222` Grand Prix of St. Petersburg → road (street)
- Make `loopStatsExpected(season, seriesId)` series-aware: Trucks (series 3) 2018+, others 2019+. Captures the bonus Trucks 2018 loop season.

### 2. Backfill + compute
- `bun run backfill --series 2` and `--series 3` (2017→2026). Idempotent, rate-limited, raw-archived like Cup.
- Verify `driver_id` is global across series (a Cup regular keeps the same id in an Xfinity start) — the `drivers` table is keyed by global driver_id; per-series stats stay separated by `series_id`. If IDs turn out to be per-series, add a series column to identity handling (not expected).
- `bun run compute --series 2` and `--series 3`.
- Sanity-check standings vs known champions (Xfinity: 2020 Cindric, 2023 Allmendinger-era leaders; Trucks: verify a couple of season win leaders).

### 3. UI — series switching
- **A segmented series switcher (CUP / XFINITY / TRUCKS) directly under the app bar**, distinct from the 5 section tabs (Home/Drivers/Races/Compare/Tracks) which are an orthogonal navigation axis. Series answers "which garage," section answers "which view."
- Selection carried in the URL as `?series=` (default Cup, shareable). A `withSeries(href)` helper threads it through the bottom tabs and internal links.
- Server routes, `layout.page`, and every page query take a `seriesId`. Race pages derive their series from the race row (race_id is globally unique); the switcher reflects it.
- Season pill shows the current series' latest season (each series computes its own `currentSeason`).

### 4. Verify + document
- Browser-check all three series (home, driver, race, compare, tracks).
- Update the published mockup artifact to show the series switcher so it's reviewable on mobile.
- `bun test` + `bunx tsc --noEmit` green; update ARCHITECTURE.md (Cup-only → 3 series), QUALITY_SCORE.md, DESIGN.md (series switcher component), PLANS.md, and move this plan to completed.

## Out of scope
- Cross-series comparison (comparing a Cup season to an Xfinity season) — compare stays within one series for now.
- Combined "all series" views.
- Driver career pages that merge a driver's Cup + Xfinity + Truck record into one timeline (future enhancement).

## Risks
| Risk | Mitigation |
|------|-----------|
| driver_id not global across series | Verify right after first Xfinity races land; add series-scoped identity only if needed |
| Unmapped track shows as "unknown" | Audited the full 2018–2026 Xfinity/Truck track list up front; `trackTypeFor` already falls back to "unknown" safely |
| Backfill volume (~2× more races + laps) | Same rate-limited, idempotent, raw-archived path as Cup; run in background |
