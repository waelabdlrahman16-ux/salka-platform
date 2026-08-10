import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { driverSelfService } from './driverSelfService'

// How often the driver's position is pushed to the server while they are out
// delivering. The cadence comes from this timer, NOT from the browser's
// position callbacks: Android coalesces watchPosition and stops firing when the
// rider is stationary, so a driver waiting at a gate for four minutes would
// have gone "stale" on the dispatch board while sitting there perfectly fine.
// Staleness has to mean "we have lost him", not "he stopped moving".
const REPORT_INTERVAL_MS = 20000

// This module no longer acquires its own fix.
//
// It used to call Geolocation.getCurrentPosition() on its own timer, behind a
// Capacitor.isNativePlatform() gate -- which meant it did nothing at all,
// because there is no native build yet, so every driver row on the server has
// had a null position since the day the feature was written.
//
// Meanwhile Driver.tsx has been running navigator.geolocation.watchPosition()
// the whole time to draw the 🛵 marker on the pool and active maps. The fix was
// already in the app; it was simply never sent. So this is now a sink: the
// existing watch pushes positions in through reportPosition(), and this module
// decides what reaches the server and how often. That removes the second GPS
// acquisition, the second permission prompt, and the generation/starting
// concurrency guard that existed only because start() had to await a fix before
// it could install its interval.
/** Last rejection from update_my_location, so a caller can surface it. */
export let lastReportError = ''

// A fix older than this is not worth sending. The timer re-sends whatever it
// holds and the SERVER stamps location_updated_at = now(), so a driver who
// loses GPS would keep publishing his last coordinate forever and the board
// would render «موقعه دلوقتي» over a pin that has not moved in an hour -- the
// confident-wrong-pin failure this module exists to avoid.
const MAX_FIX_AGE_MS = 90_000

let lastPos: { lat: number; lng: number; at: number } | null = null
let timerId: ReturnType<typeof setInterval> | null = null
let inFlight = false

async function send() {
  // A single slow round trip on a bad mobile connection must not queue a second
  // one behind it. Skipping a tick is free -- the next one is 20s away and
  // carries a fresher position anyway.
  if (!lastPos || inFlight) return
  if (Date.now() - lastPos.at > MAX_FIX_AGE_MS) return   // let it age honestly
  inFlight = true
  const { lat, lng } = lastPos
  try {
    // The server ignores this unless the caller has an assignment in Picked_Up
    // or Out_for_Delivery, so a position arriving in the seconds after the last
    // delivery completes is discarded rather than parked on the driver's row.
    //
    // edgeAction() RESOLVES with { ok: false } rather than rejecting, so the
    // catch below never saw a rejected write -- the pin just stopped updating
    // and dispatch could not tell a lost signal from a refused one.
    const res = await driverSelfService('updateLocation', { lat, lng })
    if (!res.ok) {
      lastReportError = res.error
      console.error('location report rejected', res.error)
    } else {
      lastReportError = ''
    }
  } catch (e) {
    lastReportError = (e as Error)?.message ?? String(e)
    console.error('location report failed', e)
  } finally {
    inFlight = false
  }
}

// Called for every fix the page's watchPosition produces, whether or not we are
// currently reporting -- cheap, and it means the first tick after start() has a
// position to send instead of waiting a full interval for the next callback.
export function reportPosition(lat: number, lng: number) {
  const first = lastPos === null
  lastPos = { lat, lng, at: Date.now() }
  // Only when reporting is live AND this is the first fix we have held: get the
  // pin on the dispatch board within a second of the driver setting off,
  // instead of up to 20s later.
  if (timerId && first) void send()
}

// Idempotent, synchronous, and safe to call from an effect that may re-run.
export function startLocationReporting() {
  if (timerId) return

  // On a native build the WebView's own navigator.geolocation still needs the
  // OS-level runtime permission the app declares. Asking through the Capacitor
  // plugin is the only way to raise that dialog; on web this whole branch is
  // skipped and the browser prompts on its own when watchPosition starts.
  // Deliberately not awaited: the timer must exist before this resolves, or a
  // stop() arriving during the prompt has nothing to cancel.
  if (Capacitor.isNativePlatform()) {
    Geolocation.checkPermissions()
      .then(p => (p.location === 'granted' ? null : Geolocation.requestPermissions()))
      .catch(e => console.error('location permission request failed', e))
  }

  timerId = setInterval(send, REPORT_INTERVAL_MS)
  void send()
}

export function stopLocationReporting() {
  if (!timerId) return
  clearInterval(timerId)
  timerId = null
  // lastPos is deliberately KEPT. Android stops firing watchPosition when the
  // rider is stationary, so clearing it meant a driver who collected his next
  // order while standing at the same restaurant had no pin until he physically
  // rode off. The age check in send() is what stops it going stale.
  // Without this the driver's last fix stays on his row forever, and dispatch
  // watches a 🛵 parked at the previous customer's door for the rest of the
  // night. The server drops the position outright rather than ageing it, so the
  // board shows "no location" -- which is true -- instead of a confident pin in
  // the wrong place.
  void driverSelfService('clearLocation').then(res => {
    if (!res.ok) console.error('clear location failed', res.error)
  })
}
