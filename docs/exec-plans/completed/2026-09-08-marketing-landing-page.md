# Marketing Landing Page (/welcome)

Status: COMPLETE
Created: 2026-09-08 · Completed: 2026-09-08

## Goal

A marketing/landing page for the product, served by the existing site (Bun server
+ static export) at `/welcome`, on-theme with the app's design system
(docs/DESIGN.md tokens: near-black background, caution-yellow accent, condensed
uppercase display type). At launch cutover it can be promoted to what anonymous
visitors see first; for now it's an additive route with zero risk to the current
home.

## Owner decisions (2026-09-08)

- **Placement**: a page on the existing site (`/welcome`), not a standalone deploy.
- **Name**: "Looplab" stays the working placeholder. The hero logo is the
  unlettered tire master (brand exploration V3, PR #24) with the wordmark drawn
  as **SVG curved text over the image**, so the eventual real name is a
  one-constant change — no regenerated artwork needed.
- **Primary CTA**: conversion-focused — sign up / go Pro (web or app, either is
  fine; revenue is the goal). Hero CTA → `/signup`, pricing section → `/pricing`.
- **Hero angle**: race-day companion leads (most differentiated, free, emotional),
  with analytics and DFS/predictions as the ladder beneath it — per the marketing
  brief distilled from docs/research + the product spec: hook = live free,
  moat = proprietary analytics, reason-to-pay = predictions/DFS/deep tools.

## Marketing frame (from repo research)

- Vision: give NASCAR's 75M fans the modern data tools the sport deserves;
  incumbents have the data but 2003–2008-era UX and no mobile.
- Nobody independent does live; the official app killed RaceView in 2019.
- Proprietary metrics (adjPE, Closer Score) are the moat — "Beyond the Box Score".
- Predictions are sold honestly (public methodology, backtested vs. baselines,
  predicted-vs-actual shown post-race). Never gambling advice; no NASCAR
  affiliation claims (nominative use only).
- Pricing per spec §4: Free = Cup + live; Pro = $9.99/mo (7-day trial) or
  $69/season; 2026 launch-window passes cover 2027 with the rest of 2026 free.

## Steps

- [x] Owner Q&A: placement, hero angle, CTA focus, placeholder name
- [x] Process the brand asset: unlettered tire master → 900px JPEG in
      `src/app/static/brand/` (PR #24 branch asset; ~137KB)
- [x] `src/app/pages/welcome.ts`: standalone marketing document (own layout,
      shared style.css) — hero (SVG-lettered tire, headline, CTAs, fact strip),
      live-companion section with a CSS live-board vignette, "Beyond the Box
      Score", Pro section (predictions/DFS/deep tools/alerts), Free-vs-Pro
      pricing cards, app section (stores coming soon, PWA today), disclaimer
      footer. No JS; no inline handlers (CSP `script-src 'self'` holds).
- [x] `src/app/style.css`: append a `landing-` scoped section reusing tokens
- [x] Wire: `render.renderWelcome()`, server route `/welcome` +
      `/brand/tire-master.jpg`, export writes both; `/brand/` joins the asset
      cache class in http.ts + a `_headers` cache rule
- [x] Tests: welcome page holds the CSP bar (no inline scripts/handlers),
      carries signup/pricing CTAs, the placeholder wordmark constant, and the
      NASCAR/gambling disclaimers
- [x] Verify: `bun run typecheck` + full `bun test`; docs updated (ARCHITECTURE,
      PLANS, this plan → completed)

## Results and verification

- The page has **no JavaScript at all** (Plausible's external tag only when
  `PLAUSIBLE_DOMAIN` is set, matching every other page), so the WS-I CSP holds
  trivially; `/welcome` was also added to `tests/app.csp.test.ts`'s rendered-page
  sweep and the template scan covers `welcome.ts` automatically.
- The hero logo composes SVG `textPath` lettering (name + tagline constants)
  over the unlettered V3 tire master, downscaled to a 900px ~137KB JPEG at
  `src/app/static/brand/tire-master.jpg` (source PNG stays in PR #24's
  `docs/design-docs/brand-v3-assets/`). A circle clip hides the JPEG's square
  edge. Renaming the product is a one-constant edit (`BRAND_NAME`).
- Visually verified with headless Chrome at 1360px and (via an iframe harness —
  headless Chrome clamps windows to 500px) at 390px: hero art stacks above the
  copy on mobile, no horizontal overflow, plans/metric cards collapse to one
  column. Screenshots reviewed at both widths.
- `bun run typecheck` clean; `bun test` **815 pass, 0 fail** (2,539 assertions,
  48 files) including the new `tests/app.welcome.test.ts` (CTAs, swappable
  wordmark, disclaimers, spec §4 pricing, `/brand/*` cache class + `_headers`
  rule).
- Tech debt logged: static-host CTAs 404 until the launch cutover; copy claims
  (pricing, launch offer, store status) are code with no CMS.

## V2 — owner feedback pass (2026-09-08, same day)

Owner review of v1 asked for three things, all shipped:

1. **The landing page IS the site root.** `/` now serves the marketing page to
   anonymous visitors and the app home to signed-in ones; the app home moved to
   `/home` (any series prefix — Home tab, wordmark, and 404 links updated), the
   static export writes the landing at `/` plus `${prefix}/home` homes with
   bare `/xfinity`/`/trucks` kept as home copies for old URLs, and `/welcome`
   remains an alias.
2. **Show the actual product, not generic imagery.** Every ladder section now
   carries a real screenshot captured from the running app against the live
   database (`src/app/static/shots/`): the Enjoy Illinois 300 prediction card
   (free top-3 + Pro teaser, real generation stamp), the 2026 adjPE
   leaderboard, the Kyle Larson profile (form sparkline, track-type splits,
   metric percentiles), and the Cook Out Southern 500 recap ("What the Loop
   Data Saw"). The live section's board mock was rebuilt around what only this
   product does — live pass efficiency, Loop-Rating stars, the pit window,
   tire severity, a My Driver alert — instead of a running order any app has.
   A new "Every race, decoded" section shows the recap.
3. **Only claim what's real.** Verified in the db before writing copy: 84
   prediction rows + 168 DFS projections exist and `/predictions` renders the
   current card, so the predictions claims stand as written.

**Recapture recipe** (screenshots will age with the season): with the server
running against a current db — headless Chrome, `--window-size=500,2600`, shoot
`/predictions`, `/metrics`, `/recap`, `/drivers/{id}`; crop with ImageMagick to
the card regions; write to `src/app/static/shots/` keeping the `LANDING_SHOTS`
filenames.

Verification: `bun test` **819 pass, 0 fail** (root-flip coverage added to
server/pwa/export/welcome tests; CSP sweep gained `/home`), typecheck clean,
visually reviewed at 1360px and the 500px mobile breakpoint.

## Boundaries

- Copy claims must stay inside what's shipped and honest: no "20 years of loop
  data" (false for the CDN path), no "beat the sportsbook", predictions framed
  as information for entertainment/fantasy use.
- The name is a placeholder; nothing on the page may make it load-bearing beyond
  the single wordmark constant.
- No nav-tab placement yet — the page is reachable by URL and future promotion;
  changing the app shell is out of scope.
- App-store badges are "coming soon" labels, not links (no store listings exist).
