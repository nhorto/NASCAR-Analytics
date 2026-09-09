# Mobile Device Drive — iOS Simulator + Android Emulator

**Status:** COMPLETE · 2026-09-09
**Follows:** [App Nav Realignment](2026-09-09-app-nav-realignment.md) (its one open acceptance box was
"simulator drive of both states — owner-gated"). This closes that box, and adds the
**first Android run in the project's history**.

## Why

The 2026-09-09 UX realignment shipped the app retab (5 tabs, Picks, Stats hub,
UpsellSheet, series pills) verified only by typecheck + unit tests. WS-J's
standing gap was that **no screen had ever rendered on a device**, and Android
had never been run at all — so the tab bar, icons, sheet layout and the whole
Android auth path were unproven.

## Environment

- DB: `VACUUM INTO` snapshot of the 3-series database (Cup 327 / Xfinity 264 /
  Trucks 187 races) — a plain `cp` of the live WAL database produced a corrupt
  copy, so the snapshot is taken through SQLite, not the filesystem.
- Server: `PORT=3111 LOG_REQUESTS=1 bun run src/app/index.ts serve`. Port 3111
  because a **stale dev server from the 2026-09-08 drive still owns :3000** from
  another worktree; it was left running rather than killed.
- iOS: iPhone 17 simulator (iOS 26.2), Expo Go 57.0.9 from `~/.expo` cache.
- Android: `Medium_Phone_API_36.1` emulator (Android 16), Expo Go 57.0.9 APK
  installed via `adb install`; `adb reverse tcp:3111` + `tcp:8081` so the
  emulator's `localhost` reaches the host.
- Driver: **Maestro 2.6.0** (drives both platforms from one tool; AXe, used on
  2026-09-08, is no longer installed). Both devices connected at once, so flows
  must pass `--device`.
- Entitlement: `drive@example.com`, Pro via `bun run grant`.

## Findings

Severity: **P1** blocks a paying user, **P2** wrong/misleading output, **P3** polish.

| # | P | Surface | What | Status |
| - | - | ------- | ---- | ------ |
| 1 | **P1** | android (shared auth) | **A successful sign-in was reported as a failure and the app stayed signed out.** `classifyAuthResponse` only treated a landing on `/account` as success when the page carried *no* form error — but the signed-in account page always renders `<p class="note form-error">Email not verified — required before upgrading</p>`, and since verification mail cannot be sent yet (A4) **every real account is unverified**. The result was classified `rejected` *with* detail, which also made it "conclusive" and so skipped the `/api/me` fallback added on 2026-09-08. Android hit this every time; iOS masked it because its cookie jar applies `Set-Cookie` late, bounces to `/signin`, and takes the inconclusive→`/api/me` path instead. | **fixed** |
| 2 | P2 | mobile | A Pro viewer selecting a series with no ingested data saw **"Could not reach the server."** — the server was fine and answering 404. Same class as the 2026-09-08 drive's finding #2 (blaming the wrong thing for missing data). `fetchStats` now distinguishes 404 → `"empty"` from a transport failure, and Stats renders "No {series} data yet — we haven't loaded this series yet." | **fixed** |
| 3 | P3 | mobile | Settings' **Save button sits under the keyboard**: the field is focused, the keyboard covers Save, and a tap lands on the keyboard. Cost two attempts to set the server address before "Saved." appeared. Not introduced here (pre-dates the realignment). Fixed with a `KeyboardAvoidingView` plus `returnKeyType="done"` / `onSubmitEditing`, so the keyboard's own done key saves; re-verified on the emulator (Save fully visible with the keyboard up, and Enter produces "Saved."). | **fixed** |
| 4 | P3 | a11y | Tab buttons announced **"Home, tab, 1 of 15"** — 15 because expo-router counts the ten `href: null` routes that deliberately live in this navigator so pushed screens keep the tab bar. Fixed with explicit `tabBarAccessibilityLabel`s; the hierarchy now reads "Home, tab 1 of 5" … "Account, tab 5 of 5". | **fixed** |
| 5 | P3 | repo | `expo start` rewrites `mobile/tsconfig.json`, dropping `expo-env.d.ts` and `.expo/types/**/*.ts` from `include` (it did it again on this second run). Reverted, and now guarded by `mobile/src/lib/__tests__/tsconfig.test.ts` so the narrowing fails a test instead of riding along in a diff. | **fixed** |
| 6 | **P1** | app/server | **A subscriber kept seeing the paywall after paying.** `/api/predictions` returns *different 200 bodies* by entitlement (free: three rows + `hiddenCount`; Pro: the whole field) but was classed as shared `data` and served `public, max-age=300` while anonymous. The app cached the anonymous body, and after sign-in the Picks tab re-rendered the **free** board — "39 more drivers with Pro" — from its own HTTP cache, with **no request reaching the server**, for up to five minutes. Caught on Android by noticing DFS unlocked while Predictions did not, then confirming the server log had no `/api/predictions` call after `/api/me 200`. Fixed with a `viewer` cache class (`private, no-store`) for endpoints whose 200 body varies by entitlement; endpoints that *refuse* rather than trim (403 `/api/dfs`, the series JSON) were already safe. Regression-tested in `tests/app.http.test.ts` and re-verified on-device: the full board now renders immediately after sign-in. | **fixed** |

