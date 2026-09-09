# Web Responsive Realignment — Desktop Sidebar + Mobile 5-Tab Consolidation

**Status:** ACTIVE · created 2026-09-09
**Design doc:** [../../design-docs/2026-09-09-ux-realignment.md](../../design-docs/2026-09-09-ux-realignment.md) (+ mockup HTML, owner-approved 2026-09-09)
**Owner decision it implements:** the web should stop rendering as a 520px phone column with a bottom tab bar on desktop; mobile web/PWA must remain exactly as it is today.

## Goal

Two halves, one shared IA (owner decision 2026-09-09: do both now):

1. **Desktop (≥ 900px):** a grouped left sidebar and a wider content area
   (two-column dashboard on Home).
2. **Mobile web (< 900px):** the 8-tab bottom bar consolidates to the **same
   five tabs as the native app** — Home · Live · Picks · Stats · Account — so
   a fan moving between the app and the mobile site meets one navigation.
   The shell/card layout below 900px is otherwise unchanged.

One HTML serves every width (a hard requirement: the static export can't sniff
devices): the page renders both navs and a media query picks.

## Non-goals

- No API changes; no change to gating verdicts or cacheability (anonymous
  pages stay public).
- No redesign of page content beyond width/wrapping (tables gain room; they do
  not gain columns).

## Design

### Navigation model

`layout.ts` renders **both** navs on every page:

- the `<nav class="tabbar">` (hidden ≥ 900px) **consolidated to five group
  tabs** mirroring the app:
  - **Home** → `/` · **Live** → `/live` (keeps the livedot) ·
    **Picks** → `/predictions` · **Stats** → `/stats` (new hub page) ·
    **Account** → `/account`
  - Each page highlights its *group*: predictions/dfs/methodology → Picks;
    recap/races/drivers/metrics/compare/tracks → Stats; auth/pricing →
    Account. A `tabGroup(tab)` mapping in `layout.ts` decides (the sidebar
    keeps exact-page highlighting).
  - **`/stats` hub (new series-prefixed route + exported page):** hub rows in
    house style — Recap, Races, Drivers, Metrics, Compare, Track types — so
    every demoted tab stays one tap away. Server + `export.ts` + 404 handling.
  - **Picks segmented control:** `/predictions` and `/dfs` each get a
    Predictions ⇄ DFS seg at the top (house `.seg`), same as the app's Picks
    tab. `/dfs` free-state teaser behavior unchanged.
  - The appbar's account glyph disappears < 900px (Account is now a tab);
    kept ≥ 900px? No — the sidenav footer owns it there. Appbar = wordmark +
    season pill only.
- a new `<aside class="sidenav">`, hidden < 900px, containing:
  - wordmark + season pill
  - series switcher (Cup / Xfinity / Trucks; lock glyph for non-Pro on 2/3,
    same teaser gate as today — presentation only)
  - grouped links — this grouping is the shared IA with the app:
    - (ungrouped) Home
    - **Race weekend:** Live (livedot), Predictions, DFS `PRO`
    - **Results:** Recap, Races
    - **Stats:** Drivers, Metrics
    - **Tools:** Compare, Track types
  - footer: Account (signed-out: "Sign in · Go Pro"; Pro: PRO pill)

Duplicated nav markup costs ~1–2KB per page pre-gzip — acceptable; it keeps the
static export working with zero server logic.

### Tab identity

- Extend `Tab` union with `"predictions" | "dfs" | "stats" | "account"`;
  `server.ts` prediction pages stop borrowing `active: "metrics"`
  (`/predictions` + methodology → `predictions`, `/dfs` → `dfs`); auth/account
  pages stop borrowing `home`.
- `sectionIndex()` (series-switch landing) handles the new ids.

### Icons

