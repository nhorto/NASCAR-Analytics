# Weekly Race Recap

**Status:** ACTIVE
**Started:** 2026-07-05

## Problem

The product's north star is fans returning **3+ consecutive race weekends**
(PRODUCT_SENSE), and `core-beliefs.md` names "post-race data (Sunday–Monday)"
as one of the two content beats the product must be built around. Today there
is nothing that gives a fan a reason to open the site the night a race ends —
the `/race/{id}` page is a static results table with a few loop superlatives,
and it's buried behind the Races index. There is no front-door "here's what
just happened, and here's what our metrics saw that the box score didn't."

Competitive context (docs/research/2026-07-05_competitive-refresh.md):
- **Lap Raptor** already ships free "Stat Pack recaps" — so a plain stat dump
  is not enough; our edge must be the loop-data-first proprietary metrics
  (adjPE, Closer Score) they don't have.
- **NASCAR Insights** (official) publishes a *weekly editorial* post-race column
  — "published weekly, not live/interactive." Nobody offers an **auto-generated,
  interactive, self-serve** recap. That's our lane.

## Goal

An **auto-generated weekly recap** for the latest completed race in each series,
regenerated every weekly refresh with **zero manual writing**, surfaced on the
front door. It answers, at a glance: what happened, what our metrics saw, who
moved in the standings, and which drivers over/under-delivered.

Four sections (per the scoping decision — all four, fully auto-generated):

1. **Race-result summary** — winner + podium, key cautions / lead changes /
   margin of victory, notable finishes. (Baseline fans expect.)
2. **Moat-metric storylines** — the differentiator. Per-race adjPE and Closer
   Score standouts: who most out-passed expectation for their track position,
   who gained the most vs. the league's closing baseline. The story the box
   score can't tell.
3. **Playoff / standings movement** — points standings snapshot after this race,
   points gained this race, the top-16 playoff picture with a cut line, and
   each contender's movement since the previous race.
4. **Driver-level callouts** — biggest over- and under-performer vs. their own
   trailing form, with links into their profile pages.

## Scope / Non-goals

- **No live data.** A recap is inherently post-race; it runs entirely off data
  already ingested + computed. This is why it's the right first step (vs. the
  live race companion, which needs the live feed).
- **v1 playoff logic is simplified.** We render points standings + a top-16
  "playoff picture" + movement-since-last-race. We do **not** model the real
  NASCAR playoff format (round-by-round elimination, points resets, waivers,
  win-and-in). Full playoff-round/cut-line logic is logged as tech debt and a
  future refinement — it is season-phase-dependent and materially larger.
- **No client-side JS** — server-rendered like the rest of the site, statically
  exportable via the existing `render.ts` path.
- **No new metric *definitions*** — reuses the exact adjPE/Closer residual math
  already in `analytics/service.ts`; only adds a per-race application of it.

## Design

Recaps compose ≥2 domains (ingestion race data + analytics), and cross-domain
service imports are forbidden, so the **pure computations live in the analytics
domain** (persisted by `compute`), and the **page assembly lives in the app
layer** — matching how every existing multi-domain page is wired.

### analytics domain (types → config → service → repo → runtime)

New **persisted** per-race artifacts, computed during `bun run compute` so page
render stays read-only and fast (keeps the <60ms guarantee):

- `types.ts`:
  - `RaceMetricStandout` — one driver's single-race adjPE residual and Closer
    residual (value + the league-baseline context), for the top/bottom callouts.
  - `RaceRecap` — the assembled payload: race header, standouts, standings
    movement rows, form callouts. (Assembled in the app layer at render time
    from persisted pieces; the *pieces* are what analytics owns.)
- `config.ts`: `RECAP_STANDOUT_COUNT` (how many over/under-performers to show).
- `service.ts` (pure, unit-tested — reuses existing helpers):
  - `raceMetricStandouts(loops, exp)` — apply the existing per-loop residual math
    (`passEfficiency` − `exp.passEfficiencyByAvgPs`; `closingLapsDiff` −
    `exp.closingGainByClosingPs`) to a **single race's** loop rows, returning each
    driver's per-race adjPE + Closer residual. Baselines are the same
    `LeagueExpectations` `computeAll` already builds — pass them in, don't rebuild.
  - `cumulativePointsStandings(results, uptoRaceId)` — fold `PointsResultRow`s by
    date into running points, returning standings **as of** a given race and the
    prior race, so movement (Δ rank, Δ points, playoff cut line at P16) is a diff.
  - `formCallouts(raceResults, formRows)` — best/worst finish vs. the driver's
    trailing-form `avgFinish` as of that race (over/under-performer).
  - Persist per-race standouts in a new `race_metric_standouts` table via repo
    (written in `computeAll`, alongside the existing three tables).
- `repo.ts`: `replaceRaceStandouts` / `raceStandouts(raceId)` reads; a
  `pointsResultsThroughRace`/date-ordered read to back cumulative standings.
- `runtime.ts`: `handleRecap` → `/api/recap/:raceId` (dev convenience / API parity).

### app layer

- `pages/recap.ts`: the four-section recap template — reuses `card`, `statChips`,
  `badge`, `barRow`, `deltaArrow`, `withSeries` from `html.ts`; links drivers to
  their profiles and the race to `/race/{id}`.
- `render.ts`: `renderRecap(p, raceId)` (canonical, un-prefixed like `/race/{id}`
  since race_id is global; series derived from the race) and `renderLatestRecap(p,
  seriesId)` for the per-series "this week" entry point.
- `server.ts`: routes `/recap` (latest completed race for the series) and
  `/recap/{raceId}`.
- `export.ts`: pre-render `/recap` per series + `/recap/{raceId}` for recent races
  (bounded — e.g. current season) so the static site carries them.
- `layout.ts`: surface the recap — a "Latest Recap" nav entry and/or promote it
  on Home. (Home already loads `latestRace`; add a prominent recap hero card that
  links to `/recap`.)
- `html.ts`: any small formatting helper the callouts need (reuse first).

### weekly refresh tie-in

The recap is regenerated by the existing `sync → compute → export` chain: `sync`
brings the new race in, `compute` refreshes `race_metric_standouts`, `export`
re-renders `/recap`. This is the same pipeline the (separate) auto-refresh CI
plan will schedule — the recap needs no special automation of its own.

## Verification

- **Unit (analytics service, pure):**
  - `raceMetricStandouts` — residual sign/magnitude vs. a known baseline;
    drivers with no green-flag encounters excluded; ordering.
  - `cumulativePointsStandings` — running totals, movement diff, cut-line at P16,
    first-race-of-season edge (no prior race).
  - `formCallouts` — over/under-performer selection vs. trailing form; ties;
    driver with no prior form.
- **E2E (app.server.test):** `/recap` renders all four sections for the latest
  race; `/recap/{raceId}` renders a historical race; series-aware; home hero card
  links in; `/api/recap/:id` shape.
- **Compute idempotency:** re-running `compute` reproduces identical
  `race_metric_standouts`.
- Full `bun test` green (incl. architecture tests).

## Docs to update on completion

- Move this plan to `completed/`, update `PLANS.md` (Active → Completed).
- `ARCHITECTURE.md`: add `race_metric_standouts` to the schema/structure notes;
  Current Guarantees (+ recap page + per-race metric standouts); update
  "What Does NOT Exist" (recap now exists; note simplified playoff logic).
- `docs/product-specs/index.md`: link the recap spec.
- `docs/exec-plans/tech-debt-tracker.md`: log "recap playoff picture is
  points-only, not the real elimination/reset format."
- `QUALITY_SCORE.md`: web-app + analytics notes if grades shift.
