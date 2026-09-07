// Inbound provider webhooks (WS-G). Today that means Resend delivery events:
// a hard bounce or a spam complaint suppresses that address so we stop mailing
// it — sending into a dead address or an angry inbox is how a young sending
// domain loses its reputation.
//
// The signature check is mandatory: this endpoint mutates deliverability state
// from an unauthenticated origin, so an unsigned or stale request is refused
// before the body is parsed as anything meaningful.
import type { Providers } from "../providers/index.ts";
import { accountsService } from "../domains/accounts/index.ts";
import { verifyWebhookSignature } from "../providers/email.ts";
import { logLine } from "./http.ts";

type P = Pick<Providers, "db">;

export const RESEND_WEBHOOK_PATH = "/webhooks/resend";

export interface WebhookDeps {
  /** RESEND_WEBHOOK_SECRET; null disables the endpoint (503 rather than 200). */
  secret: string | null;
  now?: () => Date;
  log?: { info: (m: string) => void; warn: (m: string) => void };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Pull the recipient out of a Resend event payload (`to` may be array or string). */
export function recipientOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const to = (data as { to?: unknown }).to;
  if (Array.isArray(to) && typeof to[0] === "string") return to[0];
  if (typeof to === "string") return to;
  const email = (data as { email?: unknown }).email;
  return typeof email === "string" ? email : null;
}

/** Which suppression (if any) an event type implies. */
export function suppressionFor(type: string): "bounced" | "complained" | null {
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "complained";
  return null;
}

/**
 * Handles the provider webhook; returns null for every other path so the
 * server falls through to its router.
 */
export async function handleWebhookRequest(
  p: P,
  req: Request,
  url: URL,
  deps: WebhookDeps,
): Promise<Response | null> {
  if (url.pathname !== RESEND_WEBHOOK_PATH) return null;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const now = deps.now?.() ?? new Date();

  if (!deps.secret) {
    deps.log?.warn(logLine("error", "webhook received but RESEND_WEBHOOK_SECRET is unset", {}));
    return json({ error: "webhook_not_configured" }, 503);
  }

  const body = await req.text();
  const verdict = verifyWebhookSignature({
    secret: deps.secret,
    headers: {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    body,
    nowSeconds: Math.floor(now.getTime() / 1000),
  });
  if (!verdict.ok) {
    deps.log?.warn(logLine("error", "webhook signature rejected", { reason: verdict.reason }));
    return json({ error: "invalid_signature" }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const type = typeof (payload as { type?: unknown })?.type === "string"
    ? (payload as { type: string }).type
    : "unknown";
  const email = recipientOf(payload);
  if (!email) return json({ error: "no_recipient" }, 400);

  // svix-id is unique per delivery attempt of a given event, so it doubles as
  // the idempotency key for provider retries.
  const eventId = req.headers.get("svix-id")!;
  const fresh = accountsService.recordEmailEvent(p, { eventId, type, email }, now);
  const reason = suppressionFor(type);
  const suppressed = fresh && reason !== null ? accountsService.suppressAddress(p, email, reason, now) : false;
  if (suppressed)
    deps.log?.info(logLine("info", "address suppressed", { type, reason }));
  return json({ ok: true, recorded: fresh, suppressed }, 200);
}
