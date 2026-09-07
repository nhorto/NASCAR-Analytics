# Predictions backtest — held-out 2025 (WS-F honesty bar)

**Date:** 2026-09-07 · **CLI:** `bun run backtest:predictions` ·
**Model:** `src/domains/predictions/` (spec §9)

## Protocol

- **Features are strictly point-in-time**: every input to a race's prediction
  comes from races dated before it (trailing-5 finish, trailing-10 loop
  rating, track-type history, trailing-20 DNF rate, starting position).
  `driver_form` was deliberately NOT reused — its window includes the race
  it's attached to.
- **Train:** 2022–2024 Cup points races (Next Gen era) — used to fit the
  loop-rating→finish map (least squares, n=3878), the per-track-type
  simulation σ, and the rating weights (coarse grid, Brier objective).
  Earlier seasons feed feature history only.
- **Eval:** 2025, evaluated exactly once with the frozen config
  (36 points races, 1,316 scored driver-races, 96.1% of actual finishers
  covered by the entry heuristic).
- **Baselines:** uniform (k/n), and **trailing-5 average finish pushed
  through the same simulation machinery** — so the comparison isolates the
  rating, not the probability plumbing.

## Results (Brier, lower is better)

| Model | Win | Top 5 | Top 10 |
|---|---|---|---|
| **Model, Saturday (with qualifying)** | **0.02547** | **0.1039** | **0.1731** |
| Model, Thursday (form only) | 0.02603 | 0.1078 | 0.1755 |
| Baseline: trailing-5 (same sim) | 0.02683 | 0.1158 | 0.1945 |
| Baseline: uniform | 0.02560 | 0.1142 | 0.1937 |

**The published (Saturday) model beats both baselines on all three events —
the honesty bar passes.** Two honest footnotes:

1. The win-probability margin over *uniform* is thin (0.02547 vs 0.02560):
   winning a Cup race is rare and shocks (superspeedways, late cautions) are
   huge, so "everyone 1-in-38" is genuinely hard to beat. The margin over the
   informed trailing-5 baseline is comfortable, and top-5/top-10 margins are
   large (-10% / -11% Brier vs both baselines).
2. The **Thursday (form-only) model loses to uniform on win Brier**
   (0.02603 vs 0.02560) while still crushing both baselines on top-5/top-10.
   Qualifying carries real win signal. The product's Thursday page should
   carry the model-confidence note the spec asks for ("win odds firm up
   after qualifying"); the Saturday run is the one the bar is judged on.

## Calibration (Saturday model, pooled win/top-5/top-10)

| Bin | n | Predicted | Actual | \|gap\| |
|---|---|---|---|---|
| 0–10% | 2112 | 3.5% | 3.2% | 0.2 |
| 10–20% | 743 | 14.5% | 14.9% | 0.4 |
| 20–30% | 483 | 24.6% | 27.1% | 2.5 |
| 30–40% | 291 | 34.7% | 36.4% | 1.7 |
| 40–50% | 196 | 44.4% | 43.4% | 1.0 |
| 50–60% | 84 | 54.1% | 53.6% | 0.6 |
| 60–70% | 39 | 64.0% | 69.2% | **5.2** |

Six of seven bins are inside the spec's ±5-point band. The seventh (60–70%,
n=39) misses by 0.2 points — with 39 samples the standard error of the
empirical frequency is ±7.6 points, so the miss is statistically
indistinguishable from zero; if anything the model is slightly *under*-
confident on its strongest calls. Recorded as-is; re-check when a second
held-out season exists.

## Calibrated settings (provenance for config.ts)

- `LOOP_RATING_MAP = {a: 33.7, b: 0.212}` — least squares, trailing-10
  rating vs next-race finish, 2022–2024, n=3878.
- `SIGMA_BY_TRACK_TYPE` — base grid: σ shifts of ±2 positions around the
  prior; optimum at superspeedway 12.5 / intermediate 9.0 / short 9.0 /
  road 8.0 / dirt 10.0.
- `WEIGHTS = {trailingFinish 0.15, trackTypeFinish 0.10, loopRating 0.50,
  startPos 0.25, dnfPenalty 6}` — grid winners on train Brier; deltas
  between the top few variants were < 0.5% (noise-level), so the simplest
  strong setting was kept rather than chasing fourth-decimal wins.

## Reproduce

```
bun run backtest:predictions                # held-out 2025 eval
bun run backtest:predictions --calibrate    # re-derive σ/weights (train only)
bun run backtest:predictions --seasons 2023 # sanity on a train year
```
