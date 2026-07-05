# Competitive Landscape Refresh (2026-07-05)

Targeted refresh of the March 2026 market research. Focus: what changed in the competitive/official landscape, plus data-access risk. Companion docs: [data sources re-verification](2026-07-05_data-sources-reverification.md), [odds sources](2026-07-05_odds-sources.md).

## Material changes since March 2026

1. **NASCAR Mobile app v16 (Jan–Jun 2026) — biggest change.** The official app got a real overhaul for 2026: upgraded driver pages (season stats, last-5-race trends, career stats, **track-by-track performance history**), a 24/7 NASCAR Channel, and premium live stats (Win Probability, Movers & Fallers, lap averages, fuel/tire pit gauges) at **$4.99/mo**. This compresses the "modern driver profiles" differentiation and partially occupies the live-companion space. It still has **no loop-data exploration, no head-to-head comparison tooling, no track-type analytical splits** — that's where our lane remains open.
2. **New entrant: nascar-reference.com.** Free, modern, mobile-styled independent site (solo builder, Richard R. Glover): 78 seasons of results (1949–2026), 4,361 driver profiles, head-to-head comparisons, an Elo-style "NR-Rating" prediction model, records DB, career-arc viz. **No loop data** — historical/results-based only. "Modern free NASCAR stats site" is no longer an empty niche; loop-data-first analytics still is.
3. **Lap Raptor leveled up while staying free.** Data current through July 4, 2026. Added Pass Matrix, race previews, Stat Pack recaps; expanded to IndyCar, Trucks, dirt series, Supercars. Still no paywall. Its author also launched **Prop Raptor** (propraptor.com) — a betting +EV props tool in free beta covering **NHL/MLB only** so far. Watch for NASCAR expansion; the author is drifting toward betting products.
4. **Win The Race pricing now confirmed: $50/mo or $225/rest-of-season** (March research guessed $15–30/mo). Free tier exists (track comparison tool + core loop metrics). Paid: 200k-run sims, FMV odds, DFS optimizer, pit stop scores, Discord. Squarely a DFS/bettor toolbox — not casual-fan stats exploration.
5. **FRCS.pro**: alive, freemium (Fan free; Crew Chief $39/yr; Owner $79/yr), Accupredict projections, exports. Not modernized. Footer credits "NASCAR Statistics provided courtesy of NASCAR Digital Media, LLC" — implies tolerated/permitted data use.
6. **Racing-Reference**: unchanged product; now behind aggressive Cloudflare bot-blocking (fully hard-blocked to programmatic access). Irrelevant to users, relevant if we ever hoped to scrape pre-2016 loop data from it — effectively not an option.
7. **NASCAR Insights** (official, w/ Racing Insights): still a weekly *editorial* franchise on nascar.com (Passer Rating, pace/restart metrics, projection articles). **No standalone analytics product, no self-serve stats explorer, no public API announced.** Official data remains licensed via Sportradar/SportsDataIO.

## Data-access risk (re-checked)

- **CDN verified fully open today** (multiple 200s, no auth, including today's live Chicagoland feed at `cacher/live/feeds/series_1/{race_id}/live_feed.json`). No developer ToS covering these endpoints exists; NASCAR's NDM network terms are generic site terms.
- **No takedowns found 2025–2026.** Only documented enforcement precedent remains nascarnomics.com (~2013–14). A swagger spec of the unofficial API circulated publicly in Feb 2025 with no reported response.
- **rNascar23.Sdk is effectively dead** (last push July 2023) — useful as endpoint documentation only; don't depend on it.
- **nascaR.data is healthy** (last push 2026-07-01, automated Monday updates in-season, sources from DriverAverages *with permission*, offers CSV/Parquet) — a low-risk supplementary path for historical results.
- Verdict: risk posture unchanged. Raw-JSON archival at ingestion remains the right insurance.

## Positioning implications for the MVP

The open lane, confirmed as of July 2026: **loop-data-first analytics with modern UX** — interactive loop-data exploration, head-to-head comparisons built on loop metrics, track-type splits, and proprietary computed metrics. Nobody occupies it:

| Player | Modern UX | Loop data | Comparisons | Track-type analytics | Free |
|--------|-----------|-----------|-------------|---------------------|------|
| NASCAR Mobile v16 | ✅ | ❌ | ❌ | ❌ (per-track history only) | Partial ($4.99/mo premium) |
| nascar-reference.com | ✅ | ❌ | ✅ (results-based) | ❌ | ✅ |
| Lap Raptor | ❌ (functional, dated) | ✅ deep | Partial | ✅ filters | ✅ |
| Win The Race | ❌ | ✅ | ❌ | ✅ tool | ❌ ($50/mo) |
| FRCS.pro | ❌ (2008-era) | ✅ | ❌ | Partial | Partial ($39–79/yr) |

Two cautions: (a) the free-tier bar is higher than in March (Lap Raptor + nascar-reference are both free and good at their respective things); (b) the official app will keep absorbing casual-fan features, so differentiation must come from analytical depth + comparison/exploration UX, not from "driver pages exist."
