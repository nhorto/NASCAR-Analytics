# Product Spec — v1 paid product ("LoopLab" working name)

**Status:** APPROVED SHAPE (owner decisions 2026-09-07), build per
[the launch exec plan](../exec-plans/active/2026-09-07-production-and-paid-launch.md).
**Supersedes:** the pricing sketch in
[the productization review](../research/2026-09-07_productization-review.md) §5.3.
**Owner decisions** are recorded in the exec plan's decisions register; when this
spec and that register disagree, the register wins.

This document says what the product is, what it does, and how it behaves. It does
not say how to build it or when; that is the exec plan.

---

## 1. One paragraph

A mobile-first, installable web app for NASCAR fans who want more than the
broadcast gives them: modern loop-data analytics, a free live race-day companion,
and a paid tier of predictions, DFS projections, and deep historical tools. Free
covers the Cup Series and the live board. Pro ($9.99/month or $69/season) covers
all three national series, our race predictions, DFS projections and cheat
sheets, custom historical analysis and exports, push alerts for your driver, and a
Thursday preview email.

## 2. Who it is for

| Audience | What they get free | Why they pay |
|---|---|---|
| Data-loving Cup fans | Everything analytical about Cup, the live board on race day | Xfinity/Trucks, predictions, push alerts, exports |
| DFS players (DraftKings first, FanDuel second) | Loop-data context they cannot get on DK/FD | Projections + cheat sheet every weekend |
| Race-day second-screen fans | The live companion | "My Driver" push alerts, Strategy tab |

## 3. Guiding principle for the free/Pro line

**Nothing that dies with the unofficial live feed is the reason someone paid.**
The live companion is free because it depends entirely on NASCAR's live CDN feed,
which could be closed without notice. Pro features run on weekly data (which has
fallbacks) and on our archived history (which is ours). The one exception is
push alerts, which are Pro at the owner's choice; if the feed goes dark, push is
the only paid feature affected, and the terms address that (§11).

## 4. Tiers

### Free
- Cup Series: home, driver profiles, race pages, races index, compare, track
  explorer, metrics leaderboards, weekly recap, cross-series career pages
  (career pages show all three series' totals because driver ids are global;
  the deep per-series profile for Xfinity/Trucks is Pro).
- Live companion for Cup: the live board (running order, gaps, flag, stage,
  basic loop counters), Race Overview, Strategy tab, tap-to-drill per driver,
  "My Driver" selection with the **in-app** alert feed.
- Monday recap email (opt-in, no account needed; email address only).
- No ads at launch. If ads are ever added they are free-tier only.

### Pro — $9.99/month or $69/season
- Xfinity and Trucks everywhere the free tier has Cup: profiles, races,
  compare, tracks, metrics, recap, live board.
- **Race predictions**: win / top-5 / top-10 probability per driver for the
  next race, published Thursday from form, refreshed after qualifying. Cup at
  launch; Xfinity and Trucks predictions are a fast-follow (cut-order item).
- **DFS projections + cheat sheet**: projected fantasy points per driver for
  DraftKings and FanDuel scoring, with a printable one-page sheet. NASCAR
  Fantasy Live (the official season-long game) is post-launch.
- **Deep historical tools**: CSV export of any table on the site; track-type
  and season-range filters over the whole history on the track explorer and
  compare pages; compare up to four drivers.
- **Push alerts** for "My Driver": pitted, out, big mover, caution, stage end,
  lead change, race start. Web push, delivered to the installed app.
- **Thursday preview email**: predictions + cheat sheet link, plus the Monday
  recap.
- Account page: manage subscription, download invoices, delete account.

### Season pass window
A season pass covers one NASCAR season (February through the championship
race in November). Passes bought in the 2026 launch window are **2027 season
passes and include the rest of 2026 free**. A pass is not auto-renewing; the
holder gets a renewal email in January.

### Free trial
Monthly plans start with a **7-day free trial**, card required, cancel any time
from the account page. Season passes have no trial (they are a one-time
purchase; the 14-day refund rule in §11 applies instead).

## 5. Platform: installable web app (PWA), no store apps

- One codebase, served at the product domain. Installable on iOS and Android
  from the browser ("Add to Home Screen"); an install prompt appears on the
  home page after the second visit and on the Live page during a race.
- Works offline for the app shell and the last-viewed pages; live and data
  pages are network-first.
- Push notifications via Web Push (VAPID). On iOS this requires the installed
  app (iOS 16.4+), and the Live page says so when the user turns alerts on.
- No App Store / Play Store listing in v1. Payments stay on the web (Stripe
  Checkout), so no store commission applies.
- Desktop is a wider version of the same layout (two columns above 900px is
  in scope; parity with mobile is not required).

## 6. Accounts

- Sign-up with email + password. Password rules: 10+ characters, checked
  against a breached-password list; hashed with argon2id.
- Email verification required before any Pro purchase (not before browsing).
- Password reset by emailed link (30-minute expiry, single use).
- Sessions: httpOnly, Secure, SameSite=Lax cookies; 30-day rolling expiry;
  "sign out everywhere" on the account page.
- Rate limits on sign-in, sign-up, and reset endpoints.
- Account deletion: self-serve, immediate, cancels any subscription; data
  purged within 30 days; Stripe customer retained as required for records.
- No social sign-in in v1.

## 7. Billing

- Stripe Checkout for purchase, Stripe Customer Portal for management, Stripe
  webhooks as the only source of truth for entitlement.
