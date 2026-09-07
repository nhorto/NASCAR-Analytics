# WS-F: Predictions and DFS — implementation plan

**Status:** ACTIVE — build detail for the launch plan's WS-F (weeks 5–6),
started 2026-09-07 (WS-D done; WS-E blocked on the owner's Stripe account, so
the schedule pulls WS-F forward — it needs no owner accounts).
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-F.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md) §9
(product-level definition of the model, the honesty bar, and DFS-as-config).

## Shape

One new domain plus app wiring:

- **`src/domains/predictions/`** — per-driver per-race features (point-in-time,
  strictly-prior races only), a rating, a finishing-order Monte Carlo
  simulation with track-type-calibrated variance, DFS scoring as pure
  functions over config, and repo-owned `race_predictions` +
  `dfs_projections` tables.
- **App** — `bun run predict` CLI (defaults to the next scheduled points race
  without results), Thursday/Saturday in-process crons (same
  spawn-the-CLI pattern as refresh/canary), `/predictions` + `/dfs` +
  `/predictions/methodology` pages with generation stamps and the free
  top-three teaser, print stylesheet for the cheat sheet.
- **Backtest** — `bun run backtest:predictions`: calibrates weights/variance
  on 2022–2024, evaluates once on held-out 2025, writes the report to
  `docs/research/`.

## Decisions taken here (within spec bounds)

- **Point-in-time features, computed in-domain.** `driver_form` includes the
  race it's attached to (verified in analytics service — window is
  `slice(i-5, i+1)`), so reusing it for prediction would leak the outcome.
  The predictions repo reads raw race logs and builds features from races
  **strictly before** the target race: trailing-5 avg finish, trailing-10
  avg loop rating, career track-type avg finish (capped lookback), trailing-
  season DNF rate, and start position when available. Rookie/short-history
  drivers get field-relative defaults plus extra variance.
- **Two stages, matching the spec's cadence:** `thursday` (no qualifying —
  expected start = trailing avg start) and `saturday` (actual starting
  position). "Locked at green flag" is just "the Saturday run is the last
  one"; no live-feed integration in v1. Post-race, the page joins the stored
  prediction against actual results (predicted vs actual).
- **Entry list heuristic:** drivers with a result in any of the series' last
  3 completed points races (the CDN entry-list feed is not ingested; the
  heuristic is honest for Cup regulars and documented on the methodology
  page; a real entry-list source is logged as tech debt).
- **Simulation:** each run draws `score_i = rating_i + N(0, σ_tracktype)`
  (deterministic seeded PRNG — mulberry32 + Box-Muller), sorts to a
  finishing order; published probabilities are simulation frequencies over
  5,000 runs. Expected laps led / fastest laps allocate the race's lap count
  by a propensity blending prior laps-led share with simulated win/top-5
  odds.
- **Baselines for the honesty bar:** (a) uniform (`k/n` for top-k), and
  (b) the **same simulation machinery** with rating = trailing-5 avg finish
  alone — a strong, fair "trailing-5" baseline expressed in probabilities
  so Brier applies to all three.
- **Train/eval split:** calibrate weights + σ on 2022–2024 (Next Gen era;
  earlier seasons still feed *features*), evaluate exactly once on held-out
  2025. Report Brier (win/top5/top10) vs both baselines + a calibration
  table (±5 pts on bins with ≥30 samples per acceptance).
- **DFS scoring is config, not code:** `config/dfs/dk.json` +
  `config/dfs/fd.json` at the **repo root** (a domain `config.ts` cannot
  import JSON without breaking the architecture scanner, and root-level
  config matches "a rule change is a config edit"). The service validates
  shape (`parseScoringRules`) and scores purely:
  finish-position table + laps-led/lap + fastest-laps/lap + place
  differential × (start − finish). ⚠ The point values are written from
  documented DK/FD rules but MUST be verified against the live platforms
  before launch weekend (owner + the two recruited DFS players; tech debt).
