# Payment, deposit and refund — transition matrix

**Status: specification only.** Nothing here has been built, migrated or deployed.
Target contract, with today's behaviour beside it.

Second matrix in the canonical-state series. Companion to
`quote-approval-transition-matrix.md`, which hands off to this one at Q4 and Q10.

---

## 0. The policy, as stated

> **A COD order over the admin's threshold requires InstaPay first.**
> The threshold is whatever number is typed into the admin portal — not a constant.

Production today: `cod_deposit_threshold_egp = 2000`, editable in the settings tab,
which renders every settings row generically. **The rule is live and working.**

### But the number has a trapdoor

Five database functions read that setting, and **all five hardcode a fallback of 300**:

| Function | Reads | Falls back to |
|---|---|---:|
| `place_order` | `cod_deposit_threshold_egp` | 300 |
| `confirm_custom_order_price` | same | 300 |
| `apply_order_promo` | same | 300 |
| `staff_create_pickup_order` | same | 300 |
| `switch_to_cash` | same | 300 |

If that row is deleted, renamed, or given a non-numeric value, every one of them
silently reverts to 300 — **ignoring the number in the admin portal** and demanding
deposits on **110 historical orders' worth** of traffic between 300 and 2000 that the
policy says should pass on cash.

Nobody would see it happen. There is no alert on a settings row going missing, and a
deposit demand looks identical whether it came from policy or from a fallback.

> **One of those 300s is mine.** The 19 August drift migration changed
> `apply_order_promo` from 3000 to 300 to match its four siblings. Aligning them was
> right; aligning them on 300 encoded a number that contradicts the business rule.

**P-GAP-1 — the fallback must not invent a policy.** A missing setting should fail
loudly or disable the gate, never substitute a different number. Recommendation: seed
the row, guard it, and raise `deposit_threshold_unset` if absent. A checkout that errors
is recoverable; one that quietly charges a deposit nobody authorised is not.

### Open question — deposit or full payment?

"Needs InstaPay first" is implemented today as **50% of the total**
(`ceil(v_total * 0.5)`). Two readings:

- **(a) 50% deposit via InstaPay**, balance in cash — what the code does now
- **(b) 100% prepayment via InstaPay**, nothing collected on delivery

The matrix below is written so the decision changes **one cell** — `deposit_amount` —
and nothing else. **Not decided; needs your answer.**

---

## 1. States

| Dimension | State | Meaning | Today |
|---|---|---|---|
| Payment | `not_required` | Total is 0 after wallet/promo | `online_payment_status = null` |
| | `unpaid` | Cash on delivery, under threshold | `null` |
| | `deposit_due` | Over threshold, InstaPay required before proceeding | `pending` + `cod_deposit_amount` |
| | `awaiting_confirmation` | Customer says they paid; ops has not verified | `instapay_claimed_at` set |
| | `paid` | Verified | `paid` |
| | `failed` | Gateway declined or claim rejected | **absent** |
| Refund | `none` | — | `refund_status = null` |
| | `partially_refunded` | Some money returned | **absent** |
| | `refunded` | Fully returned | `refunded` |

**Today's payment dimension has three values (`null`, `pending`, `paid`) doing the work
of six.** `null` alone means *not required*, *unpaid-on-delivery*, and *never
initialised* — three different facts sharing one absence.

---

## 2. The matrix

### P1 · ∅ → `not_required`

| Facet | Contract |
|---|---|
| **Actor** | System, at order creation |
| **Conditions** | Total after wallet and promo = 0 |
| **DB / audit** | `payment_state = 'not_required'`; event `payment.not_required` |
| **Financial** | Wallet already debited; nothing further owed |
| **Notifications** | None |
| **Idempotency** | Derived from the total; recomputing is safe |
| **Labels** | Customer: "مدفوع بالكامل من رصيدك" · Ops: "لا يتطلب دفع" |
| **Today** | Works — `apply_order_promo` moves `awaiting_payment` → `pending` when the total reaches 0. **No change.** |

