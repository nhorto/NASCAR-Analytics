# Spike — recomputing official loop-data metrics from lap timing

**Date:** 2026-09-07 · **Status:** experiment, documented (WS-C of the
[launch plan](../exec-plans/active/2026-09-07-production-and-paid-launch.md)).
**Script:** `bun scripts/spike-loop-from-timing.ts [--season] [--series]`.
**Question:** if NASCAR's `loopstats` endpoint closed, could we keep the
proprietary metrics alive from per-lap timing (`lap_times` + `cautions`) —
which has a licensed vendor path (Sportradar) — as the data-risk analysis
hoped (productization review §5.1b)?

## Method

For every 2025 Cup points race carrying BOTH `lap_times` and `loop_stats`
(35 races, 1,329 driver-races), recompute per-driver metrics from per-lap
`running_pos` + green/yellow state (caution segments), then measure agreement
with the official values: exact-match rate, within-±1 rate, mean absolute
error, Pearson r.

- Passes = net position gains between consecutive green laps (gaining 3 spots
  = 3 passes). Quality passes = the passed cars that ran in the top 15.
- Fast laps = fastest recorded time per **green** lap (empirically the
  official definition: counting yellow laps too overshoots by ~1.1/driver).
- Positions on lap 0 (the grid) are excluded from "laps completed".

## Results (2025 Cup, 35 races, n = 1,329 driver-races)

| Metric | Exact | ±1 | MAE | r | Verdict |
|---|---|---|---|---|---|
| laps | 90.9% | 92.6% | 0.46 | 1.000 | ✅ recoverable |
| lead_laps | 94.7% | 99.0% | 0.08 | 1.000 | ✅ recoverable |
| top15_laps | 82.0% | 94.1% | 0.36 | 1.000 | ✅ recoverable |
| avg_ps | 86.9% | 89.4% | 0.88 | 0.925 | ✅ close (official uses mid-lap scoring loops) |
| fast_laps | 57.7% | 82.5% | 0.78 | 0.990 | 🟡 close with the green-only definition |
| passes_gf | 0.8% | 2.1% | 62.4 | 0.872 | ❌ undercounts ~2× |
| passed_gf | 0.5% | 1.2% | 63.8 | 0.853 | ❌ undercounts ~2× |
| quality_passes | 16.4% | 24.6% | 21.2 | 0.848 | ❌ same cause |
| **pass efficiency** (passes ÷ (passes+passed)) | — | — | **0.045** (ratio) | 0.801 | 🟡 usable as a labeled estimate |

## What this means

1. **Position-derived metrics are fully recoverable** (laps, lead laps,
   top-15 laps ~exact; average running position within ~0.9 of the official
   scoring-loop version). Anything we build on those survives a loopstats
   loss with any per-lap timing source.
2. **Raw pass counts are NOT recoverable from per-lap data.** Official loop
   data samples multiple scoring loops per lap; passes made and unmade within
   one lap are invisible to lap-boundary positions. We see roughly half the
   official volume (e.g. Vegas: mean 42.6 computed vs 93.4 official). No
   per-lap method can close that — it's a data-resolution floor, not a bug.
3. **The ratio our adjPE metric actually consumes survives.** Pass
   *efficiency* divides two same-scale undercounts: mean absolute error is
   4.5 points of efficiency (r = 0.80, n = 1,305 with ≥10 pass events on both
   sides). Good enough for a **clearly-labeled "estimated" degraded mode** of
   adjPE, not for silently substituting official numbers.
4. Closer Score inputs (closing-position deltas) are position-derived and
   were not separately scored here; by construction they fall in bucket 1.
   Driver Rating is NASCAR's proprietary formula and is simply gone without
   loopstats — never promised otherwise.

## Decision (per the WS-C promotion bar)

The >95% bar is met only for the position-derived metrics — so this ships as
a documented experiment, **not** a production path (as the plan default). The
feed-loss posture it buys: in a loopstats-only outage we can keep most of the
loop-insights surface alive from lap timing (which `nascaR.data` does NOT
carry, but Sportradar licenses), with pass-based metrics flagged as estimates
and Driver Rating dropped. Wiring that degraded mode is post-launch backlog.
