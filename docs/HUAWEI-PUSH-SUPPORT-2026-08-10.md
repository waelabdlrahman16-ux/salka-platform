# Huawei Push Notification Support — Scoping Note (2026-08-10)

## Status: Deferred, not started

## Why this exists
The audit backlog lists "Huawei devices" as a P3 item. This note documents
findings from a codebase scan so the decision to defer is traceable, rather
than the item silently going stale.

## Current state
Push notifications are Firebase Cloud Messaging (FCM) only, end to end:
`src/lib/push.ts`, `public/firebase-messaging-sw.js`, and the
`@capacitor/push-notifications` plugin. There is no Huawei/HMS handling
anywhere in the repo — no HMS plugin installed, no AGConnect Gradle wiring,
no `platform: 'huawei'` value in the push-token schema.

## Why this isn't a small addition
Huawei phones sold since ~2019 (post US trade restrictions) ship without
Google Play Services, so FCM cannot deliver to them at all — there is no
config flag or fallback; it requires a genuinely parallel push stack:

- A Huawei AppGallery Connect account and app registration, producing
  separate credentials (`agconnect-services.json`)
- A community-maintained HMS Capacitor plugin (no official one exists;
  materially less mature than `@capacitor/push-notifications`)
- A new `'huawei'` platform value, its own native token-registration path,
  and a parallel `send-push` Edge Function implementation calling HMS Push
  Kit's REST API (different auth and payload shape than FCM)
- Physical Huawei hardware for testing — devices without Play Services
  cannot be validated in the Android emulator or Firebase Test Lab, and the
  team has none today

## Estimate
Multi-week engineering effort, gated on external account provisioning and
hardware acquisition before implementation can even start. Not a P3 quick
win; more accurately an epic that needs its own scoping once a Huawei
developer account and test device exist.

## Recommendation
Leave deferred until: (a) there's evidence of meaningful Huawei device share
in the actual customer base, and (b) a Huawei AppGallery Connect account and
at least one physical test device are available.
