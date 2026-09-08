// /account v0 (WS-D): plan display, verification state, sign out (this
// session / everywhere), delete. Billing portal + email prefs + push toggle
// land with WS-E and the notifications work.
import { esc, card, fmtDate } from "../html.ts";
import type { Viewer } from "../viewer.ts";
import type { EmailPrefs } from "../../domains/accounts/index.ts";

// `data-confirm` (not an inline onsubmit) so the page needs no inline script —
// boot.js runs the confirm from a delegated submit handler. See WS-I.
function post(action: string, csrf: string, label: string, extra = "", confirm?: string): string {
  const guard = confirm ? ` data-confirm="${esc(confirm)}"` : "";
  return `<form class="auth-form inline" method="post" action="${esc(action)}"${guard}>
<input type="hidden" name="csrf" value="${esc(csrf)}">${extra}
<button type="submit">${esc(label)}</button></form>`;
}

/** Checkbox row for one digest list. */
function prefRow(name: string, label: string, hint: string, on: boolean): string {
  return `<label class="pref-row"><input type="checkbox" name="${esc(name)}"${on ? " checked" : ""}>
<span><b>${esc(label)}</b><br><span class="note">${esc(hint)}</span></span></label>`;
}

function emailSection(prefs: EmailPrefs, csrf: string, pro: boolean): string {
  const suppressed = prefs.bouncedAt ?? prefs.complainedAt;
  // A silently dead address is worse than a visible one — say so plainly.
  const warning = suppressed
    ? `<p class="note form-error">⚠ We stopped sending to this address on ${fmtDate(suppressed)} because
${prefs.bouncedAt ? "it bounced" : "a message was reported as spam"}. Fix the address (or contact support) to start again.</p>`
    : "";
  return `${warning}
<form class="auth-form" method="post" action="/auth/email-prefs">
<input type="hidden" name="csrf" value="${esc(csrf)}">
${prefRow("recap", "Monday race recap", "What the numbers said about Sunday — free.", prefs.recap)}
${prefRow("preview", "Thursday race preview", pro ? "The model's board for the coming race — Pro." : "Pro only — you'll start getting it when you upgrade.", prefs.preview)}
<button type="submit">Save email preferences</button></form>`;
}

export function accountContent(opts: {
  viewer: Viewer;
  csrf: string;
  error: string | null;
  notice: string | null;
  prefs: EmailPrefs;
}): string {
  const { viewer, csrf } = opts;
  const user = viewer.user!;
  const flash = `${opts.error ? `<p class="note form-error" role="alert">⚠ ${esc(opts.error)}</p>` : ""}${
    opts.notice ? `<p class="note form-notice" role="status">✓ ${esc(opts.notice)}</p>` : ""
  }`;

  const plan = viewer.pro
    ? `<p><span class="plan-chip pro">PRO</span> until ${fmtDate(viewer.proUntil)} (${esc(viewer.proSource ?? "")})</p>`
    : `<p><span class="plan-chip">FREE</span> — <a href="/pricing">see what Pro adds</a></p>`;

  const verify = user.verifiedAt
    ? `<p class="note">Email verified ${fmtDate(user.verifiedAt)}.</p>`
    : `<p class="note form-error">Email not verified — required before upgrading.</p>
${post("/auth/resend-verify", csrf, "Resend verification email")}`;

  const sessions = `${post("/auth/signout", csrf, "Sign out")}
${post("/auth/signout-all", csrf, "Sign out everywhere")}`;

  const del = `<p class="note">Deletes your account immediately and cancels any subscription.
Site data (stats, races) is unaffected — only your account is removed.</p>
<form class="auth-form" method="post" action="/auth/delete"
 data-confirm="Delete your account permanently?">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label>Confirm password<input type="password" name="password" required autocomplete="current-password"></label>
<button type="submit" class="danger">Delete account</button></form>`;

  return `${flash}
${card("Plan", `<p class="note">${esc(user.email)}</p>${plan}${verify}`)}
${card("Email", emailSection(opts.prefs, csrf, viewer.pro))}
${card("Sessions", sessions)}
${card("Danger zone", del)}`;
}
