# Execution Plans Index

> All execution plans for NASCAR Analytics.

## Active Plans

| Plan | Status | Description |
|------|--------|-------------|
| [Live Race Day Companion](exec-plans/active/2026-07-05-live-race-companion.md) | ACTIVE | Free, in-app, mobile-first live companion: live loop-data leaderboard, my-driver in-app alerts, strategy/pit-cycle tracker. Cloudflare Durable Object polls the NASCAR CDN live feed → `/api/live`. Backed by [research](research/2026-07-05_live-race-companion.md). Owner-approved 2026-07-05. Phase 0 confirmed locally; Phase 1 DONE (pure `live` domain + tests, `baselines.json`, `bun run capture`); **Phase 2 DONE — the `looplab-live` Worker + `LiveCoordinator` DO are deployed and serving a self-contained live page at [looplab-live.nhorton.workers.dev](https://looplab-live.nhorton.workers.dev)** (validated against tonight's Cup race feed). Phase 3 next: fold the live page + a "🔴 LIVE" banner into the main Pages site. |
| _Other candidates_ | | Connect the Cloudflare deploy + add the two CI secrets (owner login), SEO/OpenGraph metadata + sitemap, real playoff-format model for the recap. |

## Completed Plans

| Plan | Completed | Description |
|------|-----------|-------------|
| [Weekly Auto-Refresh CI](exec-plans/completed/2026-07-05-weekly-refresh-ci.md) | 2026-07-05 | Portable `bun run refresh` (backfill + compute + export + deploy, all series; env-configurable, deploy self-gates on Cloudflare secrets) scheduled by a GitHub Actions workflow (Mondays 12:00 UTC + dispatch) that caches the DB across runs. Green and artifact-verifiable before Cloudflare is connected; drop-in for a future Cloudflare Container. |
| [Weekly Race Recap](exec-plans/completed/2026-07-05-weekly-recap.md) | 2026-07-05 | Auto-generated post-race recap per series: result summary, per-race proprietary-metric standouts (adjPE + Closer, new `race_metric_standouts` table), points-standings movement with a per-series cut line, and form-vs-result driver callouts. `/recap` + `/recap/{id}` + `/api/recap/:id`; new Recap nav tab; Home CTA repointed. Runs off already-computed data — no live feed. |
| [Cross-Series Career Pages](exec-plans/completed/2026-07-05-cross-series-careers.md) | 2026-07-05 | Un-prefixed `/driver/{id}` career page unifying a driver's Cup+Xfinity+Truck record: grand totals, per-series breakdown, and a season × series timeline matrix. Linked from each series profile; `/api/driver/:id/career`. |
| [Surface the Moat Metrics](exec-plans/completed/2026-07-05-surface-moat-metrics.md) | 2026-07-05 | Made adjPE + Closer Score first-class: a `/metrics` leaderboard page (new nav tab) ranking the season's loop-data regulars, rank/percentile context on driver profiles, and a "Beyond the Box Score" home card. |
| [Fan Analytics Platform MVP](exec-plans/completed/2026-07-05-fan-analytics-mvp.md) | 2026-07-05 | Full MVP: CDN ingestion pipeline + raw archival (Phase 0/1), drivers + analytics domains with proprietary metrics (Phase 2), mobile-first dark web app — profiles, race pages, compare, track explorer (Phase 3). |
| [Multi-Series (Xfinity + Trucks)](exec-plans/completed/2026-07-05-multi-series.md) | 2026-07-05 | Backfilled all 3 national series with loop data; added a Cup/Xfinity/Trucks series switcher threaded through the whole app and JSON API. |
| [Polish Pass + Deployment Prep](exec-plans/completed/2026-07-05-polish-and-deploy-prep.md) | 2026-07-05 | In Form regular filter + track-explorer on-screen filters; researched hosting, chose Cloudflare Pages. |
| [Cloudflare Static Export](exec-plans/completed/2026-07-05-cloudflare-static-export.md) | 2026-07-05 | Path-based series URLs, client-rendered compare/tracks, `bun run export` → dist/ for Cloudflare Pages Direct Upload. See [DEPLOY.md](DEPLOY.md). |

## Tech Debt

See [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md).

## How to Use This

1. **Starting new work?** Check active plans first.
2. **Creating a new plan?** Add to `exec-plans/active/`, update this index.
3. **Finishing a plan?** Move to `exec-plans/completed/`, update this index.
4. **Found tech debt?** Log it in the tech debt tracker.
