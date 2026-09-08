// The marketing landing page — served at the site root for anonymous visitors
// (signed-in viewers get the app home; /welcome stays as an alias). A
// standalone document, not the app shell: no tab bar or series switcher, its
// own responsive layout, but the same style.css tokens so it reads as the same
// product. Copy strategy (see the exec plan): hook = the free live race-day
// companion, moat = the proprietary metrics, reason-to-pay =
// predictions/DFS/deep tools; CTAs drive /signup and /pricing. Sections show
// the REAL product — screenshots captured from the running app (static/shots/)
// — because a landing page that looks like every other NASCAR app's marketing
// is the opposite of the pitch. Holds the CSP bar: boot.js only (worker
// registration), no inline scripts or handlers.
import { esc, ASSET_VERSION } from "../html.ts";
import { analyticsTag } from "../layout.ts";

/**
 * The working name, rendered as SVG curved text over the UNLETTERED tire
 * master (brand exploration V3), so the real name — still undecided — is a
 * one-constant change with no regenerated artwork.
 */
export const BRAND_NAME = "Looplab";
export const BRAND_TAGLINE = "Racing Analytics";

/**
 * Product screenshots the page embeds, captured from the running app against
 * the real database (see the exec plan for the recapture recipe). server.ts
 * serves them and export.ts ships them; both key off this list.
 */
export const LANDING_SHOTS = ["predictions.png", "metrics.png", "driver.png", "recap.png"] as const;

const wordmark = (name: string): string =>
  esc(name).replace(/^(.{4})(.*)$/, "$1<em>$2</em>");

/** The hero logo: curved lettering composed over the blank sidewall. */
function tireLogo(): string {
  return `<svg class="landing-tire" viewBox="0 0 900 900" role="img" aria-label="${esc(BRAND_NAME)} — ${esc(BRAND_TAGLINE)}">
  <image href="/brand/tire-master.jpg?v=${ASSET_VERSION}" width="900" height="900"/>
  <defs>
    <path id="tire-arc-top" d="M 170,450 A 280,280 0 0 1 730,450"/>
    <path id="tire-arc-bottom" d="M 110,450 A 340,340 0 0 0 790,450"/>
  </defs>
  <text class="landing-tire-name"><textPath href="#tire-arc-top" startOffset="50%">${esc(BRAND_NAME.toUpperCase())}</textPath></text>
  <text class="landing-tire-tag"><textPath href="#tire-arc-bottom" startOffset="50%">${esc(BRAND_TAGLINE.toUpperCase())}</textPath></text>
</svg>`;
}

/** A framed real-product screenshot. */
function shot(file: (typeof LANDING_SHOTS)[number], alt: string, caption: string): string {
  return `<figure class="landing-phone">
  <img src="/shots/${file}?v=${ASSET_VERSION}" alt="${esc(alt)}" loading="lazy" width="500">
  <figcaption class="mut">${esc(caption)}</figcaption>
</figure>`;
}

/**
 * The live-board mock: what the second screen shows that the broadcast (and
 * the other apps) don't — live proprietary metrics, the pit-cycle model, tire
 * severity, My Driver alerts. Built from the app's own design idioms.
 */
function liveBoardMock(): string {
  const row = (
    pos: number, num: string, name: string, gap: string, eff: string, effCls: string, stars: string,
  ) =>
    `<tr><td class="num">${pos}</td><td><span class="landing-carno num">${num}</span>${name}</td><td class="num">${gap}</td><td class="num ${effCls}">${eff}</td><td class="landing-stars">${stars}</td></tr>`;
  return `<div class="card landing-board" aria-hidden="true">
  <div class="landing-board-h"><span class="landing-live-pill"><i></i>LIVE</span><span class="mut num">Lap 267 / 312 · Green</span></div>
  <table class="landing-board-t">
    <thead><tr><th>P</th><th>Driver</th><th>Gap</th><th>Pass eff</th><th>Loop ★</th></tr></thead>
    <tbody>
      ${row(1, "5", "Larson", "Leader", "+2.4", "pos", "★★★★★")}
      ${row(2, "12", "Blaney", "+0.42", "+1.1", "pos", "★★★★")}
      ${row(3, "24", "Byron", "+1.18", "−0.3", "neg", "★★★★")}
      ${row(4, "11", "Hamlin", "+2.05", "+0.8", "pos", "★★★")}
    </tbody>
  </table>
  <div class="landing-strategy num">
    <span>PIT WINDOW <b>L272–279</b></span>
    <span>TIRE SEVERITY <b class="neg">HIGH</b></span>
    <span>TYPICAL GREEN RUN <b>52 LAPS</b></span>
  </div>
  <div class="landing-toast"><span class="landing-toast-tag">MY DRIVER</span> #11 Hamlin pitted — 4 tires · L268</div>
</div>`;
}

