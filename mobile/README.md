# LoopLab mobile (WS-J)

The native Expo/React Native app (iOS + Android). Plan of record:
`docs/exec-plans/active/2026-09-08-ws-j-native-mobile-app.md`. This is a
**client of the existing server** — it re-declares the response types it
consumes and decides nothing the server already decides (tiers, gating,
entitlement).

"LoopLab" and `app.looplab.placeholder` follow the repo's D2 placeholder
convention. Nothing gets registered with Apple/Google under these ids.

## Layout

- `src/app/` — expo-router routes (thin wrappers over feature screens).
- `src/features/<name>/` — `api.ts` (fetch + defensive parse), `model.ts`
  (pure view-model), screens. `api`/`model` never import react-native, so
  their colocated tests run under the repo root's plain `bun test`.
- `src/lib/` — server base-url config, timeout fetch, cookie/session
  handling, auth flows, the viewer/entitlement context, and the stubbed
  `purchases.ts` / `push.ts` interfaces.
- `src/ui/` — theme tokens (mirroring `src/app/style.css`) and shared
  components.

## Running

```bash
cd mobile
bun install
bun run typecheck
bunx expo start        # Expo Go / dev client; simulators need expo run:ios|android
```

Point the app at a server from Settings (defaults to `http://localhost:3000`,
the dev server's port). `bun run serve` at the repo root starts one.

## Owner-gated stubs (do not "finish" these without the owner steps)

- **Purchases** (`src/lib/purchases.ts`): RevenueCat adapter is TODO behind
  the `PurchasesClient` interface — gated on launch-plan owner steps
  **J1/J2** (RevenueCat account + IAP products, which need the D2 name).
- **Push** (`src/lib/push.ts`): APNs/FCM registration is TODO behind the
  `PushClient` interface — gated on **J5** (APNs key + FCM project).
- **Store identity**: bundle ids/slug/name are placeholders until **D2**;
  EAS config and store metadata arrive with stage 4 (J3/J4).
