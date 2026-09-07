// Unsubscribe landing (WS-G). The link already took effect by the time this
// renders — the page confirms what stopped and offers a one-click undo, which
// is what makes acting on a GET safe for link-prefetching mail scanners.
import { esc, card } from "../html.ts";
import type { EmailKind } from "../../domains/accounts/index.ts";

const LIST_NAMES: Record<EmailKind, string> = {
  recap: "Monday race recap",
  preview: "Thursday race preview",
};

export function unsubscribeContent(opts: {
  kind: EmailKind;
  token: string;
  csrf: string;
  resubscribed: boolean;
}): string {
  const name = LIST_NAMES[opts.kind];
  if (opts.resubscribed)
    return card(
      "You're back on the list",
      `<p class="note">The <b>${esc(name)}</b> email is on again. You can change it any time in <a href="/account">your account</a>.</p>`,
    );
  return card(
    "Unsubscribed",
    `<p class="note">You'll no longer get the <b>${esc(name)}</b> email. Nothing else about your account changed.</p>
<form class="auth-form inline" method="post" action="/auth/resubscribe">
<input type="hidden" name="csrf" value="${esc(opts.csrf)}">
<input type="hidden" name="token" value="${esc(opts.token)}">
<input type="hidden" name="list" value="${esc(opts.kind)}">
<button type="submit">Undo — resubscribe me</button></form>
<p class="note">Manage every email in <a href="/account">your account settings</a>.</p>`,
  );
}
