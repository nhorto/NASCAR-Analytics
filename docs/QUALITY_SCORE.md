# Quality Score

> Grades each domain and architectural layer. Updated as the project evolves.

## Domain Grades

| Domain | Types | Config | Repo | Service | Overall |
|--------|-------|--------|------|---------|---------|
| data-ingestion | A | A | B | B | **B+** (2026-07-05: pipeline works, tested, verified vs real data; all 3 national series backfilled; no scheduled automation) |
| analytics | A | A | B | B | **B+** (2026-07-05: metric math unit-tested, e2e compute tested, output verified vs known history; expectations are league-wide buckets — not yet era/track-type-adjusted) |
| drivers | A | A | B | B | **B+** (2026-07-05: summaries/race log/lookup + cross-series career (unit + e2e) tested; identity verified stable; no headshots/bio metadata) |
| web app (app layer + runtimes) | — | — | — | B | **B** (2026-07-05: e2e route tests incl. series switching + metrics leaderboards, in-browser verified across all 3 series, <60ms renders; proprietary metrics now surfaced via `/metrics` + profile rank context; single-column layout only, placeholder wordmark) |
| live (Workers-safe domain + edge DO) | A | A | — | B | **B+** (2026-07-06: pure domain fully unit-tested and Workers-portable; deployed edge DO + main-site `/live`. Strategy model calibrated from the backfill and **held-out backtested** — per-track pit-cadence prediction is 60% lower MAE than the flat baseline (6.0 vs 15.0 laps, ±10 laps for 86% of held-out stints); tire severity validated by cross-series face-validity ordering. Gaps: metrics are live-counter estimates (no post-race authoritative swap), baked artifacts go stale until a manual recalibrate+redeploy, DO stops when unwatched, intermediate-track cadence MAE ~10 laps) |
| odds | — | — | — | — | Deferred (no viable odds source) |

## Scoring Criteria

- **A**: Complete, tested, documented, enforced
- **B**: Functional, mostly tested, some gaps
- **C**: Works but has known issues or missing tests
- **D**: Incomplete or has architectural violations
- **F**: Missing or broken
