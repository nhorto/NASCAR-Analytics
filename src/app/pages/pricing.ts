// /pricing (WS-D shape, WS-E checkout): the tier comparison of spec §4, with
// buy buttons for whichever plans are actually sellable right now.
import { esc, card } from "../html.ts";
import type { Viewer } from "../viewer.ts";

/** Which plans the server can currently start a checkout for. */
export interface PlanOffer {
  monthly: boolean;
  season: boolean;
}

const ROWS: Array<[string, string, string]> = [
  ["Cup Series — profiles, races, compare, tracks, metrics, recap", "✓", "✓"],
  ["Live board for Cup races", "✓", "✓"],
  ["Cross-series career pages", "✓", "✓"],
  ["Xfinity + Trucks — everything above, all three series", "—", "✓"],
  ["Race predictions (win / top-5 / top-10)", "—", "✓"],
  ["DFS projections + printable cheat sheet", "—", "✓"],
  ["CSV export, full history filters, compare up to 4", "—", "✓"],
  ["Push alerts for your driver", "—", "✓"],
  ["Thursday preview email", "—", "✓"],
];

/** Post-redirect flash messages this page explains. */
const NOTICES: Record<string, string> = {
  "checkout-canceled": "Checkout canceled — you haven't been charged.",
  "checkout-failed": "We couldn't reach our payment provider just now. Please try again.",
  "plan-unavailable": "That plan isn't available right now.",
};

export function pricingNotice(m: string | null): string | null {
  return m === null ? null : (NOTICES[m] ?? null);
}

function buyButton(csrf: string, plan: string, label: string, sub: string): string {
  return `<form class="auth-form inline" method="post" action="/billing/checkout">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<input type="hidden" name="plan" value="${esc(plan)}">
<button type="submit">${esc(label)}</button>
<span class="note">${esc(sub)}</span></form>`;
}

/**
 * The Go Pro card. Four states, and the distinction that matters is the last
 * one: with no Stripe key or no price id there is deliberately no button at
 * all, because a button that 500s is worse than an honest "not yet".
 */
function goPro(viewer: Viewer, offers: PlanOffer, csrf: string): string {
  if (viewer.pro) return `<p class="note form-notice">You're Pro — thanks for the support.</p>`;

  if (!viewer.user)
    return `<p class="note"><a href="/signup">Create a free account</a> to get started —
Pro is <b>$9.99/month</b> (7-day free trial) or <b>$69/season</b>.</p>`;

  if (!offers.monthly && !offers.season)
    return `<p class="note">Checkout opens soon — Pro is <b>$9.99/month</b> (7-day free trial)
or <b>$69/season</b>.</p>`;

  const unverified = viewer.user.verifiedAt === null;
  if (unverified)
    return `<p class="note form-error">Verify your email address before upgrading —
<a href="/account">resend the link</a>.</p>`;

  return [
    offers.monthly
      ? buyButton(csrf, "monthly", "Start 7-day free trial", "$9.99/month after the trial. Cancel anytime.")
      : "",
    offers.season ? buyButton(csrf, "season", "Buy a season pass", "$69 — no subscription.") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function pricingContent(opts: {
  viewer: Viewer;
  offers: PlanOffer;
  csrf: string;
  notice: string | null;
}): string {
  const { viewer, offers } = opts;
  const flash = opts.notice
    ? `<p class="note form-error" role="alert">⚠ ${esc(opts.notice)}</p>`
    : "";
  const table = `<table class="pricing-table"><thead>
<tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>
${ROWS.map(([f, free, pro]) => `<tr><td>${f}</td><td class="num">${free}</td><td class="num">${pro}</td></tr>`).join("\n")}
</tbody></table>`;

  return `${flash}${card("Free vs Pro", table)}
${card("Go Pro", `${goPro(viewer, offers, opts.csrf)}<p class="note">Season passes bought in 2026 cover the 2027 season — the rest of 2026 is included free.</p>`)}`;
}
