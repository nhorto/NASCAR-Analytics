# Surface the Moat Metrics

**Status:** COMPLETE
**Started:** 2026-07-05
**Completed:** 2026-07-05

## Problem

Adjusted Pass Efficiency (adjPE) and Closer Score are the proprietary moat
(PRODUCT_SENSE principle 3), but today they surface only as two bare numbers on a
driver's *latest-season* profile card. A fan reading "+4.0" has no idea whether
that is elite or noise — there is no league context, no ranking, no way to ask
"who is the best closer in the field?", and nothing on the front door. The moat
is invisible. QUALITY_SCORE flags this: the metrics "are not yet prominently
exposed in the UI."

## Goal

Make the two proprietary metrics a first-class, browsable feature:

1. **Metrics leaderboard page** (`/metrics`, per series) — the headline. Ranks
   the current season's qualified drivers by each proprietary metric, side by
   side, with a plain-English methodology explainer. New top-level nav tab.
2. **League context on the driver profile** — replace the bare numbers with
   `value · rank of N · percentile`, plus a career-trend sparkline, so the number
   means something.
3. **Home "Beyond the Box Score" card** — current-season leader in each metric,
   linking to `/metrics`. Puts the moat on the front door.

## Scope / Non-goals

- No new metric math — this exposes the metrics already computed in
  `driver_season_stats`. (Era/track-type-adjusted baselines remain the separate
  tech-debt item.)
- No client-side JS — server-rendered like the rest of the site; statically
  exportable.

## Design

### analytics domain (types → config → service)
- `config.ts`: `METRIC_LEADER_MIN_LOOP_SHARE = 0.5` — leaderboards restrict to
  loop-data regulars (ran ≥ this share of the season's max loop-race count) so a
  part-timer's few strong runs can't top the board. Mirrors the existing form-leader rule.
- `types.ts`: `MetricKey`, `MetricRank` (driver, value, rank, percentile),
  `SeasonMetricBoard` (both ranked lists for a season).
- `service.ts` (pure, unit-tested):
  - `qualifiedRegulars(rows, share)` — filter to loop-data regulars.
  - `rankByMetric(rows, key)` — sort best-first, assign rank + percentile
    (share of the qualified field a driver beats).
  - `seasonMetricBoard(p, season, seriesId)` — orchestration, reuses
    `repo.standingsForSeason` (already returns names + all metrics).
  - `driverMetricRanks(p, driverId, season, seriesId)` — a driver's rank in each
    metric for the profile context.
- `runtime.ts`: `handleMetrics` → `/api/metrics` (dev convenience).

### app layer
- `pages/metrics.ts`: explainer card + two ranked leaderboard cards.
- `render.ts`: `renderMetrics` (null → 404 when no computed data).
- `layout.ts`: new `metrics` tab (placed 2nd, after Home, to foreground the moat).
- `server.ts`: `/metrics` route. `export.ts`: one `/metrics` page per series.
- `pages/drivers.ts`: rank/percentile sublines + career adjPE sparkline in the
  Loop Metrics card.
- `pages/home.ts`: "Beyond the Box Score" card.
- `html.ts`: `ordinal()` helper.

## Verification
- Unit: `rankByMetric` ordering/percentile/tie/empty; `qualifiedRegulars` threshold.
- E2E (app.server.test): `/metrics` renders leaders; profile shows rank context;
  home shows the moat card; `/api/metrics` is series-aware.
- Full `bun test` green (incl. architecture tests).

## Docs to update on completion
- Move this plan to completed/, update PLANS.md.
- ARCHITECTURE.md Current Guarantees (+ metrics page) and What Does NOT Exist.
- QUALITY_SCORE.md web-app note.
