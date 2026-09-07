# Productization Review — where LoopLab is, and what it would take to make it a product

**Date:** 2026-09-07 (owner answers folded in the same day)
**Purpose:** Owner asked for a state-of-the-repo review plus a first pass at
"should this become a product, on what infrastructure, with what business
model, at what price." This is a decision document, not a plan. Section 6
records the owner's answers; the recommendations are written against them.

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

## 2. Where the data comes from (plain English)

There is **one** data source for everything on the site, plus one backup path
we do not use yet.

**The NASCAR public CDN, `cf.nascar.com`.** It is the same set of JSON files
that NASCAR's own website and mobile app read. There is no API key, no login,
no developer agreement, and no published terms for these paths. It needs a
browser-looking `User-Agent` header and nothing else. Endpoints we read:

| File | What it gives us | Coverage |
|---|---|---|
| `cacher/{year}/{series}/schedule-feed.json` | The season schedule, race ids, tracks, start times | 2016 → now |
| `cacher/{year}/{series}/{race}/weekend-feed.json` | Official results, entries, and (for ~1/4 of races) `pit_reports` | 2017 → now |
| `loopstats/prod/{year}/{series}/{race}.json` | The **official loop data** per driver: Driver Rating, passes, quality passes, fast laps, running-position stats | 2019 → now (2018 for Trucks) |
| `cacher/{year}/{series}/{race}/lap-times.json` | Every driver's lap time for every lap | 2020 → now |
| `cacher/{year}/{series}/{race}/live-pit-data.json` | Per-stop pit timing, tires changed, flag state at the stop | Recent seasons; used live and in calibration |
| `live/feeds/live-feed.json` | The live race feed the Worker polls every 5 s | Only while a session is on track |

Every 200 response is archived verbatim under `data/raw/` with a sha256 index,
so if NASCAR ever locks these paths we keep everything ingested to that day.

Two things the March research believed that turned out false: loop data does
**not** go back to 2005 on the CDN (only Racing-Reference has that, and it is
bot-blocked), and The Odds API does **not** cover NASCAR. So we have ~7.5
seasons of loop data, which covers the whole Next Gen era, and no odds source.

**Backup path, unused:** the `nascaR.data` R package (CRAN, GPL-3, weekly
updates, sourced from DriverAverages.com with permission). Results only, 1949
onward, no loop data. It is the fallback for official results if a `weekend-feed`
goes missing, like the 2025 YellaWood 500 did.

**Official, paid path, not used:** Sportradar (NASCAR's official real-time data
licensee, enterprise pricing on request) and SportsDataIO (NASCAR in its
catalogue; commercial access through sales, a hobby "Discovery Lab" tier at
roughly $99–149/mo with next-day data). Neither carries tire wear or fuel.

---

## 3. The pit-cycle / strategy work: what got solved and what is still a hole

You are remembering correctly that this had holes. Here is exactly where it
landed on 2026-07-06 (see the calibration plan and the tire/fuel research).

**What we wanted:** a live "this car has N laps of fuel left and its tires are
this worn" readout, like the official app's premium gauges.

