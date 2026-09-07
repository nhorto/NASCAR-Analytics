// Email provider — a minimal Resend REST client (plain fetch, no SDK) plus a
// null client used whenever the key/recipient are absent, so alert paths are
// deploy-safe before the owner's Resend account exists (launch plan A4) and
// testable with an injected transport.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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
          body: JSON.stringify({ from: opts.from, to: [msg.to], subject: msg.subject, text: msg.text }),
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
