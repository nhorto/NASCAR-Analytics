# Runbook — backups and restore (Litestream)

## How backups work

`scripts/docker-entrypoint.sh` wraps the server in
`litestream replicate -exec …`, so every SQLite write streams continuously to
`LITESTREAM_REPLICA_URL` (S3-compatible: Backblaze B2 or Cloudflare R2).
On a fresh machine (new/empty volume) the entrypoint first runs
`litestream restore -if-db-not-exists`, so machine loss self-heals on boot.

The raw JSON archive (`data/raw/`) is the second line of defense for *data*
(the db is regenerable from it plus the CDN); Litestream is what makes machine
loss a non-event for *service*.

- **B2**: `LITESTREAM_REPLICA_URL=s3://<bucket>/nascar.db` plus
  `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`; endpoint
  `s3.<region>.backblazeb2.com` goes in the URL query
  (`?endpoint=…`) or `AWS_ENDPOINT_URL_S3`.
- **R2**: same, endpoint `https://<account-id>.r2.cloudflarestorage.com`.

## The restore drill (WS-B acceptance; re-run before launch, WS-I)

```sh
LITESTREAM_REPLICA_URL=s3://<bucket>/nascar.db \
LITESTREAM_ACCESS_KEY_ID=… LITESTREAM_SECRET_ACCESS_KEY=… \
bun run restore-drill
```

The drill restores the replica into a temp dir, boots the real server against
it, asserts `/health` is ok and the home page renders, prints the restored
dataset's freshness, and cleans up. `--keep` preserves the restored db for
inspection. It must print `✓ restore drill PASSED`. Run it from any machine
with `litestream` installed (`brew install benbjohnson/litestream/litestream`)
— running it *off* the production box is the point: it proves a fresh machine
can come back from the bucket alone.

## Manual restore (machine or volume lost)

Normally unnecessary — a new machine restores itself on boot. If the volume is
corrupt while the machine lives:

```sh
railway ssh
litestream restore -o /data/nascar.db.new "$LITESTREAM_REPLICA_URL"
mv /data/nascar.db.new /data/nascar.db && rm -f /data/nascar.db-wal /data/nascar.db-shm
exit
railway redeploy          # restarts the container onto the repaired volume
```

To restore to a point in time (bad refresh, corrupted write):
`litestream restore -timestamp 2026-10-01T00:00:00Z -o …`.

## If the replica itself is gone

The site keeps serving from the volume. Recreate the bucket, reset the
secrets, redeploy (replication restarts from a fresh snapshot), then re-run
the restore drill. Worst case (volume AND replica lost): re-backfill from the
CDN (`bun run refresh` cold) — slow but complete, per the data-risk analysis.
