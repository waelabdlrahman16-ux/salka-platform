import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { supabase } from './supabase'

const REPORT_INTERVAL_MS = 20000 // every 20s while actively delivering

let intervalId: ReturnType<typeof setInterval> | null = null

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
  if (intervalId) return // already running

  try {
    const perm = await Geolocation.checkPermissions()
    let granted = perm.location === 'granted'
    if (!granted) {
      const req = await Geolocation.requestPermissions()
      granted = req.location === 'granted'
    }
    if (!granted) return

    await reportOnce()
    intervalId = setInterval(reportOnce, REPORT_INTERVAL_MS)
  } catch (e) {
    console.error('location reporting failed to start', e)
  }
}

export function stopLocationReporting() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
