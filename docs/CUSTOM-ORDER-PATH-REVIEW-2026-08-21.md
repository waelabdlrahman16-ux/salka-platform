# هنجبلك (custom_request): every path, and every thing that stops one

Written after order #1000 could be neither priced nor dispatched for most of an
evening, for three unrelated reasons in a row. Each refusal was correct. None of
them said anything a person could act on.

## The path, as it actually runs

```
  customer submits          submit_custom_order
                            status = awaiting_quote, pricing_status = pending_quote
                            quote_state = 'pending'        <- set by a trigger, always
        |
  staff put a price on it   TWO DIFFERENT MECHANISMS EXIST -- see below
        |
  customer accepts          accept_custom_order_quote
                            quote_state = 'accepted'
        |
  dispatch                  admin_assign_order
                            guard_custom_order_quote_dispatch refuses unless accepted
        |
  fulfilment                guard_custom_order_quote_fulfilment refuses the same way
```

## The trap: two pricing mechanisms, only one of which unblocks dispatch

| | `confirm_custom_order_price` | `issue_custom_order_quote` |
|---|---|---|
| reached from | vendor-operations `confirmPrice` — the button in `src/pages/Admin.tsx` | `quote-operations` — **not in this repository** |
| sets `subtotal`, `service_fee` | yes | no, snapshots them onto a quote row |
| sets `pricing_status = 'confirmed'` | yes | no |
| sets `quote_state` | **no** | yes, `'offered'` |
| leaves the order dispatchable | **no** | only once the customer accepts |

`initialize_order_quote_state` sets `quote_state = 'pending'` on **every** new
custom order. `guard_custom_order_quote_dispatch` refuses any assignment while
`quote_state` is neither null nor `'accepted'`. Together those mean:

> **Pricing a هنجبلك order through the Admin portal button alone can never make
> it dispatchable.** It sets a price, leaves `quote_state` at `'pending'`, and
> every driver is refused afterwards with a message about nothing.

That is exactly what happened to #1000: priced at 21:21, then every driver
refused, with `حصل خطأ، جرب تاني` on screen.

The data agrees. Of 108 custom orders:

| `quote_state` | orders | ever assigned |
|---|---|---|
| `null` (predate the quote system) | 80 | 76 delivered |
| `accepted` | 2 | 2 delivered — **the quote flow does work end to end** |
| `expired` | 2 | 0 |
| `offered` | 1 | 0 (#1000) |
| `pending` | 24 | 0 — all cancelled, none ever priced |

The 76 that delivered are all from before the trigger existed. Since it landed,
**the only custom orders that have reached a customer are the two that went
through an accepted quote.**

## Every blocker, what raises it, and what to do

### Submitting
| code | raised when | staff action |
|---|---|---|
| `not_a_custom_order_vendor` | restaurant's `order_mode` is not `custom_request` | wrong vendor |
| `restaurant_closed` | `vendor_is_open_now` false | wait, or open the vendor |
| `compound_missing_distance` / `compound_missing_fee` | compound has no GPS or no fee | fix the compound |
| `empty_order` | no items and no prescription | nothing to price |
| `invalid_promo_code`, `promo_*` | code checked at submit, before a price exists | tell the customer |
| `slot_full`, `slot_unavailable` | scheduled slot | pick another slot |

### Pricing
| code | raised when | staff action |
|---|---|---|
| `not_authorized` | not a supervisor or admin | pricing is staff-only |
| `invalid_amount` | subtotal null or negative | retype |
| `order_not_found` | not a `custom_request` | wrong order |
| `order_closed` | cancelled | nothing to do |
| `quote_not_pending` | issuing over a quote already accepted | it is already agreed |
| `quote_requires_admin_approval` | total over `quote_admin_approval_ceiling_egp` (**3000**) | an admin must issue it |

### Dispatch — `admin_assign_order`, in the order it checks
| code | raised when |
|---|---|
| `admin_only` | not supervisor/admin for this order |
| `order_not_found` / `order_closed` | delivered or cancelled |
| `order_not_paid` | status is `awaiting_payment` — a COD deposit is due |
| `driver_not_found` / `driver_suspended` | driver row missing or inactive |
| `not_your_pool` | order and driver disagree on `is_test`. **Not even `force` overrides this** |
| `order_not_priced` | `pricing_status` still `pending_quote` |
| `already_assigned` | an open assignment exists |
| `driver_already_declined` | that driver rejected it before — `force` overrides |
| `too_many_attempts` | attempt 6+ — `force` overrides |
| `dispatch_rule_blocked` | driver at 4 active orders, or heading the other way |
| **`quote_not_accepted`** | **the trigger. The customer has not agreed the price** |

`quote_not_accepted` is last in practice and was the one nobody could read: it
is raised by a trigger on `delivery_assignments`, not by
`admin_assign_order` itself, so it does not appear in that function's list of
refusals at all.

## What was fixed, and what is still open

Fixed (#190): `quote_not_accepted` and `order_not_paid` now have Arabic copy.
Before, both arrived as `حصل خطأ، جرب تاني`.

Still open, in the order I would take them:

1. **Make pricing and quoting one action.** Either `confirm_custom_order_price`
   should issue a quote, or the Admin button should call the quote path. Today a
   correct-looking action produces a permanently undispatchable order.
2. **Bring the quote system into this repository** — see
   `DRIFT-SWEEP-2026-08-21.md`. Nothing here can see the guards that refuse.
3. **Say why the assign sheet is refusing before it is tapped.** The order's
   `quote_state` is known; showing "waiting for the customer to accept" beside
   the order costs nothing and removes the whole class of confusion.
4. **Reconsider the 15-minute window.** #1000's reminder was sent 63 seconds
   before expiry. It is now `quote_validity_minutes` in settings, so this is an
   edit rather than a migration.
