# Real Playoff-Format Model

**Status:** COMPLETE
**Started:** 2026-07-05
**Completed:** 2026-07-05

## Outcome

Shipped. The recap's "Championship Picture" is now a season-phase-aware
**Playoff Picture** (`playoffPicture`): the regular season shows the real
win-and-in field (winners in the top-30 locked, remaining spots by points, cut
line + bubble with points-behind); the playoffs show the round (Round of 16 →
12 → 8 → Championship 4, per `PLAYOFF_FORMAT_BY_SERIES`) with race-winner
auto-advance, round-by-round eliminations, and an eliminated-drivers trail.
Phase is derived from the last-N races of the ingested season schedule (so it's
known mid-season). Pure/unit-tested (`regularSeasonField`, `playoffStandings`,
`seasonAggregates`); wired through `/recap`, `/recap/{id}`, and `/api/recap/:id`.
Verified with a full 18-driver seeded season (Round-of-12 and Championship-4
render paths). Remaining approximations (waivers, reset totals, ties) logged as
tech debt. Full `bun test` green (134).

## Problem

The weekly recap's "Championship Picture" uses a **simplified points cut line**
(top 16/12/10 by raw season points). That's wrong the moment it matters most:

- **Regular season** (now): the real playoff picture is **win-and-in** — every
  race winner (top-30 in points) is locked into the field regardless of points;
  only the remaining spots go to winless drivers by points. A pure points order
  hides the entire storyline ("X won, he's in; the cut line is between Y and Z").
- **Playoffs** (Sept–Nov): drivers reset, race in **rounds** (16→12→8→4 for Cup),
  a round win **auto-advances**, and the field is trimmed after each round's
  cutoff. Raw season points are meaningless here.

Logged as tech debt; this replaces it with a season-phase-aware model.

## The format (modeled window: 2017–present, current formats)

Encoded per series in config:

| Series | Field | Rounds (cut after) | Round races | Playoff races |
|--------|-------|--------------------|-------------|---------------|
| Cup (1) | 16 | 12 → 8 → 4 | 3, 3, 3, 1 | 10 |
| Xfinity (2) | 12 | 8 → 4 | 3, 3, 1 | 7 |
| Trucks (3) | 10 | 8 → 4 | 3, 3, 1 | 7 |

- Playoff points (`results.playoff_points_earned`, ingested since 2017) carry and
  re-seed at every round; within a round, cut order = playoff points + race points
  earned in that round. A round win = auto-advance (clinched).
- Regular-season win eligibility approximates the real rule as **≥1 win AND top-30
  in points** (waivers / encumbered wins not modeled).

## Phase detection

Playoff races = the **last N scheduled races of the season by date** (N =
playoff-race count for the series). Robust because nothing exhibition runs after
the regular-season finale (the All-Star race is mid-season, the Clash is
preseason). The full season schedule — including not-yet-run races — is in the
`races` table (ingested by `backfill`), so the split is known mid-season too.

## Design

### analytics domain
- `config.ts`: `PLAYOFF_FORMAT_BY_SERIES` (field size, round cut sizes, round race
  counts), `PLAYOFF_RESET_BASE`, `PLAYOFF_WIN_ELIGIBILITY_RANK = 30`.
- `types.ts`: `PlayoffFormat`, `PlayoffPictureRow` (driver, wins, points, playoff
  points, status: `in-win` | `in-points` | `bubble` | `out` | `clinched` |
  `eliminated`, pointsBehindCut), `PlayoffPicture` (phase, roundLabel, cutSize,
  rows).
- `service.ts` (pure, unit-tested):
  - `seasonAggregates(rows, throughRaceId)` — per-driver points/wins/playoffPoints
    through a race, points-ranked (for the top-30 gate).
  - `regularSeasonField(aggs, format)` — win-and-in seeding + winless-by-points
    fill + cut line + bubble, with the >field-size-winners edge handled by playoff
    points.
  - `playoffStandings(rows, raceSequence, format, throughRaceId)` — round-by-round
    simulator: seed the field from the finale, accumulate each round's race points
    + carried playoff points, auto-advance round winners, eliminate to the cut;
    emit the current round's standing.
  - `playoffPicture(rows, raceSequence, format, throughRaceId)` — dispatches
    regular vs playoff and returns a unified `PlayoffPicture`.
- `repo.ts`: add `playoffPoints` to `seasonPointsResultsWithNames`; new
  `seasonRaceSequence(seriesId, season)` (all races by date → last-N = playoffs).
- `runtime.ts`: `/api/recap/:id` gains `playoff` alongside the existing fields.

### app layer
- `pages/recap.ts`: replace the "Championship Picture" card with a phase-aware
  **"Playoff Picture"** card — regular season shows the win-and-in field (W / PP /
  Pts columns, cut-line divider, bubble drivers with "−N to cut"); playoffs show
  "Round of N · after race M" with clinched (auto-advanced) and below-cut markers.
- `render.ts`: `renderRecap` computes the playoff picture and passes it in.
- The existing `standingsMovement` stays (points-movement util + API field); the
  recap page just renders the richer playoff picture instead of the naive cut.

## Verification

- Unit: `regularSeasonField` (win-and-in, winless fill, cut line, >field winners
  edge, top-30 gate); `playoffStandings` (round detection, auto-advance, an
  elimination across a cutoff, championship round); `playoffPicture` phase
  dispatch; phase detection from a race sequence.
- E2E (app.server.test): recap renders a "Playoff Picture" card; seed a small
  playoff-phase scenario to exercise the round path.
- Full `bun test` green (incl. architecture tests).

## Docs to update on completion
- Move plan to `completed/`, update `PLANS.md`.
- `ARCHITECTURE.md`: Current Guarantees (recap now models the real format);
  remove the "No real playoff-format model" gap from "What Does NOT Exist".
- `tech-debt-tracker.md`: resolve the "Recap playoff picture is points-only" item;
  note the remaining approximations (waivers, reset totals, ties).
