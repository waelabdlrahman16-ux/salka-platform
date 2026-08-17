import * as Sentry from '@sentry/react'

/**
 * Report a failed order attempt to Sentry -- but only the ones that mean
 * something is wrong with US.
 *
 * WHY THIS EXISTS. On 2026-08-13 checkout was dead for two hours and nothing
 * told anyone. Sentry was configured, but the only thing that ever reported to
 * it was ErrorBoundary, which catches React render crashes. A checkout that
 * fails cleanly -- the server answers, the customer sees a message, no
 * exception is thrown -- is invisible to it. So the one failure that costs money
 * was the one failure nobody could alert on.
 *
 * WHY MOST FAILURES ARE DELIBERATELY NOT REPORTED. An expired promo code, a
 * closed restaurant, an out-of-stock item, a full delivery slot: these are the
 * system working. Reporting them would bury the real signal under hundreds of
 * ordinary events a week, and an alert that cries wolf is an alert people mute.
 * The same reasoning as the order smoke test distinguishing "ordering is broken"
 * from "the check could not run".
 *
 * The list below is therefore of CUSTOMER-side outcomes, and everything not on
 * it is reported. That direction matters: a code nobody anticipated is far more
 * likely to be a new bug than a new kind of customer mistake, so the default is
 * to shout.
 */
const EXPECTED_CUSTOMER_OUTCOMES = new Set([
  // The customer's promo code, not our fault
  'promo_invalid', 'promo_expired', 'promo_not_available', 'promo_minimum_not_met',
  'promo_limit_reached', 'promo_already_used', 'promo_nothing_to_discount',
  'promo_customer_missing',
  // Catalogue and availability -- the shop is simply shut or sold out
  'restaurant_closed', 'item_unavailable', 'item_not_available_now',
  'vendor_not_covering_compound', 'slot_full', 'slot_unavailable',
  // The customer has not finished choosing
  'size_required', 'invalid_size', 'invalid_combo', 'empty_order',
  'addon_group_min_not_met', 'addon_group_max_exceeded',
  // Their details, their input
  'invalid_phone', 'invalid_customer_name', 'invalid_unit_number', 'invalid_zone',
  'notes_too_long', 'invalid_item_quantity', 'invalid_addon',
  'collect_amount_required', 'invalid_collect_amount',
  'invalid_payment_method', 'invalid_payment_mode', 'invalid_prescription_path',
  'not_a_custom_order_vendor', 'missing_customer_details', 'compound_id_required',
  // Account state and limits -- these are the rules working
  'account_blocked', 'login_required', 'not_logged_in',
  'daily_order_limit', 'order_rate_limit', 'rate_limited',
  // The customer's connection. A spike here says something about Egyptian
  // mobile networks, not about Salka, and it would be by far the noisiest tag.
  'network',
])

/**
 * `code` is the value from RpcResult -- an allowlisted server token, or
 * 'unknown' when extractCode could not place it.
 *
 * Fire-and-forget and never throws: an analytics or monitoring failure must
 * never be the reason a customer cannot order.
 */
export function reportOrderFailure(
  code: string,
  context: { action: string; restaurantId?: number | null; compoundId?: number | null },
): void {
  try {
    if (EXPECTED_CUSTOMER_OUTCOMES.has(code)) return

    // captureMessage, not captureException: there is no stack worth keeping,
    // and a STABLE message string is what lets Sentry group these into one
    // issue you can put a rate alert on ("more than N in 5 minutes"). Throwing
    // a synthetic Error here would give every occurrence a different stack and
    // scatter them across issues, which is precisely what stops an alert firing.
    Sentry.captureMessage(`order failed: ${code}`, {
      level: 'error',
      tags: {
        order_failure_code: code,
        order_action: context.action,
      },
      extra: {
        restaurantId: context.restaurantId ?? null,
        compoundId: context.compoundId ?? null,
      },
    })
  } catch {
    // Sentry not configured, blocked by an extension, offline -- all fine.
  }
}
