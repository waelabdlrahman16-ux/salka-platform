# Accepted security-advisor warnings

Captured 2026-08-09, updated 2026-08-10 after batches 8 and 9 closed the 43-function finding below. Every claim in this file was verified against production by query, not assumed.

Advisor total as of 2026-08-10: **20** — 7 `authenticated_security_definer_function_executable` (exactly the seven protected predicates in §1, nothing else), 12 `rls_enabled_no_policy` (INFO), 1 `extension_in_public`. This is the theoretical floor: every function this file once listed as "NOT accepted" is now closed. See §5.

---

## 1. Functions that MUST keep `authenticated` EXECUTE

A row-level-security policy is evaluated as the **calling** role. If `authenticated` loses EXECUTE on a function a policy calls, the policy raises instead of filtering and every read through it fails. These are load-bearing, not oversights.

| Function | RLS policies | Tables that break if revoked | Other functions calling it |
|---|---|---|---|
| `public.is_admin()` | **43** | app_events, banned_customers, banners, complaints, compounds, customer_wallets, delivery_assignments, delivery_slots, discounts, driver_device_log, driver_earnings, driver_settlements, driver_tips, drivers, menu_categories, menu_item_addon_groups, menu_item_addons, menu_item_combos, menu_item_sizes, menu_items, order_items, order_ratings, orders, regions, restaurants, settings, settlement_requests, shift_swap_requests, shifts, vendor_addon_library, vendor_coverage, wallet_transactions | 44 |
| `public.my_driver_id()` | **12** | delivery_assignments, driver_earnings, driver_settlements, driver_tips, drivers, order_items, orders, settlement_requests, shift_swap_requests, shifts | 24 |
| `public.is_catalog_manager()` | **7** | menu_categories, menu_item_addon_groups, menu_item_addons, menu_item_combos, menu_item_sizes, menu_items, vendor_addon_library | 5 |
| `public.is_supervisor()` | 5 | compounds, delivery_assignments, drivers, order_items, restaurants | 9 |
| `public.my_restaurant_id()` | 2 | order_items, orders | 9 |
| `public.supervisor_may_touch_order(integer)` | 1 | orders | 10 |

`public.my_customer_id()` is also protected by standing instruction. It appears in **0** RLS policies; its 12 callers are all `SECURITY DEFINER` and therefore execute as owner, so it is technically revocable. It is retained deliberately, on a different justification from the six above.

**Any migration that narrows grants must assert all seven still hold `authenticated` EXECUTE.**

## 2. `pg_net` in the public schema — accepted

- Supabase-managed extension, version 0.20.4, registered in `public`.
- Every callable object lives in a separate **`net`** schema: `net.http_post`, `net.http_get`, `net.http_delete`, `net.http_collect_response`, `net.http_request_queue`, `net._http_response` and others. Nothing in this codebase references `public.http_*`.
- Nine functions depend on it: `push_send`, `notify_admin`, `notify_new_order`, `notify_new_order_for`, `notify_order_status_change`, `notify_order_delivered_receipt`, `notify_driver_order_ready`, `notify_driver_assignment_change`, `notify_customer_driver_arrived`.

Only the extension's registered namespace is in `public`; no callable surface is. Relocating it would risk the entire push and notification pipeline to move a metadata pointer, and Supabase owns this extension's lifecycle. **Accepted, not remediated.**

## 3. `private` schema USAGE for `authenticated` — accepted, documented

`authenticated` holds USAGE on `private` and EXECUTE on exactly one function there: `private.cancel_order`. All other 98 private functions (56 at batch 7, +43 from batches 8-9) are revoked from `authenticated`. `anon` has no USAGE at all.

This is deliberate. `public.cancel_order` is **SECURITY INVOKER** and delegates to `private.cancel_order`, which is how staff cancel directly from the Admin, Supervisor and Vendor screens while customers go through the rate-limited `cancel-order` Edge Function.

Because the wrapper is invoker rather than definer, the advisor never flags it. Authorization is enforced inside:

