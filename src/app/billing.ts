// Billing routes (WS-E, outbound half): send a buyer to Stripe Checkout or the
// Customer Portal, and render /pricing with whatever can actually be bought.
//
// These routes deliberately write NOTHING. The webhook state machine
// (billingService.applyStripeEvent) is the only entitlement writer, so the
// worst a bug here can do is fail to start a purchase — never grant Pro that
// was not paid for, and never miss one that was. The post-checkout landing
// says "activating" rather than "you're Pro" for the same reason: the webhook
// may not have arrived yet.
import type { Providers } from "../providers/index.ts";
import { accountsService } from "../domains/accounts/index.ts";
import { billingService, billingConfig } from "../domains/billing/index.ts";
import { page, htmlResponse } from "./layout.ts";
import { currentSeason } from "./render.ts";
import { logLine } from "./http.ts";
import { csrfOk, ensureCsrf, type Viewer } from "./viewer.ts";
import { pricingContent, pricingNotice, type PlanOffer } from "./pages/pricing.ts";
import { card } from "./html.ts";

type P = Pick<Providers, "db" | "stripe">;

/** Bun's FormData, not undici's — same alias auth.ts uses. */
type Form = Awaited<ReturnType<Request["formData"]>>;

export interface BillingDeps {
  /** Absolute origin for Stripe's success/cancel/return URLs. */
  baseUrl: () => string;
  /** Stripe Price ids from the environment; null means "not sellable yet". */
  priceMonthly: string | null;
  priceSeason: string | null;
  /** Secure cookie flag — matches the auth module's posture. */
  production: boolean;
  now?: () => Date;
}

const CUP = 1;

/** Money endpoints get the same treatment as sign-in, not less. Generous
 *  enough that a user retrying a failed card is never blocked. */
const CHECKOUT_LIMIT = { max: 15, windowMs: 15 * 60 * 1000 };

export type PlanId = "monthly" | "season";

interface PlanSpec {
  mode: "subscription" | "payment";
  priceId: string;
  trialDays: number | null;
}

/** The plan a user asked for, if it is real AND currently sellable. */
function planSpec(plan: string, deps: BillingDeps): PlanSpec | null {
  if (plan === "monthly" && deps.priceMonthly)
    return { mode: "subscription", priceId: deps.priceMonthly, trialDays: billingConfig.TRIAL_DAYS };
  if (plan === "season" && deps.priceSeason)
    return { mode: "payment", priceId: deps.priceSeason, trialDays: null };
  return null;
}

/**
 * What /pricing should render as buyable. A plan needs both a configured
 * Stripe client and its own price id — having a key but no price id is the
 * state right after the owner creates the account and before they create the
 * products (E1), and offering a button then would 500 on click.
 */
export function planOffers(stripeConfigured: boolean, deps: BillingDeps): PlanOffer {
  return {
    monthly: stripeConfigured && Boolean(deps.priceMonthly),
    season: stripeConfigured && Boolean(deps.priceSeason),
  };
}

function shell(p: P, title: string, content: string, status = 200, setCookies: string[] = []): Response {
  const res = htmlResponse(
    page({ title, active: "home", seriesId: CUP, season: currentSeason(p, CUP), content }),
    status,
  );
  for (const c of setCookies) res.headers.append("Set-Cookie", c);
  return res;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/** Off-site redirect to a Stripe-hosted page. */
function toStripe(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url } });
}

function tooMany(retryAfterSeconds: number): Response {
  return new Response("Too many attempts — try again later.", {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(retryAfterSeconds) },
  });
}

export async function handleBillingRequest(
  p: P,
  req: Request,
  url: URL,
  viewer: Viewer,
  deps: BillingDeps,
): Promise<Response | null> {
  const path = url.pathname;
  const now = deps.now?.() ?? new Date();

  if (req.method === "GET" && path === "/pricing") {
    // The page carries buy buttons, so it must install the CSRF cookie the
    // same way every other form page does.
    const csrf = ensureCsrf(req, deps.production);
    return shell(
      p,
      "Pricing",
      pricingContent({
        viewer,
        offers: planOffers(p.stripe.configured, deps),
        csrf: csrf.token,
        notice: pricingNotice(url.searchParams.get("m")),
      }),
      200,
      csrf.setCookie ? [csrf.setCookie] : [],
    );
  }

  if (req.method === "GET" && path === "/billing/return") return billingReturn(p, viewer);

  if (req.method !== "POST" || !path.startsWith("/billing/")) return null;

  const form: Form = await req.formData().catch(() => new FormData() as unknown as Form);
  const csrf = form.get("csrf");
  if (!csrfOk(req, typeof csrf === "string" && csrf !== "" ? csrf : null))
    return shell(
      p,
      "Blocked",
      card(
        "Request blocked",
        `<p class="note">This form was missing its security token. Go back, reload the page, and try again.</p>`,
      ),
      403,
    );

  if (path === "/billing/checkout") return checkout(p, form, viewer, deps, now);
  if (path === "/billing/portal") return portal(p, viewer, deps, now);
  return null;
}

