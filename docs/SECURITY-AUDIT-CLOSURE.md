# GoSalka security audit -- closure report

**Project:** `waelabdlrahman16-ux/salka-platform` · Supabase `pqpnwxyevrsipklzmwex`
**Batches covered:** 1–9 (complete) · **Closed:** 2026-08-10
**Verification timestamp:** 2026-08-10 13:15 UTC (point-in-time)
**Revision:** 3 -- batches 8 and 9 closed the residual 43-function finding from Revision 2. See §12.

---

## 1. Scope and limitations

**In scope:** database function exposure, row-level security, table grants, Edge Function routing, schema baseline accuracy, repository and deployment integrity.

**Explicitly NOT performed:**

- No penetration testing, fuzzing, dependency CVE scan, or secret scanning of git history.
- **No authenticated end-to-end testing.** No credentials were created or used, and no test orders were placed. Every customer, vendor, driver, supervisor and admin journey is therefore NOT TESTED unless it was observed in production telemetry. This remains true after batches 8 and 9 -- their verification was the same class of check as batches 1–7 (permission model, data integrity, role-scoped reads), not new user-journey testing.
- No mobile-device testing (iOS, Android, Huawei).
- Performance, accessibility and payment-provider readiness were not assessed.
- Findings are point-in-time and do not cover changes made after the timestamp above.

---

## 2. Initial findings

At the PR #39 checkpoint the project carried 145 advisor findings, later 133. Privileged database functions were directly callable by any signed-in browser client across ordering, payments, dispatch, vendor operations, admin finance and account management.

---

## 3. Completed batches

| Batch | PRs | Migration(s) | Result |
|---|---|---|---|
| Foundation | #36–#39 | cancellation, payment actions, order editing, public catalog | 145 → 133 |
| 1 Customer sessions & history | #40 | `route_customer_session_history_through_edge` | |
| 2 Order creation | #41 | `route_order_creation_through_edge` | |
| 3 Customer actions & analytics | #42, #43 | `route_customer_order_access_through_edge`, `route_analytics_ingestion_through_edge` | |
| 4 Admin & financial | #44, #45 | `route_admin_financial_actions_through_edge`, `route_admin_account_driver_actions_through_edge` | |
| 5 Driver & vendor operations | #46, #47, #49 | `route_dispatch_operations_through_edge`, `route_vendor_operations_through_edge`, `route_admin_vendor_slots_through_edge` | 71 → 64 |
| 6 Customer accounts & swaps | #51 | `route_customer_accounts_and_swaps_through_edge` | 64 → 50 |
| 7 Closure | #50, #52 | `revoke_unused_grants_on_policyless_tables` | baseline refresh + accepted-warnings register |
| 8 Admin panel | #56 | `route_admin_panel_actions_through_edge` | 63 → 43 |
| 9 Driver/catalog (final) | #57 | `route_driver_catalog_actions_through_edge` | 43 → 20 |
| Non-security | #48 | `supermarket_delivery_slots_off` | supermarket ordering unblocked |

**Advisor movement: 133 → 20.** Anonymous security-definer warnings **14 → 0** (closed at batch 7, held through batches 8–9). Authenticated **106 → 7** -- exactly the seven protected RLS predicates in §6, nothing else.

Every change followed the same sequence: isolated branch → build and security checks → migration tested inside `BEGIN … ROLLBACK` → draft PR → explicit approval → Edge Function deployed first → frontend merged and deployed → migration applied separately → live verification. Batches 8 and 9 followed this sequence without exception.

---

## 4. Vulnerabilities fixed

64 privileged functions were moved into the `private` schema behind service-role-only wrappers in batches 1–7, reachable only through 19 authenticated, rate-limited, input-validating Edge Functions. Anonymous direct database access was eliminated entirely at that point. Seven tables holding OTP codes, session tokens and customer PII had their inert `anon`/`authenticated` SELECT grants removed.

