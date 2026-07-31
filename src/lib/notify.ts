// Free, no external service: browser notification + beep when new work arrives.
import { getAudioContext } from './audioUnlock'

let prev: Record<string, number> = {}

export function ping(key: string, count: number, title: string, body: string) {
  const last = prev[key]
  prev[key] = count
  if (last === undefined || count <= last) return

  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; gain.gain.value = 0.15
    osc.start(); osc.stop(ctx.currentTime + 0.18)
  } catch { /* audio blocked until first tap - fine */ }

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch { /* unsupported */ }
}

export function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  } catch { /* unsupported */ }
}
