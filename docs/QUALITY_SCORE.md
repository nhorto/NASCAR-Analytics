# Quality Score

> Grades each domain and architectural layer. Updated as the project evolves.

## Domain Grades

| Domain | Types | Config | Repo | Service | Overall |
|--------|-------|--------|------|---------|---------|
| data-ingestion | A | A | B | B+ | **B+** (2026-09-07: pipeline tested and verified vs real data, all 3 series; per-race writes now atomic (fetch-all-then-one-transaction, injected-failure tested, backfill continues past a bad race); fallback-results write path + points-race ordinal reads for the nascaR.data adapter) |
| analytics | A | A | B | B | **B+** (2026-07-05: metric math unit-tested, e2e compute tested, output verified vs known history; expectations are league-wide buckets — not yet era/track-type-adjusted) |
| drivers | A | A | B | B | **B+** (2026-07-05: summaries/race log/lookup + cross-series career (unit + e2e) tested; identity verified stable; no headshots/bio metadata) |
| web app (app layer + runtimes) | — | — | — | B+ | **B+** (2026-09-07: e2e route tests incl. series switching + metrics leaderboards, <60ms renders; production pipeline added per WS-B — env validation (fail-fast, negative-tested), request ids, JSON request logs, per-route cache control, CSP/HSTS/nosniff headers, gzip, `/health` incl. 503-on-unreadable-db test, in-process refresh cron with a TTL advisory lock (contention/takeover/failure paths tested); WS-D added per-request viewer resolution, CSRF-checked auth routes, series/feature gating with a teaser (e2e-tested: anon → teaser + 403 JSON, Pro → real page, public-vs-private cache headers). Gaps: not yet deployed (owner accounts pending), CSP still allows 'unsafe-inline' scripts, single-column layout, placeholder wordmark) |
| live (Workers-safe domain + edge DO) | A | A | — | B | **B+** (2026-08-07: pure domain fully unit-tested and Workers-portable; deployed edge DO + main-site `/live`. Strategy model calibrated from the backfill and **held-out backtested** — per-track pit-cadence prediction is 60% lower MAE than the flat baseline (6.0 vs 15.0 laps, ±10 laps for 86% of held-out stints); tire severity validated by cross-series face-validity ordering. Weekly refresh now regenerates/deploys both Worker artifacts and refuses an empty calibration; schedule canonicalization guards partially rolled feed identity. Gaps: full-race Phase 4 soak remains, metrics are live-counter estimates (no post-race authoritative swap), DO stops when unwatched, intermediate-track cadence MAE ~10 laps) |
| accounts | A | A | B+ | A- | **A-** (2026-09-07 WS-D: argon2id via Bun.password, hash-only token storage, enumeration-safe failures with a timing-equalizing dummy verify, rolling sessions, single-use expiring verify/reset tokens, sliding-window rate limits — all negative-tested (wrong password, reused/expired tokens, limit trips, weak/common passwords) plus e2e over a real server with a cookie jar. Gaps: common-password blocklist instead of a live HIBP check; no 2FA (not in v1 spec)) |
| billing (entitlement slice) | A | A | B+ | B+ | **B+** (2026-09-07 WS-D: spec-§7 entitlement model with boundary tests (future/past/exactly-now), manual grants + `bun run grant`, verified-email purchase guard. Deliberately partial: the Stripe webhook state machine, portal, and `stripe_events` idempotency are WS-E) |
| data-health (canary + fallbacks) | A | A | B+ | A- | **A-** (2026-09-07 WS-C: pure runner + validators unit-tested incl. HTTP/shape/transport classification; `feed_status` persistence with streak/outage math and threshold-crossing alerts (one email per outage) fully tested incl. recovery/re-alert; on-page "data delayed" banner e2e-tested; nascaR.data fallback mapping pure + tested and **verified exact against the real release** (3/3 2026 races, 35/36 2025), fills the YellaWood hole. Gaps: real email send untested until Resend exists; SportsDataIO stub schema unverified; alias tables are manual) |
| odds | — | — | — | — | Deferred (no viable odds source) |

## Scoring Criteria

- **A**: Complete, tested, documented, enforced
- **B**: Functional, mostly tested, some gaps
- **C**: Works but has known issues or missing tests
- **D**: Incomplete or has architectural violations
- **F**: Missing or broken