### P2 · ∅ → `unpaid` (cash, under threshold)

| Facet | Contract |
|---|---|
| **Actor** | System, at placement or quote acceptance |
| **Conditions** | `payment_method = 'cod'` **AND** `total <= threshold_from_admin_portal` |
| **DB / audit** | `payment_state = 'unpaid'`; event records **the threshold value used**, not just the outcome |
| **Financial** | Driver collects `total` on delivery |
| **Notifications** | None |
| **Idempotency** | Pure function of total and threshold |
| **Labels** | Customer: "الدفع كاش عند الاستلام" · Driver: "حصّل {total}" · Ops: "كاش" |
| **Today** | Works. **GAP: the event does not record which threshold was applied**, so a fallback-driven decision is indistinguishable from a policy-driven one after the fact. |

### P3 · ∅ → `deposit_due` (cash, over threshold)

| Facet | Contract |
|---|---|
| **Actor** | System |
| **Conditions** | `payment_method = 'cod'` **AND** `total > threshold_from_admin_portal` |
| **DB / audit** | `payment_state = 'deposit_due'`; freeze `deposit_amount` **and the threshold that triggered it**; event `payment.deposit_required` |
| **Financial** | **Amount = policy — 50% today, or 100% if you choose (b). The one cell that changes.** |
| **Notifications** | Customer: InstaPay instructions and the amount. Ops: awaiting payment |
| **Idempotency** | Recomputation must not move an amount already shown to a customer — freeze at first issue |
| **Labels** | Customer: "حوّل {amount} على إنستاباي عشان نأكد الطلب" · Ops: "في انتظار إنستاباي" |
| **Today** | Works at 2000. **GAP: the amount is recomputed rather than frozen** — the same class as the 19 August promo defect. |

### P4 · `deposit_due` → `awaiting_confirmation`

| Facet | Contract |
|---|---|
| **Actor** | Customer |
| **Conditions** | `deposit_due`; not already confirmed |
| **DB / audit** | `instapay_claimed_at`; event `payment.claimed` |
| **Financial** | **None. A claim is not money** — this is the distinction that must never blur |
| **Notifications** | Ops: a claim to verify |
| **Idempotency** | Re-claiming updates the timestamp, never advances the state |
| **Labels** | Customer: "بنأكد التحويل" · Ops: "يدّعي الدفع — راجع" |
| **Today** | Exists as `mark_instapay_claimed`. **Works.** |

### P5 · `awaiting_confirmation` → `paid`

| Facet | Contract |
|---|---|
| **Actor** | Admin or Supervisor — **never the customer** |
| **Conditions** | A claim exists, or `force` with a mandatory reason |
| **DB / audit** | `payment_state = 'paid'`; **`confirmed_by` + `confirmed_at`**; event `payment.confirmed` |
| **Financial** | Deposit recognised. Balance owed on delivery = `total - deposit` |
| **Notifications** | Customer: confirmed. Vendor: **order becomes visible here** (see quote matrix Q10) |
| **Idempotency** | Confirming twice is a no-op, never a second recognition |
| **Labels** | Customer: "تم تأكيد الدفع" · Driver: "حصّل {balance} بس" · Ops: "مدفوع" |
| **Today** | Exists as `admin_confirm_instapay_payment`, with a `force` path. **GAP: no `confirmed_by`** — same hole PR #177 closes for adjustments. A forced confirmation names nobody. |

### P6 · `deposit_due` → `unpaid` (switch to cash)

| Facet | Contract |
|---|---|
| **Actor** | Admin or Supervisor, with a reason |
| **Conditions** | Not yet paid |
| **DB / audit** | Clear the deposit; `payment_state = 'unpaid'`; event `payment.switched_to_cash` **with actor and reason** |
| **Financial** | Full amount now collected on delivery — **the platform accepts the risk the threshold existed to avoid** |
| **Notifications** | Customer: pay cash on delivery. Driver: collect the full amount |
| **Idempotency** | Safe to repeat |
| **Labels** | Customer: "هتدفع كاش عند الاستلام" · Ops: "تحوّل لكاش" |
| **Today** | Exists as `switch_to_cash`. **GAP: this is a deliberate override of your policy and records no actor or reason.** It is the single easiest way to bypass the 2000 rule, and it is invisible afterwards. |

