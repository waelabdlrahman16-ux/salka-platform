// Has this device ever had an order actually arrive?
//
// Used to decide when the app is allowed to ask for a slot on the home screen.
// The install prompt used to render on every route from the first second of the
// first visit -- including /checkout, where it took 15% of the viewport above a
// customer who had already decided to buy, and offered a 23x18px dismiss.
//
// Asking a stranger to install is a request before anything has been earned.
// Asking someone whose food just arrived is a request at the one moment the
// answer is obviously yes.
//
// Deliberately localStorage and not the server: it is a UI preference for this
// device, it must survive a signed-out session, and it must never block a render
// waiting on a network call.

const KEY = 'salka_delivered_once'

export function markOrderDelivered(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}

export function hasEverBeenDelivered(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
