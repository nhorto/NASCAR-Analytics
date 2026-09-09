# Runbook — deploying the production server (Railway)

The production shape (launch plan WS-B, decisions D10 as amended by
[WS-B2](../exec-plans/active/2026-09-08-ws-b2-railway-migration.md), and D18):
one Bun container on Railway running `src/app/server.ts`, SQLite on a Railway
volume at `/data`, Litestream streaming every write to an S3-compatible bucket
(Cloudflare R2), the weekly refresh running in-process Mondays 12:00 UTC, and
the static export on Cloudflare Pages as the read-only fallback.

## The project as it exists today

| | |
|---|---|
| Project | `nascar-analytics` (`982971bc-2847-4f79-942f-8e21cf497c91`) |
| Service | `web`, built from `nhorto/NASCAR-Analytics` on `main`, Dockerfile builder |
| Environment | `production` |
| Region | `us-east4` (US East / IAD) |
| Volume | `nascar-data`, mounted at `/data` |
| URL | https://web-production-fd3c38.up.railway.app |

The name is the D2 placeholder problem in reverse: the project is named for
what it *is* (`nascar-analytics`), not for a product name nobody has picked, so
nothing here has to be renamed when D2 lands — only the custom domain is added.

## Configuration is code — do not click

`.railway/railway.ts` is the source of truth for the service, the volume, the
region, the health check, the replica count and the non-secret environment. It
replaces `fly.toml`.

```sh
railway config plan     # preview; changes nothing
railway config apply    # asks first; --yes for non-interactive
railway config pull     # import what Railway actually has, to reconcile drift
```

A clean `railway config plan` (0 to add/change/destroy) is the check that the
file and reality agree. Run it after any dashboard change.

Two shapes in that file are easy to get wrong and fail *silently* — both cost
a debugging cycle already, so they are commented in the file too:

- **`volumeMounts` is keyed by mount path**, with the volume node as the value:
  `volumeMounts: { "/data": data }`. Keying by volume name and passing
  `{ mountPath: "/data" }` is accepted, applies "successfully", and leaves the
  volume attached to *no service* at `/tmp` — i.e. a server whose database
  quietly lives on ephemeral container disk.
- **No start command.** The Dockerfile's `ENTRYPOINT` is
  `scripts/docker-entrypoint.sh`, which restores from the replica and then runs
  the server under `litestream replicate -exec`. Setting a start command
  overrides it and you get a healthy-looking server with no replication.

## First deploy (already done once — this is the repeat recipe)

1. `railway link` (or `railway init --name nascar-analytics`) and
   `railway service web`.
2. `railway config apply` — creates the volume and the service, sets the
   non-secret env, wires the health check.
3. `railway domain` — generates the `*.up.railway.app` domain. `APP_BASE_URL`
   in the config is `https://${{RAILWAY_PUBLIC_DOMAIN}}`, which Railway resolves
   at deploy time, so verify/reset email links are correct without anyone
   hardcoding a host.
4. Railway builds from GitHub `main` automatically on push. `railway deployment
   list` shows status; `railway logs --build <id>` and `railway logs
   --deployment <id>` show the two log streams.
5. Verify: `curl https://<host>/health` → `{"ok":true,...}` with the expected
   `latestSeason`.

## Secrets (never in `.railway/railway.ts`)

The config declares every secret name with `preserve()` so that `config apply`
knows about them and will not clear them. Set the values with:

```sh
railway variables --set NAME=value --service web
```

| Variable | Unblocks | Owner step |
|---|---|---|
| `LITESTREAM_REPLICA_URL` `LITESTREAM_ACCESS_KEY_ID` `LITESTREAM_SECRET_ACCESS_KEY` | Backups. **Without these the db is not replicated** — the entrypoint logs a loud warning and serves anyway | R2 bucket |
| `CLOUDFLARE_API_TOKEN` | The refresh's static-fallback publish + Worker deploy | A1 |
| `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` | Web checkout + billing webhooks (WS-E) | E1–E3 |
| `REVENUECAT_WEBHOOK_SECRET` | IAP entitlement webhook (WS-J) | J1 |
| `RESEND_API_KEY` `EMAIL_FROM` `RESEND_WEBHOOK_SECRET` `ALERT_EMAIL_TO` | Verify/reset/digest email, canary alerts | A4 |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | Web Push (`bun run src/app/index.ts gen:vapid`) | WS-H |
| `PLAUSIBLE_DOMAIN` | Analytics tag | A4 |

