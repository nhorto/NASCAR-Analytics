// Auth + account routes (WS-D): GET pages and POST actions for sign-up,
// verify, sign-in, sign-out, reset, delete, /account, /pricing. Successful
// POSTs redirect (303, PRG); failures re-render the form with the reason.
// Every POST checks the CSRF double-submit pair; sign-in/sign-up/reset are
// rate-limited per spec §6.
import type { Providers } from "../providers/index.ts";
import type { EmailClient } from "../providers/email.ts";
import { accountsService, accountsConfig } from "../domains/accounts/index.ts";
import { billingService } from "../domains/billing/index.ts";
import { page, htmlResponse } from "./layout.ts";
import { currentSeason } from "./render.ts";
import { logLine } from "./http.ts";
import { ensureCsrf, csrfOk, sessionCookie, clearSessionCookie, clientIp, type Viewer } from "./viewer.ts";
import * as authPages from "./pages/auth.ts";
import { accountContent } from "./pages/account.ts";
import { pricingContent } from "./pages/pricing.ts";
import { unsubscribeContent } from "./pages/unsubscribe.ts";
import * as emails from "./emails.ts";
import type { EmailKind } from "../domains/accounts/index.ts";

type P = Pick<Providers, "db" | "hibp" | "stripe">;

export interface AuthDeps {
  email: EmailClient;
  /** Absolute origin for links in emails (lazy — known after the port binds). */
  baseUrl: () => string;
  /** Secure cookies + strict behavior in production. */
  production: boolean;
  now?: () => Date;
}

const CUP = 1;

/** Post-redirect flash messages, keyed by ?m=. */
const NOTICES: Record<string, string> = {
  verified: "Email verified.",
  "reset-done": "Password updated — sign in with it.",
  "signed-out": "Signed out.",
  "check-email": "Account created. We sent a verification link to your email.",
  "verify-sent": "Verification email sent.",
  "prefs-saved": "Email preferences saved.",
};

function notice(url: URL): string | null {
  return NOTICES[url.searchParams.get("m") ?? ""] ?? null;
}

function shell(p: P, title: string, content: string, status = 200, setCookies: string[] = []): Response {
  const res = htmlResponse(
    page({ title, active: "home", seriesId: CUP, season: currentSeason(p, CUP), content }),
    status,
  );
  for (const c of setCookies) res.headers.append("Set-Cookie", c);
  return res;
}

function redirect(location: string, setCookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: location } });
  for (const c of setCookies) res.headers.append("Set-Cookie", c);
  return res;
}

function tooMany(retryAfterSeconds: number): Response {
  return new Response("Too many attempts — try again later.", {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(retryAfterSeconds) },
  });
}

type Form = Awaited<ReturnType<Request["formData"]>>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function sendAuthEmail(deps: AuthDeps, to: string, built: emails.BuiltEmail): Promise<void> {
  const result = await deps.email.send({ to, subject: built.subject, text: built.text });
  if (!result.ok)
    console.error(
      logLine("error", "auth email not sent", { to, subject: built.subject, detail: result.detail }),
    );
}

/** Query/form list name → the closed union, so a typo can't set a column. */
function emailKind(raw: string | null): EmailKind | null {
  return raw === "recap" || raw === "preview" ? raw : null;
}

/**
 * Handles auth-owned paths; returns null for everything else so the server
 * falls through to the site router.
 */
export async function handleAuthRequest(
  p: P,
  req: Request,
  url: URL,
  viewer: Viewer,
  deps: AuthDeps,
): Promise<Response | null> {
  const now = deps.now?.() ?? new Date();
  const path = url.pathname;

  if (req.method === "GET") return handleGet(p, req, url, viewer, deps, now);
  if (req.method === "POST" && path.startsWith("/auth/")) {
    const form: Form = await req.formData().catch(() => new FormData() as unknown as Form);
    if (!csrfOk(req, str(form.get("csrf")) || null))
      return shell(p, "Blocked", authPages.messageContent(
        "Request blocked",
        "This form was missing its security token. Go back, reload the page, and try again.",
        { href: path === "/auth/signin" ? "/signin" : "/", label: "← Back" },
      ), 403);
    return handlePost(p, url, viewer, deps, now, form, req);
  }
  return null;
}