```sql
if not ( (p_token is not null and p_token = v_public_token)
         or v_is_vendor or v_is_admin ) then
  raise exception 'not_authorized';
```

An authenticated user with neither the order's secret token nor a staff role is refused. **Residual risk:** a customer holding their own order token can call the RPC directly and bypass the Edge Function's rate limit. Scope is limited to their own order, in cancellable statuses only. Accepted for now; closing it means giving staff cancellation its own Edge Function route.

## 4. Twelve `rls_enabled_no_policy` tables — INFO, verified not leaking

RLS is enabled with zero policies, which denies every row to `anon` and `authenticated`. Confirmed empirically: each of the seven that still carried a SELECT grant was queried through PostgREST as a real anonymous client and returned `[]`.

Batch 7 revokes the pointless SELECT grants on those seven. The remaining five never had them.

| Table | anon/auth SELECT before batch 7 |
|---|---|
| customers, customer_sessions, customer_otp_codes, customer_addresses, order_status_events, driver_shift_bonuses, request_item_suppressions | granted (inert) — **revoked by batch 7** |
| _mcd_menu_backup_20260806, dead_push_tokens, push_nudge, push_send_log, rate_limit_log | already none |

The tables stay policy-free by design: all access is through `SECURITY DEFINER` functions, which bypass RLS as owner. The INFO notices remain after batch 7 and are accepted.

`_mcd_menu_backup_20260806` is a dead 76-row menu backup. Dropping it is a data deletion and is deliberately **not** part of batch 7.

---

## 5. CLOSED 2026-08-10 — the 43-function finding from batches 8 and 9

This section originally listed 43 functions with **0 RLS policies and 0 internal callers** as deferred, not-accepted work. All 43 are now moved into `private` behind service-role-only wrappers, following the same pattern as batches 1–7. Both batches followed the full rollout sequence (Edge Function deployed first, frontend merged second, migration applied separately) and were verified live: `anon` executes zero `SECURITY DEFINER` functions in `public`, `authenticated` executes exactly the seven in §1, data integrity and role-scoped reads all matched the pre-migration baseline with zero leakage.

- **Admin panel (20) — batch 8, PR #56, migration `route_admin_panel_actions_through_edge`:** admin_add_menu_category, admin_customer_detail, admin_customers, admin_daily_report, admin_delete_menu_category, admin_delete_menu_item, admin_flag_driver_dispute, admin_funnel, admin_list_accounts, admin_live_deliveries, admin_pending_refunds, admin_push_health, admin_rename_menu_category, admin_reorder_menu_categories, admin_set_compound_fee, admin_set_restaurant_rank, admin_set_vendor_hours, admin_stalled_orders, admin_upsert_compound, admin_vendors_without_items
- **Driver assignment, self-service, catalog and misc (23) — batch 9, PR #57, migration `route_driver_catalog_actions_through_edge`:** apply_library_addon, available_orders, check_discount_conflict, claim_order, clear_my_location, driver_accept_assignment, driver_arrived_at_customer, driver_arrived_at_restaurant, driver_called_customer, driver_claim_device, driver_confirm_cash_received, driver_mark_out_for_delivery, driver_mark_picked_up, driver_reject_assignment, driver_report_no_answer, driver_report_problem, driver_set_available, mark_delivered, my_driver_stats, restaurant_reliability, restaurants_reliability_all, save_my_push_token, update_my_location

The advisor floor for this project is **7** (the protected predicates in §1) plus the 12 INFO notices in §4 plus the 1 accepted `pg_net` warning in §2 — **20 total**, and that is exactly what production shows as of this capture. There is no more deferred work from the original audit.

## Correction (2026-08-11)

The `PGRST202` compatibility shim described below does not exist in the codebase. Checked every Edge Function named in this document plus all other `.rpc()` call sites (21 files, 60 calls) — each does a single `.rpc()` call with error-message matching against a `KNOWN` allowlist, never a second/fallback `.rpc()` call gated on an error code. This item is closed as not applicable; nothing to clean up.
