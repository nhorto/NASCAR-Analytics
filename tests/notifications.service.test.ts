// Web Push: protocol crypto (RFC 8291/8188/8292) and the policy that decides
// who gets an alert. The crypto is round-tripped through an independent
// receiver implementation, because a self-consistent-but-wrong derivation is
// exactly the failure a browser would silently drop.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  b64urlDecode,
  b64urlEncode,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  sendPush,
  vapidAuthorization,
  vapidFromEnv,
} from "../src/providers/webpush.ts";
import { notificationsService, notificationsConfig } from "../src/domains/notifications/index.ts";
import type { CandidateAlert, PushSubscriptionRecord } from "../src/domains/notifications/index.ts";
import { testDb, seedUser } from "./seed.ts";

const NOW = new Date("2026-09-07T18:00:00Z");

/** Stand in for a browser's PushSubscription: a real P-256 pair + auth secret. */
async function fakeDevice() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const exported = await crypto.subtle.exportKey("raw", pair.publicKey);
  // Copy into a plain-ArrayBuffer-backed view: TS 5.7's generic Uint8Array
  // means ArrayBufferLike-backed arrays don't satisfy the crypto signatures.
  const publicRaw = new Uint8Array(exported.byteLength);
  publicRaw.set(new Uint8Array(exported));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  return {
    p256dh: b64urlEncode(publicRaw),
    auth: b64urlEncode(auth),
    publicRaw: publicRaw as Uint8Array<ArrayBuffer>,
    authRaw: auth as Uint8Array<ArrayBuffer>,
    jwk: jwk as { kty: "EC"; crv: "P-256"; x: string; y: string; d?: string },
  };
}

describe("payload encryption (RFC 8291 / aes128gcm)", () => {
  test("a message round-trips back to the exact plaintext", async () => {
    const device = await fakeDevice();
    const payload = JSON.stringify({ title: "Pit stop", body: "Bell pits from P3" });
    const body = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload });
    const decrypted = await decryptPayload(body, device.jwk, device.publicRaw, device.authRaw);
    expect(decrypted).toBe(payload);
  });

  test("the body carries the RFC 8188 header: salt, record size, key id", async () => {
    const device = await fakeDevice();
    const body = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload: "hi" });
    const view = new DataView(body.buffer, body.byteOffset);
    expect(body.length).toBeGreaterThan(16 + 5 + 65);
    expect(view.getUint32(16)).toBe(4096); // record size
    expect(body[20]).toBe(65); // key id length = uncompressed P-256 point
    expect(body[21]).toBe(0x04); // the point itself is uncompressed
  });

  test("each message uses a fresh salt and ephemeral key", async () => {
    const device = await fakeDevice();
    const a = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload: "same" });
    const b = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload: "same" });
    // Reusing salt+key across messages would leak plaintext relationships.
    expect(b64urlEncode(a.subarray(0, 16))).not.toBe(b64urlEncode(b.subarray(0, 16)));
    expect(b64urlEncode(a.subarray(21, 86))).not.toBe(b64urlEncode(b.subarray(21, 86)));
  });

  test("the wrong auth secret cannot decrypt — the secret really is binding", async () => {
    const device = await fakeDevice();
    const body = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload: "secret" });
    const wrongAuth = new Uint8Array(16) as Uint8Array<ArrayBuffer>;
    crypto.getRandomValues(wrongAuth);
    await expect(decryptPayload(body, device.jwk, device.publicRaw, wrongAuth)).rejects.toThrow();
  });

  test("a tampered ciphertext fails the GCM tag rather than decrypting", async () => {
    const device = await fakeDevice();
    const body = await encryptPayload({ p256dh: device.p256dh, auth: device.auth, payload: "secret" });
    body[body.length - 1] = body[body.length - 1]! ^ 0xff;
    await expect(decryptPayload(body, device.jwk, device.publicRaw, device.authRaw)).rejects.toThrow();
  });

  test("a malformed subscriber key is rejected, not silently mis-encrypted", async () => {
    await expect(
      encryptPayload({ p256dh: b64urlEncode(new Uint8Array(10)), auth: b64urlEncode(new Uint8Array(16)), payload: "x" }),
    ).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  test("generated keys are a 65-byte P-256 point plus a private scalar", async () => {
    const keys = await generateVapidKeys("mailto:owner@example.com");
    expect(b64urlDecode(keys.publicKey).length).toBe(65);
    expect(b64urlDecode(keys.publicKey)[0]).toBe(0x04);
    expect(b64urlDecode(keys.privateKey).length).toBe(32);
  });

  test("the header is a signed ES256 JWT whose audience is the endpoint ORIGIN", async () => {
    const keys = await generateVapidKeys("mailto:owner@example.com");
    const header = await vapidAuthorization(keys, "https://fcm.googleapis.com/fcm/send/abc123", 1_800_000_000);
    expect(header).toStartWith("vapid t=");
    expect(header).toContain(`k=${keys.publicKey}`);
    const jwt = /t=([^,]+)/.exec(header)![1]!;
    const [rawHeader, rawPayload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(rawHeader!, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(rawPayload!, "base64url").toString()) as Record<string, unknown>;
    // Including the path in `aud` is the classic VAPID bug — services reject it.
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:owner@example.com");
    expect(claims.exp).toBe(1_800_000_000 + 12 * 60 * 60);
    expect(b64urlDecode(signature!).length).toBe(64); // raw r||s
  });

  test("the signature verifies against the advertised public key", async () => {
    const keys = await generateVapidKeys("mailto:owner@example.com");
    const header = await vapidAuthorization(keys, "https://push.example/x/y", 1_800_000_000);
    const jwt = /t=([^,]+)/.exec(header)![1]!;
    const [h, pl, sig] = jwt.split(".");
    const raw = b64urlDecode(keys.publicKey);
    const key = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC", crv: "P-256",
        x: b64urlEncode(raw.subarray(1, 33)),
        y: b64urlEncode(raw.subarray(33, 65)),
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlDecode(sig!),
      new TextEncoder().encode(`${h}.${pl}`),
    );
    expect(ok).toBe(true);
  });

  test("env without both keys yields no VAPID identity", () => {
    expect(vapidFromEnv({})).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "a" })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toEqual({
      publicKey: "a", privateKey: "b", subject: "mailto:alerts@localhost.invalid",
    });
  });
});

