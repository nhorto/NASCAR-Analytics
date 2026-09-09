# App Nav Realignment — Delete the Pro Tab, Retab by Intent

**Status:** ACTIVE · created 2026-09-09
**Design doc:** [../../design-docs/2026-09-09-ux-realignment.md](../../design-docs/2026-09-09-ux-realignment.md) (+ mockup HTML, owner-approved 2026-09-09)
**Parent:** WS-J (native mobile app). This changes navigation and presentation only — entitlement logic, `/api/me`, `hiddenCount`, 403 gating, and the purchases stub are untouched.

## Goal

Replace Home / Live / Drivers / **Pro** / Account with intent-named tabs where
every feature lives where a fan would look for it, and Pro renders as inline
lock states plus one shared upsell sheet — never as a place. Free and Pro
viewers see identical navigation; only lock treatments differ.

## Tab bar (order is a decision, recorded here)

| # | Tab | Icon (Ionicons, outline↔filled) | Why this slot |
|---|-----|--------------------------------|----------------|
| 1 | Home | `home-outline` / `home` | default landing, leftmost by convention |
| 2 | Live | `radio-outline` / `radio` | race-day surface; easy left-thumb reach; carries the live indicator |
| 3 | Picks | `podium-outline` / `podium` | the marquee (and monetized) feature gets the center slot |
| 4 | Stats | `stats-chart-outline` / `stats-chart` | reference material, browsed not checked |
| 5 | Account | `person-circle-outline` / `person-circle` | rightmost by convention |

- Icons via `@expo/vector-icons` (Ionicons) — first mobile UI dependency
  (`bun add @expo/vector-icons`; fonts bundle into the binary, no network).
  Active tab uses the filled variant + accent tint; inactive outline + muted.
- **Live indicator:** when the Worker reports a live race, the Live tab shows a
  small red dot badge and its icon tints `--neg` red (mirrors the web's
  `.livedot`). Mechanism: a `LiveStatusProvider` beside `ViewerProvider`
  polling the Worker's `/api/live/status` every 60s **only while the app is
  foregrounded** (AppState listener), exposing `isLive` to `_layout.tsx`
  (`tabBarBadge`) and to Home's LIVE banner. Reuses `features/live/api.ts`.
  Tab bars never reorder dynamically — the dot is the only live-state change.
- Label alternatives considered for #3: "Predict", "Weekend" ("Race Day"
  collides with Live). "Picks" chosen: shortest honest label. One-line change
  if the owner renames it.

## Screens

- **Picks** (`app/picks.tsx`, new): segmented control **Predictions ⇄ DFS**
  hosting the existing `PredictionsScreen` / `DfsScreen` bodies (they are
  already embeddable components; free-state behavior — real top-3 +
  `hiddenCount`, DFS `ProLock` — is preserved). Free viewers additionally get
  greyed placeholder rows under the top-3 with an inline
  "🔒 N more · Unlock with Pro" row (matches the web teaser). Methodology
  stays a pushed route. The old `/predictions` + `/dfs` routes remain
  registered (hidden) so nothing deep-links into a 404.
- **Stats** (`app/stats.tsx`, promoted to a tab): hub rows **Drivers ·
  Compare · Track types** on top, then the existing standings + metric-leader
  cards inline (that content already lives in `StatsScreen`). `drivers.tsx`
  drops out of the tab bar (hidden route; `driver/[id]` unchanged).

## Series browsing (owner decision 2026-09-09: in scope — the server is ready)

The server already serves every series to the app's endpoints — `?series=2|3`
on `/api/standings/:season`, `/api/metrics`, `/api/drivers`,
`/api/drivers/:id/stats` — with `jsonRequestBlocked` returning the same 403
`pro_required` the web teaser rests on. The app hardcodes `series=1` today;
this plan stops that.

- **`SeriesProvider`** (beside `ViewerProvider`): selected series 1/2/3,
  persisted in async-storage, exposed via `useSeries()`.
- **`SeriesPills`** shared component (Cup / Xfinity / Trucks, house seg
  style): Cup always open; Xfinity/Trucks show a lock glyph for free viewers
  and tapping a locked pill opens the upsell sheet — a fan never hits a raw
  403 surprise (the 403 handling stays as defense-in-depth).
