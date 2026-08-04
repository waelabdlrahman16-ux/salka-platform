import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { supabase } from './supabase'

const REPORT_INTERVAL_MS = 20000 // every 20s while actively delivering

let intervalId: ReturnType<typeof setInterval> | null = null
// Bumped by every stop() and every start(). An in-flight start compares its own
// token against this after each await and bails if it has been superseded --
// otherwise a start that is still waiting on a 15s GPS fix can install its
// interval after a stop() has already run, leaving an orphan nobody can clear.
let generation = 0
let starting = false

async function reportOnce() {
  try {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
    await supabase.rpc('update_my_location', {
      p_lat: position.coords.latitude,
      p_lng: position.coords.longitude
    })
  } catch (e) {
    // GPS momentarily unavailable is normal (tunnel, indoors) -- just skip this tick
    console.error('location report failed', e)
  }
}

// Starts reporting the driver's live position every ~20s while they're
// actively out delivering (Picked_Up/Out_for_Delivery). No-ops on web/PWA --
// this is a native-only capability. Uses a fixed-interval poll rather than
// watchPosition so the battery/data cost is predictable and capped, instead
// of however often the OS decides to fire location-change events.
export async function startLocationReporting() {
  if (!Capacitor.isNativePlatform()) return
  // `starting` must be checked and set synchronously. The old guard tested only
  // intervalId, which is assigned *after* two awaits (permissions, then a
  // reportOnce with a 15s timeout) -- so a second call arriving inside that
  // window sailed past the guard and overwrote the handle, orphaning the first
  // interval permanently. The driver page re-ran this effect every 10s poll.
  if (intervalId || starting) return
  starting = true
  const myGeneration = ++generation

  try {
    const perm = await Geolocation.checkPermissions()
    let granted = perm.location === 'granted'
    if (!granted) {
      const req = await Geolocation.requestPermissions()
      granted = req.location === 'granted'
    }
    if (!granted) return
    if (myGeneration !== generation) return // stopped while we were awaiting

    await reportOnce()
    if (myGeneration !== generation) return

    intervalId = setInterval(reportOnce, REPORT_INTERVAL_MS)
  } catch (e) {
    console.error('location reporting failed to start', e)
  } finally {
    starting = false
  }
}

export function stopLocationReporting() {
  generation++ // invalidate any start still waiting on a GPS fix
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