export function welcomePage(): string {
  const title = `${BRAND_NAME} — NASCAR analytics & live race-day companion`;
  const description =
    "A free live race-day companion, loop-data analytics the timing screen doesn't show, and honestly backtested predictions — every NASCAR Cup, Xfinity, and Trucks weekend.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="/brand/tire-master.jpg">
<link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a0c10">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<script src="/boot.js?v=${ASSET_VERSION}"></script>${analyticsTag()}
</head>
<body class="landing">

<header class="landing-top">
  <span class="wordmark">${wordmark(BRAND_NAME)}</span>
  <nav class="landing-top-nav">
    <a href="/pricing">Pricing</a>
    <a href="/signin">Sign in</a>
    <a class="landing-btn landing-btn-solid" href="/signup">Start free</a>
  </nav>
</header>

<main>

<!-- ============ Hero: the race-day hook ============ -->
<section class="landing-hero">
  <div class="landing-hero-copy">
    <p class="landing-eyebrow">A modern analytics platform for NASCAR fans</p>
    <h1>Race day,<br>upgraded.</h1>
    <p class="landing-lede">A free live race-day companion, loop-data analytics the timing screen doesn't show, and honestly backtested predictions — every Cup, Xfinity, and Trucks weekend.</p>
    <div class="landing-cta-row">
      <a class="landing-btn landing-btn-solid" href="/signup">Start free</a>
      <a class="landing-btn landing-btn-ghost" href="/pricing">See what Pro gets</a>
    </div>
    <p class="landing-cta-note mut">No account needed to look around — <a href="/home">explore the app</a>.</p>
  </div>
  <div class="landing-hero-art">${tireLogo()}</div>
</section>

<div class="landing-facts num" role="list">
  <span role="listitem"><b>3</b> national series</span>
  <span role="listitem">Results back to <b>2017</b></span>
  <span role="listitem">Loop data since <b>2019</b></span>
  <span role="listitem">Lap-by-lap since <b>2020</b></span>
</div>

<!-- ============ Live: free, differentiated ============ -->
<section class="landing-section">
  <div class="landing-split">
    <div>
      <p class="landing-eyebrow">Live · free every Cup race</p>
      <h2>Your spotter for the couch.</h2>
      <p>Every app can show you a running order. The live board runs the parts nobody else does: <b>live proprietary metrics</b> — pass efficiency and a Closer read computed against the field while the race runs — a <b>pit-cycle model</b> that says whose window opens when, and a <b>tire-severity read</b> calibrated per track from years of real pit stops (60% better than a flat guess on held-out races).</p>
      <ul class="landing-list">
        <li><b>Pit cycles, decoded.</b> Who's pitted, who's stayed out, and when the next stops should come — per-track, not a guess.</li>
        <li><b>Strategy that's honest.</b> Typical green-flag run and tire severity for tonight's track. A behavioral read, not a fake fuel gauge.</li>
        <li><b>My Driver.</b> Pin your driver — pit stops, big moves, cautions, stage ends, in one feed.</li>
        <li><b>Free.</b> The live board is part of the free tier. Period.</li>
      </ul>
    </div>
    ${liveBoardMock()}
  </div>
</section>

<!-- ============ The analytics moat ============ -->
<section class="landing-section">
  <p class="landing-eyebrow">The analytics</p>
  <h2>Beyond the box score.</h2>
  <p>NASCAR's loop data counts every green-flag pass, every quality lap, every closing surge — and the tools fans had for reading it were built in 2008. We started over, around two metrics you won't find on any timing screen. Both are <b>residuals</b> — a driver measured against the average car running in the same part of the field — so a mid-pack overachiever isn't buried under the leaders' raw numbers.</p>
  <div class="landing-shot-row">
    ${shot("driver.png", "Kyle Larson driver profile: form trend, track-type splits, and loop-metric percentiles", "A real driver profile — form, track-type splits, loop-metric ranks.")}
    ${shot("metrics.png", "Adjusted Pass Efficiency season leaderboard", "The season Adjusted Pass Efficiency board — ranked over loop-data regulars.")}
  </div>
  <div class="landing-metric-grid">
    <div class="card landing-metric">
      <h3>Adjusted Pass Efficiency</h3>
      <p>Green-flag passes won vs. the average car running where they run. Positive = a genuine passer.</p>
    </div>
    <div class="card landing-metric">
      <h3>Closer Score</h3>
      <p>Track position gained over the closing laps vs. expectation. Positive = strong when it counts.</p>
    </div>
  </div>
</section>

<!-- ============ Race weekends, decoded ============ -->
<section class="landing-section">
  <div class="landing-split landing-split-rev">
    ${shot("recap.png", "Cook Out Southern 500 recap: race stats, winner card, and What the Loop Data Saw", "A real weekly recap — auto-built the moment the results land.")}
    <div>
      <p class="landing-eyebrow">Every race · decoded</p>
      <h2>The story under the finish order.</h2>
      <p>After every race, a recap the broadcast can't give you: <b>What the Loop Data Saw</b> — who actually won more passing battles than their track position deserved, who closed hardest — next to a real <b>playoff picture</b> with the cut line, win-and-in tracking, and round-by-round eliminations, and form callouts for who over- and under-ran their trailing form.</p>
      <ul class="landing-list">
        <li><b>Compare anything.</b> Head-to-head — and for Pro, up to four drivers across series and season ranges.</li>
        <li><b>Track-type splits.</b> Superspeedway vs. short track vs. road course, for every driver, back to 2017.</li>
        <li><b>Cross-series careers.</b> A driver's whole Cup + Xfinity + Trucks record on one page.</li>
      </ul>
    </div>
  </div>
</section>

<!-- ============ Pro: the reason to pay ============ -->
<section class="landing-section">
  <div class="landing-split">
    <div>
      <p class="landing-eyebrow">Pro · predictions &amp; DFS</p>
      <h2>An honest edge.</h2>
      <p>Predictions built the boring, credible way: strictly point-in-time features, a Monte Carlo race simulation, and a <a href="/predictions/methodology">public methodology page</a>. The model ships only because it beat the naive baselines on a held-out season — and after every race we show what it said next to what actually happened.</p>
      <ul class="landing-list">
        <li><b>Win / top-5 / top-10 probabilities</b> for every driver, out Thursday, refreshed after qualifying.</li>
        <li><b>DFS projections</b> for DraftKings and FanDuel, with a printable cheat sheet.</li>
        <li><b>Deep tools.</b> Full-history filters, CSV export of any table.</li>
        <li><b>Push alerts for your driver</b> — pitted, big mover, caution, stage end, race start.</li>
        <li><b>All three series unlocked</b>, plus the Thursday preview email.</li>
      </ul>
      <p class="landing-fine mut">Predictions are statistical estimates for entertainment and fantasy-sports use. Not gambling advice.</p>
    </div>
    ${shot("predictions.png", "Race predictions board: win, top-5, top-10 probabilities with the free top three shown", "A real prediction card — the top three are free, every driver with Pro.")}
  </div>
</section>

<!-- ============ Pricing ============ -->
<section class="landing-section" id="pricing">
  <p class="landing-eyebrow">Pricing</p>
  <h2>Free to watch. Pro to play.</h2>
  <div class="landing-plans">
    <div class="card landing-plan">
      <h3>Free</h3>
      <p class="landing-price num">$0</p>
      <ul class="landing-list">
        <li>Everything analytical about the Cup Series — profiles, races, compare, tracks, metrics, recaps</li>
        <li>The live board, every Cup race</li>
        <li>Cross-series career pages</li>
        <li>Monday recap email (opt-in)</li>
      </ul>
      <a class="landing-btn landing-btn-ghost" href="/signup">Start free</a>
    </div>
    <div class="card landing-plan landing-plan-pro">
      <p class="landing-plan-flag">7-day free trial</p>
      <h3>Pro</h3>
      <p class="landing-price num">$9.99<span>/month</span> <em>or</em> $69<span>/season</span></p>
      <ul class="landing-list">
        <li>Everything in Free, all three national series</li>
        <li>Race predictions + DFS projections &amp; cheat sheet</li>
        <li>Deep tools: 4-driver compare, full history, CSV export</li>
        <li>Push alerts for your driver + Thursday preview email</li>
      </ul>
      <a class="landing-btn landing-btn-solid" href="/pricing">Go Pro</a>
      <p class="landing-fine mut">Season passes bought in 2026 cover the 2027 season — the rest of 2026 is included free.</p>
    </div>
  </div>
</section>

<!-- ============ The app ============ -->
<section class="landing-section">
  <p class="landing-eyebrow">Take it with you</p>
  <h2>One account. Every screen.</h2>
  <p>Native iOS and Android apps are on the way — the same live board, predictions, and alerts, built for your pocket. Until then, the site installs as an app today (Add to Home Screen), and your account carries across all of it.</p>
  <div class="landing-stores">
    <span class="landing-store">App Store <b>coming soon</b></span>
    <span class="landing-store">Google Play <b>coming soon</b></span>
  </div>
</section>

</main>

<footer class="landing-footer">
  <span class="wordmark">${wordmark(BRAND_NAME)}</span>
  <nav class="landing-footer-nav">
    <a href="/pricing">Pricing</a>
    <a href="/signup">Sign up</a>
    <a href="/signin">Sign in</a>
    <a href="/home">Explore the app</a>
    <a href="/predictions/methodology">Methodology</a>
    <a href="/live">Live</a>
  </nav>
  <p class="landing-fine mut">Not affiliated with or endorsed by NASCAR. NASCAR® is a registered trademark of the National Association for Stock Car Auto Racing, LLC, used only to describe the races we cover. Predictions are statistical estimates for entertainment and fantasy-sports use — not gambling advice.</p>
</footer>

</body>
</html>`;
}
