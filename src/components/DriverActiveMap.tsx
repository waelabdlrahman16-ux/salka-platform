import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const driverIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;transform:translateY(-6px)">🛵</div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 20]
})
const destIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;transform:translateY(-6px)">📍</div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 26]
})

interface Props {
  destLat: number | null
  destLng: number | null
  showRoute?: boolean
  heightPx?: number
  myPos: { lat: number; lng: number } | null
  // Without this the map showed "جاري تحديد موقعك…" (still locating) forever
  // when location was actually denied -- contradicting the "الموقع مقفول"
  // banner rendered above it on the page, which correctly said permission was
  // off. Same failure, two components disagreeing about what to tell the
  // driver.
  locationDenied?: boolean
}

export default function DriverActiveMap({ destLat, destLng, showRoute, heightPx = 180, myPos, locationDenied }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkerRef = useRef<L.Marker | null>(null)
  const destMarkerRef = useRef<L.Marker | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

    if (destLat != null && destLng != null) {
      if (!destMarkerRef.current) destMarkerRef.current = L.marker([destLat, destLng], { icon: destIcon }).addTo(map)
      if (showRoute) {
        if (lineRef.current) lineRef.current.remove()
        lineRef.current = L.polyline([[myPos.lat, myPos.lng], [destLat, destLng]], { color: '#0A5F5E', weight: 4 }).addTo(map)
      }
      map.fitBounds([[myPos.lat, myPos.lng], [destLat, destLng]], { padding: [30, 30] })
    } else {
      map.setView([myPos.lat, myPos.lng], 15)
    }
  }, [myPos, destLat, destLng, showRoute])

  function recenter() {
    const map = mapRef.current
    if (!map || !myPos) return
    if (destLat != null && destLng != null) map.fitBounds([[myPos.lat, myPos.lng], [destLat, destLng]], { padding: [30, 30] })
    else map.setView([myPos.lat, myPos.lng], 15)
  }

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line" style={{ height: heightPx }}>
      <div ref={containerRef} className="w-full h-full" />
      {!myPos && (
        <div className="absolute inset-0 bg-shellup grid place-items-center text-sm text-mist text-center px-4">
          {locationDenied ? 'الموقع مقفول. فعّله من إعدادات الموبايل' : 'جاري تحديد موقعك…'}
        </div>
      )}
      <button onClick={recenter} aria-label="رجّع للموقع" className="absolute bottom-2.5 left-2.5 bg-white rounded-full w-9 h-9 grid place-items-center shadow-sm">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0A5F5E" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
