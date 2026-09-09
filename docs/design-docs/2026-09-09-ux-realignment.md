# UX Realignment — Desktop Web + App Navigation & Pro Gating

**Status:** Implemented 2026-09-09 (owner-approved) — both exec plans completed: [web-desktop-breakpoint](../exec-plans/completed/2026-09-09-web-desktop-breakpoint.md), [app-nav-realignment](../exec-plans/completed/2026-09-09-app-nav-realignment.md). Web verified with headless-Chrome screenshots (both entitlement states); app typechecks + unit-tests (simulator drive owner-gated, J3/J4).
**Mockup:** [2026-09-09-ux-realignment-mockup.html](2026-09-09-ux-realignment-mockup.html) (standalone; open in a browser; has a Free ⇄ Pro toggle)

## The two problems

### 1. The web site is a phone app pretending, even on a desktop

`src/app/style.css` caps `.shell` at **520px** and fixes a bottom tab bar to it. On a
phone (and as the installed PWA) that is right. On a laptop it is a narrow strip
in the middle of a dark void, with a *bottom* tab bar — a phone idiom that reads
as wrong on desktop. Two compounding problems:

- The tab bar already has **8 tabs** and still doesn't include Predictions or
  DFS (ARCHITECTURE.md logs "nav placement" as an open polish decision). There
  is no ninth slot. The bottom-bar idiom is out of room.
- Desktop is where the deep tools earn their keep — DFS lineup building on a
  Thursday night, four-driver compare, CSV exports. All of them want width.

### 2. The app organizes features by billing status, not by what they are

The app's five tabs are Home / Live / Drivers / **Pro** / Account. "Pro" is a
junk drawer: a paywall pitch, then cards for Predictions, DFS, Compare,
Track types (two of which are partly *free*), then "coming soon" stubs. Why this
is wrong:

- **For a paying user, "Pro" is a meaningless category.** Once you've paid, you
  don't think "let me open the Pro area" — you think "let me check predictions."
  The label describes a transaction, not an intent.
- **For a free user it's a tab-sized ad** they didn't ask for, and it *hides*
  the free stuff (free compare, free track explorer, free top-3 predictions)
  behind a door labeled with something they don't have.
- Predictions — arguably the product's marquee feature — is two taps deep.

## Principles (what stays true no matter what)

1. **One design language, two layout idioms.** App and web should share tokens,
   components, and information architecture — not literal chrome. Bottom tabs on
   phones (native app *and* mobile web/PWA); a sidebar on desktop web. This is
   how every major product does it (ESPN, Spotify, Twitter); the surfaces will
   feel like one product *because* each feels native to its screen.
2. **Navigation never changes with entitlement.** Free and Pro users see the
   same tabs, the same screens, the same table headers. What changes is only
   whether rows are real or locked. (This is already the codebase's stated
   philosophy — "a free viewer can see the real shape of what Pro buys instead
   of a wall" — the Pro tab just contradicts it.)
3. **The server keeps deciding.** All gating verdicts stay server-side
   (`/api/me`, `/api/predictions` hiddenCount, 403 `pro_required`). This
   proposal only re-houses where the locked treatment *renders*. `ProLock`
   survives as the shared locked component.
4. **Pro becomes a badge and a sheet, not a place.** A `PRO` pill marks locked
   things in situ; tapping any locked thing opens one shared upsell sheet
   (feature list, price, trial CTA — honest about the purchase stub until
   J1/J2). "Manage Pro" lives in Account.

## Proposed web IA (desktop ≥ 900px)

Left sidebar (~230px), grouped — the grouping *is* the shared IA:

| Group | Entries |
|-------|---------|
| — | Home |
| **Race weekend** | Live (● when green), Predictions, DFS `PRO` |
| **Results** | Recap, Races |
| **Stats** | Drivers, Metrics, Standings |
| **Tools** | Compare, Track types, CSV export `PRO` |

- Series switcher (Cup / Xfinity / Trucks) at the top of the sidebar; Xfinity
  and Trucks carry a small lock for free viewers (same teaser gate as today).
- Sidebar footer: account / sign-in / Go Pro.
- Content area widens to ~1100px; Home becomes a two-column dashboard (recap +
  standings left; predictions teaser, metrics leaders, DFS right). Tables get
  room to show the columns that are currently cramped.
- **Below ~900px** the shell/card layout stays, but the 8-tab bottom bar
  consolidates to the **same five tabs as the app** (Home · Live · Picks ·
  Stats · Account, with a `/stats` hub page for the demoted sections) — owner
  decision 2026-09-09: do this in the same pass, so app and mobile web share
  one navigation.

## Proposed app IA

Five tabs, named by intent:

| Tab | Contents |
|-----|----------|
| **Home** | today's card stack (unchanged) |
| **Live** | live board (unchanged) |
| **Picks** | Predictions ⇄ DFS segmented control; methodology link |
| **Stats** | hub: Standings, Drivers, Metric leaders, Compare, Track types (+ Recap/Races when their JSON APIs exist) |
| **Account** | profile, plan / **Manage Pro**, settings, sign-in |

- The **Pro tab is deleted.** Its pitch card becomes the shared upsell sheet;
  its feature list becomes the actual navigation above.
- "Picks" is the shortest honest label for predictions+DFS; alternatives
  considered: "Predict", "Weekend", "Race Day" (collides with Live). Bikeshed
  freely — the structure is the decision, not the label.
- Drivers moves inside Stats (its current top-level tab is an index page, not a
  daily destination). If that feels wrong in use, the fallback is dropping
  Account to a header gear icon and restoring Drivers.

### Gating patterns (app), matching the web teaser

| Situation | Treatment |
|-----------|-----------|
| Partially free table (predictions) | Real top-3 rows, then greyed/blurred rows with one inline "Unlock all N drivers — Pro" row. Mirrors the web's blurred-teaser tables. |
| Fully Pro screen (DFS) | Real header + controls visible but disabled, `ProLock` card in the body. |
| Pro-only series (Xfinity/Trucks) | Series pills always visible on Stats/Drivers/Live; lock glyph for free viewers; tap → upsell sheet; Pro switches to real data (the `?series=` endpoints already exist — owner decision 2026-09-09: build series browsing in this pass). |
| Any locked tap | One shared bottom **upsell sheet** (not a navigation). |
| Pro user | Identical screens, no locks, small `PRO` pill in Account and nowhere else. No celebration chrome in daily surfaces. |

## What this deliberately does not touch

- No change to gate.ts verdicts, `/api/*` shapes, or entitlement logic.
- No change to mobile-web/PWA layout below the desktop breakpoint.
- Purchases remain stubbed (J1/J2); the upsell sheet keeps stating that
  honestly, per Apple 3.1.1.

## Open questions (resolved 2026-09-09 unless noted)

1. "Picks" vs "Predict" vs "Weekend" for the third tab label — **Picks**,
   still a one-line rename if the owner changes their mind.
2. Standings on web: stays a Home card + `/stats` hub entry; no dedicated
   page yet.
3. Mobile-web tab overflow — **consolidate to the app's five tabs in the same
   pass** (owner).
4. App series browsing — **in scope** (owner): the `?series=` endpoints exist;
   pills on Stats/Drivers/Live, locked for free viewers.

## Next step

If accepted, split into two exec plans (they are independent):
**web-desktop-breakpoint** (CSS + layout.ts sidebar, no route changes) and
**app-nav-realignment** (retab `_layout.tsx`, delete ProScreen hub, add the
upsell sheet, re-home screens).
