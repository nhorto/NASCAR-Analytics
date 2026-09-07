// Web Push domain types (WS-H). Zero runtime imports (architecture rule).

/** The alert kinds a device can subscribe to (mirrors live's LiveAlertKind). */
export type PushAlertKind =
  | "lead_change"
  | "position_gain"
  | "position_loss"
  | "pit"
  | "caution"
  | "green"
  | "stage_end"
  | "out"
  | "finish";

/** One browser push endpoint, owned by a user. */
export interface PushSubscriptionRecord {
  endpoint: string;
  userId: number;
  /** Subscriber's P-256 public key, base64url (from PushSubscription.keys). */
  p256dh: string;
  /** Subscriber's auth secret, base64url. */
  auth: string;
  /** Only alerts about this driver are sent; null = global alerts only. */
  followedDriverId: number | null;
  kinds: PushAlertKind[];
  /** Local-hour window during which alerts are dropped; null = always on. */
  quietFromHour: number | null;
  quietToHour: number | null;
  /** IANA timezone of the device, e.g. "America/New_York". */
  timezone: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Consecutive delivery failures; a persistent endpoint gets pruned. */
  failureCount: number;
}

/** What the client sends when subscribing. */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  followedDriverId?: number | null;
  kinds?: PushAlertKind[];
  quietFromHour?: number | null;
  quietToHour?: number | null;
  timezone?: string | null;
}

/** The notification a device receives. */
export interface PushMessage {
  title: string;
  body: string;
  /** Deep link opened on tap. */
  url: string;
  /** Collapses same-topic notifications on the device. */
  tag: string;
}

/** An alert the dispatcher is considering sending. */
export interface CandidateAlert {
  kind: PushAlertKind;
  message: string;
  driverId: number | null;
  atLap: number;
  raceId: number;
}

/** VAPID application-server identity. */
export interface VapidKeys {
  /** base64url, uncompressed P-256 point (65 bytes) — also sent to the client. */
  publicKey: string;
  /** base64url, 32-byte P-256 private scalar. */
  privateKey: string;
  /** mailto: or https: contact, per RFC 8292. */
  subject: string;
}

/** Result of one delivery attempt. */
export interface PushDeliveryResult {
  endpoint: string;
  ok: boolean;
  status: number;
  /** True when the push service says this endpoint is permanently gone. */
  gone: boolean;
  detail: string;
}
