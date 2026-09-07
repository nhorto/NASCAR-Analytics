# Runbook — upstream feed loss (cf.nascar.com)

The whole product reads one unlicensed public CDN. The productization review's
risk analysis (docs/research/2026-09-07_productization-review.md §5.1b) says
the realistic failure is **technical, not legal**: an auth wall, UA check, or
IP block appearing without notice. This runbook is what to actually do.

**How you'll know:** the canary email ("[looplab canary] upstream feed
outage: …") after two consecutive failing daily runs, or a red `canary.yml`
workflow before the server canary is live. Pages automatically show the
"data updates are delayed" banner from the same `feed_status` data — that
part needs no action.

## First hour

1. **Confirm scope.** `bun run canary` locally. Read which checks fail and
   how: an HTTP 401/403 everywhere = access change; one endpoint 404 = a
   moved/retired path; shape failures = a schema change (different playbook —
   the normalizers need updating, data is still there).
2. **Check it isn't just us.** Open nascar.com's live leaderboard and one
   `cf.nascar.com/cacher/...` URL in a phone browser on cellular. If NASCAR's
   own site is broken too, it's likely their outage — wait, do nothing.
3. **Do NOT retry aggressively.** No backfill loops against a 403. If we're
   IP-blocked, hammering makes it permanent. The rate-limited canary once a
   day is the probe.
4. Nothing else breaks by itself: the site serves from our own SQLite; the
   static fallback stays up; history is safe (raw archive + Litestream).

## First day (still down)

1. **Freshness first:** results + schedules keep flowing without the CDN —
   `bun run sync --source nascar-data --series 1` (+ `--series 2`, `3`)
   after Monday 05:00 ET fills any missing race from the nascaR.data release
   (verified exact vs CDN rows; fields it lacks stay NULL, loop data is NOT
   included). The site stays current on results, recaps, and standings.
2. **Live + loop data are what's actually lost.** The live board goes idle
   (it is free precisely because of this — spec §3); loop-data metrics freeze
   at the last ingested race.
3. If the canary shows a **shape** change instead of a lockout: fix the
   normalizer against the archived payloads, add a fixture, ship. That is an
   afternoon, not an incident.

## First week (still down)

1. Decide whether it looks deliberate (auth wall = deliberate; 5xx = not).
2. **Weekly data path:** start the SportsDataIO free trial, verify the stub's
   schema against real payloads (src/providers/sportsdataio.ts — currently
   NOT-FOR-PRODUCTION), and budget the Discovery Lab tier (~$99–149/mo,
   next-day data) if the trial confirms fit. Loop-style metrics from lap
   timing: see the WS-C spike report in docs/research/ for what is and isn't
   recomputable.
3. **Business obligations (owner):** D8 / spec §11 — if Pro features that
   depend on the feed are dark 14 consecutive days in season, monthly billing
   pauses and season passes extend. Only push alerts qualify today (Pro's
   other features run on weekly data with the fallback above). Draft the
   status-page note early, not on day 14.
4. Send the NASCAR Digital Media courtesy-arrangement email if it was never
   sent (review §5.1 step 2) — a lockout is the moment to ask politely, not
   to scrape around.

## What is deliberately NOT here

- Rotating IPs/UAs to evade a block: no. It converts a technical block into a
  deliberate-circumvention story and torches the courtesy-arrangement path.
- A live-feed fallback: none exists at any hobby price. Live pauses until a
  Sportradar conversation makes sense (§8 backlog trigger).
