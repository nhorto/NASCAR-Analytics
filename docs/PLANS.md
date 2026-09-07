# Execution Plans Index

> All execution plans for NASCAR Analytics.

## Active Plans

| Plan | Status | Description |
|------|--------|-------------|
| [Production + Paid Launch](exec-plans/active/2026-09-07-production-and-paid-launch.md) | ACTIVE | Eight-week plan (2026-09-07 → 2026-11-01) from the frozen static site to a production Bun server on Fly.io with accounts, Stripe billing, gating (free = Cup + live board; Pro = all series + predictions + DFS + deep tools + push + preview email), an installable PWA, data-resilience work (canary, fallback adapters, cold-backfill fix, feed-loss runbook), legal docs, and launch hardening. Decisions register inside. Spec: [v1 paid product spec](product-specs/2026-09-07-v1-paid-product-spec.md). Background: [productization review](research/2026-09-07_productization-review.md). |
| [Live Race Day Companion](exec-plans/active/2026-07-05-live-race-companion.md) | ACTIVE | Free, in-app, mobile-first live companion: layered live loop-data board, proprietary live metrics, strategy/pit-cycle tracking, and driver alerts. **Phases 0–3 are built and deployed. Phase 4 is in progress (2026-08-07): harden partially rolled upstream session metadata, automate generated Worker artifacts/deployment in the weekly refresh, and complete a full-race soak before closing the plan.** |
| _Other candidates_ | | SEO/OpenGraph metadata + sitemap, cross-series statistical comparison, sharper metric baselines (era/track-type). |

## Completed Plans

| Plan | Completed | Description |
|------|-----------|-------------|
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
