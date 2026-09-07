# Production + Paid Launch — from today's frozen static site to taking money

**Status:** ACTIVE — owner-approved shape 2026-09-07. Build starts immediately.
**Target:** paid launch by **2026-11-01**, the week before championship weekend.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md).
**Background:** [productization review](../../research/2026-09-07_productization-review.md).
**Owner:** Nick. **Builder:** Claude sessions; owner does identity-bound steps
(accounts, logins, domain, lawyer) and reviews PRs.

---

## 1. Decisions register (2026-09-07)

When work collides with this table, the table wins until a new dated row
replaces the old one.

| # | Decision | Choice | Why / consequence |
|---|---|---|---|
| D1 | Mobile app | Installable web app (PWA); no store apps | One codebase; push via Web Push; payments stay on web |
| D2 | Name / domain | Undecided; "LoopLab" is a placeholder | **Must be decided by end of week 2** — blocks Stripe product names, sender domain, manifest, terms |
| D3 | Paid launch date | By 2026-11-01 | Eight weeks; cut order in §7 applies if a week is lost |
| D4 | Tier line | Free = Cup + live board; Pro = all three series + predictions + DFS + deep tools + push + preview email | Nothing feed-dependent is the reason someone paid (push is the accepted exception) |
| D5 | Price | $9.99/mo (7-day trial, card required) or $69/season; 2026 buyers get a 2027 pass with the rest of 2026 free | |
| D6 | Entity | Sole proprietor, personal Stripe | Fastest; move to an LLC before meaningful revenue (tracked in §8) |
| D7 | Legal docs | Drafted in-repo, one lawyer hour to review before launch | Lawyer booked in week 3, review in week 4 |
| D8 | Feed-loss policy | Pause monthly billing + extend passes after 14 consecutive dark days; owner to revisit before 2027 | Low exposure because live is free |
| D9 | Payments | Monthly + season pass + trial; no lifetime deal | |
| D10 | Hosting | One Bun container on Fly.io (Railway as alternate), SQLite on a volume, Litestream backups | Least ops; the code runs as written |
| D11 | Sign-in | Email + password (argon2id), emailed reset links; no social sign-in | |
| D12 | Cloudflare account | New personal account for this product; DNS + static fallback + (until migrated) the live Worker move there | Separates from Fabrication IS |
| D13 | Who builds | Claude sessions build; owner does accounts/logins and reviews | Several sessions a week assumed |
| D14 | Pro contents | Predictions, DFS projections + sheet, deep historical tools, Thursday email + ad-free, push alerts | |
| D15 | DFS platforms | DraftKings first, FanDuel second, NASCAR Fantasy Live post-launch | Owner does not play DFS; validate with two DFS players before launch |
| D16 | Series | Free = Cup only; Pro = all three series everywhere. Predictions: Cup at launch, Xfinity/Trucks fast-follow | Gating Xfinity/Trucks pages requires the dynamic server |
| D17 | Live Worker at launch | Stays on Cloudflare (moved to the new account); in-process poller is post-launch | Working and free; migration is not on the November critical path |
| D18 | Weekly refresh | Moves onto the production server (cron in-process, lock-protected); GitHub Actions retained as a build-only smoke test | Structurally ends the weekly cold backfill |

## 2. Goal and definition of done

**Done means:** a stranger can find the site, install it on their phone, use
the free Cup product, sign up, start a Pro trial or buy a season pass, receive
predictions and a DFS sheet on Thursday, get push alerts for their driver
during a race, manage or cancel from the account page, and every one of
those paths is tested, monitored, backed up, and covered by published terms.

Verification is the doctrine in `CLAUDE.md`: colocated tests, negative cases,
exact asserts, architecture tests green, `bun test` zero failures, and each
workstream's acceptance list below checked off in this file.

## 3. Current state (baseline, 2026-09-07)

