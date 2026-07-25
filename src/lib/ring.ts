// Continuous "incoming call" style ring for the vendor tablet.
// Plays a two-tone pattern on a loop until stop() is called.
let ctx: AudioContext | null = null
let loopId: ReturnType<typeof setInterval> | null = null

function beep(freq: number, start: number, duration: number) {
  if (!ctx) return
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
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)()
    ringOnce()
    loopId = setInterval(ringOnce, 1500)
  } catch { /* audio blocked until first user interaction on the page - fine, resumes after a tap */ }
}

export function stopRinging() {
  if (loopId) { clearInterval(loopId); loopId = null }
}
