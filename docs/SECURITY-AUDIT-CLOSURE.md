# GoSalka security audit — closure report

**Project:** `waelabdlrahman16-ux/salka-platform` · Supabase `pqpnwxyevrsipklzmwex`
**Batches covered:** 1–7 · **Closed:** 2026-08-10
**Verification timestamp:** 2026-08-09 23:40 UTC (point-in-time)

---

## 1. Scope and limitations

**In scope:** database function exposure, row-level security, table grants, Edge Function routing, schema baseline accuracy, repository and deployment integrity.

**Explicitly NOT performed:**

- No penetration testing, fuzzing, dependency CVE scan, or secret scanning of git history.
- **No authenticated end-to-end testing.** No credentials were created or used, and no test orders were placed. Every customer, vendor, driver, supervisor and admin journey is therefore NOT TESTED unless it was observed in production telemetry.
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
| Non-security | #48 | `supermarket_delivery_slots_off` | supermarket ordering unblocked |

**Advisor movement: 133 → 63.** Anonymous security-definer warnings **14 → 0**. Authenticated **106 → 50**.

Every change followed the same sequence: isolated branch → build and security checks → migration tested inside `BEGIN … ROLLBACK` → draft PR → explicit approval → Edge Function deployed first → frontend merged and deployed → migration applied separately → live verification.

---

## 4. Vulnerabilities fixed

64 privileged functions were moved into the `private` schema behind service-role-only wrappers, reachable only through 19 authenticated, rate-limited, input-validating Edge Functions. Anonymous direct database access was eliminated entirely. Seven tables holding OTP codes, session tokens and customer PII had their inert `anon`/`authenticated` SELECT grants removed.

**One production incident.** Commit `def7d16` ("Add files via upload"), pushed straight to `main` through the GitHub web UI, stripped 18 Edge Function calls out of `Admin.tsx`, `CheckoutPage.tsx` and `CustomOrder.tsx` and took checkout down for roughly 20 minutes. It was not stale junk — it was genuine work-in-progress on the delivery-slots feature, written against a pre-refactor copy of those files. Reverted by `e6447ab`. The revert is verified complete: current `main` carries **more** Edge calls than before the upload (Admin 19→22, Checkout 7→9, CustomOrder 9→11).

---

## 5. Production verification evidence

Captured 2026-08-09 23:40 UTC.

| Check | Result |
|---|---|
| Anonymous security-definer warnings | **0** |
| Advisor total | 63 (50 authenticated + 12 INFO + 1 `pg_net`) |
| All 7 RLS predicates hold `authenticated` EXECUTE | **PASS** |
| Policy-free tables readable by anon/authenticated | **0 of 12** |
| Service-role-only wrappers leaking to anon/authenticated | **0 of 54** |
| `private` functions reachable by `authenticated` | 1 (`cancel_order`, by design) |
| `anon` USAGE on `private` | **false** |
| Orders total / latest order ID | 35 / **117** |
| Orphan orders, order items, assignments, wallet tx, earnings, tips, settlement requests, ratings | **all 0** |
| Orders with duplicate active assignments | **0** |
| Negative values (orders, wallets, earnings, tips, settlements, bonuses) | **all 0** |
| Catalog order total arithmetic mismatches | **0** |
| Test orders contributing to earnings, tips or wallet transactions | **0** |
| Historical orders visible (2026-08-05 → 2026-08-09) | **PASS** |

### Role reads through RLS

Verified by impersonating real staff identities inside a rolled-back transaction.

| Actor | Visibility | Correct? |
|---|---|---|
| admin | 35 orders, 69 items, 7 drivers, 22 assignments, 2 wallet tx | full — correct |
| supervisor | 35 orders, 69 items, 7 drivers, 17 restaurants | full — correct |
| vendor (restaurant 4) | **6** orders, **27** items | scoped — correct |
| driver (driver 1) | **4** assignments, 4 orders, 1 earning | scoped — correct |
| catalog manager | 570 menu items, 95 categories | correct |
| anon | 17 restaurants, 570 items, 63 compounds, 3 settings | public surface only |

Scoping — not merely reachability — was confirmed: the vendor sees 6 of 35 orders and the driver 4.

---

## 6. Accepted risks and exact justifications

