# Runbook — deploying the production server (Fly.io)

The production shape (launch plan WS-B, decisions D10/D18): one Bun container
on Fly.io running `src/app/server.ts`, SQLite on a Fly volume at `/data`,
Litestream streaming every write to an S3-compatible bucket (Backblaze B2 or
Cloudflare R2), the weekly refresh running in-process Mondays 12:00 UTC, and
the static export on Cloudflare Pages as the read-only fallback.

## First deploy (one time; needs the Fly account — launch plan A2)

1. `fly launch --no-deploy` from the repo root — it picks up `fly.toml`.
   Rename the app there first if the product name (D2) is decided.
2. Create the volume in the app's primary region:
   `fly volumes create nascar_data --size 3 --region iad`
3. Create the replica bucket (B2 or R2) and set the secrets:
   ```sh
   fly secrets set \
     LITESTREAM_REPLICA_URL=s3://<bucket>/nascar.db \
     LITESTREAM_ACCESS_KEY_ID=<key> \
     LITESTREAM_SECRET_ACCESS_KEY=<secret> \
     AWS_REGION=<region-or-auto>            # R2: endpoint via LITESTREAM_* env, see backup-restore.md
   ```
4. Optional but expected in production:
   ```sh
   fly secrets set \
     CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> \  # static-fallback publish + Worker deploy
     PLAUSIBLE_DOMAIN=<product-domain> \
     LIVE_API_BASE=https://<live-worker-host>                    # when the Worker moves accounts (D12/D17)
   ```
5. Seed the data. Either let the first in-process refresh cold-backfill
   (~30+ min against the CDN — avoid; it is the exact load pattern we are
   trying to stop), or copy a local db up once:
   `fly ssh sftp shell` → `put data/nascar.db /data/nascar.db`.
6. `fly deploy`. Verify: `curl https://<app>.fly.dev/health` returns
   `{"ok":true,...}` with the expected `latestSeason`.

## DNS + static fallback (needs the new Cloudflare account — A1/A6)

Point the product domain at Fly (CNAME to `<app>.fly.dev`, or `fly certs add`
with A/AAAA records) **proxied through Cloudflare**. Then make Cloudflare serve
the static Cup export when the origin is down (WS-B acceptance: within 60 s):

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

## Uptime monitor (owner, free tier)

Point an external monitor (e.g. UptimeRobot free tier) at:
- `https://<product-domain>/health` (expect `"ok":true`)
- `https://<product-domain>/` (expect HTTP 200)
Alerts go to the owner email. 1-minute interval if the tier allows, else 5.

## The weekly refresh after this deploy

- On the server: `ENABLE_REFRESH_CRON=1` (set in fly.toml) arms the in-process
  cron for Mondays 12:00 UTC. It takes the `weekly-refresh` advisory lock and
  spawns `bun src/app/index.ts refresh` as a child process — same command,
  same logs, one `▶` line per step, ending with the Pages + Worker deploys.
- Manual run: `fly ssh console -C "bun src/app/index.ts refresh"` (the lock
  makes this safe even if the cron fires).
- **After the first server refresh is verified** (launch-plan WS-B acceptance
  box 3): flip `.github/workflows/weekly-refresh.yml` to
  `bun run refresh --no-deploy` so CI becomes the build-only smoke test (D18),
  and retire `cache-keepwarm.yml`. Do NOT flip earlier — CI is what keeps the
  public site fresh during the playoffs until then.

## Rollback

`fly releases` → `fly deploy --image <previous-image-ref>`. The db is on the
volume, not in the image, so rolling back code never touches data. For data
problems, see [backup-restore.md](backup-restore.md).
