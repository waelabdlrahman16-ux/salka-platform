import { useRef, useState } from 'react'

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

  function start(clientX: number) {
    if (disabled) return
    const track = trackRef.current
    if (!track) return
    maxDrag.current = track.clientWidth - 56 // thumb width
    startX.current = clientX - dragX
    setDragging(true)
  }

  function move(clientX: number) {
    if (!dragging) return
    let x = clientX - startX.current
    x = Math.max(0, Math.min(maxDrag.current, x))
    setDragX(x)
  }

  function end() {
    if (!dragging) return
    setDragging(false)
    if (dragX >= maxDrag.current * 0.85) {
      setDragX(maxDrag.current)
      if (navigator.vibrate) navigator.vibrate(20)
      onConfirm()
      setTimeout(() => setDragX(0), 400)
    } else {
      setDragX(0)
    }
  }

  return (
    <div ref={trackRef}
      className={`relative w-full rounded-2xl p-1.5 select-none touch-none ${disabled ? 'bg-shellup opacity-50' : 'bg-shellup'}`}
      style={{ height: 64 }}
      onMouseMove={e => move(e.clientX)}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchMove={e => move(e.touches[0].clientX)}
      onTouchEnd={end}>
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