- Entitlement model: each user has `pro_until` (a date) and
  `pro_source` (`subscription` | `season_pass` | `grant`). Pro is on when
  `pro_until` is in the future. Subscriptions write `pro_until` = current
  period end + 3-day grace on every invoice; season passes write the fixed
  season end date; manual grants exist for testers and support.
- Past-due monthly: Pro stays on for the 3-day grace, then off; Stripe's
  smart retries run for 2 weeks; the user sees a banner and can update the
  card in the portal.
- Prices are USD only. Tax: Stripe Tax enabled (sole proprietor at launch;
  see the exec plan's decisions register for the entity path).
- Receipts and invoices come from Stripe; we do not generate our own.

## 8. Pages and behaviour (what changes from today)

| Area | Today | v1 |
|---|---|---|
| Serving | Pre-rendered static files | Dynamic Bun server with per-user gating; anonymous Cup pages are cached at the edge |
| Series switcher | Always shows Cup / Xfinity / Trucks | Same, but Xfinity/Trucks show a Pro teaser page (headline stats visible, tables blurred, one-tap upgrade) to non-Pro users |
| Live | Free for all series | Free for Cup; Xfinity/Trucks live is Pro; push alerts Pro |
| New: `/predictions` | — | Per-race probability table, model confidence note, "last updated" stamp, methodology explainer. Pro. Free users see the top three with the rest blurred |
| New: `/dfs` | — | Projections table (DK and FD toggle), sortable, salary column when the user pastes a salary CSV (optional), cheat-sheet print view. Pro |
| New: `/account` | — | Plan, billing portal link, email preferences, push toggle, delete account |
| New: `/pricing` | — | Tier comparison, start trial / buy pass |
| Compare | 2 drivers, one series | Pro: up to 4 drivers, any series, any season range; free unchanged |
| Tracks | Since-year + min-starts | Pro: full range control + CSV export |
| Every table | — | Pro: "Export CSV" button |
| Recap | Page | Page + Monday email (free opt-in) |
| Legal | — | `/terms`, `/privacy`, linked in the footer and at checkout |

Behavioural rules:
- Speed stays a feature: p95 server render under 100 ms on precomputed data;
  no page waits on Stripe or email.
- If the server is down, Cloudflare serves the last static export of the free
  Cup site (read-only mode). Pro pages show a "temporarily unavailable" state.
- If the live feed is down, the Live page shows the idle state with the next
  scheduled session; it never shows stale data as live.
- Predictions and projections are always stamped with their generation time
  and the data they were built from (last race id ingested).

## 9. Predictions and projections (product-level definition)

- **Inputs**: our season and track-type stats (adjPE, Closer Score, average
  finish, DNF rate), trailing form, track-type history, and qualifying
  position when available.
- **Output**: for each entered driver, P(win), P(top 5), P(top 10), expected
  finish, plus expected laps led and fastest laps for DFS scoring.
- **Method**: a rating per driver per race, then a finishing-order simulation
  (many thousands of runs) with track-type-calibrated variance. Published
  probabilities are the simulation frequencies.
- **Honesty bar**: the model must beat two naive baselines (uniform, and
  "trailing-5 average finish") on a held-out season by Brier score and be
  reasonably calibrated before it ships. The methodology page states this
  and shows the backtest.
- **Cadence**: Thursday (entry list + form), Saturday (after qualifying),
  and locked at green flag. Post-race, the page shows what the model said
  versus what happened.
- **DFS scoring**: DraftKings and FanDuel scoring rules are configuration,
  not code, so a rule change is a config edit.
- Predictions are information. The product never takes or facilitates
  bets, never republishes sportsbook odds, and carries no affiliate links
  in v1.

## 10. Data resilience behaviours (user-visible)

- A daily canary checks every upstream endpoint pattern; if one fails for
  two consecutive days, the owner is emailed and a small "data delayed"
  notice appears on affected pages.
- The site never renders partial weekly data as complete; a refresh either
  commits a race fully or not at all.
- Historical data is never deleted; a feed loss freezes history, it does not
  remove it.
- Fallback sources exist and are tested (see the exec plan): official results
  via `nascaR.data`; loop-style metrics recomputable from lap timing; paid
  weekly data via SportsDataIO if needed.

## 11. Terms, privacy, refunds (what the documents must say)

- **Data availability clause**: Pro features rely on third-party racing data
  that may become unavailable. If Pro features that depend on it are
  unavailable for more than 14 consecutive days during the season, monthly
  billing pauses and season passes are extended by the outage length.
  Nothing else is owed. (Owner: revisit before the 2027 season.)
- **Refunds**: monthly plans are cancel-any-time with no partial refunds; the
  trial exists for that. Season passes are refundable in full within 14 days
  of purchase if fewer than two races have run in the covered window.
- **Not gambling advice**: predictions are statistical estimates for
  entertainment and fantasy-sports use; no guarantee of accuracy; no
  affiliation with any sportsbook.
- **Trademarks**: the product name and domain do not contain "NASCAR"; the
  terms state the product is not affiliated with or endorsed by NASCAR.
- **Privacy**: email, password hash, subscription state, push subscription
  endpoints, "My Driver" preference, and Plausible-style aggregate analytics
  (no cookies, no cross-site tracking). No sale of data. Deletion on request
  and self-serve.
- **Age**: 18+ to purchase (fantasy sports context), stated at checkout.

## 12. Out of scope for v1

Store apps, social sign-in, sportsbook odds, affiliate links, lineup
optimizer, ownership projections, an API, Discord, cross-series statistical
normalization, team badges on the live board, NASCAR Fantasy Live scoring.
