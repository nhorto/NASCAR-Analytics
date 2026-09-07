# Productization Review — where LoopLab is, and what it would take to make it a product

**Date:** 2026-09-07
**Purpose:** Owner asked for a state-of-the-repo review plus a first pass at the
questions "should this become a product, on what infrastructure, with what
business model, at what price." This is a decision document, not a plan. The
open questions at the end need owner answers before any exec plan is written.

---

## 1. Where we actually are

### What is built (and it is more than you probably remember)

Everything below was built in a two-day burst on 2026-07-05/06 on top of the
March research. `bun test` is green today: **185 tests, 0 failures**, including
the architecture-boundary test.

| Area | State | Evidence |
|---|---|---|
| Ingestion | Done. All three national series, results 2017–2026, loop data 2019+, lap times 2020+, raw JSON archived | Weekly CI log 2026-08-31: 2026 season at 28/38 Cup, 24/33 Xfinity, 18/25 Trucks |
| Proprietary metrics | Done. Adjusted Pass Efficiency + Closer Score, league-baseline residuals, verified vs known history | `analytics/service.ts`, 475-line test file |
| Static site | Done. ~2,459 pre-rendered pages: drivers, races, compare, track explorer, `/metrics`, cross-series careers, auto-recap with a real playoff model | `export.ts`; CI artifact every Monday |
| Live race companion | Phases 1–3 deployed. Cloudflare Worker + Durable Object polls the CDN, computes live metrics/alerts/strategy; `/live` on the main site | `worker/index.ts`, `client/live.js` |
| Strategy model | Calibrated per track + held-out backtested (60% lower pit-cadence MAE than baseline) | `docs/research/2026-07-06_strategy-backtest.md` |
| Weekly refresh | CI runs every Monday, green for 11 straight runs | `.github/workflows/weekly-refresh.yml` |

Code size is ~9,100 lines of TypeScript across `src/`, `worker/`, `scripts/`,
`tests/`. The domain layering is real and enforced. For a solo side project this
is in unusually good shape.

### What is broken or stalled (the part you did not remember)

1. **The public site has been frozen since early July.** The weekly workflow
   builds a fresh `dist/` every Monday and then prints
   `CLOUDFLARE_API_TOKEN not set — skipping deploy` and throws it away. The two
   Cloudflare secrets were never added. So `looplab-arh.pages.dev` still shows
   whatever was hand-deployed around 2026-07-06, while the 2026 playoffs are
   running right now. The Vercel mirror is older still.
2. **PR #9 ("Harden live data and refresh automation", 2026-08-07) is an open
   draft, mergeable, never merged.** It fixes a real bug (the CDN's idle feed
   mixing one race's name with another track's metadata), wires the Worker
   baseline/strategy regeneration and Worker deploy into `bun run refresh`, and
   makes cold backfills survive a single 5xx. It passed CI on its branch. It
   should be merged before anything else is built on `main`.
3. **The CI database cache effectively never hits.** GitHub evicts caches not
   touched for 7 days. The cron fires Mondays 12:00 UTC but actual start drifts
   (12:22, 12:44, 14:11, 18:26 …), so the previous week's cache is usually just
   past 7 days old. Runs on Aug 24 and Aug 31 show `0 already covered` for every
   season: a full ~1,000-race cold backfill against NASCAR's CDN every week. It
   self-heals, but it is thousands of needless requests weekly to an unofficial
   feed we are trying not to draw attention to. Fix: a stable cache key plus a
   mid-week keep-warm dispatch, or move the DB to object storage as DEPLOY.md
   already anticipates.
4. **No usage measurement of any kind.** No analytics script, no server logs we
   read, no email capture. We have no idea whether anyone besides you has ever
   opened the site. That is the single largest gap between "project" and
   "product decision" because every pricing question below depends on it.
5. **Live Worker baked artifacts are stale** (baselines and strategy tables from
   July). PR #9 fixes the pipeline; the Worker itself still needs a redeploy.
6. Smaller: `analytics/service.ts` (919 lines), `live/service.ts` (714) and
   `worker/index.ts` (619) are past the point where they should be split.
   `LIVE_API_BASE` is a hard-coded `workers.dev` URL in `layout.ts`. Twenty-odd
   "no results ingested" warnings in the backfill log (race ids 5241–5244,
   5260–5263, 5374–5375, 5587–5592 …) look like exhibition/duel events but
   should be confirmed once, not re-logged forever.

**Net:** the hard part (data + metrics + pages + live) exists and works. What is
missing is operational: nobody flipped the switch that lets it refresh itself,
and nobody is watching whether it is used.

---

## 2. How deep is the Cloudflare dependency, really?

Shallower than the docs make it sound. Inventory:

| Piece | Cloudflare-specific surface | Portability |
|---|---|---|
| Static site (`dist/`) | Only `_headers` (cache rules). Already mirrored on Vercel | Runs on any static host or any web server. Zero work |
| Live Worker (`worker/index.ts`) | `DurableObjectState.storage` get/put (14 calls), alarm get/set/delete (4), `cf:` fetch options (3), the DO class shape | The logic it wraps (`src/domains/live/*`) is pure and already Bun-tested. The Worker is a ~600-line adapter |
| Refresh pipeline | One `bunx wrangler pages deploy` call | Replace with rsync/S3 sync/whatever the new host wants |
| Main site → live API | One hard-coded origin string | Config value |

