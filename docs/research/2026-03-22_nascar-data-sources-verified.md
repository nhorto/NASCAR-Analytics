# NASCAR Data Sources — Verified Reality (2026-03-22)

These sources were independently verified by hitting actual endpoints, checking PyPI, CRAN, and GitHub.
Updated with CDN discovery on 2026-03-22.

---

## THE PRIMARY SOURCE: NASCAR's Public CDN (How Fan Sites Actually Get Data)

**This is the most important finding.** NASCAR serves JSON data files on a public CDN with NO authentication:

```
cf.nascar.com/cacher/{year}/{series_id}/{race_id}/{data_type}.json
```

Examples:
- `https://cf.nascar.com/cacher/2021/1/schedule-feed.json`
- `https://cf.nascar.com/cacher/live/series_1/5031/live-pit-data.json`
- Pattern for loop data, lap times, pit data, standings, etc.

**No API key. No login. Public JSON.** This is almost certainly how Lap Raptor, FRCS.pro, and similar sites get their data.

An existing SDK documents these endpoints: `github.com/RRoberts4382/rNascar23.Sdk`
- Includes LoopData endpoint specifically
- Documents the full URL patterns and data structures

**Data available via CDN:**
- Loop data (Driver Rating, Quality Passes, Avg Running Position, Green Flag Speed, Fast Laps, Laps in Top 15, etc.)
- Lap times and pit stop data
- Live race data during events
- Schedules, standings, points
- Historical data (query past year/race combinations)

**This is the data pipeline that matters. Everything below is supplementary.**

---

## ALSO FREE AND USABLE

### nascaR.data (R Package)
- **Status:** Confirmed working, actively maintained
- **Version:** 3.0.1 (updated Feb 2026)
- **What you get:** Cup Series results (1949-present), Xfinity (1982-present), Truck (1995-present)
- **Data includes:** Finishing position, driver/car info, track details, performance metrics per race
- **What you DON'T get:** Loop data, lap-by-lap telemetry, practice/qualifying speeds
- **Source:** Data from DriverAverages.com (with permission)
- **How to use:**
```r
install.packages("nascaR.data")
library(nascaR.data)
# Datasets: cup_series, xfinity_series, truck_series
```
- **License:** GPL-3, fully free
- **GitHub:** github.com/kyleGrealis/nascaR.data

### pynascar (Python Package)
- **Status:** Confirmed on PyPI, actively updated
- **Version:** 0.2.1 (updated Aug 2025)
- **What you get:** Race schedules, lap times, pit stop info, race flags, race control messages, practice/qualifying data, driver season stats
- **Returns:** Python objects and pandas DataFrames
- **How to use:**
```bash
pip install pynascar
```
- **Caveat:** Unofficial — wraps NASCAR's internal data feeds. Could break if NASCAR changes endpoints.
- **GitHub:** github.com/ab5525/pynascar

### racing-reference.info (Browser Only)
- **Status:** Site is live, data is visible in browser
- **What you get:** Loop data stats (since 2005), full historical results (since 1949), driver stats
- **Loop data includes:** Average Running Position, Driver Rating, Green Flag Passes, Quality Passes, Green Flag Speed, Fastest Laps, Laps in Top 15, Laps Led
- **IMPORTANT:** Cloudflare blocks automated scraping. You CAN view/copy data in a browser but cannot programmatically scrape it easily. Would need headless browser (Playwright) + rate limiting, and likely violates terms.
- **URL for loop data:** racing-reference.info/driver-loop-data-stats/

### DriverAverages.com
- **Status:** Referenced as the source for nascaR.data
- **What you get:** Aggregated loop data averages by driver
- **Scraping status:** Not fully verified for bot protection

---

## EXISTS BUT NOT TRULY FREE

### SportsDataIO NASCAR API
- **Status:** Real developer portal, real API
- **Free tier:** Exists but returns FAKE/SCRAMBLED data (for testing schema only)
- **Real data:** Requires paid subscription (pricing not public, contact sales)
- **What paid tier gets you:** Real-time race coverage, historical database, driver standings, live scoring, odds
- **URL:** sportsdata.io/developers/api-documentation/nascar

### BelNaruto/nascar-api (RapidAPI)
- **Status:** GitHub repo exists (README only, no source code)
- **What it is:** Unofficial API on RapidAPI
- **Endpoints:** /results, /race-results, /race-report, /scoreboard, /news
- **Cost:** Likely small free tier (~500 req/mo), paid above that
- **Risk:** Unofficial, could break anytime

---

## EXISTS BUT LOCKED/UNUSABLE

### feed.nascar.com/swagger (Official NASCAR API)
- **Status:** Swagger docs are public, ALL endpoints return 401 Unauthorized
- **41 endpoints documented:** LiveFeed, LiveFlag, LivePitData, Driver stats, Race data, Track data, etc.
- **Access:** No public signup, no API keys available. Internal/partner API only.
- **Useful for:** Understanding NASCAR's data model and what data exists (even if you can't access it)

### NASCAR Event Racing Data Platform (ERDP)
- **Status:** Documentation at docs.nextgen.nascarracedata.com is public
- **What it has:** Real-time telemetry at 10ms intervals — CAN Bus data, optical tracking, GPS, pit data
- **Access:** Email erdp.access@nascar.com. Designed for broadcast partners, OEMs, team engineers. Not for individual developers.

### SMT Telemetry
- **What it is:** 1.3TB per race of GPS, throttle%, brake pressure, steering angle per car
- **Access:** Teams and broadcasters only. No public access whatsoever.

---

## STALE / LOW VALUE

### jbrooksdata/nascar-data (GitHub)
- **Status:** Exists but abandoned since June 2022
- **What's in it:** Lap times, lap speeds, pit stop data (R scripts)
- **1 star, 0 forks.** Scrapers were against old NASCAR.com API. May not work.

---

## SUMMARY: What a developer can actually work with today

| Need | Best Free Source | Limitation |
|------|-----------------|------------|
| Historical race results | nascaR.data (R) | Results only, no loop data |
| Lap times, pit stops | pynascar (Python) | Unofficial, could break |
| Loop data / advanced stats | racing-reference.info (manual) | Browser only, no API |
| Live race data | pynascar (limited) | Unofficial, limited scope |
| Betting odds | The Odds API (~$50/mo) | Not free |
| Real-time telemetry | Not available | Locked behind ERDP/SMT |