- 185 tests green; static site frozen since early July because CI never
  deploys (secrets absent); PR #9 open and unmerged; weekly CI cold-backfills
  every Monday because the cache evicts; no analytics; no accounts; no
  payments; live Worker on the FabIS Cloudflare account with July baselines.

## 4. Architecture target (what changes)

```
Cloudflare (new account)           Fly.io app (Bun, one container)
  DNS for the product domain         server.ts: site + API + auth + billing + gating
  Static Cup fallback (Pages)   →    SQLite on a volume  ──Litestream──▶ B2/R2 backup
  looplab-live Worker (D17)          cron: weekly refresh (D18), daily canary,
                                           Thursday/Saturday predictions, emails
                                     push dispatcher: polls the Worker's /api/live
                                           during sessions, sends Web Push
Stripe  ◀── Checkout / Portal / webhooks
Resend  ◀── verify, reset, recap (free), preview (Pro), canary alerts
Plausible ◀── aggregate analytics (no cookies)
```

New code lives in these places (respecting `Utils → Types → Providers →
Domains → App` and the intra-domain layer order):

- `src/domains/accounts/` — users, sessions, password hashing, verification,
  reset, deletion. Repo owns the `users`, `sessions`, `tokens` tables.
- `src/domains/billing/` — entitlement (`pro_until`, `pro_source`), Stripe
  webhook state machine, portal links. Repo owns `entitlements`,
  `stripe_events` (idempotency).
- `src/domains/predictions/` — rating, simulation, backtest, DFS scoring
  config. Repo owns `race_predictions`, `dfs_projections`.
- `src/domains/notifications/` — email templates + sends, push subscriptions
  + dispatch, "My Driver" follows. Repo owns `push_subscriptions`,
  `email_prefs`, `follows`.
- `src/domains/data-health/` — canary checks, fallback adapters
  (`nascar-data`, `sportsdataio` stub), feed status. Repo owns `feed_status`.
- `src/providers/` — `stripe.ts`, `email.ts` (Resend), `push.ts` (web-push
  VAPID), `analytics.ts` (Plausible snippet), `nascar-data.ts` (fallback source).
- `src/app/` — gating middleware, new pages (`predictions`, `dfs`, `account`,
  `pricing`, `terms`, `privacy`), PWA assets (`manifest.webmanifest`, `sw.js`),
  cron wiring, server hardening.
- `docs/legal/terms.md`, `docs/legal/privacy.md` — the source of the rendered
  legal pages.
- `docs/runbooks/` — `deploy.md`, `feed-loss.md`, `backup-restore.md`,
  `incident.md`.

Files stay ≤400 lines and functions ≤60 (the review flagged three files
already over; they get split as they are touched, not in a big-bang).

## 5. Workstreams

Each workstream has an ID, an owner-side step list (things only Nick can do),
a build list, and acceptance criteria. IDs are referenced from the schedule.

### WS-A Foundations and stop-the-bleeding (week 1)

Owner steps:
- A1 Create the new Cloudflare account; invite the FabIS account's Pages
  project + Worker for transfer, or accept a fresh deploy there.
- A2 Create Fly.io account; add a payment method.
- A3 Create Stripe account (individual); complete identity verification
  (takes days, start now).
