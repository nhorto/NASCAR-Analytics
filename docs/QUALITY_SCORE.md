# Quality Score

> Grades each domain and architectural layer. Updated as the project evolves.

## Domain Grades

| Domain | Types | Config | Repo | Service | Overall |
|--------|-------|--------|------|---------|---------|
| data-ingestion | A | A | B | B | **B+** (2026-07-05: pipeline works, tested, verified vs real data; all 3 national series backfilled; no scheduled automation) |
| analytics | A | A | B | B | **B+** (2026-07-05: metric math unit-tested, e2e compute tested, output verified vs known history; expectations are league-wide buckets — not yet era/track-type-adjusted) |
| drivers | A | A | B | B | **B+** (2026-07-05: summaries/race log/lookup tested; identity verified stable; no headshots/bio metadata) |
| web app (app layer + runtimes) | — | — | — | B | **B** (2026-07-05: e2e route tests incl. series switching, in-browser verified across all 3 series, <60ms renders; no caching headers, single-column layout only, placeholder wordmark) |
| odds | — | — | — | — | Deferred (no viable odds source) |

## Scoring Criteria

- **A**: Complete, tested, documented, enforced
- **B**: Functional, mostly tested, some gaps
- **C**: Works but has known issues or missing tests
- **D**: Incomplete or has architectural violations
- **F**: Missing or broken