1. **50 authenticated security-definer warnings.** Only **7** are load-bearing and must keep `authenticated` EXECUTE, because RLS policies are evaluated as the calling role:

   | Function | RLS policies | Other callers |
   |---|---|---|
   | `is_admin()` | 43 (32 tables) | 44 |
   | `my_driver_id()` | 12 (10 tables) | 24 |
   | `is_catalog_manager()` | 7 (7 tables) | 5 |
   | `is_supervisor()` | 5 | 9 |
   | `my_restaurant_id()` | 2 | 9 |
   | `supervisor_may_touch_order(integer)` | 1 | 10 |
   | `my_customer_id()` | 0 | 12 (all definer) |

   `my_customer_id()` is retained by standing instruction; it is technically revocable since its callers are all `SECURITY DEFINER`. **The other 43 warnings are NOT accepted — see §7.**

2. **`authenticated` holds USAGE on `private`, plus EXECUTE on `private.cancel_order`.** `public.cancel_order` is SECURITY **INVOKER**, so the advisor cannot see it. This lets staff cancel directly from Admin/Supervisor/Vendor while customers go through the rate-limited `cancel-order` Edge Function. Inner authorization requires the order's secret token, vendor ownership, or admin/supervisor — a signed-in user with none of these receives `not_authorized`. **Residual risk:** a customer holding their own order token can call the RPC directly and bypass the Edge Function's rate limit, on their own order only, in cancellable statuses only.

3. **`pg_net` in the `public` schema.** Only the extension's registered namespace is in `public`; every callable object lives in the separate `net` schema. Nine notification functions depend on it. Supabase manages its lifecycle. Relocating it would risk the push pipeline to move a metadata pointer. **Not remediated.**

4. **12 `rls_enabled_no_policy` INFO notices.** Intentional: all access is through `SECURITY DEFINER` functions that bypass RLS as owner, so policies would be dead weight. Verified unreadable by anon and authenticated.

5. **`admin-accounts` runs with `verify_jwt=false`** but authenticates in-function: it reads the `Authorization` header, calls `auth.getUser(token)` and rejects unless `profiles.role = 'admin'`. Compensated, not open.

---

## 7. Unresolved issues

| # | Issue | Severity |
|---|---|---|
| 1 | **43 functions remain directly callable** by any signed-in client — 20 admin panel, 17 driver self-service, 2 catalog, 4 misc. All have 0 RLS policies and 0 internal callers. **Unfinished, not intentional.** Needs batches 8–9. | Medium |
| 2 | **`supabase/baseline` does not match live.** `migration-history.json` has 309 entries vs 312 live; `public-tables.json` still records the 7 tables as anon-readable. The snapshot was taken before batch 7's own migration was applied. | Medium |
| 3 | **Production build is not byte-reproducible.** A documentation-only merge changed the bundle by −77,858 bytes. Verified functionally equivalent (same 19 chunks, all endpoints and libraries present, no console errors); cause not established. | Medium |
| 4 | **224 performance advisors never assessed** — 203 multiple-permissive-policies, 20 unused indexes, 1 auth connection notice. | Low |
| 5 | `admin_funnel()` and `settle_driver_earnings()` do not filter `is_test`. Harmless today — 0 test rows reach compensation — but the guard is upstream rather than at the reporting layer. | Low |
| 6 | Untracked `supabase/functions/vendor-operations/deno.lock` in the working copy. | Cosmetic |

---

## 8. Regression matrix

Statuses are literal. "Observed" means seen in production telemetry, not executed by the auditor.

| Area | Status | Evidence |
|---|---|---|
| Public homepage and catalog | **PASS** | Browser render + anon REST returning rows |
| Customer order visibility (data layer) | **PASS** | 35 orders, full history 2026-08-05 → 2026-08-09 |
| Vendor / driver / supervisor / admin / catalog reads | **PASS** | RLS impersonation, correctly scoped |
| Anon blocked on the 7 sensitive tables | **PASS** | HTTP 401 / SQLSTATE 42501 on all seven |
| Google / email customer login | **PASS (observed)** | 28 logins, `/authorize`, `/callback` in auth logs |
| Existing sessions | **PASS (observed)** | 8 routine `refresh_token_not_found` (normal rotation) |
| Analytics ingestion | **PASS (observed)** | Live events during and after the change |
| Customer OTP request and login | **NOT TESTED** | Requires a real phone and SMS delivery |
| Customer profile and saved addresses | **NOT TESTED** | Requires a customer login |
| Checkout, quote, order creation | **BLOCKED** | Requires a test order — not approved |
| Vendor accept / delay / price / availability / ready / open state | **NOT TESTED** | Requires vendor login and a live order |
| Dispatch and driver assignment | **NOT TESTED** | Requires a live order |
| Driver notification, pickup, delivery | **NOT TESTED** | Requires a driver device |
| Supervisor permitted write actions | **NOT TESTED** | Reads pass; writes untested |
| Admin order / account / driver / vendor / cancellation / refund / deposit / financial actions | **NOT TESTED** | Would create financial activity |
| Cancellation and refund queue | **NOT TESTED** | Requires a cancellable order |
| Push notifications, foreground and background | **NOT TESTED** | Requires devices |
| Production build, lint, Edge Function type checks | **BLOCKED locally / PASS in CI** | Node absent on the audit machine; CI green on `082648b` |