function handleGet(
  p: P,
  req: Request,
  url: URL,
  viewer: Viewer,
  deps: AuthDeps,
  now: Date,
): Response | null {
  const path = url.pathname;
  const csrf = ensureCsrf(req, deps.production);
  const cookies = csrf.setCookie ? [csrf.setCookie] : [];

  if (path === "/signup")
    return viewer.user
      ? redirect("/account")
      : shell(p, "Sign up", authPages.signUpContent({ csrf: csrf.token, error: null, email: "" }), 200, cookies);
  if (path === "/signin")
    return viewer.user
      ? redirect("/account")
      : shell(p, "Sign in", authPages.signInContent({ csrf: csrf.token, error: null, notice: notice(url), email: "" }), 200, cookies);
  if (path === "/reset")
    return shell(p, "Reset password", authPages.resetRequestContent({ csrf: csrf.token, error: null, notice: null }), 200, cookies);
  let m = path.match(/^\/reset\/([A-Za-z0-9_-]+)$/);
  if (m)
    return shell(p, "Reset password", authPages.resetConfirmContent({ csrf: csrf.token, token: m[1]!, error: null }), 200, cookies);
  m = path.match(/^\/verify\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const result = accountsService.verifyEmail(p, m[1]!, now);
    return result.ok
      ? viewer.user
        ? redirect("/account?m=verified")
        : redirect("/signin?m=verified")
      : shell(p, "Verification failed", authPages.messageContent(
          "Verification failed", result.reason, { href: "/account", label: "← Account" }), 400);
  }
  if (path === "/account") {
    if (!viewer.user) return redirect("/signin");
    return shell(p, "Account", accountContent({
      viewer,
      csrf: csrf.token,
      error: null,
      notice: notice(url),
      prefs: accountsService.emailPrefs(p, viewer.user.userId, now),
    }), 200, cookies);
  }

  // One-tap unsubscribe from a digest footer. Acting on GET is deliberate: the
  // cost of a link-prefetching scanner is an unwanted unsubscribe (undoable
  // right on the page), while requiring a POST would cost real readers their
  // one-tap opt-out — and a hard-to-leave list earns spam complaints.
  m = path.match(/^\/unsubscribe\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const kind = emailKind(url.searchParams.get("list"));
    if (!kind)
      return shell(p, "Unsubscribe", authPages.messageContent(
        "Unknown list", "That unsubscribe link is missing which emails to stop.",
        { href: "/account", label: "← Email settings" }), 400);
    const userId = accountsService.unsubscribe(p, m[1]!, kind, now);
    if (userId === null)
      return shell(p, "Unsubscribe", authPages.messageContent(
        "Link not recognized",
        "That unsubscribe link is no longer valid — the account may have been deleted. You can manage email in your account settings.",
        { href: "/account", label: "← Email settings" }), 404);
    return shell(p, "Unsubscribed", unsubscribeContent({
      kind, token: m[1]!, csrf: csrf.token, resubscribed: false,
    }), 200, cookies);
  }
  if (path === "/pricing") return shell(p, "Pricing", pricingContent(viewer));
  return null;
}

/** Everything a POST endpoint needs, bundled once in handlePost. */
interface PostCtx {
  p: P;
  viewer: Viewer;
  deps: AuthDeps;
  now: Date;
  form: Form;
  ip: string;
  csrfToken: string;
  limit: (key: string, rule: { max: number; windowMs: number }) => { allowed: boolean; retryAfterSeconds: number };
}

