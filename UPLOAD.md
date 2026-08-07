# What to upload — 2026-08-07

Everything pending is in this zip. Nothing is being held back.
Unzip and drop the folders into the repo root on GitHub; the paths already match.

## 23 files, in 4 groups

### A. The revenue fix — upload this first if you upload nothing else
| file | why |
|---|---|
| `src/pages/Offers.tsx` | reads `vendor_open_states()` instead of the stale `is_open` column |
| `src/pages/CustomOrder.tsx` | same |
| `src/pages/Vendor.tsx` | same |

All 12 live vendors sit at `is_open = false` permanently and nothing resets it.
Measured as an anonymous customer at 07:22: **Offers returned 0 rows while 4
vendors were genuinely open.** Every hour this is not deployed, customers see an
empty shop.

### B. Push — the client half of today's fix
| file | why |
|---|---|
| `src/lib/push.ts` | breaks Firebase's dead-token cache; this is the "works once then never again" bug |
| `src/lib/platform.ts` | **new** — iOS / standalone detection |
| `src/components/EnablePushButton.tsx` | iPhone users now get instructions instead of a blank space |
| `src/components/InstallPrompt.tsx` | add-to-home-screen card |
| `public/firebase-messaging-sw.js` | staff banners stick until acted on; customers' do not |
| `src/lib/firstOrder.ts` | **new** — remembers a delivered order |

### C. The UI pass on the customer path
`src/components/ProductCard.tsx`, `src/components/RestaurantCard.tsx`,
`src/components/CustomizeSheet.tsx`, `src/pages/CheckoutPage.tsx`,
`src/pages/Track.tsx`, `src/pages/Home.tsx`, `src/pages/RestaurantDetail.tsx`,
`src/pages/Admin.tsx`, `src/lib/statusLabels.ts`, `src/App.tsx`, `src/index.css`

Includes the fix for the second screenshot you sent: a cancelled order now shows
«ملغي» in red with the reason and the minutes elapsed, and no live price box.

### D. The server record — already live, but not written down until now
| file | why |
|---|---|
| `supabase/functions/send-push/index.ts` | the repo copy was **two versions stale** |
| `supabase/functions/push-health/index.ts` | **new** — did not exist in the repo at all |
| `supabase/push-and-supervisor-2026-08-07.sql` | **new** — today's 8 migrations |

Group D changes nothing in production — it is already deployed. It matters
because `supabase/` is the only place a future session can read what the
database actually does, and it had drifted.

## Verified before packaging

- `npm run build` — clean. TypeScript compiles, the firebase service-worker
  version check passes, 535 modules, 17 chunks.
- Every file in this zip is byte-identical to the tested tree.
- Nothing here reverts your earlier upload — `Supervisor.tsx` on `main` already
  matches, and no other file on `main` is newer.

## Not in this zip, on purpose

The featured-vendor flag, the ordering controls and the Talabat-style badges.
You said you would confirm those later, so they are not shipped. They are not
lost — say the word and they go in the next one.

## After it deploys

Tell محمود to open **app.gosalka.com in Chrome on Android**, sign in, enable
notifications, then ⋮ → Add to Home screen. Not the APK — no APK has ever
registered a push token. ماكدونالدز and هارت أتاك need to do the same on their
own devices.