Re-hosting the live poller as a plain long-running process is: a `setInterval`
loop instead of `alarm()`, an in-memory object (or one SQLite table) instead of
`storage.get/put`, and an HTTP handler that returns the latest payload. One to
two days including tests. The stop-when-unwatched behaviour becomes unnecessary
on a fixed-cost server.

### The real architectural change is not "off Cloudflare", it is "static → dynamic"

Every page today is a public file. That model cannot support accounts,
paywalls, per-user alerts, or push, which is the whole premium tier. The good
news: `src/app/server.ts` already is the dynamic version of the site. It is the
dev server, using the exact same `render.ts` as the export, with the JSON API
routes. Production-izing it is the migration.

**Recommended target shape (one process, one box):**

```
Bun process
  ├─ server.ts       HTML + /api/*  (existing)
  ├─ live poller     the DO loop, moved in-process (new, small)
  ├─ auth + billing  sessions, Stripe webhooks (new)
  └─ weekly refresh  cron inside the process or a systemd timer (existing CLI)
SQLite (data/nascar.db, ~160 MB) + Litestream → S3/B2 for continuous backup
Caddy/nginx in front, TLS, static assets cached
Plausible (or PostHog) for analytics; Resend/Postmark for email
```

Hosted on Fly.io, Railway, Render, or a single Hetzner VPS. Expected cost
$10–40/month all-in. Postgres is not needed at this scale (tens of thousands of
users would still be fine on SQLite with reads only; all writes are the weekly
batch plus user tables). The tech-stack table in ARCHITECTURE.md already says
"SQLite → Postgres (production)"; I would delay Postgres until a concrete reason
appears.

**Alternative kept in reserve:** keep the static export as the free, SEO-facing
site and add a small dynamic "app" server only for logged-in features. It
halves hosting risk but doubles the surface area to keep consistent. Choose it
only if the free tier must stay on a free static host for cost reasons.

What "why leave Cloudflare" is the deciding factor here (see question 1 at the
end). If the reason is that the account is the FabIS business account, the
answer is a new account anywhere, and Cloudflare would still be a fine place to
run a Bun/Node container. If the reason is wanting a real server for auth and a
database, the one-box shape above is right regardless of vendor.

---

## 3. The business questions, honestly

### 3.1 The data source is the elephant

Everything runs on `cf.nascar.com`, an unofficial, unlicensed CDN with no terms
granting redistribution. The research position was "fine for a free fan MVP;
line up Sportradar before monetizing." That position is still correct and it
now needs a decision rather than a note:

- **Charging money changes the risk profile.** The only known enforcement
  (nascarnomics, ~2013–14) was against a free site, so "free" is not immunity
  either, but a paid product built on an unlicensed feed is the one that draws a
  letter.
- **FRCS.pro credits "NASCAR Statistics provided courtesy of NASCAR Digital
  Media, LLC"** and has charged $39–79/yr for two decades. Win The Race charges
  $50/mo. Both are evidence that a tolerated or permitted path exists for small
  operators. Nobody has asked NASCAR Digital Media on our behalf.
- **Sportradar is the official path** and is enterprise-priced (unpublished;
  research estimated high hundreds to thousands per month). That is only
  affordable after revenue, not before.
- **What is defensibly ours:** the computed metrics, the strategy model, win
  probabilities from our own model. The research already identified "publish our
  own model outputs, not their odds" as the differentiated move. That does not
  make the underlying loop data ours, but it is the layer to put behind a
  paywall.

Recommendation: before charging a single dollar, (a) spend an hour with a
lawyer who has done sports-data work, and (b) email NASCAR Digital Media asking
for the same courtesy arrangement FRCS has. Either answer is useful. This is
not legal advice; it is the order of operations.

### 3.2 The market is small and that is fine if the goal matches

- Serious NASCAR DFS/betting users: an estimated 5,000–15,000 nationally.
- Data-curious fans: far larger (r/NASCAR is ~600k) but willingness to pay is
  anchored by the official app's premium tier at $4.99/mo.
- Free competition is good and getting better: Lap Raptor (deep loop data,
  free), nascar-reference.com (modern, free, no loop data). The open lane is
  still "loop-data-first analytics with modern UX + live", but the free bar is
  high.

Realistic ceilings from the research: a DFS/betting subscription business tops
out around $300–800k ARR; a broad-fan freemium site is more likely $50–200k ARR
plus affiliate. This is a **lifestyle/side business**, not a venture business.
That is compatible with running it beside FabIS only if the ongoing effort is
low, which the batch-plus-static architecture already delivers.

### 3.3 Business model options

