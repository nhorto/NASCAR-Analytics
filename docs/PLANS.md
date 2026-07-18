# Execution Plans Index

> All execution plans for NASCAR Analytics.

## Active Plans

| Plan | Status | Description |
|------|--------|-------------|
| [Live Race Day Companion](exec-plans/active/2026-07-05-live-race-companion.md) | ACTIVE | Free, in-app, mobile-first live companion: layered live loop-data board (tap-to-expand per-driver drill-down), a "Loop Rating ★" sort by our live metric, strategy/pit-cycle tracker, my-driver alerts. Cloudflare Durable Object polls the NASCAR CDN live feed → `/api/live`. Backed by [research](research/2026-07-05_live-race-companion.md) + the [live UI design spec](design-docs/2026-07-05-live-ui-design.md). Owner-approved 2026-07-05. Phases 0–3 DONE (deployed: [looplab-live.nhorton.workers.dev](https://looplab-live.nhorton.workers.dev) + `/live` on the main site). **Phase 4 (hardening) IN PROGRESS:** race-window keep-warm cron + post-race authoritative loopstats swap. |
| [PWA: Installable + Notifications](exec-plans/active/2026-07-18-pwa-installable.md) | ACTIVE | Manifest + generated icons + service worker (offline shell, cache keyed to `ASSET_VERSION`, live API never cached) → the site installs to a phone home screen; opt-in my-driver device notifications on the Live page. Owner-approved 2026-07-18. |
| _Other candidates_ | | Connect the Cloudflare deploy + add the two CI secrets (owner login), background Web Push (VAPID + DO subscription store), SEO/OpenGraph metadata + sitemap, cross-series statistical comparison, sharper metric baselines (era/track-type). |

## Completed Plans

| Plan | Completed | Description |
|------|-----------|-------------|
| [Refresh Wires the Worker Bake](exec-plans/completed/2026-07-18-refresh-worker-bake.md) | 2026-07-18 | `bun run refresh` now regenerates `worker/baselines.ts` (always) + `worker/track-strategy.ts` (`bun run calibrate` self-gates via `--min-pit-races` so CI without raw pit archives keeps the committed bake) and deploys the `looplab-live` Worker behind the same `CLOUDFLARE_API_TOKEN` gate as the Pages deploy. Closes the "baked Worker artifacts go stale" (Medium) debt; residual "strategy recalibration is local-only" logged as Low. |
| [Strategy Model Calibration](exec-plans/completed/2026-07-06-strategy-model-calibration.md) | 2026-07-06 | Replaced the live Strategy tab's fake `DEFAULT_STINT_LAPS=40` + fuel-burn-confounded falloff with a calibrated model from the backfill: per-track **typical green run** + a **pit-discontinuity tire-severity tier** (Darlington→Talladega ordering, cross-series consistent), baked series-keyed into the worker with a track_id→type fallback, plus an honest Strategy UI. **Held-out backtested** (train <2022 / test 2022): per-track pit-cadence prediction is **60% lower MAE than the flat baseline** (6.0 vs 15.0 laps; ±10 laps for 86% of held-out stints). A physical fuel capacity is deliberately unmodeled (not recoverable from history). Deployed to `looplab-live` + Pages. |
| [Real Playoff-Format Model](exec-plans/completed/2026-07-05-playoff-format-model.md) | 2026-07-05 | Replaced the recap's simplified cut line with a season-phase-aware Playoff Picture: regular-season win-and-in field + points cut, and playoff rounds (16→12→8→4 per series) with race-winner auto-advance and eliminations. Phase derived from the last-N races of the ingested schedule. |
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
