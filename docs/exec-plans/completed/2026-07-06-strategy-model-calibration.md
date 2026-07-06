# Strategy Model Calibration — Tire / Fuel / Pit (from backfill)

**Status:** COMPLETE (2026-07-06) — Phases 1–4 done + deployed. The within-stint OLS falloff was replaced with the pit-discontinuity method, the fuel-window reframed to a behavioral typical-run, and the pit-cadence prediction **held-out backtested** (see below). The within-stint OLS falloff was validated as broken and the new model validated against real data.
**Started:** 2026-07-06
**Research:** [docs/research/2026-07-06_tire-fuel-strategy-data-and-modeling.md](../../research/2026-07-06_tire-fuel-strategy-data-and-modeling.md)
**Spike:** run 2026-07-06 against `tests/fixtures/live-pit-data.json` (see Findings)

## Implementation status (read this first if you're the local agent)

**Done in this PR (cloud session — no CDN/backfill access, so pure logic + tests only):**
- **Pure calibration functions** in `src/domains/live/service.ts`, Workers-safe & unit-tested
  against the real pit fixture: `pitStopsFromLivePitData`, `reconstructStints`,
  `greenStintLengths`, `fitFalloff`, `median`. New types (`NormalizedPitStop`, `Stint`,
  `TrackStrategy`, `TrackStrategyTable`) + config (`MIN_GREEN_STINT_LAPS`,
  `MIN_GREEN_STINT_SAMPLES`, `MIN_FALLOFF_SAMPLES`, `PIT_FLAG_GREEN`).
- **Cheap win — real pit feed wired into the live model.** `pitCycleModel` now takes
  `{ pitStops, feed, trackStrategy }`: it prefers `live-pit-data.json` (green-flag stops only)
  over the placeholder-zeroed `live-feed` `pit_stops`, adds a `lapsOfFuelLeft` estimate, and
  reads the per-track fuel window from calibration. The worker fetches `live-pit-data.json`
  (`fetchPitStops`) and passes it through `processFeed`.
- **Calibration harness** `scripts/calibrate-strategy.ts` (`bun run calibrate`) — reads the
  backfill DB (`lap_times`, `cautions`, `results`, `races`) + archived `weekend-feed.json`
  `pit_reports`, runs the pure functions, aggregates per track / track-type, writes
  `dist/data/track-strategy-{series}.json` and regenerates `worker/track-strategy.ts`.
- **`worker/track-strategy.ts`** checked in as an EMPTY stub → the live model falls back to
  `DEFAULT_STINT_LAPS` until calibration is run. Correct, just uncalibrated.
- 184 tests pass; root + worker + scripts typecheck clean.