**What we learned:**
- **No feed gives a third party tire wear or fuel level.** The only source that
  measures it (NASCAR's ERDP telemetry platform) is licensed and siloed so each
  team sees only its own car. The official app's gauges are estimates, not an
  API. So anything we show must be modeled from timing data.
- **The published "tires last X laps at track Y" tables were wrong.** We checked
  them against our own backfill and they failed. The one number that survived
  is Talladega's ~45-lap fuel window.
- **Fuel capacity is not recoverable from history.** Cars pit for tires or
  track position before the tank is empty at short tracks (Bristol's longest
  observed green run is ~67 laps on a ~125-lap tank), and our stint
  reconstruction sometimes merges across a missed stop at intermediates,
  producing physically impossible 70-lap runs on a 50-lap tank. We stopped
  pretending: the model ships **`typicalStintLaps`**, the median green run at
  that track, and predicts **`lapsToTypicalPit`**. It is a behavioral "cars here
  pit every ~N green laps", not a fuel gauge, and the UI says so.
- **The first tire-falloff method was broken and was replaced.** Fitting lap
  time against laps-since-pit inside one green run cannot separate tire wear
  from fuel burn-off because both grow one lap at a time. The replacement is the
  **pit-discontinuity** method: compare a car's last three green laps before a
  four-tire stop with laps 3–6 after it. That orders tracks exactly as real
  tire knowledge predicts (Darlington 1.89 s worn-vs-fresh, Las Vegas 0.70,
  Talladega 0.19) on large samples (1,425 stops at Darlington). It bakes a
  per-track **tire severity tier** (high / moderate / low).
- **Held-out backtest (train before 2022, test 2022+):** predicting a green
  stint's length per track has a mean error of 6.0 laps versus 15.0 for the old
  flat 40-lap constant, and lands within 10 laps 86% of the time.

**Still open, honestly:**
1. **Intermediate tracks are the weak spot** (10.1-lap mean error, within 10
   laps only 61% of the time). Teams there pit early for track position and
   cautions, and no median can fix that. Closing that gap means conditioning on
   race state (laps to stage end, caution likelihood, position), which is real
   modeling work.
2. **Fuel-mileage races are not identified.** A true fuel feature would need to
   detect "this is a fuel race" from the pattern of stops. Not built.
3. **Tire severity has no ground truth.** It is validated by ordering, not by a
   number. Fine for a tier badge; not fine for "tires are 63% worn".
4. **Xfinity is thin** (85 training stints, 10.4-lap error). Trucks and Cup are
   fine.
5. **Dirt: one stint.** Ignore it.
6. **The baked calibration on the deployed Worker is from July** and must be
   regenerated by the refresh pipeline (PR #9 wires this in). Until it is
   merged and deployed, live strategy numbers drift as the season adds races.
7. **Live metrics never swap to the official numbers after the checkered flag.**
   The live adjPE/Closer estimates stay on screen instead of being replaced by
   `loopstats/prod` once it publishes. Small, known, unbuilt.

Verdict: the strategy tab is honest and better than a constant. It is a
"race-day companion" feature, not a "beat the sportsbook" feature, and it
should be sold as the former.

---

## 4. Infrastructure: Cloudflare, servers, and what actually has to change

### Cloudflare can run this in production. That was not the problem.

The worry was "we need a real server, and I am not sure Cloudflare can do
production." Both halves need correcting:

- Cloudflare Pages and Workers with Durable Objects are production-grade; the
  live Worker has been serving real race feeds since July with no incident.
  Paid Workers is $5/month and the whole thing would fit inside it.
- What Cloudflare **cannot** do is run the code as written on the dynamic path.
  `src/app/server.ts` (the full site as a live server) uses `Bun.serve` and
  `bun:sqlite`, neither of which exists in the Workers runtime. Going dynamic
  on Cloudflare means porting the repo layer to D1 and the server to a Worker,
  or running a Cloudflare Container. That is a rewrite of the storage layer for
  no product gain.

### The real change is static → dynamic, and the dynamic version already exists

Every page today is a public file. That cannot support accounts, a paywall,
per-user alerts, or push, which is the entire paid tier. `server.ts` is the
dynamic site: same `render.ts`, same JSON routes, already the dev server.
Production-izing it is the migration.

### Recommended shape: one Bun process, one box

```
Bun process
  ├─ server.ts       HTML + /api/*            (exists)
  ├─ live poller     the DO loop, in-process  (1–2 days: setInterval + a table instead of DO storage)
  ├─ auth + billing  magic-link sessions, Stripe webhooks (new)
  └─ weekly refresh  systemd timer running the existing CLI (exists)
SQLite (data/nascar.db, ~160 MB) + Litestream → S3/B2 continuous backup
Caddy in front for TLS
Plausible for analytics; Resend for email
```

On Fly.io, Railway, or a Hetzner VPS: $10–40/month all-in. Postgres is not
needed at this scale; every write is the weekly batch plus small user tables.

Cloudflare coupling to remove, measured: 14 `storage.get/put` calls, 4 alarm
calls, 3 `cf:` fetch options, one hard-coded origin string, one `wrangler`
command in the refresh CLI. The pure `live` domain needs no change.

Keep Cloudflare for DNS and as the CDN in front of the box if you like; that is
free and has nothing to do with the account question. Whether the Pages
project lives on the FabIS account is a housekeeping issue, not a reason to
migrate.

---

## 5. The business questions

### 5.1 The data source, in more detail (owner asked)

This is not legal advice. It is the shape of the risk so the lawyer hour is
well spent.

**What the law mostly says.** Facts are not copyrightable (*Feist*, 1991).
Sports scores and statistics are facts; *NBA v. Motorola* (2d Cir. 1997) held
that relaying game data in near real time did not infringe the NBA's copyright.
The one theory that survived *Motorola*, "hot news" misappropriation, was cut
back hard in *Barclays v. Theflyonthewall* (2d Cir. 2011) as preempted by
federal copyright law. Post *Van Buren* (2021) and *hiQ v. LinkedIn* (9th Cir.
2022), reading data that a site serves to the public without authentication
is not a computer-fraud violation. Loop data itself is factual; our metrics
computed on top of it are ours.

**Where the risk actually sits, in order:**
1. **Technical, not legal.** NASCAR can add authentication, a signed User-Agent
   check, or an IP block to `cf.nascar.com` any Tuesday. That would take the
   site and the live companion down at once. This is the risk to plan for. The
   raw archive protects the history; it does not protect next week's race.
2. **Terms of use.** NASCAR.com's site terms are generic and there is no
   click-through on the CDN paths, so a contract claim is weak, but a paid
   product makes a cease-and-desist letter more likely than a free one, and
   most solo operators fold at the letter regardless of merits.
3. **Trademark.** Do not put "NASCAR" in the product name, logo, or domain.
   Nominative use in text ("stats for NASCAR Cup Series races") is fine.
4. **Sportsbook-adjacent regulation.** Publishing our own win probabilities is
   information, not wagering. Republishing sportsbook odds or taking affiliate
   money triggers state affiliate registration in several states. Keep odds
   out until there is a reason.

**Precedent, corrected.** The July research cited nascarnomics.com (2014) as
NASCAR's enforcement precedent against a data site. On re-check it was a
**Nielsen** DMCA notice over republished **TV ratings**, and the site's race
statistics were never at issue. There is, as far as public record shows, **no
documented enforcement by NASCAR against a fan statistics site** using the
CDN. FRCS.pro has charged $39–79/yr on this data for two decades and credits
"NASCAR Statistics provided courtesy of NASCAR Digital Media, LLC", which
reads as an informal permission. Win The Race charges $50/mo on it. Lap Raptor
and nascar-reference.com run free on it.

**What to do, cheaply, before charging:**
1. One hour with a lawyer who has done sports-data or scraping work. Bring
   this section. Ask two questions: is our exposure materially different from
   FRCS's, and what should the terms of service say about data provenance.
2. Email NASCAR Digital Media asking for the same courtesy arrangement FRCS
   has, describing the product as fan analytics. A yes is a moat. A no is
   information. Silence is the likely outcome and changes nothing.
3. Build for the technical risk: keep the archive, keep the CDN client
   swappable behind the `nascar-cdn` provider, and keep the SportsDataIO
   Discovery Lab tier ($99–149/mo, next-day data) as the known fallback for
   historical/weekly data if the CDN closes. There is no cheap fallback for
   the live feed; if it closes, the live companion pauses until revenue can
   carry a Sportradar conversation.

Given "side income beside FabIS", the recommendation is: do steps 1 and 2 this
off-season, then charge. Do not pursue Sportradar; it only makes sense above
roughly $5k/month of revenue, and the product is not there.

### 5.1b Backup plan: how reliant we are, and how to make it survivable

**Reliance by feature.** One unlicensed source feeds everything, but the
failure mode differs:

| Feature | Needs | If the CDN closed tomorrow |
|---|---|---|
| Profiles, compare, track explorer, careers | Results + loop data, weekly | Keeps working on archived data; stops adding races |
| Proprietary metrics | Loop data | Frozen, not broken |
| Recap, playoff picture | Results + loop data, weekly | Frozen |
| Strategy calibration | Lap times + pit reports, historical | Already computed; degrades slowly |
| **Live companion** | Live feed, every 5 s | **Dead immediately; no free fallback** |

The static site never 404s; what is lost is freshness. A two-week gap is
survivable for a weekly fan product and fatal for a paid live product.

**Already in place:** the raw archive (seven seasons are ours regardless),
pure normalizers (a new source is a new adapter, not a rewrite), fixtures and
schema tests (a silent schema change fails a test first).

**Fallback by data type, cheapest first:**
1. *Results and schedules* — `nascaR.data` (free, weekly, from DriverAverages
   with permission, 1949+). Drop-in.
2. *Loop data* — no free API. Derive it ourselves from lap timing (below);
   SportsDataIO Discovery Lab (~$99–149/mo, next-day); or ask DriverAverages,
   who already license to `nascaR.data`. Racing-Reference is bot-blocked.
3. *Lap-by-lap timing* — Sportradar (official, lap-by-lap for all three
   series, enterprise pricing). Only once revenue exists.
4. *Live* — Sportradar only.

**The mitigation that matters most.** Loop data is NASCAR's summary of
per-lap position and timing. Green-flag passes, quality passes, average
running position, closing laps and fastest laps can all be recomputed from
per-lap positions plus flag state, which we already ingest and which the live
domain already does in miniature. Build a "loop metrics from timing" path
once and any lap-timing source keeps the metrics alive. That collapses four
feed dependencies into one, and the one has a licensed vendor. The moat is
then the computed layer and the audience, not feed access.

**Cheap actions, in order:**
1. Fix the weekly cold backfill (section 1, item 3). ~1,000 race fetches every
   Monday is the most likely way to *cause* a lockout.
2. Add a daily canary: each endpoint returns 200 with the expected shape, or
   an email goes out. Hear about a lockout from our monitor, not a subscriber.
3. Test fallbacks before they are needed: SportsDataIO free trial +
   `nascaR.data`, adapter stubs written against their schemas. Half a day.
4. Good citizen: keep rate limits and caching; never republish the raw feed,
   only computed views; no NASCAR marks in the brand.
5. Send the NASCAR Digital Media email (section 5.1).
6. Hedge the money: a data-availability clause in the terms of service, a
   season-pass price that survives a pro-rata refund, fixed costs near zero.
7. Set a Sportradar trigger: at a chosen monthly revenue, open the
   conversation and move live to licensed data.

### 5.2 The market, given the chosen customer

Owner's answer: DFS/bettors **and** data-loving fans who want a better
race-day companion. That is two audiences with different willingness to pay,
which argues for a single paid tier priced for the fan and built around the
live companion, with DFS projections included as the reason a DFS player
also buys it. A separate high-priced DFS tier waits for evidence.

- Serious NASCAR DFS/betting users: an estimated 5,000–15,000 nationally.
- Race-day-companion fans: much larger, anchored by the official app's $4.99
  premium tier and the emotional gap left by RaceView's shutdown.
- Free competition is good: Lap Raptor (deep loop data), nascar-reference.com
  (modern, results-only). The open lane is still loop-data-first analytics
  with modern UX **plus live**, and nobody independent does live.

Ceiling for this shape: a lifestyle business, realistically $50–200k ARR at
maturity, which is consistent with "side income beside FabIS".

### 5.3 Business model

**Freemium subscription with a season pass, live companion as the hero,
email recap as the funnel.** Ads and affiliate stay off until traffic exists.

| Tier | Price | Contains |
|---|---|---|
| Free | $0 | Everything on the site today: profiles, compare, track explorer, metrics leaderboards, recap, live board with running order and basic loop stats |
| **Pro** | **$9.99/mo or $69/season** | Full live companion (Loop Rating sort, Strategy tab, My Driver push alerts, drill-downs), race-weekend predictions from our model (win / top-5 / top-10 probabilities), DFS projections + cheat sheet, CSV export, ad-free, Monday recap in the inbox |
| Crew Chief (only if DFS demand shows) | $19.99/mo or $149/season | Lineup optimizer, ownership projections, API key, Discord |

Why $9.99 / $69 rather than the $7.99 / $59 in the first draft: with DFS
players explicitly in scope and live as the hero, the price can sit two
dollars above the official app without losing the fan, and it leaves room
under Win The Race's $50/mo for a DFS tier later. The season pass is ~42% off
monthly and avoids the December churn conversation every monthly plan has in
a February-to-November sport.

Unit economics without a data license: 500 Pro seasons ≈ $35k, 2,000 ≈ $140k;
hosting $20–40/mo, Stripe ~3%, email ~$20/mo.

Kill/continue metric for the first paid season: **200 paid season passes by
the end of May 2027** (~$14k). Below that, the site stays free with an email
list and stops consuming build time.

---

## 6. Owner answers (2026-09-07) and what they changed

| Question | Answer | Effect on this document |
|---|---|---|
| Why leave Cloudflare? | Thought a real server was required and was unsure Cloudflare could run production | Section 4 rewritten: Cloudflare is fine; the real change is static → dynamic, and the one-box Bun server is the least-work way to get there |
| Ambition | Side income beside FabIS, minimal hours | No Sportradar; cheap legal check + NDM email; batch architecture stays; kill metric added |
| First customer | DFS/bettors and race-day-companion fans | One Pro tier at $9.99 / $69 with live as the hero and DFS projections included; DFS-grinder tier deferred |
| Data risk comfort | Not sure, wanted more detail | Section 5.1 expanded; nascarnomics precedent corrected |

Still unanswered, non-blocking: has the site been shared anywhere; is
"LoopLab" the name and is there a domain; hours per week until February.

---

## 7. Recommended sequence

**Now, before the playoffs end on ~Nov 8 (one working day):**
1. Merge PR #9.
2. Add the two Cloudflare secrets so Monday's build actually deploys; redeploy
   the Worker once so baselines and strategy are current. Stop shipping a
   stale site during the most-watched ten weeks of the year.
3. Add Plausible (one script tag in `layout.ts`) and a one-field "get the
   Monday recap by email" box on the recap page. Measure for ten weeks.
4. Fix the cache-eviction miss so the weekly job stops cold-backfilling.
5. Buy the domain if "LoopLab" is the name.

**Off-season, Nov 2026–Jan 2027:**
6. Lawyer hour + NDM email (section 5.1). Gates everything paid.
7. Migrate to the one-process server (section 4). Move the live poller
   in-process. Retire the Vercel mirror.
8. Accounts (magic-link email), Stripe, the Pro gate, web push for My Driver.
9. Build the prediction model the Pro tier sells (win/top-5/top-10
   probabilities from our metrics). This is the only new analytics work in the
   plan; everything else is packaging what exists.

**Feb 2027, Daytona:**
10. Launch Pro. Measure against the May kill/continue number.
