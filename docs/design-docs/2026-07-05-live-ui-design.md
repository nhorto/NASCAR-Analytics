# Live UI — Design Spec (Phase 3)

**Status:** Design research — for owner review before building the live page.
**Companion mockup:** [`2026-07-05-live-ui-mockup.html`](2026-07-05-live-ui-mockup.html) (open it; frame 2 is interactive).
**Plan:** [Live Race Day Companion](../exec-plans/active/2026-07-05-live-race-companion.md) — this is the UI for **Phase 3**.
**Depends on:** Phase 1 (`live` domain: `normalizeFeed`, `computeLiveMetrics`, `deriveAlerts`, `pitCycleModel`, `baselines.json`) and Phase 2 (`GET /api/live` snapshot). Built, pending push.

---

## 1. What this screen is for

During a race the current product does nothing, yet that's when fans are most engaged
(~87% second-screen). The goal is a **free, in-app, mobile-first live companion** that lets a
fan answer three questions at a glance and drill for depth:

1. **What's happening in the race right now?** (flag, stage, who's leading, who's moving)
2. **How is *my* driver doing?** (position, gaps, and — the moat — live loop metrics)
3. **What's about to happen?** (pit cycle, undercut threats, tire falloff)

Design tension resolved: **glanceable *and* informative** via a **layered** structure — a board
that stays scannable, with all the depth **one tap away**. We do not choose density over
glance; we stack them.

---

## 2. Information architecture

A single new **Live** section (5th bottom-tab, replacing/next to Tracks per nav decision below),
carrying a **🔴 LIVE dot when a session is on track**. Inside it, an anchored sub-structure the
user scrolls, not a maze of pages:

```
Live
├─ Race-status header        flag · stage · laps-to-go        (always pinned on top)
├─ Sort toggle               Running Order  |  Loop Rating ★
├─ Leaderboard (the board)   one row per car; TAP a row → per-driver drill-down inline
├─ Race Overview             movers & battles · field loop leaders
├─ Strategy                  green-flag pit cycle · undercut watch · tire falloff
└─ My Driver                 follow card + alert feed  (localStorage, no account)
```

The **board is the spine**. Race Overview / Strategy / My Driver are sections below it (or
secondary tabs within Live if the scroll gets long — see open questions). The **drill-down is
the depth axis**: tap any car to expand its full live panel in place; tapping another collapses
the first (single-open accordion).

### Two existing axes are preserved
- **Series** (Cup / Xfinity / Trucks) — the segmented switcher stays; each series has its own
  live feed (`series_1/2/3`).
- **Section** (Home / Drivers / **Live** / Compare / Tracks) — Live joins the bottom bar.

---

## 3. Component inventory (all reuse existing DESIGN.md patterns + a few live-only additions)

| Component | Built on | New? |
|---|---|---|
| Race-status **flagbar** | card + hero gradient | new — flag-colored gradient, stage progress track, laps-to-go readout |
| **Sort toggle** | `.seg` segmented control | reuse |
| **Leaderboard row** | table row + number badge | new layout — pos · badge · name · gap · mover ▲▼ · chevron |
| **segbar** (mini loop trend) | — | new — 5 ticks, last-5-lap trend (green gaining / yellow holding / red losing); F1 mini-sector analog |
| **Driver drill-down** | stat chips + split bars + sparkline | reuse components, new assembly |
| **Movers / Battles** | table + badges | new light layout |
| **Pit-cycle rows** | split bars | new — stint bar colored by tire life, est. pit lap |
| **Alert feed** | — | new — icon + text + timestamp rows |
| **Follow card** | hero card | reuse |
| **LIVE dot / livechip** | — | new — the only use of a red pulse; never decorative |

Color stays strict: **accent yellow = highlight**, **green = gaining/good**, **red = losing/bad**,
plus one reserved **live-red** for the LIVE indicator only.

---

## 4. The board (glanceable layer)

One row per car, sorted by **running order** by default. Each row shows, left→right:

`POSITION · number badge · driver + team + segbar · [mover ▲▼] · [gap] · chevron`

- **mover ▲▼** — positions gained/lost **vs. start** (green/red, tabular).
- **gap** — seconds to leader; P1 shows interval to P2; leader labeled "Leader".
- **segbar** — the at-a-glance loop read: are they gaining right now, holding, or losing?

**Sort toggle → "Loop Rating ★"** re-ranks the identical board by our **live Adjusted Pass
Efficiency estimate** (swap the gap/mover columns for the metric value). This is the
differentiator in one tap: *nobody else shows a live board ordered by proprietary loop metrics.*

---

## 5. Per-driver drill-down (depth layer) — tap any row

Expands inline beneath the row. Four blocks, all confirmed against live-feed fields:

**a. Live position & gaps** — 4 mini-chips: Position · Gap to leader · Positions vs. start ·
Last-lap speed. (Also available: gap to car ahead/behind, best-lap speed, laps led.)

**b. Live loop metrics · with field rank** — split bars for **Adj Pass Efficiency (live est.)**,
**Quality Passes**, **Closer estimate**, each with the driver's **rank in the field** (`#2`) so a
raw number means something. This is the moat surfaced per driver, live.

**c. Pit / strategy status** — last stop (lap + positions gained/lost), laps on current tires,
and a window tag ("Pit window open" / "Undercut threat"). From `pit_stops[]` + `pitCycleModel`.

**d. This race so far** — two sparklines: **running-position trend** (are they building or
fading) and **lap-speed falloff** (tire life). Same inline-SVG sparkline pattern as the profile page.

---

## 6. Race Overview (the "how's the race going" layer)