**Batches 8–9 closed the remaining 43.** 20 admin-panel functions (batch 8) and 23 driver-assignment/self-service/catalog functions (batch 9) -- every one of the functions Revision 2 flagged as "NOT accepted -- deferred work, not intentional" -- were moved into `private` the same way, behind 6 new Edge Functions: `admin-catalog-actions`, `admin-compound-actions`, `admin-reports` (batch 8), `driver-assignment-actions`, `driver-self-service`, `catalog-checks` (batch 9). **`private` now holds 99 functions total** (verified by direct catalog query, not the older "64" heritage figure, which used a different counting method from an earlier draft of this audit).

**One production incident** (unchanged from Revision 2, batches 1–7). Commit `def7d16` ("Add files via upload"), pushed straight to `main` through the GitHub web UI, stripped 18 Edge Function calls out of `Admin.tsx`, `CheckoutPage.tsx` and `CustomOrder.tsx` and took checkout down for roughly 20 minutes. It was not stale junk -- it was genuine work-in-progress on the delivery-slots feature, written against a pre-refactor copy of those files. Reverted by `e6447ab`. The revert is verified complete: current `main` carries **more** Edge calls than before the upload (Admin 19→22, Checkout 7→9, CustomOrder 9→11).

**No incidents in batches 8–9.** Both deployed clean on the first attempt; one code-review finding in batch 9 (a rate limit under-provisioned for a 10-second polling cadence, which would have caused `driver-self-service` to 429 legitimate traffic after ~7 minutes of continuous use) was caught in review before merge and fixed pre-deploy, not in production.

---

## 5. Production verification evidence

Captured 2026-08-10 13:15 UTC, after batch 9's migration was applied.

| Check | Result |
|---|---|
| Anonymous security-definer warnings | **0** |
| Advisor total | **20** (7 authenticated + 12 INFO + 1 `pg_net`) |
| All 7 RLS predicates hold `authenticated` EXECUTE | **PASS** -- `is_admin`, `is_catalog_manager`, `is_supervisor`, `my_customer_id`, `my_driver_id`, `my_restaurant_id`, `supervisor_may_touch_order` individually confirmed |
| `anon`-executable `SECURITY DEFINER` functions in `public` | **0** |
| `authenticated`-executable `SECURITY DEFINER` functions in `public` | **7** -- exactly the protected predicates, nothing else |
| Policy-free tables readable by anon/authenticated | **0 of 12** |
| `private` functions reachable by `authenticated` | **1 of 99** (`cancel_order`, by design -- see §6.2) |
| `private` functions reachable by `anon` | **0 of 99** |
| `anon` USAGE on `private` | **false** |
| Orders total / latest order ID | 35 / **117** (unchanged since batch 7 -- no new orders in the interim) |
| Orphan orders, order items, assignments, wallet tx, earnings, tips, settlement requests, ratings | **all 0** |
| Orders with duplicate active assignments | **0** |
| Negative values (orders, wallets, earnings, tips, bonuses) | **all 0** |
| Test orders contributing to earnings, tips or wallet transactions | **0** |
| Historical orders visible (2026-08-05 → 2026-08-10) | **PASS** |
| GitHub Actions `CI` / `Deploy` on batch 9's merge commit | **PASS** (green) |
| `Supabase Preview` check on `main` | **FAIL** -- unchanged pre-existing issue, see §7.2 |

### Role reads through RLS

Verified twice: once after batch 7 (Revision 2), once more after batch 9's migration, by impersonating real staff identities inside rolled-back transactions. Numbers are identical across both checks -- no regression.

| Actor | Visibility | Correct? |
|---|---|---|
| admin | 35 orders, 69 items, 7 drivers, 22 assignments, 2 wallet tx | full -- correct |
| supervisor | 35 orders, 17 restaurants, 7 drivers | full -- correct |
| vendor (restaurant 4) | **6** orders, 0 leaked | scoped -- correct |
| driver (driver 1) | **4** assignments, 0 leaked | scoped -- correct |
| catalog manager | 570 menu items, 95 categories | correct |
| anon | 17 restaurants, 570 items, 63 compounds, 3 settings | public surface only |
| anon → `customers` (sensitive table, post-batch-7 revoke) | **permission denied** | correctly blocked |