/**
 * Start a purchase. Every refusal below redirects somewhere that explains
 * itself rather than rendering a dead end, because the user arrived here by
 * pressing a buy button and deserves to know why nothing happened.
 */
async function checkout(
  p: P,
  form: Form,
  viewer: Viewer,
  deps: BillingDeps,
  now: Date,
): Promise<Response> {
  const user = viewer.user;
  if (!user) return redirect("/signin?m=signin-to-upgrade");

  const gate = accountsService.rateLimit(p, `checkout:${user.userId}`, CHECKOUT_LIMIT, now);
  if (!gate.allowed) return tooMany(gate.retryAfterSeconds);

  // Spec §6: verified email before any purchase. Checked here as well as in
  // the UI, because the UI is not a security boundary.
  const allowed = billingService.canPurchase(user);
  if (!allowed.ok) return redirect("/account?m=verify-first");

  // Already Pro: sending them to Checkout would happily take a second payment.
  if (viewer.pro) return redirect("/account?m=already-pro");

  // Validate against the same offer set /pricing renders buttons from, so a
  // hand-crafted POST cannot reach Stripe for a plan the page won't sell —
  // including the "key configured but no price id yet" state (E1 pending),
  // which is "unavailable", not "failed".
  const offers = planOffers(p.stripe.configured, deps);
  const raw = form.get("plan");
  const plan = raw === "monthly" || raw === "season" ? raw : null;
  if (plan === null || !offers[plan]) return redirect("/pricing?m=plan-unavailable");
  const spec = planSpec(plan, deps)!;

  const base = deps.baseUrl();
  const profile = billingService.profileFor(p, user.userId);
  const session = await p.stripe.createCheckoutSession({
    priceId: spec.priceId,
    mode: spec.mode,
    // Stripe echoes this back on checkout.session.completed and it is the only
    // link from the payment to the account (applyCheckoutCompleted parses it
    // as a decimal user id). Wrong here = a paid user who never becomes Pro.
    clientReferenceId: String(user.userId),
    customerId: profile?.customerId ?? null,
    customerEmail: user.email,
    trialPeriodDays: spec.trialDays,
    successUrl: `${base}/billing/return`,
    cancelUrl: `${base}/pricing?m=checkout-canceled`,
  });

  if (!session.ok) {
    console.error(
      logLine("error", "stripe checkout session failed", {
        userId: user.userId,
        plan,
        detail: session.detail,
      }),
    );
    return redirect("/pricing?m=checkout-failed");
  }
  return toStripe(session.url);
}

/** Card updates, cancellation and invoices all live in Stripe's portal. */
async function portal(p: P, viewer: Viewer, deps: BillingDeps, now: Date): Promise<Response> {
  const user = viewer.user;
  if (!user) return redirect("/signin");

  const gate = accountsService.rateLimit(p, `portal:${user.userId}`, CHECKOUT_LIMIT, now);
  if (!gate.allowed) return tooMany(gate.retryAfterSeconds);

  const profile = billingService.profileFor(p, user.userId);
  // No Stripe customer means they have never checked out on the web — an IAP
  // subscriber included, whose subscription the store owns and Stripe cannot
  // show (WS-J).
  if (!profile?.customerId) return redirect("/account?m=no-billing-account");

  const session = await p.stripe.createPortalSession({
    customerId: profile.customerId,
    returnUrl: `${deps.baseUrl()}/account`,
  });
  if (!session.ok) {
    console.error(
      logLine("error", "stripe portal session failed", {
        userId: user.userId,
        detail: session.detail,
      }),
    );
    return redirect("/account?m=portal-failed");
  }
  return toStripe(session.url);
}

/**
 * Where Stripe sends the buyer back. Entitlement arrives by webhook, which may
 * land before or after this page renders — so it reports what is actually
 * known instead of congratulating someone whose payment has not been
 * confirmed yet.
 */
function billingReturn(p: P, viewer: Viewer): Response {
  const body = viewer.pro
    ? `<p class="note form-notice" role="status">✓ You're Pro — everything is unlocked.</p>
<p class="note"><a href="/predictions">See this week's predictions</a> or <a href="/account">manage your plan</a>.</p>`
    : `<p class="note" role="status">Thanks — your payment is confirmed with Stripe and we're
activating your account. This usually takes a few seconds.</p>
<p class="note">Reload this page, or <a href="/account">check your account</a>. If it hasn't
unlocked in a few minutes, contact support — your payment is safe either way.</p>`;
  return shell(p, "Thank you", card("Thank you", body));
}
