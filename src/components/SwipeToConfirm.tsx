import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  onConfirm: () => void
  disabled?: boolean
}

export default function SwipeToConfirm({ label, onConfirm, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const maxDrag = useRef(0)
  const dragXRef = useRef(0)
  const firedRef = useRef(false)
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current) }
  }, [])

  function start(clientX: number) {
    if (disabled || firedRef.current) return
    const track = trackRef.current
    if (!track) return
    maxDrag.current = track.clientWidth - 56
    startX.current = clientX - dragX
    setDragging(true)
  }

  function move(clientX: number) {
    let x = clientX - startX.current
    x = Math.max(0, Math.min(maxDrag.current, x))
    dragXRef.current = x
    setDragX(x)
  }

  // onConfirm() used to be called from inside a setDragX updater. React may run
  // an updater more than once -- it deliberately double-invokes under
  // StrictMode, which main.tsx enables -- so mark_delivered could fire twice
  // from a single swipe. The decision is made from a ref outside React state,
  // and firedRef latches so a second swipe during the reset cannot re-fire it.
  function end() {
    setDragging(false)
    const reached = dragXRef.current >= maxDrag.current * 0.85
    if (reached && !firedRef.current) {
      firedRef.current = true
      if (navigator.vibrate) navigator.vibrate(20)
      dragXRef.current = maxDrag.current
      setDragX(maxDrag.current)
      onConfirm()
      resetTimeoutRef.current = setTimeout(() => {
        dragXRef.current = 0
        setDragX(0)
        firedRef.current = false
      }, 400)
      return
    }
    if (!firedRef.current) {
      dragXRef.current = 0
      setDragX(0)
    }
  }

  // Attach move/up listeners to the window while dragging, not just the small
  // track element -- otherwise a fast swipe that leaves the div's bounds
  // stops receiving move events and the thumb gets stuck mid-drag.
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      move(clientX)
    }
    const onUp = () => end()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  return (
    <div ref={trackRef}
      className={`relative w-full rounded-2xl p-1.5 select-none touch-none ${disabled ? 'bg-shellup opacity-50' : 'bg-shellup'}`}
      style={{ height: 64 }}>
      <p className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-mist pointer-events-none">
        {label}
      </p>
      <div
        className="absolute top-1.5 h-[52px] w-14 rounded-xl bg-sea text-white grid place-items-center text-xl"
        style={{ right: 6, transform: `translateX(${-dragX}px)`, transition: dragging ? 'none' : 'transform 0.2s ease' }}
        onMouseDown={e => start(e.clientX)}
        onTouchStart={e => start(e.touches[0].clientX)}>
        ←
      </div>
    </div>
  )
}
