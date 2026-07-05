# Weekly Auto-Refresh CI

**Status:** COMPLETE
**Started:** 2026-07-05
**Completed:** 2026-07-05

## Outcome

Shipped the portable-command approach. New `bun run refresh` verb
(`src/app/index.ts`) runs backfill + compute (all three series) + export +
deploy in one process; the data dir (`NASCAR_DATA_DIR`) and Pages project
(`NASCAR_PAGES_PROJECT`) are env-configurable, and the deploy leg self-gates on
`CLOUDFLARE_API_TOKEN` (spawns `bunx wrangler pages deploy dist`), so it's a
drop-in for a future Cloudflare Container with the DB in R2.
`.github/workflows/weekly-refresh.yml` schedules it (Mondays 12:00 UTC + manual
dispatch), caches `data/nascar.db*` across runs with a rolling key (incremental
warm, self-healing cold), and always uploads `dist/` as an artifact — so the
workflow is green and verifiable *before* Cloudflare is connected, and starts
deploying the moment the two secrets are added. Verified: YAML parses, CLI
registers `refresh`, `NASCAR_DATA_DIR` override drives `export`, full `bun test`
green (129). No app/domain code changed.

## Problem

The product's whole premise is race-weekend cadence (PRODUCT_SENSE principle 5),
but every data refresh is manual today: someone runs `sync → compute → export →
deploy` by hand after each weekend (docs/DEPLOY.md). If nobody runs it, the site
silently goes stale — standings, the new weekly recap, everything. "What Does NOT
Exist" lists this twice: *no scheduled automation* and *no scheduled/CI deploy*.
DEPLOY.md explicitly defers it: "A GitHub Action could automate it later, but it
would need to run the full backfill in CI (the DB isn't in the repo)."

## The hard part: the database isn't in the repo

`data/nascar.db` is ~160MB, gitignored, and regenerable from the public CDN. A
fresh CI runner has no DB. This matters for **correctness, not just speed**: the
proprietary-metric baselines (`buildLeagueExpectations`) are computed over *all*
loop-data history (2019+). A runner that only synced the current season would
compute the residual metrics against a one-season baseline — wrong numbers.

So the CI must always operate on the full historical dataset.

## Goal

A scheduled GitHub Actions workflow that refreshes all three series and
redeploys the static site every race weekend, with **zero manual steps**, that is
**correct on a cold cache** and **fast on a warm one**, and that is **useful and
verifiable before Cloudflare is even connected**.

## Approach (decided)

Ship a **portable, runner-agnostic refresh command** now, scheduled via GitHub
Actions, and structure it so moving to a Cloudflare-native runner later is a
drop-in. A plain Cloudflare Worker cannot host this pipeline (no persistent FS,
tight CPU/time limits, can't hold a 160MB SQLite file); the eventual Cloudflare
home is a **Container** running the same command with the DB synced from R2. So
the automation contract is *one command* — everything else (GitHub Actions today,
a Container tomorrow) is just a scheduler that calls it.

### The portable unit: `bun run refresh`

A new CLI verb that runs the whole weekend loop in-process and is the single
thing any runner invokes:

1. `backfill` all three series (idempotent — new races only on a warm DB, full
   history on a cold one).
2. `compute` all three series.
3. `export` → `dist/`.
4. Deploy to Cloudflare Pages **iff** `CLOUDFLARE_API_TOKEN` is set (spawns
   `bunx wrangler pages deploy dist`); otherwise logs that `dist/` is ready and
   exits 0. `--no-deploy` forces skip.

Made portable via env, so a Container pointing at an R2-synced volume needs zero
code changes:
- `NASCAR_DATA_DIR` (default `data`) — where the DB + raw archive live.
- `NASCAR_PAGES_PROJECT` (default `looplab`) — the Pages project name.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — wrangler creds.

## Design

`.github/workflows/weekly-refresh.yml`, one job that ultimately just runs
`bun run refresh`:

1. **Trigger**: `schedule` cron `0 12 * * 1` (Mondays 12:00 UTC — safely after
   Sunday Cup races clear the ingestion's 6h finality buffer) + `workflow_dispatch`
   for on-demand runs. `concurrency` guard so two runs never overlap.
2. **Toolchain**: `actions/checkout`, `oven-sh/setup-bun`, `bun install`.
3. **Restore DB cache** (`actions/cache`): key `nascar-db-v1-${{ github.run_id }}`
   (always unique → always saves a fresh cache post-run) with `restore-keys:
   nascar-db-v1-` (restores the most recent prior cache). Path: `data/nascar.db*`
   (the sqlite file + `-wal`/`-shm`). **Only the DB is cached, not `data/raw/`** —
   the raw archive is CDN insurance, not needed to build the site, and would bloat
   the cache. The `raw_fetches` provenance rows survive; their local paths just
   won't resolve, which nothing reads back.
4. **Refresh** — a single `bun run refresh` step that backfills + computes all
   three series, exports, and deploys (deploy self-gates on `CLOUDFLARE_API_TOKEN`).
   The workflow passes `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from
   secrets through job env; when they're absent the command still builds `dist/`
   and exits 0, so the workflow is green and verifiable before Cloudflare is
   connected, and starts deploying the moment the owner adds the two secrets.
5. **Upload `dist/` artifact** (always) — the refresh+build is downloadable even
   before Cloudflare is connected.

## Scope / Non-goals

- **No DB in the repo, no commit-back.** The workflow persists the DB via Actions
  cache only; nothing is written to git.
- **Doesn't do the one-time Cloudflare connect.** Creating the `looplab` Pages
  project still needs the owner's interactive `wrangler` login (docs/DEPLOY.md);
  the workflow only automates the *recurring* deploy once secrets exist.
- **No new app/domain code** — this is pure ops wiring around existing CLI verbs.

## Verification

- Validate the workflow YAML parses and the expression/`if` syntax is well-formed.
- Dry-run the pipeline logic locally where possible: confirm `backfill → compute →
  export` is the same chain the workflow calls (already exercised by the recap
  export smoke + full `bun test`).
- Confirm the cache path glob matches the real sqlite artifacts (`data/nascar.db`,
  `-wal`, `-shm`).
- Full `bun test` stays green (no source changes, but run it to be safe).

## Docs to update on completion

- Move this plan to `completed/`, update `PLANS.md`.
- `docs/DEPLOY.md`: replace the "could automate it later" note with an
  "Automated weekly refresh" section — the cron, the two secrets to add, and how
  the deploy step gates on them.
- `ARCHITECTURE.md`: update "What Does NOT Exist" (scheduled automation + CI
  deploy now exist, minus the one-time Cloudflare connect); add the workflow to
  the structure/guarantees.