## What was verified working — both platforms

Every item below was seen rendered on a real simulator/emulator, in both
entitlement states, with server request logs confirming the calls.

- **Tab bar**: Home · Live · Picks · Stats · Account, real Ionicons (filled when
  active, gold accent), **no Pro tab**. Identical on iOS and Android.
- **Navigation does not change with entitlement** — free and Pro see the same
  five tabs, same pills, same hub. Only lock state differs.
- **Stats**: series pills (Cup free; Xfinity/Trucks padlocked for free viewers),
  Explore hub (Drivers / Compare / Track types), standings + metric boards.
- **Upsell sheet**: a locked pill opens it with the contextual reason
  ("Xfinity Series is a Pro series."), the five-benefit list, the honest
  disabled **"Purchases coming to the app"** button (Apple 3.1.1) and
  "Already Pro? Sign in". No checkout link anywhere.
- **Picks**: Predictions ⇄ DFS segment. Free = three real drivers + "39 more
  drivers with Pro"; DFS = lock card. Pro = full DK/FD board with the scoring
  line and lineup scratchpad.
- **Series browsing (the point of the change)**: as Pro, Xfinity returns real
  Xfinity standings (Allgaier 1125 pts, 6W) and Trucks real Truck standings
  (Layne Riggs 777 pts, 6W) — genuinely different boards, `?series=N` 200s in
  the log. Selection persists across an app restart.
- **Account**: the new "LoopLab Pro" card — "See what Pro unlocks" for free
  viewers, "Pro is active on this account" plus the `PRO until 12/31/2027`
  chip for Pro.
- **Auth**: sign-out → sign-in round trip on both platforms after the fix, with
  the two platform paths visible in the log (iOS `/account 303` → `/signin` →
  `/api/me 200`; Android `/account 200` → `/api/me 200`).

## Android UI pass (second session)

Every screen was additionally walked on the Android emulator and visually
checked, which is what surfaced finding #6: Home, Live, Picks (Predictions free
/ Pro, DFS locked / Pro), Stats (pills free + Pro, Explore hub, standings,
Xfinity board), Account (free + Pro), Settings (incl. the keyboard fix),
Drivers index, driver profile (Hamlin — season stat grid + recent races),
Compare (free two-slot limit + Pro upsell), Track types (its own series locks,
window steppers, real road-course board), the methodology screen, the upsell
sheet, and sign-in. All render correctly and match iOS.

## Not verified (honest gaps)

- **The Live tab's red dot** — no race was on track during the drive, so the
  badge was never exercised visually. The status parse is unit-tested and the
  poller is AppState-gated, but the dot itself remains unseen.
- **Live board with a live race**, push, and IAP — all still owner/calendar
  gated (J1/J2/J5).
- Compare / Track types / driver profile screens were reachable from the hub
  but were not walked in depth this pass.
