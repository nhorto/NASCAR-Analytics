# Exec Plan: Polish Pass + Deployment Prep

**Status:** COMPLETED 2026-07-05
**Created:** 2026-07-05
**Follows:** [Multi-Series](2026-07-05-multi-series.md)

## Progress
- ✅ Polish item 1 (In Form regular filter) — done 2026-07-05, tested + browser-verified (Xfinity In Form now shows regulars, not Cup part-timers).
- ✅ Polish item 2 (track-explorer on-screen filters) — done 2026-07-05, tested + browser-verified (Since-year + Min-starts selects, state-preserving links).
- ✅ Deployment research — presented options; Nick chose Cloudflare Pages → [static export plan](2026-07-05-cloudflare-static-export.md).

## Goal

Two user-facing polish fixes, then research (not yet build) deployment so Nick can decide where/how to host. Direction confirmed by Nick: "polish pass then figure out where and how we are going to deploy this."

## Polish items (the two visible ones; other debt intentionally deferred)

### 1. "In Form" surfaces part-timers
The home-page In Form list ranks trailing-window form with only a `window_races >= 4` gate. In a lower series, a Cup regular who made a handful of strong starts can top the board. **Fix:** only rank drivers who ran at least half the series' points races so far this season (a "regular" filter). New config constant `FORM_LEADER_MIN_SEASON_SHARE = 0.5`, enforced in the `formLeaders` repo query via a season-start count vs. the season's race count. Test: a regular is included; an elite low-start part-timer (who passes the old `window_races >= 4` gate) is excluded.

### 2. Track explorer has no on-screen filters
Season window and min-starts are URL-only. **Fix:** a compact filter form (Since-year select + Min-starts select) that GET-submits, preserving series/type/sort via hidden fields. Segment and sort links also carry `min` so changing type/sort doesn't reset it. Server passes the series' available seasons for the year dropdown. This is the mockup's "Filters ⚙" placeholder made real.

Resolves two tech-debt entries; the other four stay deferred.

## Deployment research (present options, don't build yet)
- The app is Bun + `Bun.serve()` + a single SQLite file. Data: ~160MB DB (all 3 series), plus a ~190MB+ raw archive that does NOT need to ship (it's regenerable insurance; the app only reads `nascar.db`).
- Reads are all from precomputed tables → a tiny always-on server or even a periodically-rebuilt static export could work.
- Deliverable: a short options matrix (managed container host, VM, static export, etc.) with cost/effort/fit and a recommendation. Nick chooses; then a follow-on plan builds it.

## Verification
- `bun test` + `bunx tsc --noEmit` green.
- Browser-verify both fixes across at least Cup + one lower series.
