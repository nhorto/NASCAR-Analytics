// /pricing v0 (WS-D): the tier comparison of spec §4 with sign-up CTAs.
// WS-E replaces the CTA buttons with Stripe Checkout (trial + season pass).
import { card } from "../html.ts";
import type { Viewer } from "../viewer.ts";

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

export function pricingContent(viewer: Viewer): string {
  const table = `<table class="pricing-table"><thead>
<tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>
${ROWS.map(([f, free, pro]) => `<tr><td>${f}</td><td class="num">${free}</td><td class="num">${pro}</td></tr>`).join("\n")}
</tbody></table>`;

  const cta = viewer.pro
    ? `<p class="note form-notice">You're Pro — thanks for the support.</p>`
    : viewer.user
      ? `<p class="note">Checkout opens soon — Pro is <b>$9.99/month</b> (7-day free trial) or <b>$69/season</b>.</p>`
      : `<p class="note"><a href="/signup">Create a free account</a> to get started —
Pro is <b>$9.99/month</b> (7-day free trial) or <b>$69/season</b>.</p>`;

  return `${card("Free vs Pro", table)}
${card("Go Pro", `${cta}<p class="note">Season passes bought in 2026 cover the 2027 season — the rest of 2026 is included free.</p>`)}`;
}
