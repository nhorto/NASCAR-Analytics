// Sign-up / sign-in / reset form contents (WS-D). Every POST form embeds the
// CSRF double-submit token; src/app/auth.ts owns the routes and wraps these in
// the standard page shell.
import { esc, card } from "../html.ts";

function hidden(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
}

function errorNote(error: string | null): string {
  return error ? `<p class="note form-error" role="alert">⚠ ${esc(error)}</p>` : "";
}

function noticeNote(notice: string | null): string {
  return notice ? `<p class="note form-notice" role="status">✓ ${esc(notice)}</p>` : "";
}

export function signUpContent(opts: { csrf: string; error: string | null; email: string }): string {
  const body = `${errorNote(opts.error)}
<form class="auth-form" method="post" action="/auth/signup">${hidden(opts.csrf)}
  <label>Email<input type="email" name="email" required autocomplete="email" value="${esc(opts.email)}"></label>
  <label>Password<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
  <p class="note">At least 10 characters. We check it against common breached passwords.</p>
  <button type="submit">Create account</button>
</form>
<p class="note">Already have an account? <a href="/signin">Sign in</a>.</p>`;
  return card("Create your account", body);
}

export function signInContent(opts: {
  csrf: string;
  error: string | null;
  notice: string | null;
  email: string;
}): string {
  const body = `${errorNote(opts.error)}${noticeNote(opts.notice)}
<form class="auth-form" method="post" action="/auth/signin">${hidden(opts.csrf)}
  <label>Email<input type="email" name="email" required autocomplete="email" value="${esc(opts.email)}"></label>
  <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
<p class="note"><a href="/reset">Forgot your password?</a> · <a href="/signup">Create an account</a></p>`;
  return card("Sign in", body);
}

export function resetRequestContent(opts: {
  csrf: string;
  error: string | null;
  notice: string | null;
}): string {
  const body = `${errorNote(opts.error)}${noticeNote(opts.notice)}
<form class="auth-form" method="post" action="/auth/reset-request">${hidden(opts.csrf)}
  <label>Email<input type="email" name="email" required autocomplete="email"></label>
  <button type="submit">Send reset link</button>
</form>
<p class="note">The link expires in 30 minutes and works once.</p>`;
  return card("Reset your password", body);
}

export function resetConfirmContent(opts: { csrf: string; token: string; error: string | null }): string {
  const body = `${errorNote(opts.error)}
<form class="auth-form" method="post" action="/auth/reset-confirm">${hidden(opts.csrf)}
  <input type="hidden" name="token" value="${esc(opts.token)}">
  <label>New password<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
  <button type="submit">Set new password</button>
</form>
<p class="note">Setting a new password signs you out everywhere.</p>`;
  return card("Choose a new password", body);
}

/** Generic landing (verify result, deleted-account goodbye, …). */
export function messageContent(title: string, body: string, cta: { href: string; label: string }): string {
  return card(
    title,
    `<p class="note">${esc(body)}</p>
<p class="note" style="margin-top:8px"><a href="${esc(cta.href)}">${esc(cta.label)}</a></p>`,
  );
}
