// /account v0 (WS-D): plan display, verification state, sign out (this
// session / everywhere), delete. Billing portal + email prefs + push toggle
// land with WS-E and the notifications work.
import { esc, card, fmtDate } from "../html.ts";
import type { Viewer } from "../viewer.ts";

function post(action: string, csrf: string, label: string, extra = "", confirm?: string): string {
  const onsubmit = confirm ? ` onsubmit="return window.confirm('${esc(confirm)}')"` : "";
  return `<form class="auth-form inline" method="post" action="${esc(action)}"${onsubmit}>
<input type="hidden" name="csrf" value="${esc(csrf)}">${extra}
<button type="submit">${esc(label)}</button></form>`;
}

export function accountContent(opts: {
  viewer: Viewer;
  csrf: string;
  error: string | null;
  notice: string | null;
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
 onsubmit="return window.confirm('Delete your account permanently?')">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label>Confirm password<input type="password" name="password" required autocomplete="current-password"></label>
<button type="submit" class="danger">Delete account</button></form>`;

  return `${flash}
${card("Plan", `<p class="note">${esc(user.email)}</p>${plan}${verify}`)}
${card("Sessions", sessions)}
${card("Danger zone", del)}`;
}