The boot log names every one that is missing and what it disables, so
`railway logs` right after a deploy is the checklist.

## Shell access

`railway ssh` needs a registered key once:

```sh
railway ssh keys add --key ~/.ssh/id_ed25519.pub --name <name>
railway ssh "df -h /data"
```

If it answers `Host key verification failed` in a non-interactive shell, trust
the host once: `ssh-keyscan -t ed25519 ssh.railway.com >> ~/.ssh/known_hosts`.

## Volume size — the trial cap

Railway's **Trial plan hard-caps a volume at 500 MB**, and an apply that asks
for more fails the *entire* change set with no per-resource reason. WS-B2
specifies 3 GB (`nascar.db` plus `data/raw/**`, the verbatim CDN archive that
is the insurance policy against the unofficial feed disappearing).

So `APP.volumeSizeMB` in `.railway/railway.ts` is 500 today. Once a payment
method is on the account: set it to 3072, `railway config apply`, and the
volume grows in place (`allowOnlineResize` is on). Nothing else changes.

Check the ceiling for the current plan with:

```sh
railway api 'query { me { workspaces { subscriptionPlanLimit } } }'
```

## DNS + static fallback (needs the new Cloudflare account — A1/A6)

Point the product domain at Railway (`railway domain <domain>` prints the CNAME
target) **proxied through Cloudflare**. Then make Cloudflare serve the static
Cup export when the origin is down (WS-B acceptance: within 60 s):

- The refresh already publishes `dist/` to the Pages project on every run, so
  Pages always holds the latest read-only site.
- Add a Cloudflare Worker route on the product domain with an origin-fallback
  worker:

  ```js
  export default {
    async fetch(req, env) {
      try {
        const res = await fetch(req, { signal: AbortSignal.timeout(10_000) });
        if (res.status < 500 || res.status === 503 && req.url.endsWith("/health")) return res;
        throw new Error(`origin ${res.status}`);
      } catch {
        const url = new URL(req.url);
        url.hostname = env.PAGES_HOST; // e.g. looplab-arh.pages.dev
        return fetch(new Request(url, req));
      }
    },
  };
  ```

  Bind `PAGES_HOST` to the Pages project host. GETs that fail at the origin
  fall back to the static export; everything stays on the product domain.

Note the Trial plan allows **1 custom domain**; that is enough for the product
domain, but not for a staging host alongside it.

## Uptime monitor (owner, free tier)

Point an external monitor (e.g. UptimeRobot free tier) at:
- `https://<product-domain>/health` (expect `"ok":true`)
- `https://<product-domain>/` (expect HTTP 200)
Alerts go to the owner email. 1-minute interval if the tier allows, else 5.

## The weekly refresh after this deploy

- On the server: `ENABLE_REFRESH_CRON=1` (set in `.railway/railway.ts`) arms
  the in-process cron for Mondays 12:00 UTC. It takes the `weekly-refresh`
  advisory lock and spawns `bun src/app/index.ts refresh` as a child process —
  same command, same logs, one `▶` line per step, ending with the Pages +
  Worker deploys. The boot log prints `refresh cron armed … nextRunAt=…`.
- Manual run: `railway ssh "cd /app && bun src/app/index.ts refresh"` (the lock
  makes this safe even if the cron fires).
- **After the first server refresh is verified** (launch-plan WS-B acceptance
  box 3): flip `.github/workflows/weekly-refresh.yml` to
  `bun run refresh --no-deploy` so CI becomes the build-only smoke test (D18),
  and retire `cache-keepwarm.yml`. Do NOT flip earlier — CI is what keeps the
  public site fresh during the playoffs until then.

## Seeding the database

A fresh volume starts empty (`/health` reports `latestSeason: null`). Options,
best first:

1. **Restore from the Litestream replica** — the normal path once R2 exists.
   The entrypoint does it automatically on a machine with no db.
2. **Backfill on the server**, bounded so it fits the volume:
   `railway ssh "cd /app && bun src/app/index.ts backfill --series 1 --from 2024 --to 2026"`
   then `compute`. Cup is series 1, Xfinity 2, Trucks 3.
3. Cold-backfilling all three series from 2019 is the load pattern D18 exists
   to stop. Avoid it except as a last resort.

## Rollback

`railway deployment list` → redeploy the previous good deployment
(`railway redeploy` for the latest, or the dashboard for an older one). The db
is on the volume, not in the image, so rolling back code never touches data.
For data problems, see [backup-restore.md](backup-restore.md).
