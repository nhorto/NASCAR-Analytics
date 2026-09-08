// The Web Push protocol client (WS-H): VAPID request signing (RFC 8292),
// message encryption (RFC 8291 over the aes128gcm encoding of RFC 8188), and
// the delivery POST. A provider, like providers/email.ts, because this is the
// wire protocol — *who* gets an alert is policy and lives in the
// notifications domain.
//
// Every primitive comes from WebCrypto — ECDH, HKDF, AES-GCM, ECDSA — rather
// than being hand-rolled. Hand-written HKDF/GCM is exactly where push
// implementations go subtly wrong, and the failure is invisible without a
// real push service to reject it.
import type { PushDeliveryResult, VapidKeys } from "../domains/notifications/types.ts";

/** Push services reject a JWT valid for more than 24 h; 12 is comfortable. */
const VAPID_JWT_TTL_SECONDS = 12 * 60 * 60;
/** How long the push service may hold an undelivered message. */
export const DEFAULT_PUSH_TTL_SECONDS = 900;

const enc = new TextEncoder();

/**
 * Byte arrays backed by a plain ArrayBuffer. TypeScript 5.7 made Uint8Array
 * generic over its buffer, and `Uint8Array<ArrayBufferLike>` (what Buffer and
 * some APIs hand back) does not satisfy WebCrypto's `BufferSource` — so every
 * helper here normalizes to this alias rather than casting at 20 call sites.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** A JSON Web Key, narrowed to the EC fields we use. */
export interface EcJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d?: string;
  ext?: boolean;
}

function bytes(source: ArrayLike<number>): Bytes {
  const out = new Uint8Array(source.length) as Bytes;
  out.set(source);
  return out;
}

export function b64urlEncode(input: Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

export function b64urlDecode(value: string): Bytes {
  return bytes(Buffer.from(value, "base64url"));
}

function concat(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total) as Bytes;
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-SHA256 (extract + expand) as one WebCrypto call. */
async function hkdf(
  salt: Bytes,
  ikm: Bytes,
  info: Bytes,
  lengthBytes: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    lengthBytes * 8,
  );
  return bytes(new Uint8Array(bits));
}

/** Uncompressed P-256 point (0x04 || X || Y) → JWK coordinates. */
function pointToJwk(publicKey: Bytes): { x: string; y: string } {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04)
    throw new Error("expected a 65-byte uncompressed P-256 public key");
  return {
    x: b64urlEncode(publicKey.subarray(1, 33)),
    y: b64urlEncode(publicKey.subarray(33, 65)),
  };
}

// --- VAPID (RFC 8292) ---

/** Fresh application-server identity. Run once; store as secrets. */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = bytes(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(publicKey), privateKey: jwk.d!, subject };
}