- **Race chips** — Lap · Cautions · Lead changes · Leaders (from feed top-level counters).
- **Movers · last 10 laps** — biggest **gainers** and **faders** side by side (derived from
  `running_position` deltas over the snapshot window).
- **Battles now** — pairs within ~0.4s on track (from `delta` spacing), with the closing/opening
  arrow. Answers "where's the action."
- **Field loop leaders · live** — who leads each proprietary metric right now (live est.), with
  the "swaps to official post-race" note so we never over-claim precision mid-race.

---

## 7. Strategy / pit-cycle tracker (the novel differentiator)

- **Green-flag pit cycle** — per car, a **stint bar** colored by remaining tire life
  (green→yellow→red) and an **estimated pit lap** from lap-time falloff since last stop; pitted
  cars greyed. This is the loop-data analog of F1's tire-strategy tower.
- **Undercut watch** — plain-English callouts: who pitted fresh and is gaining, who's past their
  falloff cliff and must pit. Built from `pitCycleModel` + live lap-time deltas.
- **Tire falloff · leaders** — lap-time-vs-laps-on-tires line per contender; a steeper line =
  pits sooner. Directly serves the "predict the pit cycle" pillar from the research.

> All strategy outputs are **model estimates**, labeled as such — never presented as certainty.

---

## 8. My Driver + alerts (the retention layer)

- **Follow card** — pick a driver (persists in `localStorage`, no account). Shows their live
  position, gap, positions-vs-start, top metric with rank, laps led.
- **Alert feed** — reverse-chron events from `deriveAlerts(prev, next)`: position changes, pit
  in/out, caution/restart, **metric milestones** ("now #1 in live pass efficiency"), stage
  results. Icon-coded (good/bad/warn).
- **Alert prefs** — user-toggled categories, stored locally.
- **MVP is in-app only** — no lock-screen push (fast-follow phase per the plan). The Home tab
  also carries a **"While You Were Away"** digest so the alert value survives leaving the app.

---

## 9. States

| State | Behavior |
|---|---|
| **Live** | Full board; header pinned; client polls `/api/live` ~5s; LIVE dot pulses on the tab. |
| **Idle** (no session) | "No session on track" empty state + **Next Up** race with "remind me at green" and "set my driver". DO backs off to ~60s → ~$0. |
| **Between green/caution** | Flagbar switches green↔yellow (color + label); restart context surfaces in alerts. |
| **Post-session** | Board freezes on final order; metrics **swap from live estimate → official** `loopstats/prod` values; a "Full recap →" link hands off to the existing Recap page. |
| **Stale/error** | If a snapshot is >~20s old, show a subtle "reconnecting…" chip rather than silently freezing (reliability is the incumbent's failure — we make degraded state honest). |

---

## 10. Data mapping (design → live feed)

Everything above maps to **already-confirmed** live-feed fields (see the research doc §1) — no new
data source:

| UI element | Source field(s) |
|---|---|
| Position, gap, mover | `running_position`, `delta`, `starting_position` |
| Last/best lap | `last_lap_speed`, `best_lap_speed` |
| segbar / movers / battles | `running_position` + `delta` deltas across snapshots |
| Live loop metrics | `passes_made`, `times_passed`, `passing_differential`, `quality_passes`, `position_differential_last_10_percent` × `baselines.json` |
| Pit / strategy | `pit_stops[]` (`pit_in_lap_count`, `pit_out_lap_count`, `positions_gained_lossed`), lap-time falloff |
| Flag / stage / laps-to-go | `flag_state`, `stage`, `laps_to_go`, `laps_in_race` |
| Race chips | `number_of_caution_segments`, `number_of_lead_changes`, `number_of_leaders` |
| Alerts | diff of consecutive snapshots (`deriveAlerts`) |

**Live vs. official:** during the race we show live *component* stats + a live *estimate* of our
metrics; once `loopstats/prod` finalizes we swap to authoritative values. The UI always labels
which it's showing.

---

## 11. Nav decision (needs owner confirmation)

The bottom bar has 5 slots (Home / Drivers / Races / Compare / Tracks). Live needs a home. Options:
- **A (mockup default):** Live **replaces Tracks** in the bar on race day; Tracks moves under a
  "More" affordance. Keeps 5 tabs, puts Live front-and-center when it matters.
- **B:** Live is a **6th tab** (crowds the bar on small phones).
- **C:** No permanent tab — Live is reached **only** via the Home LIVE banner (lowest friction to
  build, least discoverable when someone opens mid-race).

Recommend **A**. Flagged as an open question below.

---

## 12. Open questions for the owner

1. **Nav placement** — A / B / C above? (mockup assumes A.)
2. **Section vs. scroll** — Race Overview / Strategy / My Driver as **secondary tabs inside Live**,
   or one **long scroll** below the board? (mockup shows them as separate frames; either fits.)
3. **Default sort** — open on **Running Order** (familiar) or **Loop Rating ★** (our
   differentiator)? Recommend Running Order default, one tap to the moat.
4. **TV-sync delay slider** — the research calls this "disproportionately loved." In-scope for the
   MVP live page, or fast-follow?
5. **Confidence display** — do we show a small "estimate" confidence indicator on live metrics
   early in a race (few laps = noisy), or just the value + the swap-to-official note?
6. **Full field vs. top-N** — board shows all 38 by scroll; do we want a "my driver + neighbors"
   condensed default with a "show full field" expand?

---

## 13. What this deliberately does not include

- **No live driver-tracker map / telemetry** — throttle/brake/GPS is SMT/RaceView's proprietary
  pipeline, not in the public JSON. We win on loop-data insight, not a track map.
- **No betting / win-probability layer** — deferred (design leaves room for it as a future
  Race Overview module).
- **No lock-screen push** — in-app alerts only for MVP.
