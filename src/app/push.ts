// Push subscription routes + the race-day dispatcher (WS-H).
//
// Routes are app-layer because they join three domains: accounts (who is
// signed in), billing (push is a Pro capability, spec §4), and notifications
// (the subscription itself). The dispatcher additionally reads the live
// Worker and the live domain's alert derivation.
import type { Providers } from "../providers/index.ts";
import { notificationsService } from "../domains/notifications/index.ts";
import type { CandidateAlert, PushAlertKind } from "../domains/notifications/index.ts";
import { sendPush, vapidFromEnv } from "../providers/webpush.ts";
import type { VapidKeys } from "../domains/notifications/index.ts";
import { featureEnabled, PRO_REQUIRED_BODY } from "./gate.ts";
import { csrfOk, type Viewer } from "./viewer.ts";
import { logLine } from "./http.ts";

type P = Pick<Providers, "db">;

export interface PushDeps {
  vapid: VapidKeys | null;
  now?: () => Date;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  fetchImpl?: typeof fetch;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Handles /api/push/*; returns null for other paths. Subscribing is a
 * state-changing POST from the page, so it carries the same CSRF pair as
 * every other form (the fetch sends it as a header).
 */
export async function handlePushRequest(
  p: P,
  req: Request,
  url: URL,
  viewer: Viewer,
  deps: PushDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/push/")) return null;
  const now = deps.now?.() ?? new Date();

  // The public key is safe to hand anyone — it's what the browser needs to
  // build a subscription, and it's useless without the private half.
  if (url.pathname === "/api/push/key" && req.method === "GET")
    return deps.vapid
      ? json({ publicKey: deps.vapid.publicKey })
      : json({ error: "push_not_configured" }, 503);

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!viewer.user) return json({ error: "sign_in_required" }, 401);
  if (!featureEnabled("push", viewer)) return json(PRO_REQUIRED_BODY, 403);
  if (!csrfOk(req, req.headers.get("x-csrf-token"))) return json({ error: "csrf_failed" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (url.pathname === "/api/push/unsubscribe") {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const existing = notificationsService.subscriptionByEndpoint(p, endpoint);
    // Only the owner may remove a subscription — an endpoint is guessable in
    // principle and must not be a cross-account delete primitive.
    if (!existing || existing.userId !== viewer.user.userId)
      return json({ error: "not_found" }, 404);
    notificationsService.unsubscribe(p, endpoint);
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/subscribe") {
    const input = {
      endpoint: typeof body.endpoint === "string" ? body.endpoint : "",
      p256dh: typeof body.p256dh === "string" ? body.p256dh : "",
      auth: typeof body.auth === "string" ? body.auth : "",
      followedDriverId: typeof body.followedDriverId === "number" ? body.followedDriverId : null,
      kinds: Array.isArray(body.kinds) ? (body.kinds as PushAlertKind[]) : undefined,
      quietFromHour: typeof body.quietFromHour === "number" ? body.quietFromHour : null,
      quietToHour: typeof body.quietToHour === "number" ? body.quietToHour : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
    };
    const problem = notificationsService.validateSubscription(input);
    if (problem) return json({ error: "invalid_subscription", detail: problem }, 400);
    const existing = notificationsService.subscriptionByEndpoint(p, input.endpoint);
    // Re-subscribing the same endpoint under a different account would let one
    // user redirect another's device; require the endpoint to be free or theirs.
    if (existing && existing.userId !== viewer.user.userId)
      return json({ error: "endpoint_claimed" }, 409);
    const saved = notificationsService.subscribe(p, viewer.user.userId, input, now);
    return json({ ok: true, kinds: saved.kinds, followedDriverId: saved.followedDriverId });
  }

  if (url.pathname === "/api/push/test") {
    if (!deps.vapid) return json({ error: "push_not_configured" }, 503);
    const subs = notificationsService.subscriptionsForUser(p, viewer.user.userId);
    if (subs.length === 0) return json({ error: "no_subscription" }, 404);
    const results = [];
    for (const sub of subs) {
      const result = await sendPush({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        payload: JSON.stringify({
          title: "Looplab alerts are on",
          body: "This is what a race alert looks like.",
          url: "/live",
          tag: "looplab-test",
        }),
        vapid: deps.vapid,
        now: () => now,
        fetchImpl: deps.fetchImpl,
      });
      notificationsService.recordOutcome(p, sub.endpoint, result.ok, result.gone, now);
      results.push({ ok: result.ok, status: result.status });
    }
    return json({ ok: results.some((r) => r.ok), results });
  }

  return json({ error: "not_found" }, 404);
}

export interface DispatchOutcome {
  considered: number;
  sent: number;
  skippedDuplicate: number;
  skippedFiltered: number;
  failed: number;
  pruned: number;
}

/**
 * Fan one race's alerts out to every subscribed device. Pure orchestration
 * over the domain's decisions — dedup is claimed BEFORE the send so a crash
 * mid-batch can't re-notify, and a dead endpoint is pruned rather than retried.
 */
export async function dispatchAlerts(
  p: P,
  alerts: CandidateAlert[],
  raceName: string,
  deps: PushDeps,
): Promise<DispatchOutcome> {
  const now = deps.now?.() ?? new Date();
  const outcome: DispatchOutcome = {
    considered: 0, sent: 0, skippedDuplicate: 0, skippedFiltered: 0, failed: 0, pruned: 0,
  };
  if (!deps.vapid || alerts.length === 0) return outcome;
  const subs = notificationsService.allSubscriptions(p);

  for (const alert of alerts) {
    for (const sub of subs) {
      outcome.considered++;
      if (!notificationsService.shouldSend(sub, alert, now)) {
        outcome.skippedFiltered++;
        continue;
      }
      if (!notificationsService.claimSend(p, sub.endpoint, alert, now)) {
        outcome.skippedDuplicate++;
        continue;
      }
      const message = notificationsService.messageFor(alert, raceName);
      const result = await sendPush({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        payload: JSON.stringify(message),
        vapid: deps.vapid,
        now: () => now,
        fetchImpl: deps.fetchImpl,
      });
      const pruned = notificationsService.recordOutcome(p, sub.endpoint, result.ok, result.gone, now);
      if (pruned) outcome.pruned++;
      if (result.ok) outcome.sent++;
      else {
        outcome.failed++;
        deps.log?.warn(
          logLine("error", "push delivery failed", { endpoint: sub.endpoint.slice(0, 40), detail: result.detail }),
        );
      }
    }
  }
  return outcome;
}

export { vapidFromEnv };