async function handlePost(
  p: P,
  url: URL,
  viewer: Viewer,
  deps: AuthDeps,
  now: Date,
  form: Form,
  req: Request,
): Promise<Response | null> {
  const ctx: PostCtx = {
    p,
    viewer,
    deps,
    now,
    form,
    ip: clientIp(req),
    csrfToken: str(form.get("csrf")),
    limit: (key, rule) => accountsService.rateLimit(p, key, rule, now),
  };
  return (await handleCredentialPost(url.pathname, ctx)) ?? handleRecoveryPost(url.pathname, ctx);
}

/** Sign-up, sign-in, sign-out. */
async function handleCredentialPost(path: string, ctx: PostCtx): Promise<Response | null> {
  const { p, viewer, deps, now, form, ip, csrfToken, limit } = ctx;
  const limits = accountsConfig.RATE_LIMITS;

  if (path === "/auth/signup") {
    const gate = limit(`signup:${ip}`, limits.signupIp);
    if (!gate.allowed) return tooMany(gate.retryAfterSeconds);
    const email = str(form.get("email"));
    const result = await accountsService.signUp(p, email, str(form.get("password")), now);
    if (!result.ok)
      return shell(p, "Sign up", authPages.signUpContent({ csrf: csrfToken, error: result.reason, email }), 400);
    const token = accountsService.createVerifyToken(p, result.user.userId, now);
    await sendAuthEmail(deps, result.user.email, emails.verifyEmail(deps.baseUrl(), token));
    const session = accountsService.createSession(p, result.user.userId, now);
    return redirect("/account?m=check-email", [sessionCookie(session, deps.production)]);
  }

  if (path === "/auth/signin") {
    const email = str(form.get("email"));
    const ipGate = limit(`signin:ip:${ip}`, limits.signinIp);
    const emailGate = limit(`signin:email:${accountsService.normalizeEmail(email)}`, limits.signinEmail);
    if (!ipGate.allowed || !emailGate.allowed)
      return tooMany(Math.max(ipGate.retryAfterSeconds, emailGate.retryAfterSeconds));
    const result = await accountsService.signIn(p, email, str(form.get("password")), now);
    if (!result.ok)
      return shell(p, "Sign in", authPages.signInContent({ csrf: csrfToken, error: result.reason, notice: null, email }), 401);
    const session = accountsService.createSession(p, result.user.userId, now);
    return redirect("/account", [sessionCookie(session, deps.production)]);
  }

  if (path === "/auth/signout") {
    if (viewer.sessionToken) accountsService.signOut(p, viewer.sessionToken);
    return redirect("/signin?m=signed-out", [clearSessionCookie(deps.production)]);
  }

  if (path === "/auth/signout-all") {
    if (viewer.user) accountsService.signOutEverywhere(p, viewer.user.userId);
    return redirect("/signin?m=signed-out", [clearSessionCookie(deps.production)]);
  }

  return null;
}

