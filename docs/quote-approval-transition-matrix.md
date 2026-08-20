# Quote and approval — transition matrix

**Status: specification only.** Nothing in this document has been built, migrated or
deployed. It describes the target contract and, beside it, what the system does today.

Scope: the **Quote dimension** of the canonical order model. This is the first matrix
because it is the launch blocker — see "The defect" below.

---

## The defect this exists to close

`confirm_custom_order_price` advances an order to live (`status = 'pending'`) unless a
COD deposit is due. A deposit is only computed when `payment_method = 'cod'` **and**
total > `cod_deposit_threshold_egp`, which is **2000** in production.

So the gate applies to almost nothing. Measured on production, 20 August 2026, across
all 67 priced هنجبلك orders:

| Segment | Orders | Hit a customer gate | Went live unconfirmed |
|---|---:|---:|---:|
| 2000 or under — no gate possible | 65 | 0 | **65** |
| Over 2000 | 2 | 2 | 0 |
| **Total** | **67** | **2** | **65** |

**97% of the custom-order business is priced by staff and sent to fulfilment with no
customer agreement.** Not an edge case — the default path. The two that were gated were
gated by *size*, not by consent: a deposit demand is not an acceptance step.

The schema confirms the cause: there is **no quote acceptance function anywhere**, no
`order_quotes` table, and `pricing_status` holds only `n/a`, `pending_quote`,
`confirmed`. **`confirmed` means the supervisor confirmed it.** No state in the system
means the customer agreed.

**A second, related leak:** the vendor's board filters on `kitchen_status = 'new'` with no
pricing filter. Eight custom orders have sat on vendor boards while still
`pending_quote` — the vendor sees the order before ops has quoted it.

---

## 1. States

Quote is a dimension of the order. The **versions** live in `order_quotes`; the order
carries only the current state and a pointer to the current version.

| State | Meaning | Today |
|---|---|---|
| `not_required` | Catalogue order, price known at basket time | `pricing_status = 'n/a'` |
| `pending` | Request submitted, no quote issued yet | `pending_quote` |
| `offered` | Quote issued and visible to the customer, awaiting their decision | **absent** |
| `accepted` | Customer has agreed to a specific version | conflated into `confirmed` |
| `rejected` | Customer declined | **absent** |
| `expired` | Offer timed out with no decision | **absent** |
| `superseded` | Replaced by a newer version | **absent** |

`superseded` is not in the original plan but versioning requires it: without it, a
reissued quote has to overwrite the previous row, which is the same silent-mutation
problem the model exists to prevent.

### The frozen snapshot

Each `order_quotes` row freezes, and never mutates after issue:

`subtotal · delivery_fee · service_fee · promo_code_id · promo_discount ·
promo_discount_service · promo_discount_delivery · promo_discount_vendor ·
deposit_required · deposit_amount · total · expires_at · version`

> **This supersedes `reprice_order`.** The 19 August fix made repricing *correct*.
> Freezing the snapshot per version makes repricing *unnecessary* — a price change
> issues a new version rather than editing an accepted one. If this model is built,
> `reprice_order` should shrink to a legacy-order path, not grow.

---

## 2. The matrix

Eight facets per transition, per the plan's §2.

### Q1 · ∅ → `not_required`

| Facet | Contract |
|---|---|
| **Actor** | Customer (implicit, at checkout) |
| **Conditions** | `order_type = 'catalog'` |
| **DB / audit** | `quote_state = 'not_required'`; event `quote.not_required` |
| **Financial** | None — basket price is authoritative |
| **Notifications** | None |
| **Idempotency** | Natural — set once at creation |
| **Labels** | Customer: — · Vendor: — · Driver: — · Ops: "تسعير غير مطلوب" |
| **Today** | Works. `pricing_status = 'n/a'`. **No change needed.** |

### Q2 · ∅ → `pending`

| Facet | Contract |
|---|---|
| **Actor** | Customer |
| **Conditions** | `order_type = 'custom_request'`; ≥1 requested item |
| **DB / audit** | `quote_state = 'pending'`; event `quote.requested` |
| **Financial** | None. Total is not yet meaningful and **must not display as 0** |
| **Notifications** | Ops: new request needing a price |
| **Idempotency** | Keyed on the submission's idempotency key |
| **Labels** | Customer: "بنراجع طلبك ونبعتلك السعر" · Vendor: **must not be visible** · Ops: "محتاج تسعير" |
| **Today** | Partly. State exists as `pending_quote`. **GAP: the vendor sees it now** — their board has no pricing filter. |

