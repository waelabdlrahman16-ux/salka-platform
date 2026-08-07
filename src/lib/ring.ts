// Continuous "incoming call" style ring for the vendor tablet.
// Plays a two-tone pattern on a loop until stop() is called.
import { getAudioContext } from './audioUnlock'

let loopId: ReturnType<typeof setInterval> | null = null

function beep(freq: number, start: number, duration: number) {
  const ctx = getAudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain); gain.connect(ctx.destination)
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
  gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + duration + 0.05)
}

function ringOnce() {
  beep(900, 0, 0.35)
  beep(700, 0.4, 0.35)
}

export function startRinging() {
  if (loopId) return // already ringing
  try {
    ringOnce()
    loopId = setInterval(ringOnce, 1500)
  } catch { /* audio blocked until first user interaction on the page - fine, resumes after a tap */ }
}

export function stopRinging() {
  if (loopId) { clearInterval(loopId); loopId = null }
}

/**
 * A short burst, for a push that arrived while the app is open.
 *
 * Deliberately NOT startRinging(): nothing in a push handler is in a position
 * to decide when the ringing should stop, and a siren with no off switch is
 * worse than silence -- someone mutes the tablet and then misses everything.
 * The server already re-sends every minute until the order is acted on
 * (push_nudge_sweep), so repeated bursts carry the same "keep going until you
 * deal with it" meaning without the risk of getting stuck on.
 *
 * If a continuous ring is already running -- the vendor tablet does this while
 * orders sit unaccepted -- this does nothing rather than hijacking that loop
 * and silencing it early.
 */
export function ringBurst(durationMs = 6000) {
  if (loopId) return
  startRinging()
  const mine = loopId
  setTimeout(() => { if (loopId === mine) stopRinging() }, durationMs)
}