**Tally: 7 of 18 rows PASS (4 directly verified, 3 observed in telemetry). 11 of 18 are NOT TESTED or BLOCKED** — 9 NOT TESTED, 1 BLOCKED, 1 BLOCKED locally but green in CI. The security posture is verified; the user journeys are not.

---

## 9. Rollback and incident-response guidance

- **Batch 7 migration:** `grant select on <the 7 tables> to anon, authenticated;` — one statement, instant, no data touched.
- **Any routing migration:** re-grant the previous signature or redeploy the prior frontend. The `PGRST202` fallback shim keeps calls working mid-rollback.
- **Frontend:** `git revert <merge commit>` then push — Cloudflare redeploys in ~3 minutes. Proven during the `def7d16` incident.
- **Ordering rule:** never apply a routing migration before its frontend is live. Reversed, staff screens break immediately, because wrappers gain a trailing `p_auth_user_id` argument and the old signature disappears.
- **Never push to `main` through the GitHub web UI.** It replaces whole files rather than merging and caused the only outage of this audit.
- **Watch after any migration:** PostgREST needs a few seconds to reload its schema cache; brief `PGRST202` errors are self-healing.

---

## 10. Prioritized 30-day backlog

**P0 — week 1**
1. **Vendor push registration coverage.** Only 1 of 14 vendors holds a live token (drivers 3 of 7). Vendors who never registered cannot be notified of orders. Enablement problem, not code.
2. **Realign `supabase/baseline`** with live (issue #2 above).
3. **Monitoring and alerting.** None exists today; the 20-minute outage was found by hand.

**P1 — weeks 1–2**
4. Batch 8 — 20 admin-panel functions behind an Edge Function.
5. Batch 9 — 17 driver self-service + 2 catalog + 4 misc functions.
6. OTP 429 / rate-limit behaviour — two customers hit the limit and could not obtain a login code.
7. Build reproducibility — pin the Node patch version, rebuild one commit twice, compare.

**P2 — weeks 2–3**
8. Notification delivery reliability — 29 dead tokens against 9 live.
9. Notification sounds — reported too short or muted.
10. Backup restoration and disaster-recovery rehearsal — never exercised.
11. Fallback-shim cleanup in 11 Edge Functions — the `PGRST202` path can no longer succeed and turns a transient cache miss into a misleading "permission denied".

**P3 — week 4**
12. Huawei devices without Google Play Services.
13. Cross-device and poor-network testing.
14. UX and accessibility review.
15. Performance and Core Web Vitals.
16. Fawaterak payment integration readiness.
17. The 224 performance advisors.

---

## 11. Conclusion

**The security hardening audit is COMPLETE for batches 1–7 within the scope stated in §1. The platform's security hardening programme is NOT complete.**

Every anonymous exposure is closed and verified: anonymous security-definer warnings went from 14 to zero. 64 privileged functions now sit behind authenticated, rate-limited Edge Functions with input validation. Data integrity is intact — zero orphans, zero negative financial rows, zero test contamination of compensation.

Two qualifications must travel with that conclusion:

1. **43 functions remain directly callable by any signed-in client.** The original seven-batch plan labelled the residual warnings "intentional"; testing every one against every RLS policy and function body shows only 7 are. The other 43 carry internal role checks — so this is defence-in-depth rather than an open door — but the work is unfinished, not accepted. Batches 8 and 9 should be scheduled.

2. **No claim of end-to-end functional correctness is made.** 11 of 18 regression areas were never executed, because doing so would have required credentials or real financial activity. What is proven is the permission model, not the user journeys.