| Model | Fits what exists | Data-risk | Revenue realism | Effort |
|---|---|---|---|---|
| A. Free + sportsbook affiliate + display ads | Fully | Lowest | Low unless traffic is large; sportsbook CPA ($200–500/depositor) needs state affiliate registration in several states | Low |
| B. Freemium subscription (free stats, paid predictions/DFS/live premium) | Mostly; needs accounts + Stripe + the dynamic server | Highest (paid on unlicensed data) | The research's base case: $60–180k ARR at 500–1,000 subs | Medium |
| C. Season-pass content brand (the auto-recap as a Monday newsletter, "PFF for NASCAR") | Recap generator already exists | Medium | 2,000 × $8/mo ≈ $190k ARR is the research's scenario; more realistic first year is a few hundred subs | Low–Medium |
| D. B2B / media data licensing (metrics API to podcasters, YouTubers, fantasy sites) | Needs an API and licensing clarity | Highest without a license | Few customers, higher ACV | Medium |

Recommendation: **B with C folded in**, sequenced so that the paid tier
launches at the 2027 Daytona 500, not this season. The email list built from
the recap is the asset that survives any pivot, including a forced one if the
data question goes badly.

### 3.4 Pricing (a first position, to be tested, not a final answer)

Anchors: NASCAR Mobile premium $4.99/mo (low, official); FRCS $39–79/yr;
Win The Race $50/mo or $225/rest-of-season; The Athletic $72/yr; PFF $8–12/mo.

Season-pass pricing fits this sport. The calendar is February to early
November with a three-month dark period; monthly subscriptions will churn every
December and the season pass removes that conversation.

| Tier | Price | What it unlocks |
|---|---|---|
| Free | $0 | Everything on the site today: profiles, compare, track explorer, metrics leaderboards, recap, live board (running order + basic loop stats) |
| **Pro** | **$7.99/mo or $59/season** | Race-weekend predictions (our model's win/top-5/top-10 probabilities), DFS projections + printable cheat sheet, full live companion (Loop Rating sort, Strategy tab, My Driver push alerts), CSV export, ad-free, Monday recap in the inbox |
| Crew Chief (later, only if DFS demand shows) | $19.99/mo or $149/season | Lineup optimizer, ownership projections, API access, Discord |

Why these numbers: Pro sits above the official app (we sell depth they will not
build) and well under Win The Race (we sell to fans, not grinders), and the
season price lands in FRCS's proven $39–79 band with a modern product. The
season pass is ~38% off monthly, which is the standard nudge.

Unit economics at those prices, ignoring a data license: 500 Pro seasons ≈
$30k, 2,000 ≈ $120k; hosting $20–40/mo, Stripe ~3%, email ~$20/mo. A data
license is the unknown that could make the whole thing marginal, which is why
it is question 4 below.

A kill/continue metric for the first paid season: **200 paid season passes by
the end of May 2027** (~$12k). Below that, the project stays a free site with
affiliate links and stops consuming build time.

---

## 4. Recommended sequence

**Now, before the playoffs are over (one working day):**
1. Merge PR #9.
2. Add the two Cloudflare secrets so Monday's build actually deploys; redeploy
   the Worker once so baselines are current. Or, if leaving Cloudflare is
   decided, point the same `dist/` at the new host. Either way, stop shipping a
   stale site during the most-watched ten weeks of the year.
3. Add Plausible (one script tag in `layout.ts`) and a one-field "get the
   Monday recap by email" box on the recap page. Measure for ten weeks.
4. Fix the cache-eviction miss so the weekly job stops cold-backfilling.
5. Buy the domain if "LoopLab" is the name.

**Off-season, Nov 2026–Jan 2027:**
6. Data decision: lawyer hour + NDM email. This gates everything paid.
7. Migrate to the one-process dynamic server (section 2). Move the live poller
   in-process. Retire the Vercel mirror.
8. Accounts (magic-link email is enough), Stripe, the Pro gate, push alerts.
9. Build the prediction model that the Pro tier sells. This is the only new
   analytics work in the plan; everything else is packaging what exists.

**Feb 2027, Daytona:**
10. Launch Pro. Measure against the May kill/continue number.

---

## 5. Open questions for the owner

The recommendations above are built on assumptions. These answers change them:

1. **Why leave Cloudflare?** Business-account entanglement, wanting a real
   server for auth and a database, cost, or something else. Determines whether
   the answer is "new account" or "new architecture".
2. **What is the ambition?** Side income ($1–5k/mo) run beside FabIS with
   minimal hours; a real business you would put serious time into; or mostly a
   portfolio/fun project. Determines whether licensing and Sportradar are worth
   pursuing at all.
3. **Which customer first?** Data-loving fans (broad, low willingness to pay),
   DFS/bettors (narrow, high willingness to pay), or media/B2B. Determines what
   the Pro tier contains and the price band.
4. **Risk appetite on the data source.** Comfortable charging on the unofficial
   CDN the way FRCS and Win The Race appear to, or want a permitted/licensed path
   before any paywall.
5. Has the site been shared anywhere, and is there any signal that people use it?
6. Is "LoopLab" the name? Is there a domain?
7. Hours per week you could realistically give this between now and February.
