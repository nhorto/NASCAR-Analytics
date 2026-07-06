# Tire, Fuel & Strategy — Data Sources and Modeling Methods (2026-07-06)

> Research backing the strategy layer of the [Live Race Day Companion](../exec-plans/active/2026-07-05-live-race-companion.md).
> Question: for tire wear, fuel, and pit strategy — including how they vary by track —
> **is there a data feed that carries this, or must we compute it? And how?**
> Method: fan-out web search → 21 sources fetched → 47 claims extracted → 25 adversarially
> verified (3-vote, kill on 2/3 refute) → 19 confirmed, 6 refuted. Confidence is noted per claim.

---

## Bottom line

**There is no feed — free or licensed — that a third-party product can buy that hands you
live tire wear or fuel level for the field.** Everything on our Strategy tab must be **modeled
from timing data**, exactly as we're already (crudely) doing. The upside: the *established*
modeling method is well-documented (a granted patent describes it), we already ingest the
inputs it needs, and the honest per-track calibration path is **our own historical backfill**,
not a published table (the published tables we found were mostly wrong — see Refuted).

Three findings that change how we should think about this:

1. **Real tire/fuel telemetry exists but is structurally out of reach.** NASCAR's Event Racing
   Data Platform (ERDP) carries 60+ sensors per car — but it is **licensed AND team-siloed**:
   each team gets only *its own* car. There is no 40-car third-party tap. And NASCAR **bans live
   telemetry to teams during the race** anyway. So nobody — not even Cup teams — has the live
   field-wide tire/fuel feed we'd want. This kills the "just buy the data" option.
2. **Fuel is *always* a calculation, for everyone.** NASCAR bans fuel gauges. Every "laps of
   fuel left" number you've ever seen on a broadcast is `(gallons × MPG) ÷ track-length` with an
   empirically-measured MPG. We can compute the same thing — the secret sauce is the per-track MPG.
3. **Our current model is the right *shape*, just under-calibrated.** The canonical method
   (PitRho patent US 10,412,466) is "adjusted lap times": regress out tire age, fuel load, and
   traffic from raw lap times to isolate true pace, then project undercut/overcut. We already use
   lap-speed trend as a falloff proxy — this is the principled version of that, and it's buildable
   on the public feed.

---

## Track A — Data sources: what actually carries tire/fuel/pit data

| Source | Tire wear | Fuel | Pit / stint | Access | Cost | Verdict |
|---|---|---|---|---|---|---|
| **Public CDN** `live-feed.json` / `lap-times.json` | ❌ | ❌ | pit-in lap only (live) | Open | Free | Lap #/time/speed + running position only. *What we use today.* |
| **Public CDN** `weekend-feed.json` → `pit_reports` | per-corner tire-**change** booleans (not wear) | ❌ | ✅ `pit_in_race_time`, `pit_out_race_time`, `total_duration`, flag status | Open | Free | **Underused by us** — real pit timing + green/yellow flag status. But post-session, not `live-feed.json`. |
| **`pynascar`** (community wrapper) | change flags only | ❌ | ✅ same granular pit fields | Open (MIT) | Free | Same ceiling as the public CDN — it *is* the CDN. Useful field reference. |
| **Racing-Reference / loop data** | ❌ | ❌ | ❌ | Open | Free | Position-derived advanced stats only (avg running pos, driver rating, quality passes). No tire/fuel. |
| **NASCAR ERDP** (Event Racing Data Platform) | ✅ tire temp, brake wear, CAN-bus @10ms | ✅ (sensor-derived) | ✅ microsecond pit timing (Bolt6 optical) | **Licensed + credentialed** (`erdp.access@nascar.com`; 403 without auth) | Licensed; **team-siloed = own car only** | The only *real* telemetry — and unavailable to a 40-car third party. Terms unknown (open question). |
| **NASCAR Premium app** "Live Telemetry" | derived "tire remaining" gauge | derived "fuel remaining" gauge | pit timers | Consumer app | ~$4.99/mo | A **product, not an API.** Gauges are *estimates*, not raw exports. Not queryable. |
| **SMT** (SportsMEDIA Technology) | ❌ (broadcast overlay) | ❌ | live timing/scoring + driver-input telemetry (brake pressure/zone, throttle) | Broadcast/licensed | Licensed | Powers TV graphics. Enumerated fields carry **no** tire-wear or fuel telemetry. Not a consumer feed. |
| **Sportradar / SportsDataIO / Genius** | ❌ tire/fuel not advertised | ❌ | timing/scoring, pit events | Licensed API | Paid tiers | Official real-time timing feeds — richer/more reliable than the CDN, but **no tire-wear or fuel fields surfaced**. Genius is the sportsbook-data licensee (betting angle), not a tire/fuel source. |

