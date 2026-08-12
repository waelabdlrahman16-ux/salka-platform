import { useEffect, useState } from 'react'
import { audioBlocked, unlockAudio } from '../lib/audioUnlock'

/**
 * Web audio is muted until a real tap. Keep that requirement visible beside
 * notification enrollment rather than letting an incoming order look silent.
 */
export default function EnableSoundButton() {
  const [blocked, setBlocked] = useState(() => audioBlocked())

  useEffect(() => {
    const refresh = () => setBlocked(audioBlocked())
    refresh()
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [])

  if (!blocked) return null

  return (
    <button
      className="w-full mb-3 rounded-xl border border-sand/50 bg-sand/15 px-3.5 py-3 text-right text-sm font-semibold text-sandink"
      onClick={() => { unlockAudio(); setBlocked(audioBlocked()) }}>
      🔇 فعّل صوت التنبيهات على الجهاز ده
    </button>
  )
}
