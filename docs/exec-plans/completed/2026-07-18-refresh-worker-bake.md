# Wire the Worker Bake + Deploy into `bun run refresh`

**Status:** COMPLETED 2026-07-18
**Started:** 2026-07-18
**Resolves tech debt:** "Baked Worker artifacts (baselines + track-strategy) go stale on refresh" (Medium, live/worker)

## Problem

`bun run refresh` (the weekly CI loop) backfills, computes, exports, and deploys
the static site — but NOT the live Worker. `worker/baselines.ts` and
`worker/track-strategy.ts` are generated bakes, so every weekly refresh made the
deployed live metrics (adjPE / Closer baselines, strategy calibration) drift
stale until someone manually re-ran the generators and `wrangler deploy`.

## Plan

1. **`scripts/calibrate-strategy.ts` self-gates on data coverage.** The strategy
   calibration needs the historical raw `weekend-feed.json` pit archives, which
   exist only where the full backfill ran (locally). CI's cache keeps only the
   DB, so a CI calibrate run would see ≤ a handful of races and bake a garbage
   (near-empty) table over the good one. Add `--min-pit-races` (default 10):
   below the floor, warn and exit 0 **without writing anything** — the committed
   bake stays authoritative. Local runs (100+ races with pit data) are unaffected.
2. **`refresh` regenerates the bakes after export:**
   - `bun run scripts/gen-worker-baselines.ts` — always runs; reads the
     `dist/data/baselines-{1,2,3}.json` the export just emitted (DB-only, so it
     is always fresh, on CI too). This is the part that actually drifts weekly.
   - `bun run scripts/calibrate-strategy.ts --series 1|2|3` — runs everywhere,
     self-gates per (1). Fresh on local runs, no-op on CI.
3. **`refresh` deploys the Worker** after the Pages deploy, behind the same
   `CLOUDFLARE_API_TOKEN` gate (and skipped by `--no-deploy`):
   `bunx wrangler deploy` with cwd `worker/`.

No workflow-file change needed — CI already just calls `bun run refresh`.

## Consequence / residual

- Weekly baseline drift is fully closed once the CI secrets are added.
- Strategy calibration refreshes only when `refresh` runs where the raw pit
  archives live (owner's machine). It aggregates 2017+ history, so it moves
  slowly; the committed bake staying a few weeks old is acceptable. Logged in
  the tracker as a Low residual.

## Verify

- `bun test` green (incl. architecture tests).
- `bun run refresh --no-deploy` locally-in-CI-conditions (no raw archives):
  calibrate skips, baselines regenerate, nothing garbage-baked.
