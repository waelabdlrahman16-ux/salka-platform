# Two systems deploy the same Workers

Found 2026-08-21, while adding a deploy job for `landing/` that turned out to
be unnecessary. Recorded because the situation is invisible from the
repository alone: nothing in the tree says a second deployer exists.

## What is actually deploying

| Worker | GitHub Actions (`.github/workflows/deploy.yml`) | Cloudflare Workers Builds (Git integration) |
|---|---|---|
| `appgosalka-platform` (the app, `app.gosalka.com`) | yes — `wrangler deploy` on push to `main` | **yes** |
| `gosalka-landing` (the marketing site, `gosalka.com`) | no | **yes** |

The Cloudflare side is configured in the Cloudflare dashboard, not in this
repository, which is why reading `deploy.yml` gives a confident and wrong
answer about how the site ships.

## How it was found

Three observations that only fit together one way:

1. `gosalka-landing`'s `modified_on` was minutes old, while `landing/` had not
   changed on `main` since 2026-08-18.
2. PR #188 received a Cloudflare deployment, a commit preview URL and a branch
   preview URL, with no workflow doing anything — and a second one for
   `appgosalka-platform`.
3. Deploy run #361 (`f60a463`) finished at 20:27:01Z; the
   `appgosalka-platform` Worker's `modified_on` is 20:28:00Z — a minute
   *later*, i.e. the Cloudflare build landed on top of the Actions deploy.

## Why it matters, and why it matters less than it first appears

Two systems building the same Worker from the same commit should produce the
same bundle. They do not, because the Actions build injects two `VITE_` values
from repo secrets and a Cloudflare build cannot see GitHub secrets. So the
bundle in production depended on which deployer finished last.

Checked, one at a time, rather than assumed:

- **Push notifications: never at risk.** `src/lib/firebaseConfig.ts` has
  carried a literal fallback for `VAPID_PUBLIC_KEY` since #137. A build
  without `VITE_FIREBASE_VAPID_KEY` still ships a working key. The comment in
  `deploy.yml` saying push was dead without that secret describes the state
  *before* that fallback and is no longer current.
- **Error monitoring: genuinely at risk.** `src/main.tsx` read
  `VITE_SENTRY_DSN` with no fallback and guarded `Sentry.init()` on it, so a
  Cloudflare-built bundle had Sentry entirely inert — and an inert Sentry is
  indistinguishable from a healthy app from the outside. This is the one real
  consequence, and the commit alongside this file removes it by giving the DSN
  the same literal fallback as the Firebase config.

After that change, both deploy paths produce an equivalent bundle, so the
duplication is redundancy rather than a race with a wrong outcome.

## What is left, and who can do it

The duplication itself cannot be fixed from this repository — the Git
integration lives in the Cloudflare dashboard. Someone with dashboard access
should pick one path per Worker:

- **Keep Cloudflare, drop the Actions job.** Fewer moving parts, and branch
  preview URLs come free (they are genuinely useful — PR #188's redesign was
  reviewable at a real URL because of this). Costs the pinned Node and
  Wrangler versions the workflow guarantees; `deploy.yml`'s own comments
  record what version drift did to build reproducibility.
- **Keep Actions, disconnect the integration.** Keeps those pins and one
  auditable log. Loses the preview URLs.

Either is defensible. Two at once is not: `modified_on` stops identifying the
commit being served, and any future build-time input has to be configured in
two places or it will silently apply to only half the deploys.