**TODO locally (needs the CDN + backfill this cloud env can't reach):**
1. **Run the real spike/calibration:** `bun run backfill` (if needed) → `bun run calibrate --series 1`
   (then 2, 3). Confirm the `pit_reports` key names in `pitStopsFromWeekendPitReports()` actually
   parse (the repo fixture's `pit_reports` is empty, so that adapter is UNVALIDATED — if it logs
   "0 races had parseable pit_reports", fix the key list). Sanity-check the emitted per-track fuel
   windows against known values (e.g. Talladega ~45).
2. **Validate the falloff fit** separates tire from fuel (see the arXiv 2512.00640 lead) — the
   current single-run OLS slope conflates them; this is the real modeling work (Phase 1 finish).
3. Redeploy the worker with the regenerated `track-strategy.ts`; then Phases 2–4 (UI honesty,
   backtest).

## Local validation + rebuild (2026-07-05, local session — CDN + backfill reachable)

Ran the calibration and the two flagged validations against the real 298 MB backfill
(`data/nascar.db`) + 909 archived `weekend-feed.json`. Both TODOs resolved; findings forced a
model reframe (below). **This is the "full rebuild" the user approved.**

### TODO 1 — adapter parses; but the fuel-window ESTIMATOR is wrong
- `pitStopsFromWeekendPitReports()` **parses fine** — 256/909 archives carry non-empty
  `pit_reports` (keys `vehicle_number`, `lap_count`, `pit_in_flag_status`, `*_tire_changed`).
  Cup run: 107 races, 39,477 stops. No key-list fix needed. (There is **no `driver_id`** in
  `pit_reports` — only `driver_name` — but the falloff join uses `results.car_number → driver_id`,
  so that's fine.)
- **But `greenStintLaps = median(clean green stints)` badly under-reads a physical fuel window**
  at caution/tire tracks: Bristol 67 (real ~125), Martinsville 55 (~145), Richmond 48 (~105) —
  while intermediates land close (Kansas 48, Charlotte 48, Michigan 49). Percentile sweep showed a
  physical fuel *capacity* is **not cleanly recoverable**: under-observed where cars pit for tires
  before fuel (Richmond max green run = 67 « 105; Talladega = 36 « 48), and over-counted where
  reconstruction merges across a missed stop (Kansas/Charlotte/Texas p90 = 68–74 on a ~50-lap tank
  — physically impossible). **Reframe:** ship the median as **`typicalStintLaps`** — the honest
  *behavioral* number ("cars here pit every ~N green laps," fuel OR tires OR strategy). It's what
  the live "due to pit ~lap Y" prediction actually needs. Drop the fabricated `lapsOfFuelLeft`
  fuel-exhaustion math → **`lapsToTypicalPit`**.

### TODO 2 — the within-stint OLS falloff is broken; pit-discontinuity works
Within one uninterrupted green stint, tire-age and fuel-age are **perfectly collinear**
(both = lapsIntoStint), so OLS can't separate them and the median-across-stints in the PR does
**not** remove a *systematic* fuel-burn bias. Measured net slope (current method) vs. the
**pit-discontinuity** signal (mean last-3 green laps before a green 4-tire stop − mean laps 3–6
after; + = worn slower than fresh):

| Track | (A) within-stint OLS *(PR)* | (B) pit-discontinuity |
|---|---|---|
| Darlington (eats tires) | −0.347 ❌ *tires "improve"* | **+1.89** ✅ highest |
| Richmond (abrasive short) | −0.179 ❌ | **+1.35** ✅ |
| Watkins Glen (road) | −0.833 ❌ | **+0.79** ✅ |
| Las Vegas (intermediate) | +0.018 | **+0.70** ✅ |
| Talladega (draft, tires ~n/a) | −0.032 | **+0.19** ✅ lowest |

(B) orders all five **exactly** as real-world tire knowledge predicts, on huge n (1,425 stops at
Darlington). → **Replace `fitFalloff` with the discontinuity method:** per-track
`tireSeconds = median(worn−fresh)`, `tirePerLap = tireSeconds / typicalStintLaps`, and a
`tireTier` (high/moderate/low) for UI honesty (suppress tire narrative at draft tracks).

### Rebuild scope (this session)
- **types:** `TrackStrategy` → `{ typicalStintLaps, stintN, tireSeconds, tirePerLap, tireTier,
  tireN, races }`; `PitCyclePrediction.lapsOfFuelLeft` → `lapsToTypicalPit`; add `trackStrategy`
  to `LivePayload`.
- **config:** drop `MIN_FALLOFF_SAMPLES`; add `MIN_TIRE_SAMPLES`, `TIRE_TIER_HIGH/MODERATE`.
- **service (pure):** remove `fitFalloff`/`FalloffFit`; add `tireDropForStop(pitLap, ctx)` +
  `tireTierOf(sec)`; `pitCycleModel` uses `typicalStintLaps` + emits `lapsToTypicalPit`.
- **calibrate script:** median typical-run + discontinuity tire extraction + tiers; new artifact shape.
- **worker:** regenerate `track-strategy.ts` (all 3 series), thread `trackStrategy` into the payload.
- **UI:** Strategy tab shows the per-track tire tier + typical-run window honestly; relabel the
  "Tire Falloff" card (live speed is an *observed* pace read, correctly kept).

### Landed + deployed (2026-07-06)
- Calibrated all 3 series (`bun run calibrate --series 1|2|3`) → `worker/track-strategy.ts`
  keyed by series (Cup 19 per-track + 5 type aggregates; Xfinity 17+4; Trucks 12+4). Tire tiers
  are cross-series consistent (Darlington/Homestead/Atlanta HIGH; Talladega/Daytona LOW) — a
  strong independent-data validation.
- **Live-reachability fix:** the live feed carries `track_id` but not track *type*, so the
  track-type fallback was unreachable for uncalibrated tracks (Chicagoland, Sonoma, Watkins Glen…).
  Baked a `typeByTrackId` map into the artifact so `strategyFor(series, trackId, null)` resolves
  the type itself. Verified live: `/api/live?series=1` now returns
  `trackStrategy {intermediate, moderate, 39-lap run}` for Chicagoland (track 39, type fallback).
- Deployed the worker (`looplab-live`, versions `250906e4` then `0985b84c` with the fix) and the
  Pages site (`dist/`, asset `1thz7ac`). Old deployed client ↔ new worker and new client ↔ old
  worker are both safe (the client ignores an absent `trackStrategy`; the payload only renamed an
  unused field), so the two deploys are independent.
- 185 tests pass; root + worker + scripts typecheck clean.

### Phase 4 — held-out backtest (done 2026-07-06)
`bun run backtest` (`scripts/backtest-strategy.ts`) — temporal split, **train seasons < 2022,
test 2022** (predict the newer season from older history; no leakage). Target: predict a car's
green-flag stint length (== next green pit lap). Full results:
[docs/research/2026-07-06_strategy-backtest.md](../../research/2026-07-06_strategy-backtest.md).

Headline (754 held-out stints, all series):

| Predictor | MAE (laps) | ±10 laps |
|---|---|---|
| flat40 (old constant) | 15.0 | 39% |
| global median | 13.1 | 50% |
| byType (per track type) | 6.5 | 81% |
| **byTrack (shipped)** | **6.0** | **86%** |

- **byTrack is 60% lower MAE than the flat-40 it replaced** (15.0 → 6.0) and 55% below a global
  median. Most of the gain is already at the track-*type* level (6.5); per-track refines it ~0.5.
- Best: superspeedway (MAE 3.5). Worst: intermediate (10.1 — widest strategy variance). The
  irreducible floor is real: teams pit early for track position + cautions, not just fuel/tires.
- Tire severity is validated by face-validity ordering (Darlington→Talladega, cross-series
  consistent), not a numeric backtest — there's no ground-truth tire-wear label to score against.

### Deliberately out of scope / notes
- A physical fuel *capacity* remains unmodeled (not cleanly recoverable — see the validation);
  `lapsToTypicalPit` is a behavioral cadence, not a fuel gauge. A true fuel-mileage feature would
  need fuel-mileage-race identification.
- Bristol reads LOW tire deg (small n, and modern concrete Bristol genuinely has little falloff
  most years) — correct for the typical race, but worth a note when a soft-tire compound is run.

## Problem

The live Strategy tab is the right *shape* but under-calibrated. It leans on one
fake constant — `DEFAULT_STINT_LAPS = 40` for every car at every track (`live/config.ts`) —
and draws raw `last_lap_speed` as if it were tire falloff. Research confirmed there is
**no feed** (free or licensed) that hands a third party live tire wear or fuel level, so
these must be **modeled from timing data** — and calibrated **per track from our own
historical backfill**, because published per-track tire tables were mostly wrong (refuted
in the research). This plan builds that calibration.

## What the spike proved (2026-07-06)

Ran the stint-reconstruction method on one real race (Cuervo 300, Chicagoland, 1.5mi, 201 laps):

- **The method works.** `live-pit-data.json` (the real pit feed — NOT the zeroed `pit_stops[]`
  in `live-feed.json`) reconstructed 181 stints across 38 cars, with green/caution separation
  from `pit_in_flag_status`, tire-change booleans, and stationary durations.
- **Direction confirmed:** longest clean green runs were **34–41 laps** — near the assumed 40,
  a plausible fuel window for a 1.5-mile track.
- **The real blocker:** only **3 of 181 stints (2%) were clean green-flag runs**; 165 ended under
  caution. **One race gives almost no fuel-window signal** → calibration must aggregate *many*
  races per track. That aggregation needs the full backfill, which only runs **locally** (this
  cloud session can't reach `cf.nascar.com`).
- **Tire-falloff regression is not offline-spikeable here:** it needs full-race lap-by-lap times
  (`lap-times.json` per race), absent from the repo fixtures.

## Goal

A batch-produced **`track-strategy.json`** artifact — baked into the worker alongside the
existing `baselines.json` — carrying, per track (with track-*type* fallback for thin data):

- **`greenStintLaps`** — empirical green-flag fuel window (median + spread).
- **`mpg` / `lapsPerTank`** — fuel model input, from green-flag run lengths and known tank size.
- **`falloffSlope`** — tire lap-time degradation (sec/lap) from green-run regression.

…then rewire the live model to use these instead of the flat 40 + raw-speed proxy, and make the
UI show it honestly (as an estimate, with weak-data tracks flagged).

## Phases

**Phase 1 — Calibration harness (LOCAL, on the backfill).** New offline batch step that, per
track across all available seasons: pulls each race's `live-pit-data.json` + `lap-times.json`,
extracts **clean green-flag stints** (the spike's method, generalized), fits a **tire-falloff
slope** per green run (lap time vs laps-since-pit, controlling for fuel-burn improvement), and
estimates **laps-per-tank/MPG**. Aggregates per track and per track-type. Emits
`track-strategy.json`. *Must run where the CDN is reachable — validate on ≥1 full track's history
before trusting a number.* Report coverage (how many clean green stints per track) — no silent
extrapolation from thin data.

**Phase 2 — Bake + wire into the live model.** Copy `track-strategy.json` into the worker (like
`baselines.ts`). Replace `DEFAULT_STINT_LAPS` lookups in `pitCycleModel` with the per-track
`greenStintLaps`; add a real **fuel-window** output (`lapsPerTank − lapsSinceGreenPit`); anchor
the falloff read to `falloffSlope`. Keep pure/Workers-safe. Unit-test against fixtures.

**Phase 3 — Real pit feed + honesty.** Switch the live pit source from the zeroed
`live-feed.json` `pit_stops[]` to **`live-pit-data.json`** (real lap numbers + flag status;
confirm live latency). Update the Strategy UI to label outputs as estimates, show a confidence/
coverage indicator, and suppress fake precision at tracks where the model is weak (e.g. drafting
superspeedways, where fuel-saving and the draft dominate).

**Phase 4 — Verify & document.** Backtest predicted vs actual green-flag pit laps on held-out
races; publish error bars. Update ARCHITECTURE.md, QUALITY_SCORE, move this plan to `completed/`.

## Risks / open decisions

- **Data volume:** the spike showed clean green stints are rare per race — need many races/track;
  thin-data tracks (road courses, new tracks) fall back to track-type aggregates.
- **Separating tire vs fuel in the falloff fit** is the hard modeling step (they oppose on lap
  time); the F1 state-space lead (arXiv 2512.00640) in the research is the method to try first.
- **Superspeedways:** fuel-saving + draft make both tire falloff and stint length weakly
  predictive — likely show fuel window only, not a tire model, there.
- **Environment:** Phase 1 is local-only (CDN egress). This session can build/validate the pure
  logic against fixtures but cannot run the full backfill.
