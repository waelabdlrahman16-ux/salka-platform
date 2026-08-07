import { track } from './analytics'

const KEY = 'salka_compound_id'

/**
 * The customer's compound, remembered across launches.
 *
 * This lived in sessionStorage, which a browser clears when the tab closes and
 * an installed PWA clears every time it is shut. So the "فين مكانك؟" picker
 * opened on EVERY launch -- and since Home also fires geolocation the moment it
 * opens, every launch asked for GPS too. The place a customer lives at in
 * Sokhna does not change between one order and the next; asking again is not
 * caution, it is a toll gate.
 *
 * Reads still fall back to sessionStorage once, so anyone mid-session when this
 * shipped keeps the place they already chose instead of being asked again.
 */
export function getCompoundId(): number | null {
  const v = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY)
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export function setCompoundId(id: number): void {
  const previous = localStorage.getItem(KEY)
  localStorage.setItem(KEY, String(id))
  // Kept in step so anything still reading sessionStorage directly agrees.
  sessionStorage.setItem(KEY, String(id))

  // Funnel step 2, instrumented HERE and not in the picker component, because
  // this is the one line every path goes through -- the "فين مكانك؟" modal, the
  // header switcher and the checkout address form all end up calling it.
  // Instrumenting the modal alone would have missed the other two and quietly
  // understated the step.
  //
  // Only on an actual change: re-picking the same compound is not progress, and
  // counting it would push step 2 above step 1.
  if (previous !== String(id)) track('place_chosen', { compoundId: id })
}
