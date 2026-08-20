# The admin portal is the only source of truth — implementation spec

**Status: specification only.** Nothing built, migrated or deployed.

> **Principle.** The number typed into the admin portal is the *only* number. No code
> path may substitute a different one, and no input may leave the system in a state
> where the number cannot be read.

---

## 1. The three defects

### D1 — a typo in the portal breaks order placement · **live risk today**

`settings.value` is `text`, carries **no check constraints**, and the portal writes it
straight to the table (`Admin.tsx:1373`, `update settings set value = … where key = …`).

Every consumer then does `value::numeric`. So typing `8%`, `8 `, `٨`, or `1,500` into
any numeric setting makes that cast **raise at read time**. `service_fee_percent` is read
by `place_order`. A mistyped fee does not produce a wrong price — **it stops customers
being able to order at all**, with an error naming a cast, not a setting.

No missing row required. One keystroke, live now, and the blast radius is checkout.

### D2 — fifteen fallbacks contradict the portal · latent

34 settings are read by the database. **15 hardcode a fallback that differs from the
value you set:**

| Setting | Portal | Fallback | If the row goes missing |
|---|---:|---:|---|
| `service_fee_percent` | 8 | **0** | service fees silently become free |
| `driver_daily_salary_egp` | 800 | **0** | drivers earn nothing |
| `van_required_subtotal_egp` | 9000 | 300 | van rule fires on 25 historical orders |
| `cod_deposit_threshold_egp` | 2000 | 300 | deposits demanded on ~110 orders' traffic |
| `escalate_after_minutes` | 2 | 15 | escalation effectively stops |
| `driver_bonus_tier1_amount` | 50 | 100 | bonuses double |
| `driver_bonus_tier2_amount` | 100 | 150 | |
| `driver_bonus_tier3_amount` | 150 | 200 | |
| `driver_flat_earning_egp` | 0 | 10 | per-order pay appears from nowhere |
| `sla_travel_base_minutes` | 15 | 5 | |
| `sla_range_pct` | 10 | 30 | |
| `stall_accepted_minutes` | 20 | 60 | |
| `stall_delivery_minutes` | 45 | 90 | |
| `stall_payment_minutes` | 15 | 30 | |
| `travel_buffer_minutes` | 8 | 10 | |

Nothing alerts on a settings row disappearing, and a fallback-driven decision is
indistinguishable afterwards from a policy-driven one.

> `van_required_subtotal_egp`'s 300 was set by the 19 August drift migration, aligning
> three functions that previously disagreed (800 / 300 / 300). Making them consistent was
> right; landing on 300 while the portal said 9000 replaced an inconsistency with a
> uniform contradiction of the actual policy.

### D3 — one setting is dead · cosmetic but misleading

`driver_pay_model` (`weekly_salary`) is editable in the portal and **referenced nowhere** —
not the database, not the edge functions, not the frontend. Editing it does nothing.

The `fee_tier*_min_egp` / `_max_egp` / `_min_km` keys are also unread, but are already
filtered out of the editor with a comment explaining why. That trap was caught.

---

## 2. Design

### 2.1 Classify every setting

Add to `settings`: `kind` (`numeric` | `boolean` | `text`), `required` (boolean),
`min_value`, `max_value` (nullable numerics).

**Class A — money and policy. Never guess.** A missing or unreadable value raises
`setting_unavailable:<key>`.

`service_fee_percent` · `cod_deposit_threshold_egp` · `van_required_subtotal_egp` ·
`driver_daily_salary_egp` · `driver_flat_earning_egp` · `driver_bonus_tier{1,2,3}_amount` ·
`driver_bonus_tier{1,2,3}_orders` · `fee_tier{1..7}_egp` · `fee_tier{1..6}_max_km` ·
`sla_travel_per_km`

**Class B — operational timing. Degrade visibly.** Falls back to a documented default
**and writes a `setting_fallback_used` event**, so it is never silent.

`escalate_after_minutes` · `stall_quote_minutes` · `stall_accepted_minutes` ·
`stall_delivery_minutes` · `stall_payment_minutes` · `travel_buffer_minutes` ·
`sla_travel_base_minutes` · `sla_range_pct` · `slot_cutoff_minutes`

The split is deliberate: **money must stop rather than guess; monitoring must keep
running.** A cron that raises stops watching for stalled orders, which is worse than a
cron using a stale number and saying so.

### 2.2 Validate on write, not on read

A `before insert or update` trigger on `settings`:

