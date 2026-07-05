# Cross-Series Driver Career Pages

**Status:** COMPLETE
**Started:** 2026-07-05
**Completed:** 2026-07-05

## Problem

Every view in the app stays inside one series (series lives in the URL path).
ARCHITECTURE "What Does NOT Exist" flags the gap: there is no unified career
timeline across a driver's Cup + Xfinity + Truck record. But `driver_id` is
**global** across series (one `drivers` row per person; stats separated by
`series_id`) — so the data already supports it. A driver's whole career on one
page is something no competitor has (Racing-Reference is results-only and dated;
nascar-reference has no loop data; the official app has no cross-series view).

## Goal

A per-driver, un-prefixed career page at `/driver/{id}` (singular — distinct from
the series-scoped `/drivers/{id}` profile), mirroring the `/race/{id}` precedent
for globally-unique ids. It shows:

1. Identity header (name, latest ride) + career span across all series.
2. Grand totals (starts, wins, top 5s, top 10s) summed across series.
3. A **By Series** breakdown (Cup / Xfinity / Trucks), each linking to that
   series' deep profile.
4. A **Career Timeline** matrix — one row per season, one column per series the
   driver ran, cell = starts (+ wins) — the cross-series view nobody else has.

Discoverable via a "Full career (all series) →" link on the series profile.

## Scope / Non-goals

- Points races only, consistent with the existing driver summaries.
- No new nav tab (per-driver page, reached from the profile).
- No client JS — server-rendered, statically exportable like `/race/{id}`.

## Design

### drivers domain (owns the career record end-to-end)
Sourcing the whole page from one domain avoids cross-domain reconciliation.
- `types.ts`: `CareerSeasonRow` (per season × series), `CareerSeriesSummary`
  (per-series totals), `DriverCareer` (identity + series[] + seasons[]).
- `repo.ts`:
  - `careerSeasonRows(db, driverId)` — one GROUP BY series_id, season over the
    driver's points races (races/wins/top5s/top10s/avgFinish).
  - `careerIdentity(db, driverId)` — name + latest team/number/make from the
    driver's most recent start across all series; null if no starts.
- `service.ts`:
  - `summariseSeries(seasons)` — pure fold of season rows → per-series summaries
    (distinct seasons, summed totals, races-weighted avg finish). Unit-tested.
  - `driverCareer(p, driverId)` — compose identity + season rows + summaries;
    null when the driver has no points races.
- `runtime.ts`: `handleDriverCareer` → `/api/driver/:id/career`.

### app layer
- `pages/career.ts`: `careerContent(career)` — header, total chips, By Series
  table, season-matrix timeline. Uses `SERIES_TABS` for labels/links.
- `render.ts`: `renderCareer(p, driverId)` (null → 404); shell `active: drivers`,
  series context = the driver's primary (most-started) series.
- `server.ts`: un-prefixed `/driver/{id}` route (beside `/race/{id}`).
- `export.ts`: one `/driver/{id}` page per distinct driver (union across series).
- `pages/drivers.ts`: "Full career (all series) →" link on the profile header.

## Verification
- Unit: `summariseSeries` grouping/weighted-avg/ordering.
- E2E (app.server.test): seed a driver with Cup + Xfinity starts; `/driver/:id`
  renders both series + the timeline; `/api/driver/:id/career`; profile links to it.
- Full `bun test` green (incl. architecture tests); `tsc --noEmit` clean.

## Docs to update on completion
- Move plan to completed/, update PLANS.md.
- ARCHITECTURE.md: Current Guarantees (+ career page); remove the cross-series
  gap from "What Does NOT Exist".
- QUALITY_SCORE.md drivers note.
