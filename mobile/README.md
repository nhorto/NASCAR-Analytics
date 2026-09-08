# LoopLab mobile (WS-J)

The native Expo/React Native app (iOS + Android). Plan of record:
`docs/exec-plans/active/2026-09-08-ws-j-native-mobile-app.md`. This is a
**client of the existing server** — it re-declares the response types it
consumes and decides nothing the server already decides (tiers, gating,
entitlement).

"LoopLab" and `app.looplab.placeholder` follow the repo's D2 placeholder
convention. Nothing gets registered with Apple/Google under these ids.

## Screens

Free (Cup): home, live board, driver index/profiles, standings + metric boards.

Pro, each rendering **both** entitlement states:

| Screen | Free | Pro |
| --- | --- | --- |
| `/predictions` | top three drivers + the withheld count | the whole field, predicted-vs-actual once scored |
| `/methodology` | full (an accuracy claim only payers can check is not worth making) | same |
| `/dfs` | locked card | DK/FD projections, scoring rules, lineup scratchpad |
| `/compare` | two Cup drivers, one season | four drivers, any series, a season range |
| `/tracks` | Cup, full season range | plus Xfinity and Trucks |

The withholding is the **server's** job, not the client's: `/api/predictions`
sends a free viewer three rows and a count, `/api/dfs` answers `403
pro_required`, and the series JSON gate refuses non-Cup reads. The app renders
what it was given. `ProLock` is the one locked/upsell card, shared by every
screen; it never links to web checkout (Apple 3.1.1).

CSV export stays web-only here — a download opens outside the app and leaves
the session cookie behind.

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