- `kind = 'numeric'` → value must match `^-?[0-9]+(\.[0-9]+)?$`, and sit within
  `min_value` / `max_value` when set. Reject `8%`, `1,500`, Arabic-Indic digits, and
  trailing spaces with `invalid_setting_value:<key>`.
- `kind = 'boolean'` → must be exactly `true` or `false`.
- **Trim whitespace before validating**, since a trailing space is the likeliest typo.

The error surfaces in the settings screen at the moment of saving, next to the field —
not at 9pm inside a customer's checkout.

### 2.3 Make required rows undeletable

A `before delete` trigger raising on `required = true`. Class A's raise then becomes a
theoretical path rather than an operational risk.

### 2.4 One accessor, no magic numbers

```
private.setting_num(p_key text) returns numeric
private.setting_bool(p_key text) returns boolean
```

Reads the row, applies the class rule, returns the value. **Every one of the 34 call
sites loses its inline `coalesce(..., <number>)`.** After this change, grepping the
database for a hardcoded policy number returns nothing — which is the actual test of
whether the portal is authoritative.

Class B defaults live in **one table**, not scattered across function bodies.

### 2.5 Resolve the dead setting

Either wire `driver_pay_model` to the payout functions, or delete the row and its editor
entry. **A control that does nothing is worse than no control**, because it invites
someone to change pay policy and believe they have.

---

## 3. Call sites

| Function | Settings read |
|---|---|
| `place_order` | `service_fee_percent`, `cod_deposit_threshold_egp`, fee tiers, `slot_cutoff_minutes` |
| `confirm_custom_order_price` | `service_fee_percent`, `cod_deposit_threshold_egp` |
| `apply_order_promo` | `cod_deposit_threshold_egp` |
| `staff_create_pickup_order` | `service_fee_percent`, `cod_deposit_threshold_egp` |
| `switch_to_cash` | `cod_deposit_threshold_egp` |
| `admin_adjust_order` | `service_fee_percent` |
| `driver_can_take_order`, `available_orders`, `claim_order` | `van_required_subtotal_egp` |
| `stalled_orders` | all four `stall_*` |
| driver earnings / settlement | salary, flat, bonus tiers |
| SLA calculation | `sla_*`, `travel_buffer_minutes` |

Frontend also reads `escalate_after_minutes`, `service_fee_percent`,
`van_required_subtotal_egp` (`Admin.tsx`) and `sms_login_enabled` (`CustomerLogin.tsx`,
`VerifiedPhoneEditor.tsx`). **These need the same treatment** — a frontend `?? 15` is the
same defect wearing different syntax.

---

## 4. Rollout order

Order matters; steps 1–2 must land before 3.

1. **Add the columns, classify all 34, seed `kind` / `required` / bounds.** Additive, no behaviour change.
2. **Add the validation and delete-guard triggers.** Closes D1, the live risk. Still no read-path change.
3. **Verify every required row exists and parses** — a query, not a hope. Any failure here would have become a raise in step 4.
4. **Introduce `setting_num` / `setting_bool`.** No callers yet.
5. **Convert call sites, a few at a time**, most-used first: `place_order`, then the money functions, then dispatch, then monitoring.
6. **Convert the frontend reads.**
7. **Resolve `driver_pay_model`.**
8. **Grep for surviving magic numbers.** This is the acceptance test for the whole piece.

Steps 1–3 are worth doing on their own even if the rest waits: they close the only defect
that can break checkout today.

---

## 5. Tests

- Rejects `8%`, `8 `, `1,500`, `٨`, empty string, `abc` on a numeric setting
- Accepts `8`, `8.5`, `0`, `-1` where bounds allow; rejects out-of-bounds
- Deleting a required row raises
- Class A missing → `setting_unavailable`, and **checkout fails loudly rather than pricing wrongly**
- Class B missing → documented default **and** a `setting_fallback_used` event
- **Changing `cod_deposit_threshold_egp` in the portal changes the gate on the very next order** — the direct test of the principle
- No function body contains a numeric literal beside a `settings` lookup

---

## 6. Rollback

Each step reverses independently. Triggers drop cleanly; the accessor can be reverted
per-function since the old inline form still compiles. Steps 1–2 are additive and safe to
leave in place even if 4–8 are abandoned.

---

## 7. What this does not cover

Non-numeric policy that lives in code rather than settings — the 50% deposit fraction,
the 4-order driver cap, the 5-minute no-answer wait. Those are hardcoded with no portal
row at all, so they are outside this spec. Worth a separate decision about which should
become settings; **making them configurable is a policy question, not a cleanup.**
