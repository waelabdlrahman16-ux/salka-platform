# True notifications on a locked phone — what it takes, step by step

**Date: 2026-08-08.** Everything in the code is already done. What remains is
three GitHub secrets, one button, and installing the APK on the staff phones.

## Why the web app cannot be trusted on a locked phone

The staff screens today run in Chrome (every push token in the system's history
is `web`). Chrome push *usually* shows on the lock screen — but Android freezes
Chrome in the background whenever it feels like saving battery, and phone makers
(Xiaomi, Oppo, Samsung...) are aggressive about it. A frozen Chrome shows the
notification late or never, and there is no setting that fully prevents this.
That is not a Salka bug; it is how Android treats browsers.

A real Android app does not have this problem. FCM wakes the **system**, and the
system draws the notification from the tray — even if the app is killed, even on
the lock screen. That app already exists in this repo and is fully wired:

- `send-push` v15 sends Android tokens a real `notification` block:
  `PRIORITY_MAX`, sound, vibration, `visibility: PUBLIC` (readable on the lock
  screen), and staff alerts are `sticky` — a rider cannot swipe an order away
  by accident.
- `push.ts` creates the `salka_orders` channel at **importance MAX** with
  lock-screen visibility PUBLIC. Android 8+ takes loudness from the channel,
  and this is as loud as a channel gets.
- The APK is a thin shell that loads the live site — **every future web fix
  reaches installed phones with no rebuild.** You build this APK approximately
  once.

The reason no one has a native token yet: **the APK has never been built.**
`.github/workflows/android.yml` is in the repo, is run from the browser on your
phone, and only needs the signing secrets.

## Step 1 — add the three secrets (one time)

The values come from `salka-android.zip` (the zip delivered on 2026-08-05 —
it is the ONLY copy of the keystore; do not lose it).

GitHub → `salka-platform` → **Settings → Secrets and variables → Actions →
New repository secret**, three times:

| name | value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the file `salka-release.jks`, base64-encoded as one line |
| `ANDROID_STORE_PASSWORD` | from `keystore.properties` in the same zip |
| `ANDROID_KEY_PASSWORD` | from `keystore.properties` in the same zip |

Base64-encoding a file from a phone is awkward. **Shortcut: attach
`salka-android.zip` in the Claude chat and ask for the three exact values to
paste.** Nothing else in this process needs a computer.

Do not skip the secrets: without them the workflow falls back to a debug APK,
and the Firebase key is fingerprint-locked to the release keystore — a debug
build installs fine but **FCM silently refuses to register it**, which looks
exactly like a push bug.

## Step 2 — run the workflow

GitHub → **Actions → "Build driver APK" → Run workflow** (branch `main`).
~5–10 minutes. Open the finished run and download the **artifact** (the APK).
This works from the phone's browser.

## Step 3 — install on every staff phone

Yours, محمود's, the three riders', and any vendor phone that matters. Android
will warn about installing outside the Play Store — allow it for the browser
("install unknown apps"). Then in the app:

1. Sign in (the APK opens `/login` directly — staff login, not the customer sheet).
2. Tap the enable-notifications button, and **allow**.
3. Verify: Admin → push health should now show a row with platform `android`
   for that person. That row is the proof. `web` means they enabled it in
   Chrome, not in the APK.

## Step 4 — two phone settings per staff phone (30 seconds each)

Even native apps get throttled by battery savers on some phones:

1. **Settings → Apps → سالكة → Battery → "Unrestricted" (غير مقيد).**
2. **Settings → Apps → سالكة → Notifications** — confirm allowed, and that the
   `طلبات سالكة` channel shows as **urgent/high** with sound. Its lock-screen
   setting should be "show all content" (it asks for PUBLIC at creation).

On Xiaomi/Redmi also enable **Autostart** for the app. This is the #1 reason
"the phone didn't ring" on those devices.

## Until the APK is installed (the meantime)

For staff still on Chrome: set Chrome itself to Unrestricted battery, and make
sure app.gosalka.com notifications are allowed in Chrome's site settings. It
helps; it does not guarantee. The APK guarantees.

## One warning about the channel

`salka_orders` importance is **fixed the moment the app first creates it** on a
given phone. If it ever needs to change (e.g. a custom alarm tone — the file
would go in `android/app/src/main/res/raw/`), ship a NEW channel id in both
`push.ts` and `send-push` together. Editing the existing channel does nothing
on phones that already installed the app.

## Also in this zip

`supabase/security-revoke-anon-push-2026-08-08.sql` — the record of a security
migration **already applied to production** on 2026-08-08: the internal push
functions (`push_send`, `push_nudge_sweep`, `record_push_result`) are no longer
executable by anonymous or logged-in clients. Nudges and pushes verified still
working after the change. Nothing to do — just upload the file so the repo
stays the source of truth.