### Q3 · `pending` → `offered`

| Facet | Contract |
|---|---|
| **Actor** | Supervisor or Admin |
| **Conditions** | `quote_state = 'pending'`; order not cancelled; amount ≥ 0 and within policy ceiling |
| **DB / audit** | Insert `order_quotes` v1 with the frozen snapshot and `expires_at`; `quote_state = 'offered'`; event `quote.offered` with actor, role, version, amount |
| **Financial** | None yet. **Issuing a quote takes no money and must not create a payable** |
| **Notifications** | Customer: push + SMS fallback, "وصلك سعر لطلبك" with the amount and the expiry |
| **Idempotency** | Re-issuing the same amount within the window returns the existing version rather than creating v2 |
| **Labels** | Customer: "السعر جاهز — راجعه ووافق" · Vendor: not visible · Ops: "في انتظار موافقة العميل" |
| **Today** | **DOES NOT EXIST.** `confirm_custom_order_price` jumps straight past this to live. **This is the launch blocker.** |

### Q4 · `offered` → `accepted`

| Facet | Contract |
|---|---|
| **Actor** | **Customer only.** No staff role may perform this — the whole point |
| **Conditions** | Version is the current one; `now() < expires_at`; order not cancelled |
| **DB / audit** | `order_quotes.accepted_at`, `accepted_by`; `quote_state = 'accepted'`; copy the frozen snapshot onto the order; event `quote.accepted` |
| **Financial** | **The only transition that creates a payable.** Opens the deposit or full-payment step per the frozen `deposit_required` |
| **Notifications** | Ops: accepted, ready to proceed. Vendor: still nothing until paid |
| **Idempotency** | Accepting twice returns the first result unchanged. Never double-charges |
| **Labels** | Customer: "تم — ادفع لتأكيد" or "تم تأكيد طلبك" · Ops: "وافق العميل" |
| **Today** | **DOES NOT EXIST.** |

### Q5 · `offered` → `rejected`

| Facet | Contract |
|---|---|
| **Actor** | Customer only |
| **Conditions** | Version current; not yet accepted; not expired |
| **DB / audit** | `rejected_at`, optional `rejection_reason`; `quote_state = 'rejected'`; event `quote.rejected` |
| **Financial** | None. Any held promo redemption is **released** |
| **Notifications** | Ops: rejected, with the reason if given |
| **Idempotency** | Rejecting twice is a no-op. Rejecting after acceptance is **refused**, not silently applied |
| **Labels** | Customer: "تم إلغاء الطلب" · Ops: "رفض العميل السعر" |
| **Today** | **DOES NOT EXIST.** A customer who dislikes the price has no path but to phone. |

### Q6 · `offered` → `expired`

| Facet | Contract |
|---|---|
| **Actor** | System (sweep) |
| **Conditions** | `now() >= expires_at`; still `offered` |
| **DB / audit** | `quote_state = 'expired'`; event `quote.expired` with actor `system` |
| **Financial** | None. Promo redemption released, exactly as for rejection |
| **Notifications** | Customer: "انتهت صلاحية السعر" with a re-request path. Ops: expired queue |
| **Idempotency** | Sweep is safe to re-run; only `offered` rows move |
| **Labels** | Customer: "انتهت صلاحية السعر" · Ops: "منتهي الصلاحية" |
| **Today** | **DOES NOT EXIST** — no expiry column and no sweep. `push-nudge-sweep` already runs every minute and can host it. |

### Q7 · `offered` → `superseded` (reprice **before** a decision)

| Facet | Contract |
|---|---|
| **Actor** | Supervisor or Admin |
| **Conditions** | Current version is `offered`, not accepted |
| **DB / audit** | v(n) → `superseded`; insert v(n+1) `offered` with a fresh snapshot and expiry; events `quote.superseded` + `quote.offered`, both carrying the reason |
| **Financial** | None. **The old snapshot is never edited** |
| **Notifications** | Customer: price updated, with old and new shown |
| **Idempotency** | An identical amount does not create a new version |
| **Labels** | Customer: "تم تحديث السعر" · Ops: "نسخة {n+1}" |
| **Today** | **DOES NOT EXIST.** Repricing today mutates the order in place. |