### P7 · `paid` / `unpaid` → `failed`

| Facet | Contract |
|---|---|
| **Actor** | System (gateway) or Ops (claim rejected) |
| **Conditions** | Gateway declined, or a claim found false |
| **DB / audit** | `payment_state = 'failed'`; event with the reason |
| **Financial** | Nothing recognised. Order returns to `deposit_due` or cancels per policy |
| **Notifications** | Customer, with a retry path |
| **Idempotency** | Terminal per attempt; a retry opens a new attempt |
| **Labels** | Customer: "الدفع لم يتم" · Ops: "فشل الدفع" |
| **Today** | **DOES NOT EXIST.** A rejected claim has nowhere to go; the order sits in `pending` looking paid-ish. |

### P8 · → `refunded`

| Facet | Contract |
|---|---|
| **Actor** | Admin or Supervisor |
| **Conditions** | Money was actually taken; not already refunded |
| **DB / audit** | `refund_state = 'refunded'`; `refunded_by` + `refunded_at`; event `payment.refunded` |
| **Financial** | **Server decides the amount** — a COD order only ever took the deposit, so refunding `total` is a gift |
| **Notifications** | Customer |
| **Idempotency** | Refuses a second refund. **Already correct and tested** |
| **Labels** | Customer: "تم استرداد المبلغ" · Ops: "مسترد" |
| **Today** | Works, `mark_refunded` with `refunded_by = auth.uid()`. Amount is server-decided. **No change — this one is a model for the rest.** |

### P9 · → `partially_refunded`

| Facet | Contract |
|---|---|
| **Actor** | Admin or Supervisor, with reason and itemisation |
| **Conditions** | Money taken; refund < amount taken |
| **DB / audit** | Running total of refunded amount, not a boolean; event per refund |
| **Financial** | Sum of partials may never exceed what was taken — enforced in the database |
| **Notifications** | Customer, with what was refunded and why |
| **Idempotency** | Keyed per refund attempt, so a retry cannot double-pay |
| **Labels** | Customer: "تم استرداد {amount} من {total}" · Ops: "استرداد جزئي" |
| **Today** | **DOES NOT EXIST.** `refund_status` is a two-value flag. A partial refund today is done by hand via `credit_wallet`, which leaves the order still reading "not refunded" — the order and the money disagree, permanently. |

---

## 3. What this changes, counted

| | Transitions |
|---|---:|
| Work correctly today | **4** (P1, P2, P4, P8) |
| Exist but incomplete | **3** (P3 unfrozen, P5 no actor, P6 unlogged override) |
| Do not exist | **2** (P7 failure, P9 partial refund) |

**The single most valuable fix is not in the matrix rows.** It is **P-GAP-1**: five
functions carrying a hardcoded 300 that would override the number in your admin portal
if one settings row went missing.

---

## 4. Open questions

1. **Deposit or full prepayment above the threshold?** Currently 50%. Changes one cell.
2. **Does the threshold apply to the total, or to the cash portion?** An order part-paid from wallet may fall under the threshold on cash owed while its total sits above it.
3. **Who may `switch_to_cash`, and is there a ceiling?** Today any admin or supervisor, at any amount, unlogged.
4. **On a rejected claim (P7), cancel or return to `deposit_due`?**

---

## 5. Dependencies

- Q4 and Q10 of the quote matrix hand off to P2/P3. Neither can be finished alone.
- P5's missing `confirmed_by` is the same hole PR #177 closes for adjustments. **Whatever shape that takes should cover both** rather than solving it twice.
