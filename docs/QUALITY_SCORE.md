# Quality Score

> Grades each domain and architectural layer. Updated as the project evolves.

## Domain Grades

| Domain | Types | Config | Repo | Service | Overall |
|--------|-------|--------|------|---------|---------|
| data-ingestion | A | A | B | B | **B+** (2026-07-05: pipeline works, tested, verified vs real data; all 3 national series backfilled; no scheduled automation) |
| analytics | A | A | B | B | **B+** (2026-07-05: metric math unit-tested, e2e compute tested, output verified vs known history; expectations are league-wide buckets — not yet era/track-type-adjusted) |
| drivers | A | A | B | B | **B+** (2026-07-05: summaries/race log/lookup + cross-series career (unit + e2e) tested; identity verified stable; no headshots/bio metadata) |
| web app (app layer + runtimes) | — | — | — | B+ | **B+** (2026-09-07: e2e route tests incl. series switching + metrics leaderboards, <60ms renders; production pipeline added per WS-B — env validation (fail-fast, negative-tested), request ids, JSON request logs, per-route cache control, CSP/HSTS/nosniff headers, gzip, `/health` incl. 503-on-unreadable-db test, in-process refresh cron with a TTL advisory lock (contention/takeover/failure paths tested). Gaps: not yet deployed (owner accounts pending), CSP still allows 'unsafe-inline' scripts, single-column layout, placeholder wordmark) |
| live (Workers-safe domain + edge DO) | A | A | — | B | **B+** (2026-08-07: pure domain fully unit-tested and Workers-portable; deployed edge DO + main-site `/live`. Strategy model calibrated from the backfill and **held-out backtested** — per-track pit-cadence prediction is 60% lower MAE than the flat baseline (6.0 vs 15.0 laps, ±10 laps for 86% of held-out stints); tire severity validated by cross-series face-validity ordering. Weekly refresh now regenerates/deploys both Worker artifacts and refuses an empty calibration; schedule canonicalization guards partially rolled feed identity. Gaps: full-race Phase 4 soak remains, metrics are live-counter estimates (no post-race authoritative swap), DO stops when unwatched, intermediate-track cadence MAE ~10 laps) |
| data-health (canary engine) | A | A | — | B+ | **B+** (2026-09-07: pure runner + validators fully unit-tested incl. HTTP/shape/transport classification and the real check list against captured fixtures; end-to-end `runCanary` tested with an injected transport. Gaps: v0 alerts only by failing a CI workflow; no `feed_status` persistence or on-page notice yet — WS-C) |
| odds | — | — | — | — | Deferred (no viable odds source) |

## Scoring Criteria

- **A**: Complete, tested, documented, enforced
- **B**: Functional, mostly tested, some gaps
- **C**: Works but has known issues or missing tests
- **D**: Incomplete or has architectural violations
- **F**: Missing or broken