### Q8 · `accepted` → `superseded` (reprice **after** acceptance)

| Facet | Contract |
|---|---|
| **Actor** | Supervisor or Admin, **with a mandatory reason** |
| **Conditions** | Accepted but not yet fulfilled; reason present |
| **DB / audit** | v(n) keeps `accepted_at` as historical fact; v(n+1) issued as `offered`; `quote_state` returns to `offered`; event `quote.reissued_after_acceptance` — flagged for audit review |
| **Financial** | **Any payment already taken against v(n) is reconciled explicitly** — refunded, or credited to the new balance. Never silently reused |
| **Notifications** | Customer: **must re-accept**, showing what changed and why. Ops: exception queue |
| **Idempotency** | Reason + amount + version keyed; a repeat is rejected, not duplicated |
| **Labels** | Customer: "اتغير سعر طلبك — محتاج موافقتك تاني" · Ops: "أعيد التسعير بعد الموافقة" |
| **Today** | **THIS IS THE 19 AUGUST BUG, GENERALISED.** `admin_adjust_order` silently changed an accepted price; the discount was deleted from the total on 1 order and understated on 6, for 98.40 EGP against customers. The fix made the recalculation correct. **This transition makes it impossible instead.** |

### Q9 · `pending` or `offered` → cancelled

| Facet | Contract |
|---|---|
| **Actor** | Customer, or Ops with a reason |
| **Conditions** | Not yet accepted, or accepted-and-unpaid within policy |
| **DB / audit** | Exception dimension `cancelled`; quote frozen where it stands; event `order.cancelled` with actor and reason |
| **Financial** | Promo redemption released. Nothing charged, so nothing to refund |
| **Notifications** | Both sides |
| **Idempotency** | Already handled today — `cancel_order` releases the redemption exactly once |
| **Labels** | Customer: "تم إلغاء الطلب" · Ops: "ملغي قبل الموافقة" |
| **Today** | Works, and the redemption release is already correct and tested. **No change needed.** |

### Q10 · `accepted` → order proceeds

| Facet | Contract |
|---|---|
| **Actor** | System (derived, not a button) |
| **Conditions** | `quote_state = 'accepted'` **AND** payment satisfied per the frozen snapshot |
| **DB / audit** | Vendor fulfilment leaves `not_sent` → `pending_acceptance`; event `order.sent_to_vendor` |
| **Financial** | Deposit or full amount captured against the accepted version |
| **Notifications** | **Vendor sees the order for the first time here** |
| **Idempotency** | Sending twice is a no-op |
| **Labels** | Customer: "جاري التحضير" · Vendor: "طلب جديد" · Ops: full state |
| **Today** | **INVERTED.** The vendor sees the order from submission, before pricing and before acceptance. |

---

## 3. What this changes, counted

| | Transitions |
|---|---:|
| Work correctly today, no change | **3** (Q1, Q9, and the redemption release) |
| Exist but are wrong or leak | **2** (Q2 vendor visibility, Q10 ordering) |
| Do not exist at all | **6** (Q3–Q8) |

---

## 4. Open questions — needed before build

1. **Expiry duration**, and whether an expired quote auto-cancels the order or leaves it re-requestable. Suggest 24h and re-requestable; not decided.
2. **Does a *lower* price need re-acceptance?** Cheaper is still a change to the agreed contract. Suggest yes, for one rule rather than two.
3. **Vendor lead time.** Moving vendor visibility to Q10 means they learn about orders later than today. That is correct, but it is an operational change they must be told about, not just a code change.
4. **Policy ceiling on a quote** — is there an amount above which a supervisor cannot issue without admin approval?

---

## 5. Sequencing note

The plan places the quote fix at step 5, behind the full canonical model and the
cancellation policy. Q3–Q5 alone close the launch blocker and need neither: two new
states, one table, one customer-facing screen, and a gate in
`confirm_custom_order_price`. The remaining dimensions can land behind it.

---

## 6. Overlap to resolve

PR #177 (open, unmerged) adds actor and timestamp to adjustment lines in `order_items`.
That is a subset of the plan's `order_adjustments`. **Merge it or close it, but do not
build both** — two homes for one fact is the drift that took a day to close on 19 August.