**The one-line answer to "is tire/fuel a feed we can get?": no.** The only source that physically
measures it (ERDP) is licensed and siloed to each team's own car; every consumer/broadcast surface
that *shows* tire/fuel is displaying a **derived estimate**, not exporting a sensor. Licensed timing
APIs (Sportradar et al.) would improve our *timing/pit* inputs and reliability, but they do **not**
add tire wear or fuel.

### What this means for us concretely
- **We already have the best tire/fuel *inputs* a third party can get** — the public CDN. A paid
  timing API would buy reliability and cleaner live pit data, not new physical quantities.
- **Low-hanging fruit: wire in `pit_reports` timing.** Our `pitCycleModel` currently infers stints
  from the sparse `pit_stops[].pit_in_lap_count`. The `weekend-feed.json` pit report carries real
  in/out race-times, durations, and **flag status** (so we can filter green- vs caution-flag stops —
  critical, since caution stops don't reset a green-flag fuel window the same way). Confirm its live
  latency (open question) before relying on it in-race.

---

## Track B — How to actually compute it

### Tire degradation (falloff)
- **Canonical method (PitRho, US 10,412,466, verified):** compute **"adjusted lap times"** — take
  raw lap time and quantify+subtract the separate second-per-lap effects of **tire age**, **# new
  tires (0/2/4)**, **fuel-saving**, plus traffic, track position, time-in-race, and damage. What
  remains is the car's true pace on equal footing. Updated via Bayesian regression as the run
  develops. This is the principled version of our lap-speed-trend proxy: instead of "line goes
  down = worn," you *fit* the falloff slope and separate it from fuel burn.
- **Promising academic lead (unverified — found, not fact-checked):** *"A State-Space Approach to
  Modeling Tire Degradation in Formula 1 Racing"* (arXiv 2512.00640) — a Bayesian state-space model
  estimates **latent** tire degradation from **public timing data alone** (`lap time = f(fuel mass +
  latent tire pace)`, pit stops reset the latent state). Directly transferable to our situation
  (timing data, no ground truth). Worth a real read before we design the model.
- **Practical shape:** on each green-flag run, regress lap time vs. laps-since-pit. Early laps are
  contaminated by fuel load (heavy car = slow) which *improves* pace as fuel burns, partially
  masking tire falloff — so the two effects fight and must be fit *together*, not separately. Falloff
  is roughly linear over a stint at most tracks but steepens late; a linear+quadratic term captures it.

### Fuel
- **Fuel is estimated, never measured (verified — gauges are banned).** Model:
  `laps_per_tank = (tank_gallons × MPG) ÷ track_length_miles`. Tank is a known constant
  (~18–20 gal Next Gen). **MPG (~4.2–4.5 typical) is the hard, track-specific input** and is what
  real teams guard. It varies with throttle time, drafting, and cautions.
- **We can estimate MPG empirically from our own data:** a car that pits under green after N laps
  and takes a known-ish fill reveals its consumption; averaged over a track's history, that yields a
  per-track MPG we can bake alongside our existing `baselines.json`.

### Pit strategy / undercut-overcut
- Adjusted lap times → **project the position change** from pitting now vs. staying out, the 2-tire
  vs. 4-tire finish, and the **optimal pit lap** (simulate cumulative race time, pick the minimum).
  This is a real upgrade over our current "lapsSincePit ≥ stintLength → needs to pit" heuristic.
- The inputs (green-flag run pace, real pit durations, flag status) are all available from the
  public feed + `pit_reports`.

---

## Per-track calibration — the honest state

**Calibration is essential and cannot be copied from a published table.** We specifically went
looking for "tires last X laps at track type Y" numbers and **the widely-cited ones failed
verification** (see Refuted). The *one* solid, sourced per-track number we could confirm:

- **Talladega (superspeedway): ~45-lap fuel window.** So concrete that NASCAR **reconfigured the
  2026 spring race to 98-45-45 stages** (188 laps) specifically to keep late stages inside one tank
  and neutralize fuel-saving. (Verified.)

The takeaway is a *method*, not a lookup table:
- **Fuel window scales inversely with track length** (short track → 100+ lap windows; superspeedway
  ~45). Directionally true; exact numbers must be measured.
- **Calibrate from our backfill.** We already ingest historical `lap-times` and pit data across
  2016–2026. Per track (and track *type* — short / intermediate / superspeedway / road), we can fit:
  typical green-flag **stint length**, **laps-per-tank / MPG**, and a **tire-falloff slope** (sec/lap).
  Bake these per-track constants like we bake `baselines.json`. This replaces the flat
  `DEFAULT_STINT_LAPS = 40` — which is the single weakest assumption in the current model.

---

## What NOT to rely on (refuted, 0-3 unless noted)

- ❌ "NASCAR tires last 40–60 laps at intermediates, 100–120 at short tracks" (flowracers) — **refuted.**
- ❌ "Goodyear designs tires to last 35–100 laps by track/compound" (flowracers) — **refuted.**
- ❌ "Teams track live tire-temp telemetry / brake wear in real time during the race" — **refuted**
  (NASCAR bans live telemetry to teams in-race; tire temps are taken by hand with a pyrometer in the pit).
- ❌ "Telemetry lets teams calc fuel to within 100 feet" — **refuted** (fuel is dump-can math, not sensor).
- ❌ "SMT 'Team Analytics' / Genius exclusive is a tire/fuel data source" — **refuted** framings; those
  are timing/broadcast/betting products, not tire/fuel feeds.

> Source-quality caveat: the public-feed field maps rest on community wrapper repos
> (`armstjc/racing-data-repository`, `pynascar`) rather than an official public schema; the ERDP
> details come from NASCAR's own NextGen dev docs (primary); the modeling method is a granted patent
> (primary) that documents an *approach*, not validated accuracy. Time-sensitive: the Premium app
> feature and 2026 Talladega stages are 2025–2026 and may change.

## Open questions (carry into a strategy-model exec plan)

1. **ERDP/licensed terms:** can a non-team third party *ever* license the full-field telemetry, and
   at what cost — or is team-siloed the hard ceiling? Same question for any tire/fuel-adjacent field
   in Sportradar/SMT/Genius.
2. **Per-track constants:** derive defensible stint-length, laps-per-tank/MPG, and falloff-slope
   constants per track type from our own backfill (published tables are unreliable).
3. **Model honesty:** how well can adjusted-lap-time regression separate tire from fuel on the public
   feed with no ground truth — and what error bars should we *show the user*?
4. **Live pit latency:** does `weekend-feed.json`/`pit_reports` (or a licensed feed) update fast
   enough mid-green-run to drive live undercut math, or is it reliable only post-session?

## Sources

- Public CDN field maps: `github.com/armstjc/racing-data-repository`, `github.com/ab5525/pynascar`
- ERDP telemetry: `docs.nextgen.nascarracedata.com` (Developer Guide, Optical Tracking) — primary
- Modeling: PitRho patent US 10,412,466 (`image-ppubs.uspto.gov/.../10412466`) — primary;
  arXiv 2512.00640 (F1 tire-degradation state-space) — lead, unverified
- Fuel: buildingspeed.org (fuel-mileage arithmetic); NASCAR bans gauges (NBC/NASCAR.com corroborated)
- Per-track: hendrickmotorsports.com (2026 Talladega 98-45-45 / ~45-lap window) — verified
- Loop data: racing-reference.info/driver-loop-data-stats
- Refuted: flowracers.com (tire-life numbers), slicksandsticks.com (live-telemetry claims), smt.com,
  Genius Sports PR
