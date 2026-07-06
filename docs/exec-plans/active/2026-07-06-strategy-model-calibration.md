# Strategy Model Calibration — Tire / Fuel / Pit (from backfill)

**Status:** ACTIVE — Phase 1 (pure logic) + the cheap win landed in this PR; the calibration RUN + Phases 2–4 are local follow-ups.
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
