import { supabase } from './supabase'
import { getDeviceId } from './deviceId'
import { isInAppBrowser } from './inAppBrowser'

// Funnel instrumentation.
//
// Fixed event names, matching the whitelist in log_app_event(). Anything
// else the server drops on the floor, so adding an event here without adding it
// there is a silent no-op -- change both or neither.
//
// Three rules this file exists to enforce:
//
//   1. It NEVER throws and never rejects. Every call is fire-and-forget. An
//      analytics failure that breaks a checkout would cost more than the
//      measurement is worth, and postgrest-js resolves with { error } rather
//      than rejecting, so a bare .then() is not enough on its own.
//   2. It NEVER blocks. Nothing awaits these.
//   3. It carries NO personal data. No phone, no name, no unit number. The
//      device id is the same non-secret label lib/deviceId.ts already stores;
//      props carry fbclid, the in-app-browser flag and a referrer HOST only.
export type AppEvent =
  | 'arrival'
  | 'place_chosen'
  | 'vendor_opened'
  | 'item_added'
  | 'customization_opened'
  | 'customization_abandoned'
  | 'checkout_started'
  | 'checkout_blocked'
  | 'order_placed'

const SESSION_KEY = 'salka_analytics_session'
const FBCLID_KEY = 'salka_analytics_fbclid'
const FIRED_PREFIX = 'salka_analytics_fired:'

function safeSession(): string | null {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : null
      if (id) sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch { return null }
}

/**
 * The ad click id, captured once and remembered for the session.
 *
 * It is only present in the URL of the FIRST page view. The order that matters
 * happens several navigations later with a clean URL, so reading it live at
 * order time would attribute every paid order to nothing. Persisted in
 * sessionStorage, and the server attributes per device across the window.
 */
function fbclid(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('fbclid')
    if (fromUrl) {
      sessionStorage.setItem(FBCLID_KEY, fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem(FBCLID_KEY)
  } catch { return null }
}

function referrerHost(): string | null {
  try {
    if (!document.referrer) return null
    return new URL(document.referrer).host || null
  } catch { return null }
}

export function track(
  event: AppEvent,
  fields: {
    compoundId?: number | null
    restaurantId?: number | null
    orderId?: number | null
    props?: Record<string, string | number | boolean>
  } = {},
): void {
  try {
    const click = fbclid()
    void supabase.rpc('log_app_event', {
      p_event: event,
      p_device_id: getDeviceId(),
      p_session_id: safeSession(),
      p_compound_id: fields.compoundId ?? null,
      p_restaurant_id: fields.restaurantId ?? null,
      p_order_id: fields.orderId ?? null,
      p_props: {
        in_app: String(isInAppBrowser()),
        ...(click ? { fbclid: click } : {}),
        ...(referrerHost() ? { ref: referrerHost() as string } : {}),
        ...(fields.props ?? {}),
      },
      // A rejected promise with no handler is an unhandled rejection, which
      // Sentry reports -- so the analytics call would generate the very noise
      // the Sentry filter was just added to remove.
    }).then(() => {}, () => {})
  } catch {
    // getDeviceId, sessionStorage, URL parsing -- any of them can throw in a
    // locked-down WebView. Measurement is never worth an exception here.
  }
}

/**
 * Fire an event at most once per browser session.
 *
 * `arrival` is the denominator of the whole funnel, so counting it twice
 * because a component remounted would understate every conversion rate below
 * it -- and React StrictMode double-mounts every effect in development.
 */
export function trackOnce(event: AppEvent, fields?: Parameters<typeof track>[1]): void {
  try {
    // Checkout is meaningful per vendor. A customer can abandon one restaurant
    // and successfully check out another in the same browser session; treating
    // the second as a duplicate hides exactly the recovery we need to measure.
    const scope = fields?.restaurantId != null ? `:${fields.restaurantId}` : ''
    const key = FIRED_PREFIX + event + scope
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // No storage: fire anyway. An over-counted arrival beats a missing one.
  }
  track(event, fields)
}