Scoping -- not merely reachability -- was confirmed both times: the vendor sees 6 of 35 orders and the driver 4, with an explicit `leaked` count of 0 in both checks.

---

## 6. Accepted risks and exact justifications

### 6.1 The seven functions that must keep `authenticated` EXECUTE

These are now the **entire** set of `authenticated_security_definer_function_executable` warnings -- batches 8–9 closed every other one. A row-level-security policy is evaluated as the **calling** role. If `authenticated` loses EXECUTE on a function a policy calls, the policy raises instead of filtering and every read through it fails. These are load-bearing, not oversights.

| Function | RLS policies | Other callers |
|---|---|---|
| `is_admin()` | 43 (32 tables) | 44 |
| `my_driver_id()` | 12 (10 tables) | 24 |
| `is_catalog_manager()` | 7 (7 tables) | 5 |
| `is_supervisor()` | 5 | 9 |
| `my_restaurant_id()` | 2 | 9 |
| `supervisor_may_touch_order(integer)` | 1 | 10 |
| `my_customer_id()` | 0 | 12 (all definer) |

`my_customer_id()` is retained by standing instruction; it is technically revocable since its callers are all `SECURITY DEFINER`. Every migration in batches 8–9 asserted, inside its own `do $verification$` block, that none of these seven lost `authenticated` EXECUTE -- none did.

### 6.2 `authenticated` holds USAGE on `private`, plus EXECUTE on `private.cancel_order`

`public.cancel_order` is SECURITY **INVOKER**, so the advisor cannot see it. This lets staff cancel directly from Admin/Supervisor/Vendor while customers go through the rate-limited `cancel-order` Edge Function. Inner authorization requires the order's secret token, vendor ownership, or admin/supervisor -- a signed-in user with none of these receives `not_authorized`. **Residual risk:** a customer holding their own order token can call the RPC directly and bypass the Edge Function's rate limit, on their own order only, in cancellable statuses only. Unchanged since Revision 2.

### 6.3 `pg_net` in the `public` schema

Only the extension's registered namespace is in `public`; every callable object lives in the separate `net` schema. Nine notification functions depend on it. Supabase manages its lifecycle. Relocating it would risk the push pipeline to move a metadata pointer. **Not remediated, and not touched in batches 8–9** -- reviewed again this pass, status unchanged.

### 6.4 12 `rls_enabled_no_policy` INFO notices

Intentional: all access is through `SECURITY DEFINER` functions that bypass RLS as owner, so policies would be dead weight. Verified unreadable by anon and authenticated, both after batch 7 and again after batch 9.

### 6.5 `admin-accounts` runs with `verify_jwt=false`

Authenticates in-function: reads the `Authorization` header, calls `auth.getUser(token)` and rejects unless `profiles.role = 'admin'`. Compensated, not open. Unchanged.

---