/** Reset request/confirm, verification resend, deletion. */
async function handleRecoveryPost(path: string, ctx: PostCtx): Promise<Response | null> {
  const { p, viewer, deps, now, form, ip, csrfToken, limit } = ctx;
  const limits = accountsConfig.RATE_LIMITS;

  if (path === "/auth/reset-request") {
    const email = str(form.get("email"));
    const ipGate = limit(`reset:ip:${ip}`, limits.resetIp);
    const emailGate = limit(`reset:email:${accountsService.normalizeEmail(email)}`, limits.resetEmail);
    if (!ipGate.allowed || !emailGate.allowed)
      return tooMany(Math.max(ipGate.retryAfterSeconds, emailGate.retryAfterSeconds));
    const reset = accountsService.requestReset(p, email, now);
    if (reset)
      await sendAuthEmail(deps, reset.user.email, emails.resetEmail(deps.baseUrl(), reset.token));
    return shell(p, "Reset password", authPages.resetRequestContent({
      csrf: csrfToken, error: null,
      notice: "If that email has an account, a reset link is on its way.",
    }));
  }

  if (path === "/auth/reset-confirm") {
    const token = str(form.get("token"));
    const result = await accountsService.resetPassword(p, token, str(form.get("password")), now);
    if (!result.ok)
      return shell(p, "Reset password", authPages.resetConfirmContent({ csrf: csrfToken, token, error: result.reason }), 400);
    return redirect("/signin?m=reset-done", [clearSessionCookie(deps.production)]);
  }

  if (path === "/auth/resend-verify") {
    if (!viewer.user) return redirect("/signin");
    const gate = limit(`verify:${viewer.user.userId}`, limits.resetEmail);
    if (!gate.allowed) return tooMany(gate.retryAfterSeconds);
    if (!viewer.user.verifiedAt) {
      const token = accountsService.createVerifyToken(p, viewer.user.userId, now);
      await sendAuthEmail(deps, viewer.user.email, emails.verifyEmail(deps.baseUrl(), token));
    }
    return redirect("/account?m=verify-sent");
  }

  if (path === "/auth/email-prefs") {
    if (!viewer.user) return redirect("/signin");
    for (const kind of accountsConfig.EMAIL_KINDS)
      accountsService.setEmailPref(p, viewer.user.userId, kind, str(form.get(kind)) === "on", now);
    return redirect("/account?m=prefs-saved");
  }

  if (path === "/auth/resubscribe") {
    // Undo, straight from the unsubscribe landing page — no sign-in required
    // (the token is the proof, exactly as it was for the unsubscribe itself).
    const kind = emailKind(str(form.get("list")));
    const token = str(form.get("token"));
    if (!kind || accountsService.resubscribe(p, token, kind, now) === null)
      return shell(p, "Unsubscribe", authPages.messageContent(
        "Link not recognized", "That link is no longer valid.",
        { href: "/account", label: "← Email settings" }), 404);
    return shell(p, "Resubscribed", unsubscribeContent({
      kind, token, csrf: csrfToken, resubscribed: true,
    }));
  }

  if (path === "/auth/delete") {
    if (!viewer.user) return redirect("/signin");
    const deleteError = (reason: string, status: number) =>
      shell(p, "Account", accountContent({
        viewer, csrf: csrfToken, error: reason, notice: null,
        prefs: accountsService.emailPrefs(p, viewer.user!.userId, now),
      }), status);
    const password = str(form.get("password"));
    if (!(await accountsService.verifyPassword(p, viewer.user.userId, password)))
      return deleteError("Password is incorrect.", 400);
    // Spec §6: deletion cancels any live subscription. Cancel at Stripe
    // *before* deleting — refusing here beats orphaning a paying subscription
    // on an account that no longer exists.
    const subscriptionId = billingService.cancelableSubscriptionId(p, viewer.user.userId);
    if (subscriptionId) {
      const cancel = await p.stripe.cancelSubscription(subscriptionId);
      if (!cancel.ok) {
        console.error(logLine("error", "subscription cancel failed during account deletion", {
          userId: viewer.user.userId, detail: cancel.detail,
        }));
        return deleteError(
          "We could not cancel your subscription just now. Try again in a minute, or cancel it from the billing portal first.",
          502,
        );
      }
    }
    const result = await accountsService.deleteAccount(p, viewer.user.userId, password);
    if (!result.ok) return deleteError(result.reason, 400);
    // Drops every channel's grant (Stripe, RevenueCat, manual), not just the
    // one just canceled above. There is no RevenueCat-side call to make
    // first: unlike Stripe, RevenueCat cannot cancel a live App Store/Play
    // Store subscription on our command — only the subscriber can, from the
    // store itself — so dropping our own grant is the whole story for that
    // channel (WS-J).
    billingService.revoke(p, viewer.user.userId);
    return shell(p, "Account deleted", authPages.messageContent(
      "Account deleted",
      "Your account and sessions are gone. Stats and race data are unaffected.",
      { href: "/", label: "← Back home" },
    ), 200, [clearSessionCookie(deps.production)]);
  }

  return null;
}