- **Where it applies (shipped):** Stats (standings, metric boards — pills at
  top) and Drivers index. These are the stat surfaces the owner meant ("we have
  the data") — the server serves 2/3 to `/api/standings`, `/api/metrics`,
  `/api/drivers`, all already series-parameterized.
- **Live — deferred (documented):** the live board's `api.ts` is Cup-fixed and
  the Worker's non-Cup live coverage is unverified; threading series through the
  real-time poller + badge is a larger separate change, and Cup-first live is a
  standing product decision (D16), not a data gap. No pills on Live in this pass
  (the plan's rule: never show pills on a screen that ignores them).
- Compare and Tracks keep their own Pro series controls from WS-G (out of scope
  here); they can adopt `useSeries()` as a default in a later polish pass.
- **Where it doesn't:** Picks stays Cup-only with the same honest fast-follow
  note the server gives (`cupOnlyContent`) — predictions/DFS data genuinely
  doesn't exist for series 2/3 yet (launch decision D16). Home follows the
  selected series only where its backing data is series-scoped; audit during
  build, and never show pills on a screen that ignores them.
- **Account**: gains a "LoopLab Pro" row — Pro: plan status + `proUntil`;
  free: opens the upsell sheet.
- **Pro tab deleted**: `app/pro.tsx` and `ProScreen` removed. Their pitch +
  feature list become **`UpsellSheet`** (`features/pro/UpsellSheet.tsx`, a
  bottom-sheet modal): ✓ feature list, honest CTA (the disabled
  "Purchases coming to the app" until J1/J2 — Apple 3.1.1), "Already Pro?
  Sign in" path. Every locked tap anywhere opens this one sheet. `ProLock`
  survives as the in-screen locked card (DFS body, etc.).

## Steps

1. Add `@expo/vector-icons`; retab `_layout.tsx` (order + icons above; hide
   `drivers`, `predictions`, `dfs`; delete `pro`).
2. `LiveStatusProvider` + hook; wire badge/tint + Home banner. Colocated test
   for the status parse + foreground-only cadence logic (pure parts).
3. `SeriesProvider` + `SeriesPills`; thread `seriesId` through stats/drivers/
   live api.ts calls (drivers already takes it); locked-pill → upsell sheet;
   403 → locked state. Colocated tests for the series-threading + gate
   fallbacks.
4. `picks.tsx` + segment control; locked-row treatment on free predictions.
5. Stats hub restructure (pills + hub rows + boards); Account Pro row;
   `UpsellSheet` + wiring; delete `ProScreen`.
6. Update colocated model/api tests; `cd mobile && bun run typecheck && bun test src`.
7. Drive both entitlement states in the iOS Simulator (Expo Go, per the
   first-drive playbook): every tab, every hub row, every lock → sheet, Pro
   grant → all locks gone + Xfinity/Trucks boards render real rows.
8. Docs: ARCHITECTURE.md mobile bullets, design doc status, this plan →
   completed, PLANS.md.

## Acceptance

- [x] Tab bar is Home · Live · Picks · Stats · Account with real Ionicons;
      no "Pro" tab anywhere (`pro.tsx` + `ProScreen.tsx` deleted).
- [x] Navigation identical free vs Pro; free sees inline locks (predictions
      top-3 + `ProLock`, DFS `ProLock`, locked series pills) + the shared
      `UpsellSheet`; Pro sees no locks and no upsell.
- [x] Live tab shows a red dot badge during a live race; `LiveStatusProvider`
      polls `/api/live/status` only while foregrounded (AppState-gated).
- [x] Predictions/DFS ≤ 2 taps (Picks tab → segment); Compare/Tracks ≤ 2 taps
      (Stats hub → row).
- [x] Series pills on Stats + Drivers: Pro switches to real Xfinity/Trucks data
      (`?series=N`); free gets lock glyphs and the sheet, never a raw error
      (403 also maps to the locked state). **Live series deferred** — see above.
- [x] Entitlement still 100% server-read (`/api/me`, `?series=` 403s); no
      checkout links; the purchase button states stub unavailability honestly.
- [x] Typecheck + tests green (`bun run typecheck` clean; `bun test src` 95
      pass, +3 new; root `bun test` 869 pass).
- [x] **Simulator drive of both states — DONE 2026-09-09.** Driven on an iOS
      simulator *and* (a project first) an Android emulator via Maestro, in
      both entitlement states, against a 3-series database. Found and fixed a
      **P1** (successful sign-in reported as failure on Android — every
      unverified account, i.e. everyone, was locked out) and a P2 (missing
      series data blamed on the network). See
      [the drive report](2026-09-09-mobile-device-drive.md).
