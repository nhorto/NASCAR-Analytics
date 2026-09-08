// Native push registration interface. On mobile, APNs/FCM supersedes the
// web's VAPID push (WS-J); the server grows native-token registration beside
// its web push subscriptions in stage 4.
//
// TODO(WS-J stage 4 — owner step J5): implement with expo-notifications once
// the APNs key + FCM project exist, register the device token with the
// server, and reuse the dispatcher's per-device dedup + quiet hours.
export interface PushClient {
  /** False until the APNs/FCM credentials and server registration exist. */
  readonly available: boolean;
  register(): Promise<{ ok: boolean }>;
  unregister(): Promise<{ ok: boolean }>;
}

const stub: PushClient = {
  available: false,
  register: async () => ({ ok: false }),
  unregister: async () => ({ ok: false }),
};

export function pushClient(): PushClient {
  return stub;
}
