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

## Recommendation (2026-08-22)

**Disconnect the Git integration for `appgosalka-platform`. Keep it for
`gosalka-landing`. Keep the Actions job for both.**

What changed since the section above was written: `npm run check:quote-state`
became a CI gate, alongside `build` and `lint`, and `smoke-order` places a real
order on every pull request. That reframes the choice. The two paths are no
longer "equivalent with different pins" — one of them runs the gates and one of
them does not:

- `deploy.yml` runs on push to `main`, but the gates run in `ci.yml` and a
  human reads them on the PR before merging.
- Cloudflare Workers Builds deploys whatever lands on the branch, on its own,
  regardless of what CI concluded. A `main` that is red still ships.

That is the argument that was missing before. The gates are cheap and they have
already earned their keep — the retired `confirmPrice` path bricked a live order
precisely because a check nobody ran was the only thing that knew about it. A
deploy path that cannot see those checks should not be the one serving the app.

The split keeps what the integration is actually good for. `gosalka-landing` is
hand-written static HTML with no build inputs and no gates that apply to it, and
its branch preview URLs are how the landing page gets reviewed at all — PR #192's
photography was unreviewable from inside a sandbox without one. Nothing is lost
by leaving that Worker connected, and the previews stay.

**Steps** (dashboard only — this cannot be done from the repository):
Cloudflare dashboard → Workers & Pages → `appgosalka-platform` → Settings →
Build → disconnect the Git repository. Leave `gosalka-landing` as it is. After
that, `Current Version ID` in the `deploy.yml` log is once again the only thing
that put code in front of customers.

## Done, 2026-08-22

The Git integration for `appgosalka-platform` was disconnected in the Cloudflare
dashboard. `gosalka-landing` stays connected, so the landing page keeps its
branch preview URLs.

From here, `deploy.yml` is the only thing that puts the app in front of
customers, and `Current Version ID` in its log is once again a truthful record
of what is being served. The check to watch for on a pull request is that
`Workers Builds: appgosalka-platform` no longer appears while
`Workers Builds: gosalka-landing` still does.

If a future change needs a build-time input (an env var, a key), it now has
exactly one place to be configured: `deploy.yml`.