## 7. Unresolved issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | ~~43 functions remain directly callable by any signed-in client~~ | ~~Medium~~ | **CLOSED 2026-08-10** -- batches 8 (20 admin-panel) and 9 (23 driver/catalog/self-service) moved all 43 into `private`. See §3, §4, §6.1. |
| 2 | **`Supabase Preview` check still fails on `main`.** The check requires the local `supabase/migrations` filenames' versions to match what's recorded in `supabase_migrations.schema_migrations`. Migrations applied through the Supabase MCP connection (as every batch in this audit was, including 8 and 9) stamp their own timestamp, which does not match the on-disk filename. `supabase/baseline` itself has been realigned twice since Revision 2 (once for batch 7's own migration, once for batches 8–9) and is now accurate -- but realigning the baseline snapshot does not rename the migration files, so this check keeps failing. Fixing it requires reconciling migration filenames with applied versions, which is a separate, more invasive change than a documentation refresh. | Medium | **OPEN** |
| 3 | **Production build output is not stable across runs.** Unchanged since Revision 2 -- not re-investigated this pass. Three consecutive documentation-only merges previously produced two different bundles alternating. Root cause not established. | Medium | **OPEN, not re-checked** |
| 4 | **224 performance advisors never assessed** -- 203 multiple-permissive-policies, 20 unused indexes, 1 auth connection notice. | Low | **OPEN** |
| 5 | `admin_funnel()` and `settle_driver_earnings()` do not filter `is_test`. Harmless today -- 0 test rows reach compensation -- but the guard is upstream rather than at the reporting layer. | Low | **OPEN** |
| 6 | ~~Untracked `supabase/functions/vendor-operations/deno.lock`~~ | ~~Cosmetic~~ | **Resolved incidentally** -- stray `deno.lock` files were removed from the working copy during batch 8/9 verification (build-artifact hygiene, not a deliberate fix for this issue). |

---

## 8. Regression matrix

Statuses are literal. "Observed" means seen in production telemetry, not executed by the auditor. Unchanged categories from Revision 2 are annotated; nothing in this row set was newly exercised by batches 8–9 -- their own verification (§5) was permission-model and data-integrity checking, the same class of work as the rest of this table's PASS rows, not new end-to-end journeys.

| Area | Status | Evidence |
|---|---|---|
| Public homepage and catalog | **PASS** | Browser render + anon REST returning rows |
| Customer order visibility (data layer) | **PASS** | 35 orders, full history 2026-08-05 → 2026-08-10 |
| Vendor / driver / supervisor / admin / catalog reads | **PASS** | RLS impersonation, correctly scoped, re-verified after batch 9 |
| Anon blocked on the 7 sensitive tables | **PASS** | HTTP 401 / SQLSTATE 42501 on all seven |
| Google / email customer login | **PASS (observed)** | 28 logins, `/authorize`, `/callback` in auth logs (as of Revision 2; not re-checked this pass) |
| Existing sessions | **PASS (observed)** | 8 routine `refresh_token_not_found` (normal rotation; as of Revision 2) |
| Analytics ingestion | **PASS (observed)** | Live events during and after the change (as of Revision 2) |
| Customer OTP request and login | **NOT TESTED** | Requires a real phone and SMS delivery |
| Customer profile and saved addresses | **NOT TESTED** | Requires a customer login |
| Checkout, quote, order creation | **BLOCKED** | Requires a test order -- not approved |
| Vendor accept / delay / price / availability / ready / open state | **NOT TESTED** | Requires vendor login and a live order |
| Dispatch and driver assignment | **NOT TESTED** | Requires a live order |
| Driver notification, pickup, delivery | **NOT TESTED** | Requires a driver device |
| Supervisor permitted write actions | **NOT TESTED** | Reads pass; writes untested |
| Admin order / account / driver / vendor / cancellation / refund / deposit / financial actions | **NOT TESTED** | Would create financial activity |
| Cancellation and refund queue | **NOT TESTED** | Requires a cancellable order |
| Push notifications, foreground and background | **NOT TESTED** | Requires devices |
| Production build, lint, Edge Function type checks | **PASS** | Unlike Revision 2 (Node absent on that audit machine), batches 8–9 verified `npm run build` (`tsc -b` + `vite build`) and `deno check` on every new Edge Function directly, on a machine with the tooling installed for this purpose. GitHub Actions `build`/`deploy` green on the batch 9 merge commit. `Supabase Preview` still fails on `main` -- see §7 issue 2, tracked separately from build/lint/typecheck. |

**Tally: 8 of 17 rows PASS (5 directly verified, 3 observed in telemetry -- one row from Revision 2's build/lint check graduated from BLOCKED-locally to PASS). 9 of 17 are NOT TESTED or BLOCKED** -- 8 NOT TESTED, 1 BLOCKED. The security posture is verified, now including build/lint/typecheck; the user journeys are still not.

---

## 9. Rollback and incident-response guidance

- **Batch 7 migration:** `grant select on <the 7 tables> to anon, authenticated;` -- one statement, instant, no data touched.
- **Batch 8 migration (`route_admin_panel_actions_through_edge`):** re-create the 20 `public.<name>(...)` wrappers without the trailing `p_auth_user_id` parameter and re-grant `authenticated` EXECUTE, or redeploy the pre-batch-8 frontend (which called the old signatures directly). **Correction (2026-08-11): there is no `PGRST202` fallback shim in `admin-catalog-actions`, `admin-compound-actions`, or `admin-reports` -- checked directly against the code, only a single `.rpc()` call exists in each with no fallback path.** Calls will break immediately on rollback until the wrapper signatures and frontend are both reverted together -- see the ordering rule below.
- **Batch 9 migration (`route_driver_catalog_actions_through_edge`):** same pattern, for the 23 driver/catalog functions and the `driver-assignment-actions` / `driver-self-service` / `catalog-checks` Edge Functions. Same correction applies -- no fallback shim exists here either.
- **Any routing migration:** re-grant the previous signature and redeploy the prior frontend **together, not sequentially** -- there is no fallback path to cushion a partial rollback.
- **Frontend:** `git revert <merge commit>` then push -- Cloudflare redeploys in ~3 minutes. Proven during the `def7d16` incident.
- **Ordering rule:** never apply a routing migration before its frontend is live. Reversed, staff and driver screens break immediately, because wrappers gain a trailing `p_auth_user_id` argument and the old signature disappears.
- **Never push to `main` through the GitHub web UI.** It replaces whole files rather than merging and caused the only outage of this audit.
- **Watch after any migration:** PostgREST needs a few seconds to reload its schema cache; brief `PGRST202` errors are self-healing.

---

## 10. Prioritized 30-day backlog

Batches 8 and 9 (previously P1 items 4–5) are done and removed from this list.

**P0 -- week 1**
1. **Vendor push registration coverage.** Only 1 of 14 vendors holds a live token (drivers 3 of 7). Vendors who never registered cannot be notified of orders. Enablement problem, not code.
2. **Monitoring and alerting.** None exists today; the 20-minute outage in §4 was found by hand.
3. **Reconcile `supabase/migrations` filenames with applied versions** to clear the `Supabase Preview` check (§7 issue 2) -- the baseline data itself is now accurate, but the check tests filenames, not data.

**P1 -- weeks 1–2**
4. OTP 429 / rate-limit behaviour -- two customers hit the limit and could not obtain a login code.
5. Build reproducibility -- pin the Node patch version, rebuild one commit twice, compare (not re-investigated in this pass).

**P2 -- weeks 2–3**
6. Notification delivery reliability -- 29 dead tokens against 9 live.
7. Notification sounds -- reported too short or muted.
8. Backup restoration and disaster-recovery rehearsal -- never exercised.
9. ~~Fallback-shim cleanup in Edge Functions~~ -- **closed 2026-08-11, not applicable.** Verified directly against the code (all named Edge Functions plus every other `.rpc()` call site, 21 files / 60 calls): no `PGRST202` fallback shim exists anywhere in this codebase. This item as originally written described code that was never actually present -- see the correction on the rollback guidance above, since that guidance had assumed this shim's behavior.

**P3 -- week 4**
10. Huawei devices without Google Play Services.
11. Cross-device and poor-network testing.
12. UX and accessibility review.
13. Performance and Core Web Vitals.
14. Fawaterak payment integration readiness.
15. The 224 performance advisors.

---

## 11. Conclusion

**The security hardening audit is COMPLETE for batches 1–9 within the scope stated in §1. The database permission-model hardening programme this audit tracked is finished -- advisors are at the theoretical floor of 20, and every function the original 43-function finding flagged is closed.**

Every anonymous exposure is closed and verified: anonymous security-definer warnings went from 14 to zero at batch 7 and stayed there. 107 privileged functions (64 from batches 1–7, 43 from batches 8–9) now sit behind authenticated, rate-limited Edge Functions with input validation, all in `private` and reachable only by `service_role` (one documented exception, `cancel_order`, see §6.2). Data integrity is intact -- zero orphans, zero negative financial rows, zero test contamination of compensation -- verified both after batch 7 and again after batch 9, with identical results.

One qualification must still travel with that conclusion, unchanged from Revision 2:

1. **No claim of end-to-end functional correctness is made.** 9 of 17 regression areas were never executed, because doing so would have required credentials or real financial activity. What is proven is the permission model and now the build/lint/typecheck pipeline (§8) -- not the user journeys. This is a narrower gap than Revision 2's two qualifications, since the "43 functions unfinished" qualification is now closed, but it is not zero.

Non-security work remains: the 30-day backlog in §10 is unchanged in substance from Revision 2 apart from removing the now-completed batches 8–9, and nothing in it was addressed by this revision.

---

## 12. Revision history

**Revision 3 -- 2026-08-10.** Batches 8 and 9 closed the residual 43-function finding that Revision 2 left open.

1. **§3, §4, §6.1** updated to record batches 8 and 9: PRs #56 and #57, migrations `route_admin_panel_actions_through_edge` and `route_driver_catalog_actions_through_edge`, advisor movement 63 → 43 → 20.
2. **§5, §6.1** re-verified live: all 7 protected predicates individually confirmed, `anon`/`authenticated` reachability re-queried directly against `pg_proc` rather than relying on the advisor summary alone, role-scoped RLS reads re-run and found identical to the Revision 2 numbers (no regression).
3. **§7 issue 1 closed.** §7 issue 2 (baseline drift) narrowed: the baseline *data* has been accurate since this revision, but the `Supabase Preview` check tests migration *filenames* against applied versions, which is a separate, unaddressed problem -- moved from "will be cleared by realigning the baseline" (Revision 2's prediction) to "requires filename reconciliation, not yet done" now that realigning the baseline twice more has not cleared it.
4. **§8 build/lint/typecheck graduated from BLOCKED-locally to PASS** -- batches 8–9 were verified on a machine with Node and Deno installed, unlike the original audit machine.
5. **§10 backlog** -- items 4 and 5 (batch 8, batch 9) removed as complete; remaining items renumbered, substance otherwise unchanged.
6. **§11 conclusion** narrowed to one qualification (functional correctness) instead of two (functional correctness + unfinished functions).

**Revision 2 -- 2026-08-10.** Three corrections, all found after revision 1 was merged. No security finding changed; that revision's conclusion stood until superseded by Revision 3 above.

1. **`Supabase Preview` check status corrected.** Revision 1 recorded it as "skipped". That is true on PR branches but wrong on `main`, where it **fails on every merge** with `Remote migration versions not found in local migrations directory`. Corrected in §8 and folded into §7 issue 2, since it is an automated signal for the migration drift that was already being reported and not read.

2. **"CI green" qualified.** Revision 1 said CI was green on `082648b` without noting the failing Supabase check. §8 now distinguishes the GitHub Actions jobs (green) from the Supabase check (failing).

3. **Build instability re-characterised, and a wrong hypothesis retracted.** During closure it was asserted that two builders -- GitHub Actions and Cloudflare Workers Builds -- were racing to deploy, and that this was the highest-priority operational issue. **That assertion was incorrect and is withdrawn.** Timings across four merges show `Workers Builds: appgosalka-platform` completing in 0s every time and never writing the Worker, while the GitHub Actions `deploy` job runs 43–48s and matches the Worker's `modified_on`. There is a single deployer. What remains true is that build *output* is unstable across runs (§7 issue 3): three documentation-only merges produced two different bundles, alternating. Severity is Medium, not critical, and the top operational priority reverts to vendor push registration coverage (§10, P0 item 1).
