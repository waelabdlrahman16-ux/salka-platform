import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const driverIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;transform:translateY(-6px)">🛵</div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 20]
})
function orderIcon(selected: boolean) {
  return L.divIcon({
    html: `<div style="width:${selected ? 34 : 26}px;height:${selected ? 34 : 26}px;border-radius:50%;background:${selected ? '#0A5F5E' : '#FFFFFF'};border:2px solid #0A5F5E;display:flex;align-items:center;justify-content:center;font-size:${selected ? 16 : 13}px;box-shadow:0 1px 3px rgba(0,0,0,.2)">📦</div>`,
    className: '', iconSize: [selected ? 34 : 26, selected ? 34 : 26], iconAnchor: [selected ? 17 : 13, selected ? 17 : 13]
  })
}

interface PoolPin { id: number; lat: number; lng: number }

interface Props {
  pins: PoolPin[]
  selectedId: number | null
  onSelect: (id: number) => void
  heightPx?: number
}

export default function DriverPoolMap({ pins, selectedId, onSelect, heightPx = 220 }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkerRef = useRef<L.Marker | null>(null)
  const orderMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null)
  const hasFitBounds = useRef(false)

  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      pos => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* location unavailable -- map centers on orders only */ },
      { enableHighAccuracy: true, maximumAge: 15000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !myPos) return
    if (!driverMarkerRef.current) driverMarkerRef.current = L.marker([myPos.lat, myPos.lng], { icon: driverIcon }).addTo(map)
    else driverMarkerRef.current.setLatLng([myPos.lat, myPos.lng])
  }, [myPos])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(pins.map(p => p.id))
    for (const [id, marker] of orderMarkersRef.current) {
      if (!currentIds.has(id)) { marker.remove(); orderMarkersRef.current.delete(id) }
    }

    for (const pin of pins) {
      const existing = orderMarkersRef.current.get(pin.id)
      const icon = orderIcon(pin.id === selectedId)
      if (existing) {
        existing.setIcon(icon)
      } else {
        const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(map)
        marker.on('click', () => onSelect(pin.id))
        orderMarkersRef.current.set(pin.id, marker)
      }
    }

    if (!hasFitBounds.current && pins.length > 0) {
      const allPoints: [number, number][] = pins.map(p => [p.lat, p.lng])
      if (myPos) allPoints.push([myPos.lat, myPos.lng])
      map.fitBounds(allPoints, { padding: [30, 30] })
      hasFitBounds.current = true
    }
  }, [pins, selectedId, onSelect, myPos])

  function recenter() {
    const map = mapRef.current
    if (!map) return
    const allPoints: [number, number][] = pins.map(p => [p.lat, p.lng] as [number, number])
    if (myPos) allPoints.push([myPos.lat, myPos.lng])
    if (allPoints.length > 0) map.fitBounds(allPoints, { padding: [30, 30] })
  }

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line" style={{ height: heightPx }}>
      <div ref={containerRef} className="w-full h-full" />
      <button onClick={recenter} aria-label="رجّع للموقع" className="absolute bottom-2.5 left-2.5 bg-white rounded-full w-9 h-9 grid place-items-center shadow-sm">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0A5F5E" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