Small inline SVGs (stroke style, ~18px, `currentColor`, drawn to match the
app's Ionicons choices: home / radio / podium / stats-chart / person-circle)
via a `navIcon(name)` helper in `html.ts`, used by **both** the 5-tab tabbar
and the sidenav. Inline SVG needs no script and no CSP change.

### Layout CSS (all in `style.css`, one `@media (min-width: 900px)` block)

- `.shell`: max-width 520 → `1200px`; grid `232px minmax(0,1fr)`.
- `.appbar` (mobile) hidden ≥ 900px (wordmark/season/account move into the
  sidenav); `.series-switch` under the appbar likewise hidden (it moves into
  the sidenav).
- `.tabbar { display:none }` ≥ 900px; `.screen` bottom padding drops.
- Content column: default `max-width: 860px` for readability; pages that earn
  width (compare 4-driver, DFS board, race results) get a `.wide` wrapper
  allowed to fill.
- Home: wrap the existing card stack so ≥ 1000px it flows into a two-column
  grid (CSS only — cards keep their order/markup; grid-auto-flow dense or two
  explicit columns with an ordering class per card).
- Live dot: `client/boot.js` currently flips the tabbar's `.livedot`; change
  its selector to hit every `.livedot` so the sidenav Live entry lights too.

### Static export + headers

`export.ts` uses the same `page()`, so exported pages get the sidenav for free.
The WS-I export scans (no inline scripts / handler attributes) must stay green —
inline SVG introduces neither. `_headers`/CSP untouched.

### Optional (decide during build, small): `/exports` index

The sidebar mockup showed "CSV export"; there's no page listing the 14 datasets
(links are scattered per-table, Pro-only). If cheap, add a Pro `/exports` page
(registry → list of links) and a Tools sidenav entry; otherwise omit the entry —
**do not** link a nav item to nothing.

## Steps

1. `html.ts`: `navIcon()` inline SVGs; `layout.ts`: 5-tab tabbar +
   `tabGroup()` mapping + sidenav markup (+ `Tab` additions, sectionIndex,
   footer states).
2. `/stats` hub page (`pages/stats.ts`), wired in `server.ts` + `export.ts`;
   Picks seg on predictions/dfs pages.
3. `style.css`: the 900px block per above; home dashboard grid classes in
   `pages/home.ts` wrappers only (no content changes).
4. `server.ts`/`render.ts`: active-tab ids for predictions/dfs/methodology/
   stats/account.
5. `boot.js`: livedot selector → all `.livedot`.
6. Verify with headless-browser screenshots at 375 / 768 / 899 / 900 / 1280 px
   across home, drivers, driver profile, race, recap, metrics, compare,
   tracks, predictions, dfs, stats, account, pricing — anonymous and Pro.
   Below 900px only the tabbar row may differ from production today.
7. `bun run export`; spot-check exported pages at both widths; full `bun test`
   (architecture + WS-I export scans) green.
8. Docs: ARCHITECTURE.md (layout bullet), DESIGN.md (breakpoint + tab-group
   section), this plan → completed, PLANS.md.

## Acceptance

- [x] ≥ 900px: sidebar layout with grouped nav on every page; Predictions and
      DFS reachable from primary navigation for the first time. (verified via
      headless-Chrome screenshots at 1280px across home/predictions/dfs/drivers)
- [x] < 900px: five app-matching tabs with icons; every demoted section ≤ 2
      taps via the `/stats` hub; card/content layout otherwise unchanged.
      (390px screenshots; overflow probe reports scrollWidth == innerWidth)
- [x] Live dot lights in both navs when the Worker reports a live race.
      (boot.js now targets every `.livedot`; app.boot.test.ts updated + green)
- [x] Free vs Pro nav states correct (PRO pills, series locks, footer).
      (drove real /signin, granted Pro, screenshotted both states)
- [x] Static export ships the same experience; WS-I scans + all tests pass.
      (`bun run export` → 630 pages incl. all three `/stats`; `bun test` 866 pass)
- [x] Anonymous page cacheability and CSP unchanged. (headers unchanged; see
      caveat below)

## Caveat found during verification (logged as tech debt)

The nav now reflects Pro state (footer chip, DFS `PRO` pill) on **every** page,
including the anonymous Cup pages served `public, max-age=300`. A browser that
cached an anonymous page can show that stale (free) chrome to a user who signs
in within the 300s window — the same pre-existing behavior that already
affected the Pro-only export bar (`http.ts:43-44`, unchanged here). Render is
correct (curl with a session cookie shows Pro); the staleness is caching, which
this plan scoped out. Logged in the tech-debt tracker — the clean fix is a
small client-side `/api/me` nav reconciliation, not weakening the free-tier CDN
cache.
