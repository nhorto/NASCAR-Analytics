// Email provider — a minimal Resend REST client (plain fetch, no SDK) plus a
// null client used whenever the key/recipient are absent, so alert paths are
// deploy-safe before the owner's Resend account exists (launch plan A4) and
// testable with an injected transport.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Extra RFC-822 headers (List-Unsubscribe on digests). */
  headers?: Record<string, string>;
}

export interface EmailClient {
  /** True when a real transport is configured (the null client returns false). */
  readonly configured: boolean;
  send(msg: EmailMessage): Promise<{ ok: boolean; detail: string }>;
}

const RESEND_API_URL = "https://api.resend.com/emails";
export const DEFAULT_EMAIL_FROM = "canary@localhost.invalid";

export function createResendEmailClient(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    configured: true,
    async send(msg) {
      try {
        const res = await fetchImpl(RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: opts.from,
            to: [msg.to],
            subject: msg.subject,
            text: msg.text,
            ...(msg.headers ? { headers: msg.headers } : {}),
          }),
        });
        if (!res.ok) return { ok: false, detail: `resend HTTP ${res.status}: ${await res.text()}` };
        return { ok: true, detail: `sent to ${msg.to}` };
      } catch (err) {
        return { ok: false, detail: `resend transport: ${String(err)}` };
      }
    },
  };
}

/** Logs instead of sending. Keeps callers unconditional. */
export function createNullEmailClient(log: (m: string) => void): EmailClient {
  return {
    configured: false,
    async send(msg) {
      log(`email not configured — would have sent "${msg.subject}" to ${msg.to}`);
      return { ok: false, detail: "email not configured (RESEND_API_KEY / ALERT_EMAIL_TO unset)" };
    },
  };
}

/** Build the alert client from env: Resend when configured, else the null client. */
export function emailClientFromEnv(
  env: Record<string, string | undefined>,
  log: (m: string) => void,
): { client: EmailClient; to: string | null } {
  const apiKey = env.RESEND_API_KEY;
  const to = env.ALERT_EMAIL_TO ?? null;
  if (!apiKey || !to) return { client: createNullEmailClient(log), to };
  return {
    client: createResendEmailClient({ apiKey, from: env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM }),
    to,
  };
}

// --- inbound webhooks (WS-G) ---
// Resend signs webhooks with Svix: the signature is a base64 HMAC-SHA256 over
// `${id}.${timestamp}.${body}` keyed by the secret's base64 payload (the part
// after "whsec_"). The header may carry several space-separated
// `v1,<signature>` values during a secret rotation — any match is valid.

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type WebhookVerdict = { ok: true } | { ok: false; reason: string };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Sign a payload the way Svix does — used by verification and by tests. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return new Bun.CryptoHasher("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

/**
 * Verify an inbound webhook. Rejects missing headers, a timestamp outside the
 * replay window, and any signature mismatch (constant-time compare).
 */
export function verifyWebhookSignature(opts: {
  secret: string;
  headers: WebhookHeaders;
  body: string;
  nowSeconds: number;
}): WebhookVerdict {
  const { id, timestamp, signature } = opts.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "malformed timestamp" };
  if (Math.abs(opts.nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS)
    return { ok: false, reason: "timestamp outside tolerance" };
  const expected = signWebhook(opts.secret, id, timestamp, opts.body);
  for (const part of signature.split(" ")) {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    if (constantTimeEqual(value, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature mismatch" };
}