- **Gating (spec §8):** `/predictions` free view = top three rows + count of
  hidden rows blurred + upgrade CTA; Pro = full table. `/dfs` is Pro-only
  (feature gate; free sees the locked card). Cup only at launch (D16):
  `/xfinity/predictions` etc. fall under the existing series teaser for
  non-Pro and show a "Cup at launch" note for Pro.
- **Crons:** Thursday 16:00 UTC (form run) + Saturday 22:00 UTC (post-quals
  run), `ENABLE_PREDICTIONS_CRON=1`, spawning `bun … predict` so model work
  never blocks the event loop. No advisory lock needed (idempotent upsert;
  last write wins), matching the canary pattern.
- **Worktree data:** the local db had only 2025–2026 (WS-C testing);
  a Cup 2019–2024 backfill runs during this build so calibration/backtest
  use the real history. σ/weights land in `config.ts` with provenance
  comments; re-derivable via the backtest CLI's `--calibrate` mode.

## Build checklist

- [x] Schema: `race_predictions`, `dfs_projections`
- [x] `domains/predictions` types/config/repo/service (+ barrel)
- [x] `config/dfs/dk.json` + `fd.json` (+ shape validation)
- [x] CLI: `predict [--race ID] [--stage thursday|saturday]` — smoke-run
      against the real db (Thursday for the 2026-09-13 Gateway race,
      Saturday replay of the Southern 500: Bell/Reddick correctly top-4)
- [x] Scheduler: Thursday + Saturday crons behind `ENABLE_PREDICTIONS_CRON`
- [x] Pages: `/predictions` (stamp, free top-3 teaser, post-race
      predicted-vs-actual), `/dfs` (DK/FD toggle, print cheat sheet),
      `/predictions/methodology`
- [x] Backtest CLI + calibration; report in
      [docs/research/2026-09-07_predictions-backtest.md](../../research/2026-09-07_predictions-backtest.md)
- [x] Tests: pure model (determinism, probability sums, monotonicity,
      leakage guard), DFS hand-computed examples per rule (negative:
      malformed config), e2e generate→page flows incl. gating
- [x] Docs: ARCHITECTURE, QUALITY_SCORE, tech-debt, launch plan boxes,
      PLANS.md

## Acceptance mapping (launch plan WS-F)

- Model beats both baselines on held-out 2025 by Brier; calibration ±5 pts
  (bins ≥30 samples) → backtest report.
- Cron produces Thursday + Saturday runs without manual steps → scheduler
  tests + a real `predict` run against the next 2026 race. (The "real
  weekend" observation is inherently a calendar item; the mechanism is
  verified now.)
- DK/FD projections reproduce a hand-computed example per rule → exact-value
  unit tests.

## Findings (2026-09-07)

- **Honesty bar: PASS on held-out 2025.** Saturday model Brier: win 0.02547
  (vs trailing-5 0.02683, uniform 0.02560), top5 0.1039 (vs 0.1158/0.1142),
  top10 0.1731 (vs 0.1945/0.1937). Calibration: 6/7 bins inside ±5; the
  60–70% bin (n=39) misses by 0.2 pts — within one standard error (±7.6).
- The Thursday form-only run **loses to uniform on win Brier** (0.02603 vs
  0.02560) while beating both baselines on top5/top10 — qualifying carries
  real win signal; the methodology page says so ("win odds firm up after
  qualifying").
- Future schedule rows carry `race_type_id NULL` (type arrives with the
  weekend feed), so the next-race query treats unknown types as points races.
- Worktree db was backfilled with Cup 2019–2024 for calibration; one hole
  (race 5260, 2023) has no results — excluded automatically.

## Remaining (owner/calendar-gated)

- Observe the Thursday + Saturday crons over a real race weekend on the
  deployed server (acceptance box 2) — needs A2/Fly deploy.
- Validate the DK/FD point values in `config/dfs/*.json` with the two
  recruited DFS players before launch weekend (tech-debt logged).