async function importVapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const { x, y } = pointToJwk(b64urlDecode(keys.publicKey));
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: keys.privateKey, x, y, ext: true } satisfies EcJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The `Authorization: vapid t=…, k=…` header proving to the push service which
 * application server is sending. `aud` must be the endpoint's ORIGIN — push
 * services reject a JWT audience that carries the path.
 */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  nowSeconds: number,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: nowSeconds + VAPID_JWT_TTL_SECONDS,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await importVapidSigningKey(keys),
      enc.encode(signingInput),
    ),
  );
  // WebCrypto returns the raw r||s pair, which is exactly JWS ES256's format.
  return `vapid t=${signingInput}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

// --- payload encryption (RFC 8291 / RFC 8188) ---

const KEY_INFO_PREFIX = enc.encode("WebPush: info\0");
const CEK_INFO = enc.encode("Content-Encoding: aes128gcm\0");
const NONCE_INFO = enc.encode("Content-Encoding: nonce\0");

export interface EncryptOptions {
  /** Subscriber's public key (p256dh), base64url. */
  p256dh: string;
  /** Subscriber's auth secret, base64url. */
  auth: string;
  payload: string;
  /** Injectable for tests; random in production. */
  salt?: Bytes;
  ephemeralKeyPair?: CryptoKeyPair;
  recordSize?: number;
}

/**
 * Encrypt a push payload. Returns the complete aes128gcm body:
 *   salt(16) | record size(4) | key id length(1) | server public key(65) | ciphertext
 */
export async function encryptPayload(opts: EncryptOptions): Promise<Bytes> {
  const uaPublic = b64urlDecode(opts.p256dh);
  const authSecret = b64urlDecode(opts.auth);
  const salt = opts.salt ?? (crypto.getRandomValues(new Uint8Array(16)) as Bytes);
  const recordSize = opts.recordSize ?? 4096;

  const pair =
    opts.ephemeralKeyPair ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair);
  const asPublic = bytes(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = bytes(
    new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256)),
  );

  // Stage 1 (RFC 8291 §3.3): mix the ECDH secret with the subscriber's auth
  // secret, binding the key to both parties' public keys.
  const keyInfo = concat(KEY_INFO_PREFIX, uaPublic, asPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // Stage 2 (RFC 8188 §2.2): derive the content key and nonce from the salt.
  const cek = await hkdf(salt, ikm, CEK_INFO, 16);
  const nonce = await hkdf(salt, ikm, NONCE_INFO, 12);

  // A single record, so the delimiter is 0x02 ("last record").
  const plaintext = concat(enc.encode(opts.payload), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = bytes(
    new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
    ),
  );

  const header = new Uint8Array(5) as Bytes;
  new DataView(header.buffer).setUint32(0, recordSize);
  header[4] = asPublic.length; // key id length: 65
  return concat(salt, header, asPublic, ciphertext);
}

/**
 * The subscriber side of RFC 8291, used by tests to prove the whole derivation
 * round-trips. Never called in production — a browser does this.
 */
export async function decryptPayload(
  body: Bytes,
  uaPrivateJwk: EcJwk,
  uaPublic: Bytes,
  auth: Bytes,
): Promise<string> {
  const salt = bytes(body.subarray(0, 16));
  const idLength = body[20]!;
  const asPublic = bytes(body.subarray(21, 21 + idLength));
  const ciphertext = bytes(body.subarray(21 + idLength));

  const uaPrivate = await crypto.subtle.importKey(
    "jwk",
    uaPrivateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = bytes(
    new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256)),
  );
  const ikm = await hkdf(auth, sharedSecret, concat(KEY_INFO_PREFIX, uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, CEK_INFO, 16);
  const nonce = await hkdf(salt, ikm, NONCE_INFO, 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = bytes(
    new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, ciphertext),
    ),
  );
  // Strip the record delimiter byte.
  return new TextDecoder().decode(plain.subarray(0, plain.length - 1));
}

// --- delivery ---

export interface PushSendOptions {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: string;
  vapid: VapidKeys;
  ttlSeconds?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

/**
 * Deliver one encrypted push. `gone` distinguishes a permanently dead
 * subscription (404/410 — the browser discarded it) from a transient failure,
 * so the caller can prune instead of retrying forever.
 */
export async function sendPush(opts: PushSendOptions): Promise<PushDeliveryResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const nowSeconds = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000);
  try {
    const body = await encryptPayload({
      p256dh: opts.p256dh,
      auth: opts.auth,
      payload: opts.payload,
    });
    const res = await fetchImpl(opts.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(opts.vapid, opts.endpoint, nowSeconds),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS),
        Urgency: "high",
      },
      body,
    });
    const gone = res.status === 404 || res.status === 410;
    if (!res.ok)
      return {
        endpoint: opts.endpoint,
        ok: false,
        status: res.status,
        gone,
        detail: `push HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    return { endpoint: opts.endpoint, ok: true, status: res.status, gone: false, detail: "delivered" };
  } catch (err) {
    return { endpoint: opts.endpoint, ok: false, status: 0, gone: false, detail: `push transport: ${String(err)}` };
  }
}

/** Read VAPID keys from env; null when the deploy has none configured. */
export function vapidFromEnv(env: Record<string, string | undefined>): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT ?? "mailto:alerts@localhost.invalid" };
}
