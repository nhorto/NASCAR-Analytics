# NASCAR Betting Odds Sources (2026-07-05)

Research triggered by the finding that **The Odds API does not cover NASCAR** (confirmed against their own sports list — the March 2026 research and original ARCHITECTURE.md assumed it did). Question: is there a viable odds source for a hobby-budget project (< ~$100/mo, hard cap ~$500/mo)?

**Bottom line: there is no verified, self-serve, cheap NASCAR odds API today.** Every confirmed-coverage source is enterprise contact-sales; every cheap self-serve source either lacks NASCAR or has unverified coverage. Betting/odds stays DEFERRED for the MVP.

## Summary table

| Provider | NASCAR coverage | Pricing | Access | Hobby viability |
|---|---|---|---|---|
| The Odds API | ❌ Confirmed absent | Free–$249/mo | Self-serve | N/A |
| SportsDataIO (main) | ✅ Odds, props, in-play (DK/FD/BetMGM/Caesars+) | Unpublished, ~$500+/mo signals | Contact-sales | No |
| **SportsDataIO Discovery Lab** | ✅ NASCAR "Odds" package exists | Free (last season only); ~$99–149/mo paid | **Self-serve** | **Closest fit — see caveats** |
| OpticOdds (ex-OddsJam B2B) | ✅ Motorsports listed | Enterprise, gated | Contact-sales | No |
| OddsBlaze | ❓ Unverified, likely no | $29–249/mo, free trial | Self-serve | Cheap to test, doubtful |
| SportsGameOdds | ❌ Marketing page claims it; league docs list zero racing | $0–299/mo | Self-serve | N/A — SEO bait |
| Sportradar | Stats yes (official partner); odds products separate/enterprise | Enterprise; free trial keys | Contact-sales | No (but stats trial useful) |
| OddsMatrix (EveryMatrix) | ✅ 350+ NASCAR markets | B2B, sportsbook operators | Contact-sales | No |
| OddsPapi (new 2025) | ❓ "Motorsports" listed, NASCAR unverified; Euro-books skew | **Free tier 250 req/mo** | Self-serve | Free to test |
| Unofficial DK/FD endpoints | ✅ (books price NASCAR) | Free | Scraping | **No** — ToS violation, unstable, legal risk republishing odds |

## The one real lead: SportsDataIO Discovery Lab

Self-serve hobbyist offshoot (discoverylab.sportsdata.io) "for students, hobbyists, and early-stage ideas" with NASCAR Fantasy, Odds, and Fantasy+Odds packages. Free tier = last season's data (zero-cost schema evaluation). Two unresolved caveats requiring a direct ask to SportsDataIO before building on it:
1. The product is literally branded "personal-use APIs" — does a public fan-facing website qualify?
2. Is the odds feed real-time or next-day delayed? (Next-day is fine for closing-line/historical context, useless for live odds display.)

## Recommended path (adopted)

1. **MVP ships without republished sportsbook odds** (already the exec-plan decision).
2. When betting context becomes a priority, the differentiated move is **displaying our own model-generated win probabilities** — ours to publish freely, no odds license needed, and more proprietary than mirroring DraftKings lines. Odds APIs then become a nice-to-have for market-vs-model comparison, not a dependency.
3. Cheap empirical checks available anytime (~30 min each): Discovery Lab free tier, OddsPapi free tier (250 req/mo), OddsBlaze trial.

## Process lesson

Provider marketing pages routinely claim sports their APIs don't serve (SportsGameOdds publishes a "Motorsport Betting Odds API" page while its league docs list zero racing leagues). **Verify any odds provider against its actual league-list endpoint or docs before committing a plan to it.**
