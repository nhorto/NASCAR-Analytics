# WS-B2 — Move the production server from Fly.io to Railway (implementation plan)

**Status:** ACTIVE — amends [WS-B](2026-09-07-ws-b-production-server.md), which
stays the source of truth for what the server *does*. This plan covers only the
change of host.

**Decision change (2026-09-08, owner):** D10's "Fly.io" is replaced by
**Railway**. Everything else D10 fixes — SQLite on a persistent disk, Litestream
continuous replication, one always-on instance — is unchanged. WS-B's build
checklist stays ticked; only its deploy surface moves.

## Why this is cheap

The four things the server actually needs are provider-independent, and Railway
offers all of them:

| Requirement | Why | Railway |
|---|---|---|
| Persistent disk at `/data` | The db is a SQLite file that must survive restarts | `railway volume` |
| Exactly one always-on instance | Refresh / canary / predictions crons run **in-process**; sleeping or running two copies breaks them | 1 replica, no app sleep |
| Health check on `/health` | Already built, already returns the right shape | `healthcheckPath` |
| Custom domain + HTTPS | Needed for the installable app and login email links | `railway domain` |

Verified at plan time: the `Dockerfile` and `scripts/docker-entrypoint.sh`
contain **no Fly-specific anything** (Bun official image + the Litestream binary
+ an entrypoint that restores-then-replicates). Railway builds from that
Dockerfile as-is.

## What does NOT change

- `Dockerfile`, `scripts/docker-entrypoint.sh` — provider-neutral, ship as-is.
- Litestream replication and `bun run restore-drill`. The replica bucket is
  Cloudflare R2 either way (WS-B / owner step); it was never a Fly service.
- `src/app/env.ts`, `server.ts`, `scheduler.ts`, `http.ts` — no provider
  coupling. `requestId()` prefers `x-request-id` (which Railway injects) and only
  falls back to `fly-request-id`, so it is already correct; the Fly branch
  becomes dead but harmless. Leave it or drop it, not worth a behavior change.
- The Cloudflare Pages static export, which remains the read-only fallback
  origin (`looplab-arh.pages.dev`).

## What changes

| File | Change |
|---|---|
| `.railway/railway.ts` | **New.** Railway config-as-code (`railway config init`), the `fly.toml` equivalent: build from Dockerfile, `/data` volume, `healthcheckPath: "/health"`, 1 replica, restart-on-failure, the same `[env]` block `fly.toml` carries today. TypeScript authoring file fits a Bun/TS repo; `railway config plan` previews before `apply`. |
| `fly.toml` | Delete once Railway is serving. Keep until then — the fallback if Railway surprises us. |
| `docs/runbooks/deploy.md` | Rewrite. 10 Fly references — `fly secrets set`, `fly volumes create`, `fly deploy` — become `railway variables --set`, `railway volume add`, `railway up`. Heaviest single item in this plan. |
| `docs/DEPLOY.md` | 1 reference to the Fly production server in the header note. |
| `ARCHITECTURE.md` | 4 references. Update the deploy topology + "Current Guarantees". |
| `src/app/index.ts:302,310` | Two help-text strings say `fly secrets set` for the VAPID keys. Cosmetic but user-facing in CLI output. |
| `docs/exec-plans/active/2026-09-07-production-and-paid-launch.md` | 4 references. Restate D10, keep the original as struck-through history rather than deleting it. |
| `docs/exec-plans/active/2026-09-07-ws-b-production-server.md` | 6 references. Add a pointer to this plan; do not rewrite its history. |
| `docs/exec-plans/active/ws-g`, `ws-h` | 1 reference each, incidental. |

Research docs (`docs/research/*`) keep their Fly references — they are dated
records of what was true when written, not instructions.

## Service settings (whatever the UI calls them)

| Setting | Value |
|---|---|
| Source | GitHub repo, Dockerfile build |
| Region | US East |
| Instance | Smallest with ~1 GB RAM |
| Volume | Mount `/data`, 3 GB |
| Replicas | Exactly 1 — never autoscale; the crons run in-process |
| App sleep / auto-stop | **Off** |
| Health check | `/health` |
| Port | 8080 |

## The naming problem — parameterize, don't hardcode

`fly.toml` hardcodes `looplab` in three places, including
`APP_BASE_URL = "https://looplab.fly.dev"`. The product name is **not decided**
(Spotter / Trioval were the shortlist as of early September), and `APP_BASE_URL`
is required in production — the server fails to boot without it, and it is the
base for every verify/reset email link.

So: the Railway config derives every name-bearing value from **one exported
constant** at the top of `.railway/railway.ts`. Renaming later is a one-line
edit plus `railway config apply`, not a grep across the repo. Until the name
lands, that constant holds the Railway-generated domain, which is real and
working — no placeholder that has to be remembered.

This is the same trap that made `looplab` show up in ~20 files. Don't repeat it.

## Owner-gated (not me)

1. Add a payment method to Railway — it will not run an always-on service with a
   volume without one.
2. Create the R2 bucket `nascar-db` + an R2 API token with read/write. Hand back
   the **bucket name and endpoint**; the access key and secret go straight into
   `railway variables`, not into chat.
3. The naming decision, when it is ready (see above — not a blocker to starting).

## Build checklist

- [ ] `railway init` / `railway link` the project, service created from the repo
- [ ] `.railway/railway.ts` authored; `railway config plan` clean
- [ ] Volume mounted at `/data`, verified after a restart
- [ ] First `railway up` deploy green; `/health` returns `{"ok":true}`
- [ ] `railway variables` set: `LITESTREAM_REPLICA_URL`, `CLOUDFLARE_API_TOKEN`, `APP_BASE_URL`, plus the WS-B set as they exist
- [ ] `bun run restore-drill` passes against the R2 replica
- [ ] `docs/runbooks/deploy.md` rewritten and followed end-to-end by the owner once
- [ ] `docs/DEPLOY.md`, `ARCHITECTURE.md`, `index.ts` help text updated
- [ ] `fly.toml` deleted; D10 restated in the launch plan
- [ ] Full test suite green (architecture tests included)

## Sequencing note

WS-B's existing deviation note still holds: **do not** flip
`.github/workflows/weekly-refresh.yml` to `--no-deploy` until a refresh run on
the Railway server has ingested a real race. As of 2026-09-08 the Cloudflare
secrets are finally set and CI deploys again for the first time since June —
that is the only thing currently keeping the public site current. Breaking it to
chase D18 would re-freeze the site mid-playoffs.

## Optional, worth 2 minutes

`railway setup agent -y` installs Railway's own agent skills and MCP server into
Claude Code. It would make the config/deploy steps here more direct than
shelling out. Owner's call — it edits local tool config, so it is not done as
part of this plan.