- A4 Create Resend account; Plausible account (or approve self-hosted Umami).
- A5 Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` to GitHub secrets
  so the interim static refresh deploys during the playoffs.
- A6 Decide the name (D2) and buy the domain (deadline end of week 2).

Build:
- ~~Merge PR #9~~ ✅ 2026-09-07 — merged into the launch branch; 190 → 208 tests green; both typechecks fixed (root program had been broken by the Worker import).
- Redeploy the live Worker once with current baselines/strategy.
- ~~Fix the CI cache miss now~~ ✅ 2026-09-07 — `cache-keepwarm.yml` (Thursday restore + re-save under the refresh's concurrency group). Verify on the next two Monday runs (acceptance below).
- ~~Plausible snippet in `layout.ts`~~ ✅ 2026-09-07 — emitted only when `PLAUSIBLE_DOMAIN` is set (owner step A4 + A6 supply it). Email-capture box on the recap page
  (stores to a table on the server once WS-B ships; until then, a Resend
  audience form).
- ~~Canary v0~~ ✅ 2026-09-07 — `data-health` domain + `bun run canary` + `canary.yml` (daily 09:00 UTC). Moves onto the server in WS-C.

Acceptance:
- [ ] Monday CI run deploys and the public site shows the latest race.
- [ ] Two consecutive weekly runs report `already covered` for prior seasons.
- [ ] Plausible shows real pageviews; the canary has run three days green.
- [ ] PR #9 merged; live Worker returns current `trackStrategy` for a 2026 race.

### WS-B Production server (weeks 2–3)

Build:
- `server.ts` hardened for production: env validation, structured logs,
  request ids, `Cache-Control` per route (public for anonymous Cup pages,
  private for gated), security headers (CSP, HSTS, frame-ancestors), gzip.
- Dockerfile (Bun official image), `fly.toml`, volume for `data/`, Litestream
  sidecar to Backblaze B2 or Cloudflare R2, health endpoint, `bun run
  restore-drill` proving a restore from backup boots and serves.
- Weekly refresh runs in-process on the server (cron + advisory lock), with
  the existing CLI as the implementation; GitHub Actions becomes
  `--no-deploy` build-only (D18).
- Static export retained as **read-only fallback**: after each refresh the
  server publishes `dist/` to Cloudflare Pages; Cloudflare serves it when the
  origin is unhealthy.
- Live page reads the Worker origin from config, not a hard-coded string.
- Uptime monitor (external, free tier) on `/health` and the home page.

Acceptance:
- [ ] Product domain serves the dynamic site over HTTPS from Fly; p95 render
      under 100 ms on driver and race pages under a 50-rps synthetic load.
- [ ] Restore drill passes from a Litestream snapshot into a fresh machine.
- [ ] A refresh run on the server ingests the latest race, recomputes, and
      updates the fallback static site, with a log line per step.
- [ ] Killing the origin makes Cloudflare serve the static Cup site within
      60 s; restoring it resumes dynamic serving.

### WS-C Data resilience (weeks 2–3, in parallel with WS-B)

Build:
- Canary v1 on the server: daily check per endpoint pattern + shape
  validation via the normalizers + `feed_status` table + owner email on two
  consecutive failures + a "data delayed" notice on affected pages.
- Fallback adapter `nascar-data.ts`: reads the `nascaR.data` CSV/Parquet
  release for results and schedules into the same normalized rows; `bun run
  sync --source nascar-data` path; tested against fixtures and a real
  download.
- SportsDataIO adapter stub against the free-trial schema (results + basic
  driver stats), clearly marked not-for-production, so a lockout is a config
  change plus a card.
- "Loop metrics from lap timing" spike: recompute green-flag passes, quality
  passes, average running position and closing laps from `lap_times` +
  `cautions` for one full season; report agreement with official
  `loop_stats`. Ships as a documented experiment; promotion to a production
  path is post-launch unless agreement is >95%.
- `docs/runbooks/feed-loss.md`: what to do in the first hour, day, and week.
- Ingestion invariant: a race commits fully or not at all (transaction per
  race); test with an injected mid-race failure.

Acceptance:
- [ ] Canary has caught an injected 403 in staging and emailed within 24 h.
- [ ] `sync --source nascar-data` ingests the last three Cup races with
      results matching the CDN rows exactly (finish, start, laps led).
- [ ] Runbook reviewed by owner.
- [ ] Spike report committed under `docs/research/`.

### WS-D Accounts and gating (week 3)

Build:
- `accounts` domain: sign-up, verify, sign-in, sign-out (all sessions),
  reset, delete; argon2id via `Bun.password`; rate limits; CSRF on forms.
- Session middleware and a `viewer` object available to every render.
- Gating middleware: series gate (Xfinity/Trucks → Pro teaser for non-Pro),
  feature gate (predictions/dfs/export/push/compare-4).
- Teaser pages: headline stats visible, tables blurred, one-tap to `/pricing`.
- `/account` page v0 (plan display, sign out everywhere, delete).

Acceptance:
- [ ] Negative tests: wrong password, reused reset token, expired token,
      unverified user attempting checkout, rate limit trip, CSRF miss.
- [ ] Non-Pro request to `/xfinity/drivers/1` returns the teaser; Pro
      returns the page; anonymous Cup pages carry public cache headers,
      gated pages carry private.
- [ ] Architecture tests still pass with the new domains.

### WS-E Billing (week 4)

Owner steps: E1 Stripe products/prices created (after D2 names them);
E2 Stripe Tax enabled; E3 webhook endpoint secret installed in Fly secrets.

Build:
- `billing` domain: Checkout session creation (monthly with 7-day trial,
  season pass one-time), Customer Portal link, webhook handler with
  idempotency (`stripe_events`), entitlement writes per §7 of the spec,
  grace handling, manual grants CLI for testers.
- `/pricing`, upgrade CTAs, post-checkout landing, past-due banner.
- Legal pages rendered from `docs/legal/*.md`; linked at checkout.

Acceptance:
- [ ] Webhook state machine unit-tested for: trial start, trial→paid,
      payment failed→grace→off, cancel at period end, season pass purchase,
      refund, duplicate event delivery, out-of-order events.
- [ ] Stripe test-mode end-to-end: trial signup, card update, cancel, pass
      purchase, each reflected on `/account` within one webhook.
- [ ] Lawyer review of terms/privacy done; changes applied.

### WS-F Predictions and DFS (weeks 5–6)

Build:
- `predictions` domain: per-driver per-race rating from existing computed
  stats + form + track-type + qualifying; finishing-order simulation; P(win),
  P(top 5), P(top 10), expected finish, expected laps led, expected fastest
  laps.
- Backtest CLI (`bun run backtest:predictions`): held-out 2025 season, Brier
  and log-loss vs uniform and trailing-5 baselines, calibration table;
  report to `docs/research/`.
- DFS scoring as config (`dk.json`, `fd.json`); projections computed from
  the simulation; cheat-sheet print view.
- `/predictions` and `/dfs` pages with generation stamps and the free
  top-three teaser; Thursday + Saturday cron; methodology page.
- Validate with two DFS players (owner to recruit) on one race weekend.

Acceptance:
- [ ] Model beats both baselines on the held-out season by Brier; calibration
      within ±5 points across probability bins with ≥30 samples.
- [ ] Cron produces Thursday and Saturday runs for a real weekend without
      manual steps; post-race page shows predicted vs actual.
- [ ] DK/FD projections reproduce a hand-computed example per rule.

### WS-G Deep tools and email (week 6)

Build:
- CSV export on every table (Pro), streaming, with a filename that names the
  series/season/filter.
- Track explorer full range control; compare up to four drivers across
  series and season ranges (Pro).
- Email: Resend provider; templates for verify, reset, Monday recap (free,
  opt-in), Thursday preview (Pro); unsubscribe links; bounce handling.

Acceptance:
- [ ] Export of the largest table completes under 2 s and opens in Excel.
- [ ] Recap email sent to a test list after a real refresh; preview email
      after a real prediction run.

### WS-H PWA and push (week 7)

Build:
- `manifest.webmanifest`, icons, `sw.js` (shell cache, network-first data),
  install prompt logic, offline page.
- Web Push (VAPID) subscription flow on the Live page (Pro), iOS install
  guidance, push dispatcher on the server polling the Worker during sessions,
  alert dedup per user, quiet hours off by default.
- Live race soak: run the whole stack through one full Cup race (cautions,
  pit cycles, stage ends, checkered) and log every alert sent.

Acceptance:
- [ ] Installs on iOS and Android; Lighthouse PWA checks pass.
- [ ] A test user receives the pit/caution/stage/finish alerts for their
      driver during the soak race with no duplicates.

### WS-I Launch hardening (week 8)

Build:
- Security review (`/security-review` on the branch), dependency audit,
  secrets audit, rate-limit tuning, backup restore re-drill, load test at 5×
  expected race-day traffic, error alerting to owner email.
- Docs: ARCHITECTURE.md current guarantees + what does not exist, QUALITY
  scores, runbooks, tech-debt entries, this plan's acceptance boxes.
- Launch checklist (§9) walked live with the owner.

## 6. Schedule (eight weeks, Mon 2026-09-07 → Sun 2026-11-01)

| Week | Dates | Workstreams | Owner-side deadlines |
|---|---|---|---|
| 1 | Sep 7–13 | WS-A | A1–A5 done; A6 started |
| 2 | Sep 14–20 | WS-B, WS-C | **Name + domain decided (D2)**; DNS on new CF account |
| 3 | Sep 21–27 | WS-B finish, WS-C finish, WS-D | Lawyer booked |
| 4 | Sep 28–Oct 4 | WS-E | Stripe products created; lawyer review |
| 5 | Oct 5–11 | WS-F (model + backtest) | Recruit two DFS testers |
| 6 | Oct 12–18 | WS-F (pages), WS-G | |
| 7 | Oct 19–25 | WS-H, soak race | Owner installs on own phone, follows a driver |
| 8 | Oct 26–Nov 1 | WS-I, launch | Launch go/no-go |

## 7. Cut order (pre-agreed; drops from the bottom up if a week is lost)

Never cut: accounts, billing, terms/privacy, canary, backups, Cup
predictions, DraftKings projections, the free Cup product staying live.

Drop in this order:
1. NASCAR Fantasy Live scoring (already post-launch)
2. Xfinity/Trucks predictions (already fast-follow)
3. Compare-4 and the full range control (keep CSV export)
4. Thursday preview email (predictions live on the page only)
5. FanDuel scoring
6. Push alerts (ship the PWA without push; alerts stay in-app)
7. The loop-metrics-from-timing spike (documented, not shipped)

## 8. Post-launch backlog (not November)

- Move the live poller in-process; retire the Worker; add the post-race
  authoritative swap to official loop stats.
- Xfinity/Trucks predictions; NASCAR Fantasy Live; lineup optimizer if DFS
  demand shows.
- LLC + business bank + Stripe migration before meaningful revenue (D6).
- Sportradar conversation trigger: at $2k/month recurring, open it.
- Revisit D8 (feed-loss policy) before the 2027 season.
- Split the three oversized service files.
- Desktop two-column layout polish.

## 9. Launch checklist

- [ ] Terms, privacy, refund policy live and lawyer-reviewed
- [ ] Stripe live mode; test purchase with a real card refunded
- [ ] Backups restoring; uptime and error alerts reaching the owner
- [ ] Canary green for seven days; feed-loss runbook read
- [ ] PWA installs on the owner's phone; a push alert received
- [ ] Predictions backtest published on the methodology page
- [ ] Analytics shows traffic; email list has the recap opt-ins
- [ ] ARCHITECTURE.md, QUALITY_SCORE.md, PLANS.md updated; this plan moved
      to `completed/` with all acceptance boxes checked

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Name/domain undecided past week 2 | Medium | Blocks Stripe, email sender, manifest, terms | Hard deadline D2; placeholder everywhere until then |
| Stripe identity verification delay | Low | Blocks WS-E | Start in week 1 (A3) |
| Prediction model fails the honesty bar | Medium | Pro tier's headline feature slips | Start the backtest in week 5 day 1; fallback is a simpler form-only model that still beats baselines |
| Live feed closes during build | Low | Live goes idle; push untestable | Live is free; soak race can use a captured replay |
| Eight weeks is too few | Medium | Scope | Cut order §7; launch date holds, scope moves |
| Sole-proprietor tax/1099 surprises | Low | Admin | Stripe Tax on; LLC in backlog |
