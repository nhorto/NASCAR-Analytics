# NASCAR Data Sources — Re-verification (2026-07-05)

Re-verification of the sources documented in [2026-03-22_nascar-data-sources-verified.md](2026-03-22_nascar-data-sources-verified.md), performed by hitting live endpoints on 2026-07-05 (20 of 36 points races complete; most recent race tested: Sonoma, 2026-06-28, race_id 5617).

**Bottom line: the primary data pipeline (NASCAR public CDN) is fully operational and serving 2026 data. One material error found in the old research: The Odds API does NOT cover NASCAR.**

---

## NASCAR Public CDN — CONFIRMED WORKING (2026 season data flowing)

All tested with real requests, no auth, no API key.

### Season-level endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `cf.nascar.com/cacher/{year}/1/schedule-feed.json` | ✅ 200 | Full 2026 schedule: 107 events, 36 points races, race_ids, track names, start times (local + UTC), run_type (1=practice, 2=qualifying, 3=race) |
| `cf.nascar.com/cacher/live/live-feed.json` | ✅ 200 | Live race feed (89KB at test time) |

### Per-race endpoints (tested against 2026 race_id 5617, Sonoma)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `cacher/{year}/1/{race_id}/weekend-feed.json` | ✅ 200 | Results, entries (59KB) |
| `cacher/{year}/1/{race_id}/lap-times.json` | ✅ 200 | **Lap-by-lap times for every driver** (262KB) |
| `cacher/{year}/1/{race_id}/lap-averages.json` | ✅ 200 | Aggregated lap performance (15KB) |
| `cacher/{year}/1/{race_id}/live-pit-data.json` | ✅ 200 | Pit stop data (114KB) |
| `cf.nascar.com/loopstats/prod/{year}/1/{race_id}.json` | ✅ 200 | **Full loop data** (see below) |
| `cacher/{year}/1/{race_id}/pit-stops.json` | ❌ 403 | Use live-pit-data.json instead |
| `cacher/{year}/1/{race_id}/live-feed.json` | ❌ 403 | Per-race live feed blocked; season-level live-feed.json works |
| `cacher/{year}/1/{race_id}/raceStageData.json` | ❌ 403 | Path may be wrong or restricted |

### Loop data schema (loopstats endpoint, verified)

Per-driver fields: `driver_id`, `start_ps`, `mid_ps`, `ps` (finish), `closing_ps`, `closing_laps_diff`, `best_ps`, `worst_ps`, `avg_ps`, `passes_gf`, `passing_diff`, `passed_gf`, `quality_passes`, `fast_laps`, `top15_laps`, `lead_laps`, `laps`, `rating` (Driver Rating). Race-level: `race_id`, `race_name`, `series_id`, `sch_laps`, `act_laps`.

This is the complete official loop data set — everything the old research hoped for, direct from the CDN.

### Historical coverage boundaries

> **REVISED after full backfill ingestion (2026-07-05).** The initial probe checked HTTP status codes only; the actual ingestion revealed that some older endpoints return **HTTP 200 with a literal `null` body**. Payload-verified boundaries:

| Data | Coverage on CDN | Notes |
|------|----------------|-------|
| Schedule feeds | **2016 → present** | 2015 and earlier: 403. 2016–2018 feeds have `start_time_utc: null` (local `start_time` only) |
| weekend-feed (results) | **2017 → present** | 2016 per-race feeds all 403 (schedule exists, race data doesn't) |
| loopstats (loop data) | **2019 → present** | 2016–2017: HTTP 200 but body is `null`; 2018: 403 |
| lap-times (lap-by-lap) | **2020 → present** | 2016–2019: 403 |

Known holes found during ingestion (raw responses archived as proof):
- **2025 YellaWood 500 (race 5580)**: weekend-feed returns 200 with `weekend_race: null` — the one missing points-race result in 2017–2026. Its loop stats and lap times ARE available; official results recoverable from nascaR.data if needed.
- **Exhibition heat races** (Clash heats, All-Star heats/Open): often no weekend-feed; some have lap times anyway.
- **On-track vs official**: loop stats record on-track finish; results record official rulings (verified via the 2022 Pocono Hamlin/Kyle Busch DQ — results show Chase Elliott P1, loop stats show Hamlin P1, DQ flags correct).

**Implication:** The March research's "20 years of loop data (2005+)" is NOT available via the CDN — that depth exists only on Racing-Reference (Cloudflare-blocked to bots). The CDN gives ~7.5 seasons of loop data and ~6.5 seasons of lap-by-lap, fully covering the Next Gen car era (2022+) — the most analytically relevant era anyway. Deeper history (results only, 1949+) is available via nascaR.data.

**Process lesson:** verify CDN coverage against payloads, not status codes — this CDN serves `null`/empty bodies with HTTP 200 for some missing data.

---

## Supplementary sources — status check

| Source | Status 2026-07-05 | Notes |
|--------|-------------------|-------|
| nascaR.data (CRAN) | ✅ Actively maintained | v3.1.0, published 2026-06-11. Results 1949+ |
| pynascar (PyPI) | ⚠️ Stagnant | Still v0.2.1 (Aug 2025). Largely obsoleted by using the CDN directly |
| feed.nascar.com (official API) | 🔒 Unchanged | Swagger UI up (200); data endpoints remain partner-locked |
| Racing-Reference | 🔒 Unchanged | 403 to programmatic requests (Cloudflare), browser-only |
| DriverAverages.com | ✅ Up | 200 |

## Competitor liveness (quick check — see competitive refresh doc for detail)

Lap Raptor (200), Win The Race (200), FRCS.pro (200) — all still operating as of today.

---

## ⚠️ CORRECTION TO PRIOR RESEARCH: The Odds API does not cover NASCAR

The March research (and ARCHITECTURE.md) assumed The Odds API (~$50/mo) as the betting odds source. **Verified 2026-07-05: their sports coverage list includes golf, MMA, etc. but zero motorsports — no NASCAR, no racing of any kind.** The odds domain cannot be built on The Odds API. Alternatives research: see [2026-07-05_odds-sources.md](2026-07-05_odds-sources.md). Competitive landscape refresh: see [2026-07-05_competitive-refresh.md](2026-07-05_competitive-refresh.md).

---

## Risk note: the CDN is unofficial

`cf.nascar.com/cacher` has no published terms for third-party use and no SLA. It has been stable for years (fan sites appear to be built on it) but NASCAR could restrict or restructure it at any time. Mitigation, per core belief #7 ("the database is the product"): **archive every raw JSON response at ingestion time** so the historical dataset survives any future access change.