describe("delivery", () => {
  test("a 201 is success; 410 marks the endpoint permanently gone", async () => {
    const device = await fakeDevice();
    const keys = await generateVapidKeys("mailto:o@e.com");
    const base = { endpoint: "https://push.example/abc", p256dh: device.p256dh, auth: device.auth, payload: "{}", vapid: keys };

    const respond = (status: number, body = "") =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    const ok = await sendPush({ ...base, fetchImpl: respond(201) });
    expect(ok).toMatchObject({ ok: true, status: 201, gone: false });

    const gone = await sendPush({ ...base, fetchImpl: respond(410, "gone") });
    expect(gone).toMatchObject({ ok: false, status: 410, gone: true });

    const transient = await sendPush({ ...base, fetchImpl: respond(500, "boom") });
    expect(transient).toMatchObject({ ok: false, status: 500, gone: false });
  });

  test("required protocol headers are sent", async () => {
    const device = await fakeDevice();
    const keys = await generateVapidKeys("mailto:o@e.com");
    let seen: Headers | null = null;
    await sendPush({
      endpoint: "https://push.example/abc", p256dh: device.p256dh, auth: device.auth,
      payload: "{}", vapid: keys,
      fetchImpl: (async (_url: unknown, init: RequestInit) => {
        seen = new Headers(init.headers);
        return new Response("", { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(seen!.get("Content-Encoding")).toBe("aes128gcm");
    expect(seen!.get("Content-Type")).toBe("application/octet-stream");
    expect(seen!.get("TTL")).toBe("900");
    expect(seen!.get("Authorization")).toStartWith("vapid t=");
  });

  test("a network throw is reported, not raised", async () => {
    const device = await fakeDevice();
    const keys = await generateVapidKeys("mailto:o@e.com");
    const result = await sendPush({
      endpoint: "https://push.example/abc", p256dh: device.p256dh, auth: device.auth,
      payload: "{}", vapid: keys,
      fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("offline");
  });
});

// --- policy ---

let db: Database;
let p: { db: Database };
let userId: number;

beforeEach(() => {
  db = testDb();
  p = { db };
  userId = seedUser(db, { email: "pro@example.com" });
});

function subscribeDevice(overrides: Partial<Parameters<typeof notificationsService.subscribe>[2]> = {}) {
  return notificationsService.subscribe(
    p,
    userId,
    {
      endpoint: "https://push.example/device-1",
      p256dh: "B".repeat(87),
      auth: "a".repeat(22),
      ...overrides,
    },
    NOW,
  );
}

function alert(over: Partial<CandidateAlert> = {}): CandidateAlert {
  return { kind: "pit", message: "Bell pits", driverId: 10, atLap: 120, raceId: 5555, ...over };
}

describe("subscription validation", () => {
  test("rejects malformed input with a user-safe reason", () => {
    const v = notificationsService.validateSubscription;
    expect(v({ endpoint: "http://push.example/x", p256dh: "B".repeat(87), auth: "a".repeat(22) }))
      .toBe("Push endpoint must be an https URL.");
    expect(v({ endpoint: "https://p/x", p256dh: "short", auth: "a".repeat(22) }))
      .toBe("Subscription key is missing or malformed.");
    expect(v({ endpoint: "https://p/x", p256dh: "B".repeat(87), auth: "no" }))
      .toBe("Subscription auth secret is missing or malformed.");
    expect(v({ endpoint: "https://p/x", p256dh: "B".repeat(87), auth: "a".repeat(22), kinds: ["nope" as never] }))
      .toBe('Unknown alert type "nope".');
    expect(v({ endpoint: "https://p/x", p256dh: "B".repeat(87), auth: "a".repeat(22), quietFromHour: 24 }))
      .toBe("Quiet hours must be 0–23.");
  });

  test("accepts a well-formed subscription", () => {
    expect(
      notificationsService.validateSubscription({
        endpoint: "https://push.example/x", p256dh: "B".repeat(87), auth: "a".repeat(22),
        kinds: ["pit", "caution"], quietFromHour: 22, quietToHour: 7,
      }),
    ).toBeNull();
  });
});

describe("subscription lifecycle", () => {
  test("subscribing stores defaults and is idempotent per endpoint", () => {
    const first = subscribeDevice();
    expect(first.kinds).toEqual(notificationsConfig.DEFAULT_KINDS);
    expect(first.quietFromHour).toBeNull(); // quiet hours off by default

    const again = subscribeDevice({ followedDriverId: 22, kinds: ["caution"] });
    expect(notificationsService.subscriptionsForUser(p, userId).length).toBe(1);
    expect(again.followedDriverId).toBe(22);
    expect(again.kinds).toEqual(["caution"]);
  });

  test("a delivery failure trips the endpoint out after repeated attempts", () => {
    subscribeDevice();
    const endpoint = "https://push.example/device-1";
    expect(notificationsService.recordOutcome(p, endpoint, false, false, NOW)).toBe(false);
    expect(notificationsService.recordOutcome(p, endpoint, false, false, NOW)).toBe(false);
    // Third consecutive failure hits MAX_FAILURES and prunes.
    expect(notificationsService.recordOutcome(p, endpoint, false, false, NOW)).toBe(true);
    expect(notificationsService.subscriptionsForUser(p, userId)).toEqual([]);
  });

  test("a success resets the failure count", () => {
    subscribeDevice();
    const endpoint = "https://push.example/device-1";
    notificationsService.recordOutcome(p, endpoint, false, false, NOW);
    notificationsService.recordOutcome(p, endpoint, true, false, NOW);
    notificationsService.recordOutcome(p, endpoint, false, false, NOW);
    notificationsService.recordOutcome(p, endpoint, false, false, NOW);
    expect(notificationsService.subscriptionsForUser(p, userId).length).toBe(1);
  });

  test("a 410 prunes immediately — the browser already discarded it", () => {
    subscribeDevice();
    expect(notificationsService.recordOutcome(p, "https://push.example/device-1", false, true, NOW)).toBe(true);
    expect(notificationsService.subscriptionsForUser(p, userId)).toEqual([]);
  });
});

describe("who gets an alert", () => {
  test("per-driver alerts only reach devices following that driver", () => {
    const following = subscribeDevice({ followedDriverId: 10, kinds: ["pit"] });
    const other = { ...following, followedDriverId: 99 } as PushSubscriptionRecord;
    expect(notificationsService.shouldSend(following, alert(), NOW)).toBe(true);
    expect(notificationsService.shouldSend(other, alert(), NOW)).toBe(false);
  });

  test("global alerts reach everyone subscribed to that kind", () => {
    const sub = subscribeDevice({ followedDriverId: null, kinds: ["caution"] });
    expect(notificationsService.shouldSend(sub, alert({ kind: "caution", driverId: null }), NOW)).toBe(true);
    // …but a kind they didn't ask for never goes out.
    expect(notificationsService.shouldSend(sub, alert({ kind: "pit" }), NOW)).toBe(false);
  });

  test("a driver-scoped alert with no driver is dropped rather than broadcast", () => {
    const sub = subscribeDevice({ followedDriverId: 10, kinds: ["pit"] });
    expect(notificationsService.shouldSend(sub, alert({ driverId: null }), NOW)).toBe(false);
  });
});

describe("quiet hours", () => {
  const at = (iso: string) => new Date(iso);

  test("off by default", () => {
    const sub = subscribeDevice({ timezone: "America/New_York" });
    expect(notificationsService.inQuietHours(sub, at("2026-09-07T07:00:00Z"))).toBe(false);
  });

  test("a window wrapping midnight silences the night, not the day", () => {
    const sub = subscribeDevice({ quietFromHour: 22, quietToHour: 7, timezone: "America/New_York" });
    // 03:00Z = 23:00 previous day in New York → inside 22–07.
    expect(notificationsService.inQuietHours(sub, at("2026-09-08T03:00:00Z"))).toBe(true);
    // 18:00Z = 14:00 New York → outside.
    expect(notificationsService.inQuietHours(sub, at("2026-09-07T18:00:00Z"))).toBe(false);
  });

  test("the same instant differs by the device's timezone", () => {
    const ny = subscribeDevice({ quietFromHour: 22, quietToHour: 7, timezone: "America/New_York" });
    const tokyo = { ...ny, timezone: "Asia/Tokyo" } as PushSubscriptionRecord;
    const instant = at("2026-09-07T12:00:00Z"); // 08:00 NY, 21:00 Tokyo
    expect(notificationsService.inQuietHours(ny, instant)).toBe(false);
    expect(notificationsService.inQuietHours(tokyo, instant)).toBe(false);
    const later = at("2026-09-07T14:00:00Z"); // 10:00 NY, 23:00 Tokyo
    expect(notificationsService.inQuietHours(tokyo, later)).toBe(true);
  });

  test("an unknown or missing timezone never silences the device", () => {
    // Failing open matters: a bad zone string must not mute someone forever.
    const noZone = subscribeDevice({ quietFromHour: 22, quietToHour: 7, timezone: null });
    const badZone = { ...noZone, timezone: "Not/AZone" } as PushSubscriptionRecord;
    expect(notificationsService.inQuietHours(noZone, at("2026-09-08T03:00:00Z"))).toBe(false);
    expect(notificationsService.inQuietHours(badZone, at("2026-09-08T03:00:00Z"))).toBe(false);
  });

  test("a zero-width window is not a total blackout", () => {
    const sub = subscribeDevice({ quietFromHour: 9, quietToHour: 9, timezone: "UTC" });
    expect(notificationsService.inQuietHours(sub, at("2026-09-07T09:30:00Z"))).toBe(false);
  });
});

describe("dedup", () => {
  test("the same alert is claimable once per endpoint and race", () => {
    subscribeDevice();
    const endpoint = "https://push.example/device-1";
    expect(notificationsService.claimSend(p, endpoint, alert(), NOW)).toBe(true);
    expect(notificationsService.claimSend(p, endpoint, alert(), NOW)).toBe(false);
    // A different lap, driver, kind, or race is a different alert.
    expect(notificationsService.claimSend(p, endpoint, alert({ atLap: 121 }), NOW)).toBe(true);
    expect(notificationsService.claimSend(p, endpoint, alert({ raceId: 5556 }), NOW)).toBe(true);
  });

  test("dedup ignores the message text so a reworded restart still collapses", () => {
    // The live DO can restart and re-derive the same event with different
    // wording; keying on text would let the duplicate through.
    expect(notificationsService.dedupKey(alert({ message: "Bell pits" })))
      .toBe(notificationsService.dedupKey(alert({ message: "No. 20 to pit road" })));
  });
});

describe("notification content", () => {
  test("titles name the event and the race; the tag collapses repeats", () => {
    const message = notificationsService.messageFor(alert(), "Southern 500");
    expect(message.title).toBe("Pit stop — Southern 500");
    expect(message.body).toBe("Bell pits");
    expect(message.url).toBe("/live");
    expect(message.tag).toBe("looplab-5555-pit-10");
  });
});
