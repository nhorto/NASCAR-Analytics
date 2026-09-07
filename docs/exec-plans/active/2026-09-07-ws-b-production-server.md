# WS-B — Production server on Fly.io (implementation plan)

**Status:** ACTIVE — build detail for workstream WS-B of
[the launch plan](2026-09-07-production-and-paid-launch.md) (§5 WS-B, weeks 2–3).
Decisions D10 (Fly.io, SQLite on a volume, Litestream), D18 (refresh moves
in-process) govern. Acceptance boxes live in the launch plan; this file tracks
the build detail and what is owner-gated.

## Shape

One Bun container on Fly.io runs `server.ts` (the existing dev server, hardened)
with `data/` on a Fly volume and Litestream replicating the SQLite file to
S3-compatible storage (B2 or R2). The weekly refresh becomes an in-process cron
in the server that spawns the existing CLI (`bun src/app/index.ts refresh`) as a
child process under an advisory lock — process isolation keeps the synchronous
compute/export work off the server's event loop, and SQLite WAL handles the
cross-process write. GitHub Actions stays the interim deployer until the server
refresh is verified, then flips to `--no-deploy` build-only (see "Sequencing").

## New/changed files

| File | What |
|---|---|
| `src/app/env.ts` | Typed server config from env (`readServerEnv`): APP_ENV/NODE_ENV production flag, PORT, NASCAR_DATA_DIR, LIVE_API_BASE, PLAUSIBLE_DOMAIN/HOST, ENABLE_REFRESH_CRON, LOG_REQUESTS. Malformed values are `problems`; production boot fails fast on any problem (`requireServerEnv`). |
| `src/app/http.ts` | Pure HTTP hardening helpers: request ids (honor `x-request-id`/`fly-request-id`, else UUID), per-route-class `Cache-Control`, security headers (CSP incl. live-Worker + Plausible origins, HSTS in production, frame-ancestors none, nosniff, referrer policy), gzip encoding for compressible bodies, JSON log lines. |
| `src/app/server.ts` | Routes wrapped in the pipeline: request id → route → gzip → headers → structured log; `GET /health` (db-backed coverage snapshot, 503 when the db is unreachable); 500 guard. Signature `createServer(p, port, config?)`. |
| `src/app/scheduler.ts` | `nextRefreshAt()` (Mondays 12:00 UTC, same cadence as CI) + `runScheduledRefresh()` (advisory lock → spawn `bun src/app/index.ts refresh` → release) + `startRefreshScheduler()` timer loop. Enabled by `ENABLE_REFRESH_CRON`. |
| `src/providers/lock.ts` | SQLite advisory lock (`app_locks` table): acquire with TTL + self-renew, takeover of expired locks, holder-checked release. |
| `src/providers/db.ts` | `app_locks` table; `PRAGMA busy_timeout` so the server and the refresh child never fail on a transient write lock. |
| `src/app/layout.ts` | `LIVE_API_BASE` overridable via env (launch-plan WS-B "worker origin from config"). |
| `Dockerfile`, `.dockerignore` | Bun official image + Litestream binary copied from the official Litestream image; runs `scripts/docker-entrypoint.sh`. |
| `scripts/docker-entrypoint.sh` | Restore-if-missing from `LITESTREAM_REPLICA_URL`, then `litestream replicate -exec` around the server; runs unreplicated (with a loud warning) when the URL is absent. |
| `fly.toml` | App scaffold (name is the D2 placeholder), `/data` volume mount, `/health` HTTP check, auto-stop off (the cron must keep running), env defaults. |
| `scripts/restore-drill.ts` (`bun run restore-drill`) | Restores the replica into a temp dir, boots the real server against it on an ephemeral port, asserts `/health` + a page render, cleans up. Proves backup → boot → serve. |
| `docs/runbooks/deploy.md` | First deploy, secrets, DNS + static-fallback wiring on Cloudflare, uptime monitor, and the CI flip. |
| `docs/runbooks/backup-restore.md` | Litestream configuration, drill cadence, manual restore. |
| `.github/workflows/weekly-refresh.yml` | Unchanged for now — see "Sequencing". |

## Sequencing (deviation note, 2026-09-07)

D18 says GitHub Actions becomes build-only. Flipping it **now** would re-freeze
the public site: WS-A acceptance ("Monday CI run deploys…") depends on CI
deploying during the playoffs, and the Fly app doesn't exist until owner steps
A2 (Fly account) and A5 (secrets) are done. So the CI flip to
`bun run refresh --no-deploy` happens only after the launch-plan WS-B box
"a refresh run on the server ingests the latest race…" is ticked. Tracked in
the tech-debt tracker alongside the keep-warm retirement.

## Build checklist

- [x] Env validation module + tests (negative cases: bad PORT, bad URL, production fail-fast)
- [x] HTTP hardening helpers + tests (cache classes, CSP contents, HSTS gating, request-id passthrough, gzip on/off/threshold)
- [x] server.ts pipeline + `/health` + tests (headers on real routes, 503 on closed db, 404 no-store)
- [x] Advisory lock + tests (contention, TTL takeover, wrong-holder release)
- [x] Scheduler + tests (next-Monday-noon math incl. boundary cases; lock-skip; failure path releases the lock)
- [x] Worker origin from env in layout.ts
- [x] Dockerfile + entrypoint + fly.toml + .dockerignore
- [x] `bun run restore-drill`
- [x] Runbooks (deploy, backup-restore)
- [x] ARCHITECTURE.md / QUALITY_SCORE.md / tech-debt updates

## Owner-gated (cannot be done from this repo)

- Fly.io account + app creation + volume + secrets (launch plan A2; then `fly deploy`)
- B2 or R2 bucket + keys for Litestream (`LITESTREAM_REPLICA_URL` + credentials)
- Product domain + DNS on the new Cloudflare account (A1/A6/D2)
- Cloudflare origin-fallback wiring (runbook has the recipe) and the uptime monitor signup
- The launch-plan WS-B acceptance boxes — all four need the deployed app, so they
  stay unticked until the owner-side steps land
